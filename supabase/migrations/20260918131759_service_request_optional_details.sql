-- Value/date/budget may be unknown at submission. Approved requests accept
-- audited complements without rewriting the content covered by signatures.
ALTER TABLE public.billing_service_requests ALTER COLUMN service_value DROP NOT NULL;

CREATE TABLE public.billing_service_request_complements (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 request_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 service_value numeric(16,2) CHECK(service_value>=0), return_date date,
 attachment_ids uuid[] NOT NULL CHECK(cardinality(attachment_ids)<=5),
 actor_id uuid NOT NULL, actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT date_trunc('second',clock_timestamp()),
 input_payload jsonb NOT NULL, record_hash text NOT NULL CHECK(record_hash ~ '^[a-f0-9]{64}$'),
 UNIQUE(owner_id,request_id,version),
 FOREIGN KEY(owner_id,request_id) REFERENCES public.billing_service_requests(owner_id,id) ON DELETE CASCADE
);
ALTER TABLE public.billing_service_request_complements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.billing_service_request_complements FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.billing_service_request_complements TO authenticated;
CREATE POLICY billing_owner_read ON public.billing_service_request_complements FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'requests.read'));
ALTER TABLE public.billing_service_request_complements REPLICA IDENTITY FULL;

CREATE FUNCTION billing_private.request_details_json(p_request public.billing_service_requests) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH entries AS (
  SELECT c.*,jsonb_build_object('id',c.id,'version',c.version,'serviceValue',billing_private.decimal_text(c.service_value),
   'returnDate',c.return_date,'attachmentIds',c.attachment_ids,'actorId',c.actor_id,'actorName',c.actor_name,
   'at',c.created_at,'hash',c.record_hash) AS value
  FROM public.billing_service_request_complements c WHERE c.owner_id=p_request.owner_id AND c.request_id=p_request.id
 ), latest AS (SELECT * FROM entries ORDER BY version DESC LIMIT 1)
 SELECT jsonb_build_object('canComplement',p_request.status='approved' AND billing_private.has_permission('requests.write'),
  'complements',coalesce((SELECT jsonb_agg(value ORDER BY version) FROM entries),'[]'::jsonb),
  'currentDetails',coalesce((SELECT jsonb_build_object('serviceValue',value->'serviceValue','returnDate',value->'returnDate') FROM latest),
   jsonb_build_object('serviceValue',billing_private.decimal_text(p_request.service_value),'returnDate',p_request.return_date)))
$$;

CREATE FUNCTION billing_private.complement_service_request(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid;v_actor uuid:=auth.uid();v_id uuid;v_operation uuid;v_expected uuid;
 v_request public.billing_service_requests;v_previous public.billing_service_request_complements;v_saved public.billing_service_request_complements;
 v_value numeric;v_return date;v_files uuid[];v_input jsonb;v_name text;v_at timestamptz;v_hash text;v_count integer;
BEGIN
 PERFORM billing_private.lock_request_actor();v_owner=billing_private.current_owner_id();
 PERFORM billing_private.authorize('requests.read');PERFORM billing_private.authorize('requests.write');
 PERFORM billing_private.request_payload(p_payload,ARRAY['id','operationId','expectedComplementId','serviceValue','returnDate','attachmentIds']);
 v_id=(p_payload->>'id')::uuid;v_operation=(p_payload->>'operationId')::uuid;v_expected=(p_payload->>'expectedComplementId')::uuid;
 IF v_id IS NULL OR v_operation IS NULL OR NOT (p_payload ?& ARRAY['expectedComplementId','serviceValue','returnDate','attachmentIds'])
  OR (p_payload->>'serviceValue' IS NOT NULL AND (jsonb_typeof(p_payload->'serviceValue')<>'string' OR p_payload->>'serviceValue' !~ '^[0-9]{1,14}([.][0-9]{1,2})?$'))
  OR (p_payload->>'returnDate' IS NOT NULL AND (jsonb_typeof(p_payload->'returnDate')<>'string' OR p_payload->>'returnDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))
  OR jsonb_typeof(p_payload->'attachmentIds') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Confira valor, previsão de retorno e anexos.' USING ERRCODE='22023'; END IF;
 v_value=(p_payload->>'serviceValue')::numeric;v_return=(p_payload->>'returnDate')::date;
 SELECT coalesce(array_agg(DISTINCT value::uuid ORDER BY value::uuid),'{}') INTO v_files FROM jsonb_array_elements_text(p_payload->'attachmentIds');
 IF cardinality(v_files)>5 OR cardinality(v_files)<>jsonb_array_length(p_payload->'attachmentIds') OR array_position(v_files,NULL) IS NOT NULL THEN
  RAISE EXCEPTION 'Informe até cinco anexos distintos.' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('billing-service-request:'||v_owner::text||':'||v_id::text,0));
 SELECT * INTO v_request FROM public.billing_service_requests WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.' USING ERRCODE='P0002'; END IF;
 IF v_request.status<>'approved' THEN RAISE EXCEPTION 'Aguarde a aprovação do diretor para complementar os dados.' USING ERRCODE='23514'; END IF;
 v_input=jsonb_build_object('id',v_id,'expectedComplementId',v_expected,'serviceValue',billing_private.decimal_text(v_value),'returnDate',v_return,'attachmentIds',to_jsonb(v_files));
 SELECT * INTO v_saved FROM public.billing_service_request_complements WHERE id=v_operation;
 IF FOUND THEN
  IF v_saved.owner_id=v_owner AND v_saved.request_id=v_id AND v_saved.actor_id=v_actor AND v_saved.input_payload=v_input THEN
   RETURN jsonb_build_object('request',billing_private.request_json(v_request)); END IF;
  RAISE EXCEPTION 'Identificador já utilizado com outros dados.' USING ERRCODE='23505'; END IF;
 SELECT * INTO v_previous FROM public.billing_service_request_complements WHERE owner_id=v_owner AND request_id=v_id ORDER BY version DESC LIMIT 1;
 IF v_previous.id IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'Os dados foram complementados por outra pessoa. Feche e abra o formulário para conferir a atualização.' USING ERRCODE='40001'; END IF;
 IF cardinality(v_files)=0 AND v_value IS NOT DISTINCT FROM (CASE WHEN v_previous.id IS NULL THEN v_request.service_value ELSE v_previous.service_value END)
  AND v_return IS NOT DISTINCT FROM (CASE WHEN v_previous.id IS NULL THEN v_request.return_date ELSE v_previous.return_date END) THEN
  RAISE EXCEPTION 'Informe um valor, uma previsão de retorno ou um novo anexo para salvar.' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO v_count FROM public.billing_request_files WHERE owner_id=v_owner AND request_id=v_id AND kind='budget' AND consumed_at IS NOT NULL;
 IF v_count+cardinality(v_files)>5 THEN RAISE EXCEPTION 'A solicitação aceita no máximo cinco arquivos de orçamento.' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM public.billing_request_files WHERE owner_id=v_owner AND id=ANY(v_files) ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.billing_request_files f WHERE f.owner_id=v_owner AND f.id=ANY(v_files) AND f.actor_id=v_actor
  AND f.kind='budget' AND f.request_id=v_id AND f.consumed_at IS NULL AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=f.bucket AND o.name=f.path))<>cardinality(v_files) THEN
  RAISE EXCEPTION 'Conclua o envio dos novos orçamentos desta solicitação.' USING ERRCODE='23514'; END IF;
 SELECT coalesce(nullif(btrim(s.name),''),nullif(u.email,''),'Operador') INTO v_name FROM auth.users u
  LEFT JOIN public.billing_user_settings s ON s.user_id=u.id AND s.owner_id=v_owner WHERE u.id=v_actor;
 v_at=date_trunc('second',clock_timestamp());
 v_hash=encode(sha256(convert_to(jsonb_build_object('documentHash',v_request.document_hash,'previousHash',v_previous.record_hash,
  'operationId',v_operation,'input',v_input,'actorId',v_actor,'actorName',v_name,'at',to_char(v_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))::text,'UTF8')),'hex');
 INSERT INTO public.billing_service_request_complements(id,owner_id,request_id,version,service_value,return_date,attachment_ids,actor_id,actor_name,created_at,input_payload,record_hash)
  VALUES(v_operation,v_owner,v_id,coalesce(v_previous.version,0)+1,v_value,v_return,v_files,v_actor,v_name,v_at,v_input,v_hash);
 UPDATE public.billing_request_files SET consumed_at=v_at WHERE owner_id=v_owner AND id=ANY(v_files);
 RETURN jsonb_build_object('request',billing_private.request_json(v_request));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow OR invalid_datetime_format THEN
 RAISE EXCEPTION 'Confira identificadores, valor e previsão de retorno.' USING ERRCODE='22023';
END $$;

DO $$
DECLARE v_definition text;v_old text;
BEGIN
 SELECT pg_get_functiondef('billing_private.service_requests_dispatch(text,jsonb)'::regprocedure) INTO v_definition;
 IF strpos(v_definition,'''prepare-upload'',''create'',''decide''')=0 OR strpos(v_definition,'v_value=(p_payload->>''serviceValue'')::numeric;')=0 THEN RAISE EXCEPTION 'Dispatcher inesperado'; END IF;
 v_definition=replace(v_definition,'''prepare-upload'',''create'',''decide''','''prepare-upload'',''create'',''decide'',''complement''');
 v_definition=replace(v_definition,'IF p_action=''prepare-upload'' THEN', 'IF p_action=''complement'' THEN RETURN billing_private.complement_service_request(p_payload); END IF;
 IF p_action=''prepare-upload'' THEN');
 v_old=$old$OR jsonb_typeof(p_payload->'serviceValue') IS DISTINCT FROM 'string' OR (p_payload->>'serviceValue')!~'^[0-9]{1,14}([.][0-9]{1,2})?$'$old$;
 IF strpos(v_definition,v_old)=0 THEN RAISE EXCEPTION 'Validação de valor inesperada'; END IF;
 v_definition=replace(v_definition,v_old,$new$OR (nullif(p_payload->>'serviceValue','') IS NOT NULL AND (jsonb_typeof(p_payload->'serviceValue')<>'string' OR (p_payload->>'serviceValue')!~'^[0-9]{1,14}([.][0-9]{1,2})?$'))$new$);
 v_definition=replace(v_definition,'v_value=(p_payload->>''serviceValue'')::numeric;','v_value=nullif(p_payload->>''serviceValue'','''')::numeric;');
 -- Omitted budgets are equivalent to an empty initial list, never mandatory.
 v_definition=replace(v_definition,'IF p_action<>''create'' THEN', 'IF p_action=''create'' THEN p_payload=jsonb_build_object(''attachmentIds'',''[]''::jsonb)||p_payload; END IF;
 IF p_action<>''create'' THEN');
 EXECUTE v_definition;
 SELECT pg_get_functiondef('billing_private.request_json(public.billing_service_requests)'::regprocedure) INTO v_definition;
 IF strpos(v_definition,'SELECT jsonb_build_object(')=0 THEN RAISE EXCEPTION 'JSON inesperado'; END IF;
 v_definition=replace(v_definition,'SELECT jsonb_build_object(', 'SELECT billing_private.request_details_json(p_request) || jsonb_build_object(');
 EXECUTE v_definition;
 SELECT pg_get_functiondef('billing_private.prepare_request_file(text,jsonb)'::regprocedure) INTO v_definition;
 v_old=$old$IF EXISTS(SELECT 1 FROM public.billing_service_requests WHERE id=v_request) THEN
   RAISE EXCEPTION 'A solicitação já foi enviada; seus anexos estão protegidos.' USING ERRCODE='23514';$old$;
 IF strpos(v_definition,v_old)=0 THEN RAISE EXCEPTION 'Preparação de upload inesperada'; END IF;
 v_definition=replace(v_definition,v_old,$new$IF EXISTS(SELECT 1 FROM public.billing_service_requests WHERE id=v_request AND (owner_id<>v_owner OR status<>'approved')) THEN
   RAISE EXCEPTION 'Novos anexos podem ser incluídos após a aprovação da solicitação.' USING ERRCODE='23514';$new$);
 EXECUTE v_definition;
 SELECT pg_get_functiondef('billing_private.can_upload_request_file(text,text)'::regprocedure) INTO v_definition;
 v_old='WHERE owner_id=v_file.owner_id AND id=v_file.request_id);';
 IF strpos(v_definition,v_old)=0 THEN RAISE EXCEPTION 'Política de upload inesperada'; END IF;
 v_definition=replace(v_definition,v_old,'WHERE id=v_file.request_id AND (owner_id<>v_file.owner_id OR status<>''approved''));');
 EXECUTE v_definition;
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_service_request_complements;
 END IF;
END $$;
REVOKE ALL ON FUNCTION billing_private.request_details_json(public.billing_service_requests),billing_private.complement_service_request(jsonb) FROM PUBLIC,anon,authenticated;
