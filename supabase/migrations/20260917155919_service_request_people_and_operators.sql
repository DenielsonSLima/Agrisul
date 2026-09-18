-- Requesters are registered people, independent of login accounts. A selected
-- person's signature and the logged-in operator are distinct audit identities.
ALTER TABLE public.billing_signatures ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.billing_service_requests ALTER COLUMN requester_id DROP NOT NULL;
ALTER TABLE public.billing_service_requests ADD COLUMN created_by uuid;
ALTER TABLE public.billing_service_requests ADD COLUMN creator_name text;
UPDATE public.billing_service_requests r SET
 created_by=coalesce((SELECT e.actor_id FROM public.billing_service_request_events e WHERE e.owner_id=r.owner_id AND e.request_id=r.id AND e.action='created'),r.requester_id),
 creator_name=coalesce((SELECT e.actor_name FROM public.billing_service_request_events e WHERE e.owner_id=r.owner_id AND e.request_id=r.id AND e.action='created'),r.requester_name),
 input_payload=r.input_payload||jsonb_build_object('requesterSignatureId',r.requester_signature_id);
ALTER TABLE public.billing_service_requests ALTER COLUMN created_by SET NOT NULL;
ALTER TABLE public.billing_service_requests ALTER COLUMN creator_name SET NOT NULL;
ALTER TABLE public.billing_service_requests ADD CONSTRAINT billing_request_creator_name CHECK(length(btrim(creator_name)) BETWEEN 1 AND 254);
-- Existing submitted requester_id/name/path snapshots remain untouched.
UPDATE public.billing_signatures SET user_id=NULL WHERE role='requester';
ALTER TABLE public.billing_signatures ADD CONSTRAINT billing_signature_person_or_user CHECK(
 (role='requester' AND user_id IS NULL) OR (role='manager' AND user_id IS NOT NULL));
CREATE INDEX billing_service_requests_creator ON public.billing_service_requests(owner_id,created_by,created_at DESC);

CREATE OR REPLACE FUNCTION billing_private.signatures_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();v_actor uuid:=auth.uid();v_signature public.billing_signatures;
 v_file public.billing_request_files;v_id uuid;v_user uuid;v_file_id uuid;v_role text;v_name text;v_search text;v_status text;
 v_page integer;v_size integer;v_total bigint;v_rows jsonb;
BEGIN
 IF v_actor IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('list','options','prepare-upload','save','deactivate') THEN RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023'; END IF;
 IF p_action IN ('prepare-upload','save','deactivate') THEN PERFORM billing_private.lock_request_actor();v_owner=billing_private.current_owner_id(); END IF;
 IF p_action='prepare-upload' THEN RETURN billing_private.prepare_request_file('signature',p_payload); END IF;
 IF p_action IN ('list','options') THEN
  IF NOT billing_private.has_permission('registrations.read') AND NOT billing_private.has_permission('signatures.manage') THEN
   RAISE EXCEPTION 'Você não tem permissão para consultar assinaturas.' USING ERRCODE='42501'; END IF;
 ELSE PERFORM billing_private.authorize('signatures.manage'); END IF;
 IF p_action='options' THEN
  PERFORM billing_private.request_payload(p_payload,'{}');
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',coalesce(s.name,'Usuário')) ORDER BY s.name,m.user_id),'[]') INTO v_rows
   FROM public.billing_memberships m LEFT JOIN public.billing_user_settings s ON s.owner_id=m.owner_id AND s.user_id=m.user_id
   WHERE m.owner_id=v_owner AND m.status='active';
  RETURN jsonb_build_object('users',v_rows,'canManage',billing_private.has_permission('signatures.manage'));
 END IF;
 IF p_action='list' THEN
  PERFORM billing_private.request_payload(p_payload,ARRAY['search','page','pageSize','status']);
  v_search=coalesce(btrim(p_payload->>'search'),'');v_status=coalesce(nullif(p_payload->>'status',''),'all');
  v_page=coalesce((p_payload->>'page')::integer,1);v_size=coalesce((p_payload->>'pageSize')::integer,20);
  IF v_page NOT BETWEEN 1 AND 1000000 OR v_size NOT BETWEEN 1 AND 100 OR length(v_search)>200 OR v_status NOT IN ('active','inactive','all') THEN
   RAISE EXCEPTION 'Filtros de assinaturas inválidos.' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO v_total FROM public.billing_signatures s WHERE s.owner_id=v_owner AND (v_status='all' OR s.active=(v_status='active'))
   AND (v_search='' OR s.name ILIKE '%'||v_search||'%');
  v_page=least(v_page,greatest(1,ceil(v_total::numeric/v_size)::integer));
  SELECT coalesce(jsonb_agg(billing_private.signature_json(s) ORDER BY lower(s.name),s.id),'[]') INTO v_rows FROM (
   SELECT * FROM public.billing_signatures s WHERE s.owner_id=v_owner AND (v_status='all' OR s.active=(v_status='active'))
    AND (v_search='' OR s.name ILIKE '%'||v_search||'%') ORDER BY lower(s.name),s.id LIMIT v_size OFFSET (v_page-1)*v_size) s;
  RETURN jsonb_build_object('items',v_rows,'total',v_total,'page',v_page,'pageSize',v_size);
 END IF;
 IF p_action='deactivate' THEN
  PERFORM billing_private.request_payload(p_payload,ARRAY['id']);
  UPDATE public.billing_signatures SET active=false,updated_by=v_actor,updated_at=date_trunc('second',clock_timestamp())
   WHERE owner_id=v_owner AND id=(p_payload->>'id')::uuid RETURNING * INTO v_signature;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assinatura não encontrada.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('signature',billing_private.signature_json(v_signature));
 END IF;
 IF p_action<>'save' THEN RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023'; END IF;
 PERFORM billing_private.request_payload(p_payload,ARRAY['id','name','userId','role','fileId','active']);
 v_id=nullif(p_payload->>'id','')::uuid;v_user=(p_payload->>'userId')::uuid;v_role=p_payload->>'role';v_name=btrim(p_payload->>'name');
 IF v_role IS NULL OR v_role NOT IN ('requester','manager') OR jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string'
  OR length(v_name) NOT BETWEEN 2 AND 150 OR (p_payload ? 'active' AND p_payload->'active'<>'true'::jsonb) THEN
  RAISE EXCEPTION 'Confira o nome, usuário e função da assinatura.' USING ERRCODE='22023'; END IF;
 IF v_role='manager' THEN
  -- Only the approver is linked to an authenticated account.
  PERFORM 1 FROM public.billing_memberships WHERE owner_id=v_owner AND user_id=v_user AND status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecione um usuário ativo deste espaço para o gerente.' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('billing-signature:'||v_owner::text||':'||v_user::text||':manager',0));
 ELSIF v_user IS NOT NULL THEN
  RAISE EXCEPTION 'Solicitantes são pessoas cadastradas sem vínculo com uma conta. Não informe usuário.' USING ERRCODE='22023';
 END IF;
 IF v_id IS NOT NULL THEN
  SELECT * INTO v_signature FROM public.billing_signatures WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assinatura não encontrada.' USING ERRCODE='P0002'; END IF;
 END IF;
 v_file_id=coalesce(nullif(p_payload->>'fileId','')::uuid,v_signature.file_id);
 SELECT * INTO v_file FROM public.billing_request_files WHERE owner_id=v_owner AND id=v_file_id AND kind='signature' FOR UPDATE;
 IF NOT FOUND OR (v_file_id IS DISTINCT FROM v_signature.file_id AND (v_file.actor_id<>v_actor OR v_file.consumed_at IS NOT NULL)) THEN
  RAISE EXCEPTION 'Envie um novo arquivo PNG para esta assinatura.' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=v_file.bucket AND name=v_file.path) THEN
  RAISE EXCEPTION 'O envio da assinatura ainda não foi concluído.' USING ERRCODE='23514'; END IF;
 IF v_id IS NULL THEN
  INSERT INTO public.billing_signatures(owner_id,user_id,name,role,file_id,created_by,updated_by)
   VALUES(v_owner,v_user,v_name,v_role,v_file_id,v_actor,v_actor) RETURNING * INTO v_signature;
 ELSE
  UPDATE public.billing_signatures SET user_id=v_user,name=v_name,role=v_role,file_id=v_file_id,active=true,
   updated_by=v_actor,updated_at=date_trunc('second',clock_timestamp()) WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_signature;
 END IF;
 UPDATE public.billing_request_files SET consumed_at=coalesce(consumed_at,date_trunc('second',clock_timestamp())) WHERE owner_id=v_owner AND id=v_file_id;
 RETURN jsonb_build_object('signature',billing_private.signature_json(v_signature));
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Este usuário já possui assinatura ativa para essa função.' USING ERRCODE='23505';
 WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'Confira os dados da assinatura.' USING ERRCODE='22023';
END $$;

CREATE OR REPLACE FUNCTION billing_private.request_json(p_request public.billing_service_requests) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',p_request.id,'number',p_request.number,'status',p_request.status,'companyName',p_request.company_name,
  'companyAddress',p_request.company_address,'items',p_request.items,'serviceValue',billing_private.decimal_text(p_request.service_value),
  'returnDate',p_request.return_date,'notes',p_request.notes,'createdAt',p_request.created_at,
  'createdBy',jsonb_build_object('userId',p_request.created_by,'name',p_request.creator_name),
  'requester',jsonb_build_object('userId',p_request.requester_id,'name',p_request.requester_name,'signatureId',p_request.requester_signature_id,'signaturePath',p_request.requester_signature_path),
  'decision',CASE WHEN p_request.status='pending' THEN NULL ELSE jsonb_build_object('userId',p_request.decided_by,'name',p_request.decider_name,
   'signatureId',p_request.decider_signature_id,'signaturePath',p_request.decider_signature_path,'at',p_request.decided_at,'reason',p_request.decision_reason) END,
  'canDecide',p_request.status='pending' AND billing_private.has_permission('requests.approve') AND EXISTS(
    SELECT 1 FROM public.billing_signatures s JOIN public.billing_memberships m ON m.owner_id=s.owner_id AND m.user_id=s.user_id AND m.status='active'
    WHERE s.owner_id=p_request.owner_id AND s.user_id=auth.uid() AND s.role='manager' AND s.active),
  'attachments',coalesce((SELECT jsonb_agg(billing_private.request_file_json(f) ORDER BY f.created_at,f.id)
   FROM public.billing_request_files f WHERE f.owner_id=p_request.owner_id AND f.request_id=p_request.id AND f.consumed_at IS NOT NULL),'[]'::jsonb),
  'history',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'actorId',e.actor_id,'actorName',e.actor_name,
    'signaturePath',e.signature_path,'at',e.created_at,'reason',e.reason) ORDER BY e.created_at,CASE e.action WHEN 'created' THEN 0 ELSE 1 END,e.id)
   FROM public.billing_service_request_events e WHERE e.owner_id=p_request.owner_id AND e.request_id=p_request.id),'[]'::jsonb))
$$;

CREATE OR REPLACE FUNCTION billing_private.service_requests_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();v_actor uuid:=auth.uid();v_request public.billing_service_requests;
 v_signature public.billing_signatures;v_file public.billing_request_files;v_id uuid;v_requester uuid;v_file_ids uuid[];
 v_signature_id uuid;v_creator_name text;v_value numeric;v_return date;v_items jsonb:='[]';v_item jsonb;v_input jsonb;v_rows jsonb;v_users jsonb;v_requester_signatures jsonb;v_manager_signature jsonb;
 v_search text;v_tab text;v_from date;v_to date;v_page integer;v_size integer;v_total bigint;v_pending bigint;v_finished bigint;
 v_decision text;v_reason text;v_at timestamptz;v_number bigint;v_name text;v_address text;v_notes text;
BEGIN
 IF v_actor IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('list','get','options','prepare-upload','create','decide') THEN RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023'; END IF;
 IF p_action IN ('prepare-upload','create','decide') THEN PERFORM billing_private.lock_request_actor();v_owner=billing_private.current_owner_id(); END IF;
 PERFORM billing_private.authorize('requests.read');
 IF p_action='prepare-upload' THEN RETURN billing_private.prepare_request_file('budget',p_payload); END IF;
 IF p_action='options' THEN
  PERFORM billing_private.request_payload(p_payload,'{}');
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name) ORDER BY lower(u.name),u.id),'[]') INTO v_users FROM (
   SELECT DISTINCT ON (id) id,name FROM (
    SELECT s.id,s.name,0 AS priority FROM public.billing_signatures s WHERE s.owner_id=v_owner AND s.role='requester'
    UNION ALL SELECT r.requester_signature_id,r.requester_name,1 FROM public.billing_service_requests r WHERE r.owner_id=v_owner
   ) candidates ORDER BY id,priority,name
  ) u;
  SELECT coalesce(jsonb_agg(billing_private.signature_json(s) ORDER BY lower(s.name),s.id),'[]') INTO v_requester_signatures
   FROM public.billing_signatures s WHERE s.owner_id=v_owner AND s.role='requester' AND s.active;
  SELECT billing_private.signature_json(s) INTO v_manager_signature FROM public.billing_signatures s
   WHERE s.owner_id=v_owner AND s.user_id=v_actor AND s.role='manager' AND s.active;
  RETURN jsonb_build_object('requesters',v_users,'requesterSignatures',v_requester_signatures,'managerSignature',v_manager_signature,
   'canCreate',billing_private.has_permission('requests.write'),'canDecide',billing_private.has_permission('requests.approve'),'actorId',v_actor);
 END IF;
 IF p_action='list' THEN
  PERFORM billing_private.request_payload(p_payload,ARRAY['search','dateFrom','dateTo','requesterId','tab','page','pageSize']);
  v_search=coalesce(btrim(p_payload->>'search'),'');v_tab=coalesce(nullif(p_payload->>'tab',''),'pending');
  v_from=nullif(p_payload->>'dateFrom','')::date;v_to=nullif(p_payload->>'dateTo','')::date;
  v_requester=nullif(p_payload->>'requesterId','')::uuid;
  v_page=coalesce((p_payload->>'page')::integer,1);v_size=coalesce((p_payload->>'pageSize')::integer,20);
  IF v_page NOT BETWEEN 1 AND 1000000 OR v_size NOT BETWEEN 1 AND 100 OR length(v_search)>200 OR v_tab NOT IN ('pending','finished')
   OR v_from>v_to THEN RAISE EXCEPTION 'Filtros da solicitação inválidos.' USING ERRCODE='22023'; END IF;
  WITH filtered AS (
   SELECT r.* FROM public.billing_service_requests r WHERE r.owner_id=v_owner
    AND (v_from IS NULL OR r.created_at >= (v_from::timestamp AT TIME ZONE 'America/Sao_Paulo'))
    AND (v_to IS NULL OR r.created_at < ((v_to+1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
    AND (v_requester IS NULL OR r.requester_signature_id=v_requester)
    AND (v_search='' OR r.number::text ILIKE '%'||v_search||'%' OR r.company_name ILIKE '%'||v_search||'%'
     OR r.requester_name ILIKE '%'||v_search||'%' OR r.items::text ILIKE '%'||v_search||'%')
  ), totals AS (
   SELECT count(*) FILTER(WHERE status='pending') AS pending,count(*) FILTER(WHERE status<>'pending') AS finished FROM filtered
  ), pagination AS (
   SELECT least(v_page,greatest(1,ceil((CASE v_tab WHEN 'pending' THEN pending ELSE finished END)::numeric/v_size)::integer)) AS page FROM totals
  ), paginated AS (
   SELECT * FROM filtered r WHERE (v_tab='pending' AND r.status='pending') OR (v_tab='finished' AND r.status<>'pending')
   ORDER BY r.created_at DESC,r.number DESC LIMIT v_size OFFSET (SELECT (page-1)*v_size FROM pagination)
  )
  SELECT (SELECT pending FROM totals),(SELECT finished FROM totals),(SELECT page FROM pagination),
   coalesce((SELECT jsonb_agg(billing_private.request_json(r::public.billing_service_requests) ORDER BY r.created_at DESC,r.number DESC) FROM paginated r),'[]')
   INTO v_pending,v_finished,v_page,v_rows;
  v_total=CASE WHEN v_tab='pending' THEN v_pending ELSE v_finished END;
  RETURN jsonb_build_object('items',v_rows,'total',v_total,'page',v_page,'pageSize',v_size,'counts',jsonb_build_object('pending',v_pending,'finished',v_finished));
 END IF;
 IF p_action='get' THEN
  PERFORM billing_private.request_payload(p_payload,ARRAY['id']);
  SELECT * INTO v_request FROM public.billing_service_requests WHERE owner_id=v_owner AND id=(p_payload->>'id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('request',billing_private.request_json(v_request));
 END IF;
 IF p_action='decide' THEN
  PERFORM billing_private.authorize('requests.approve');
  PERFORM billing_private.request_payload(p_payload,ARRAY['id','decision','reason']);
  v_id=(p_payload->>'id')::uuid;v_decision=p_payload->>'decision';v_reason=coalesce(btrim(p_payload->>'reason'),'');
  IF v_id IS NULL OR v_decision IS NULL OR v_decision NOT IN ('approved','rejected') OR length(v_reason)>2000
   OR (p_payload ? 'reason' AND jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string')
   OR (v_decision='rejected' AND length(v_reason)<3) THEN
   RAISE EXCEPTION 'Informe uma decisão válida e o motivo da recusa.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_request FROM public.billing_service_requests WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.' USING ERRCODE='P0002'; END IF;
  IF v_request.status<>'pending' THEN
   IF v_request.status=v_decision AND v_request.decided_by=v_actor AND v_request.decision_reason=v_reason THEN
    RETURN jsonb_build_object('request',billing_private.request_json(v_request)); END IF;
   RAISE EXCEPTION 'Esta solicitação já foi finalizada. Atualize a lista.' USING ERRCODE='40001';
  END IF;
  SELECT * INTO v_signature FROM public.billing_signatures
   WHERE owner_id=v_owner AND user_id=v_actor AND role='manager' AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cadastre uma assinatura de gerente ativa para seu usuário antes de decidir.' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_file FROM public.billing_request_files WHERE owner_id=v_owner AND id=v_signature.file_id;
  v_at=date_trunc('second',clock_timestamp());
  UPDATE public.billing_service_requests SET status=v_decision,decided_by=v_actor,decider_name=v_signature.name,
   decider_signature_id=v_signature.id,decider_signature_path=v_file.path,decided_at=v_at,decision_reason=v_reason
   WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_request;
  INSERT INTO public.billing_service_request_events(owner_id,request_id,action,actor_id,actor_name,signature_path,reason,created_at)
   VALUES(v_owner,v_id,v_decision,v_actor,v_signature.name,v_file.path,v_reason,v_at);
  RETURN jsonb_build_object('request',billing_private.request_json(v_request));
 END IF;
 IF p_action<>'create' THEN RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023'; END IF;
 PERFORM billing_private.authorize('requests.write');
 PERFORM billing_private.request_payload(p_payload,ARRAY['requestId','requesterSignatureId','companyName','companyAddress','items','serviceValue','returnDate','notes','attachmentIds']);
 v_id=(p_payload->>'requestId')::uuid;v_signature_id=(p_payload->>'requesterSignatureId')::uuid;v_name=btrim(p_payload->>'companyName');v_address=coalesce(btrim(p_payload->>'companyAddress'),'');v_notes=coalesce(btrim(p_payload->>'notes'),'');
 IF v_id IS NULL OR v_signature_id IS NULL OR jsonb_typeof(p_payload->'companyName') IS DISTINCT FROM 'string' OR length(v_name) NOT BETWEEN 2 AND 200
  OR length(v_address)>500 OR length(v_notes)>4000
  OR (p_payload ? 'companyAddress' AND jsonb_typeof(p_payload->'companyAddress') IS DISTINCT FROM 'string')
  OR (p_payload ? 'notes' AND jsonb_typeof(p_payload->'notes') IS DISTINCT FROM 'string')
  OR jsonb_typeof(p_payload->'serviceValue') IS DISTINCT FROM 'string' OR (p_payload->>'serviceValue')!~'^[0-9]{1,14}([.][0-9]{1,2})?$'
  OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_typeof(p_payload->'attachmentIds') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Confira empresa, itens, valor do serviço e orçamento.' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 50 OR jsonb_array_length(p_payload->'attachmentIds') NOT BETWEEN 1 AND 5 THEN
  RAISE EXCEPTION 'Inclua de 1 a 50 itens e de 1 a 5 arquivos de orçamento.' USING ERRCODE='22023'; END IF;
 v_value=(p_payload->>'serviceValue')::numeric;
 IF p_payload->>'returnDate' IS NOT NULL AND (jsonb_typeof(p_payload->'returnDate')<>'string' OR (p_payload->>'returnDate')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN
  RAISE EXCEPTION 'Informe uma data de retorno válida.' USING ERRCODE='22023'; END IF;
 v_return=(p_payload->>'returnDate')::date;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
  PERFORM billing_private.request_payload(v_item,ARRAY['description','application']);
  IF jsonb_typeof(v_item->'description') IS DISTINCT FROM 'string' OR length(btrim(v_item->>'description')) NOT BETWEEN 2 AND 2000
   OR jsonb_typeof(v_item->'application') IS DISTINCT FROM 'string' OR length(btrim(v_item->>'application')) NOT BETWEEN 1 AND 1000 THEN
   RAISE EXCEPTION 'Preencha descrição e aplicação de cada equipamento/material.' USING ERRCODE='22023'; END IF;
  v_items=v_items||jsonb_build_array(jsonb_build_object('description',btrim(v_item->>'description'),'application',btrim(v_item->>'application')));
 END LOOP;
 SELECT array_agg(value::uuid ORDER BY value::uuid) INTO v_file_ids FROM jsonb_array_elements_text(p_payload->'attachmentIds');
 IF cardinality(v_file_ids)<>(SELECT count(DISTINCT id) FROM unnest(v_file_ids) id) THEN
  RAISE EXCEPTION 'Anexos repetidos não são permitidos.' USING ERRCODE='22023'; END IF;
 v_input=jsonb_build_object('requesterSignatureId',v_signature_id,'companyName',v_name,'companyAddress',v_address,'items',v_items,'serviceValue',billing_private.decimal_text(v_value),
  'returnDate',v_return,'notes',v_notes,'attachmentIds',to_jsonb(v_file_ids));
 PERFORM pg_advisory_xact_lock(hashtextextended('billing-service-request:'||v_owner::text||':'||v_id::text,0));
 SELECT * INTO v_request FROM public.billing_service_requests WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
 IF FOUND THEN
  IF v_request.created_by=v_actor AND v_request.input_payload=v_input THEN RETURN jsonb_build_object('request',billing_private.request_json(v_request)); END IF;
  RAISE EXCEPTION 'O identificador já foi utilizado com outros dados.' USING ERRCODE='23505';
 END IF;
 SELECT * INTO v_signature FROM public.billing_signatures
  WHERE owner_id=v_owner AND id=v_signature_id AND role='requester' AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Selecione uma pessoa solicitante ativa deste espaço antes de enviar.' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM public.billing_request_files WHERE owner_id=v_owner AND id=ANY(v_file_ids) ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.billing_request_files f WHERE f.owner_id=v_owner AND f.id=ANY(v_file_ids)
  AND f.actor_id=v_actor AND f.kind='budget' AND f.request_id=v_id AND f.consumed_at IS NULL
  AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=f.bucket AND o.name=f.path))<>cardinality(v_file_ids) THEN
  RAISE EXCEPTION 'Conclua o envio de todos os orçamentos desta solicitação.' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_file FROM public.billing_request_files WHERE owner_id=v_owner AND id=v_signature.file_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('billing-service-number:'||v_owner::text,0));
 SELECT coalesce(max(number),0)+1 INTO v_number FROM public.billing_service_requests WHERE owner_id=v_owner;
 v_at=date_trunc('second',clock_timestamp());
 SELECT coalesce(nullif(btrim(s.name),''),nullif(u.email,''),'Operador') INTO v_creator_name
  FROM auth.users u LEFT JOIN public.billing_user_settings s ON s.user_id=u.id AND s.owner_id=v_owner WHERE u.id=v_actor;
 INSERT INTO public.billing_service_requests(id,owner_id,number,company_name,company_address,items,service_value,return_date,notes,
  requester_id,requester_name,requester_signature_id,requester_signature_path,created_at,input_payload,created_by,creator_name)
 VALUES(v_id,v_owner,v_number,v_name,v_address,v_items,v_value,v_return,v_notes,NULL,v_signature.name,v_signature.id,v_file.path,v_at,v_input,v_actor,v_creator_name)
 RETURNING * INTO v_request;
 UPDATE public.billing_request_files SET consumed_at=v_at WHERE owner_id=v_owner AND id=ANY(v_file_ids);
 INSERT INTO public.billing_service_request_events(owner_id,request_id,action,actor_id,actor_name,signature_path,created_at)
  VALUES(v_owner,v_id,'created',v_actor,v_creator_name,v_file.path,v_at);
 RETURN jsonb_build_object('request',billing_private.request_json(v_request));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow OR invalid_datetime_format THEN
 RAISE EXCEPTION 'Confira identificadores, valores, datas e filtros informados.' USING ERRCODE='22023';
END $$;

CREATE OR REPLACE FUNCTION billing_private.can_read_request_file(p_bucket text,p_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.billing_request_files f WHERE f.bucket=p_bucket AND f.path=p_path
  AND f.owner_id=billing_private.current_owner_id() AND (
   (f.kind='budget' AND ((f.consumed_at IS NOT NULL AND billing_private.has_permission('requests.read'))
     OR (f.actor_id=auth.uid() AND billing_private.has_permission('requests.write'))))
   OR (f.kind='signature' AND (billing_private.has_permission('signatures.manage') OR billing_private.has_permission('registrations.read')
    OR (billing_private.has_permission('requests.read') AND (
      EXISTS(SELECT 1 FROM public.billing_signatures s WHERE s.owner_id=f.owner_id AND s.file_id=f.id AND (s.user_id=auth.uid() OR (s.role='requester' AND s.active)))
      OR EXISTS(SELECT 1 FROM public.billing_service_requests r WHERE r.owner_id=f.owner_id
       AND (r.requester_signature_path=f.path OR r.decider_signature_path=f.path))))))))
$$;

DROP POLICY billing_owner_read ON public.billing_signatures;
CREATE POLICY billing_owner_read ON public.billing_signatures FOR SELECT TO authenticated USING(
 billing_private.can_access_owner(owner_id,'signatures.manage') OR billing_private.can_access_owner(owner_id,'registrations.read')
 OR ((role='requester' OR user_id=auth.uid()) AND billing_private.can_access_owner(owner_id,'requests.read'))
 OR (billing_private.can_access_owner(owner_id,'requests.read') AND EXISTS(SELECT 1 FROM public.billing_service_requests r
  WHERE r.owner_id=billing_signatures.owner_id AND (r.requester_signature_id=billing_signatures.id OR r.decider_signature_id=billing_signatures.id))));
COMMENT ON COLUMN public.billing_service_requests.created_by IS 'Logged-in operator from auth.uid(); never the selected requester person.';
COMMENT ON COLUMN public.billing_service_requests.requester_id IS 'Legacy requester login snapshot only. New requester people have no login and this value is NULL.';
COMMENT ON TABLE public.billing_signatures IS 'Registered people (requester, without a login) and approvers (manager, linked to their active account). Images remain immutable.';
