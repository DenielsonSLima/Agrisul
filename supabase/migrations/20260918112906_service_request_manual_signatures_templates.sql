-- Optional handwritten signatures, server-owned document templates and record
-- hashes. These hashes identify immutable records; they are not digital signing
-- certificates, and do not claim to be hashes of PNG bytes in Storage.
ALTER TABLE public.billing_signatures ALTER COLUMN file_id DROP NOT NULL;
ALTER TABLE public.billing_service_requests ALTER COLUMN requester_signature_path DROP NOT NULL;
ALTER TABLE public.billing_service_requests ADD COLUMN requester_signing_mode text NOT NULL DEFAULT 'registered' CHECK(requester_signing_mode IN ('registered','manual'));
ALTER TABLE public.billing_service_requests ADD COLUMN decision_signing_mode text CHECK(decision_signing_mode IN ('registered','manual'));
ALTER TABLE public.billing_service_requests ADD COLUMN template_snapshot jsonb;
ALTER TABLE public.billing_service_requests ADD COLUMN document_hash text;
ALTER TABLE public.billing_service_requests ADD COLUMN requester_signature_hash text;
ALTER TABLE public.billing_service_requests ADD COLUMN decision_signature_hash text;
ALTER TABLE public.billing_service_request_events ALTER COLUMN signature_path DROP NOT NULL;
ALTER TABLE public.billing_service_request_events ADD COLUMN signing_mode text NOT NULL DEFAULT 'registered' CHECK(signing_mode IN ('registered','manual'));
ALTER TABLE public.billing_service_request_events ADD COLUMN signature_hash text;

CREATE TABLE public.billing_document_templates (
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 key text NOT NULL CHECK(key='service-request'),name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 120),
 version integer NOT NULL CHECK(version>=1),layout jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT date_trunc('second',clock_timestamp()),updated_by uuid NOT NULL,
 PRIMARY KEY(owner_id,key)
);
CREATE FUNCTION billing_private.default_request_template() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('key','service-request','name','Solicitação de serviço','module','requests','version',0,'updatedAt',NULL,'updatedBy',NULL,
 'layout','{"page":{"width":210,"height":297},"blocks":[{"id":"brand","type":"text","x":16,"y":14,"width":130,"height":6,"text":"CONTROLE DE FATURAMENTO","fontSize":8,"fontWeight":"bold"},{"id":"title","type":"text","x":16,"y":24,"width":142,"height":12,"text":"SOLICITAÇÃO DE SERVIÇO","fontSize":16,"fontWeight":"bold"},{"id":"number","type":"field","x":161,"y":24,"width":33,"height":12,"field":"requestNumber","fontSize":12,"fontWeight":"bold","align":"right"},{"id":"top-rule","type":"line","x":16,"y":39,"width":178,"height":0.4},{"id":"company-label","type":"text","x":16,"y":45,"width":29,"height":7,"text":"EMPRESA","fontSize":9,"fontWeight":"bold"},{"id":"company","type":"field","x":48,"y":45,"width":146,"height":7,"field":"companyName","fontSize":10},{"id":"address-label","type":"text","x":16,"y":55,"width":29,"height":7,"text":"ENDEREÇO","fontSize":9,"fontWeight":"bold"},{"id":"address","type":"field","x":48,"y":55,"width":146,"height":7,"field":"companyAddress","fontSize":9},{"id":"instruction","type":"text","x":16,"y":68,"width":178,"height":17,"text":"Solicitamos a execução do serviço no equipamento / material abaixo, mediante apresentação prévia de orçamento. Cite o número desta solicitação no orçamento.","fontSize":9},{"id":"items","type":"items","x":16,"y":90,"width":178,"height":71,"fontSize":9},{"id":"value-label","type":"text","x":16,"y":169,"width":80,"height":6,"text":"VALOR DO SERVIÇO","fontSize":8,"fontWeight":"bold"},{"id":"value","type":"field","x":16,"y":177,"width":80,"height":8,"field":"serviceValue","fontSize":12,"fontWeight":"bold"},{"id":"return-label","type":"text","x":112,"y":169,"width":82,"height":6,"text":"PREVISÃO DE RETORNO","fontSize":8,"fontWeight":"bold"},{"id":"return","type":"field","x":112,"y":177,"width":82,"height":8,"field":"returnDate","fontSize":10},{"id":"notes-label","type":"text","x":16,"y":190,"width":178,"height":5,"text":"OBSERVAÇÕES","fontSize":8,"fontWeight":"bold"},{"id":"notes","type":"field","x":16,"y":197,"width":178,"height":10,"field":"notes","fontSize":8},{"id":"requester-signature","type":"signature","x":16,"y":215,"width":82,"height":41,"field":"requester","fontSize":8,"align":"center"},{"id":"director-signature","type":"signature","x":112,"y":215,"width":82,"height":41,"field":"director","fontSize":8,"align":"center"},{"id":"verification","type":"verification","x":16,"y":260,"width":178,"height":24,"fontSize":8},{"id":"operator","type":"field","x":16,"y":288,"width":178,"height":5,"field":"createdByName","fontSize":8}]}'::jsonb)
$$;
CREATE FUNCTION billing_private.validate_document_layout(p_layout jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v_block jsonb;v_ids text[]:='{}';v_id text;v_type text;v_field text;v_x numeric;v_y numeric;v_w numeric;v_h numeric;v_key text;
BEGIN
 PERFORM billing_private.request_payload(p_layout,ARRAY['page','blocks']);
 PERFORM billing_private.request_payload(p_layout->'page',ARRAY['width','height']);
 IF p_layout->'page' IS DISTINCT FROM '{"width":210,"height":297}'::jsonb OR jsonb_typeof(p_layout->'blocks') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'O modelo deve usar página A4 de 210 × 297 mm e uma lista de blocos.' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_layout->'blocks') NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'Use entre 1 e 40 blocos no modelo.' USING ERRCODE='22023'; END IF;
 FOR v_block IN SELECT value FROM jsonb_array_elements(p_layout->'blocks') LOOP
  PERFORM billing_private.request_payload(v_block,ARRAY['id','type','x','y','width','height','text','field','fontSize','fontFamily','fontWeight','align']);
  v_id=v_block->>'id';v_type=v_block->>'type';v_field=v_block->>'field';
  IF jsonb_typeof(v_block->'id') IS DISTINCT FROM 'string' OR v_id!~'^[a-zA-Z0-9_-]{1,60}$' OR v_id=ANY(v_ids)
   OR v_type IS NULL OR v_type NOT IN ('text','field','items','signature','verification','line') THEN
   RAISE EXCEPTION 'Blocos devem ter identificadores únicos e um tipo permitido.' USING ERRCODE='22023'; END IF;
  v_ids=array_append(v_ids,v_id);
  FOREACH v_key IN ARRAY ARRAY['x','y','width','height'] LOOP
   IF jsonb_typeof(v_block->v_key) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Posições e dimensões devem ser numéricas, em milímetros.' USING ERRCODE='22023'; END IF;
  END LOOP;
  v_x=(v_block->>'x')::numeric;v_y=(v_block->>'y')::numeric;v_w=(v_block->>'width')::numeric;v_h=(v_block->>'height')::numeric;
  IF v_x<0 OR v_y<0 OR v_w<=0 OR v_h<=0 OR v_x+v_w>210 OR v_y+v_h>297 THEN
   RAISE EXCEPTION 'Todos os blocos devem permanecer dentro da página A4.' USING ERRCODE='22023'; END IF;
  IF v_block ? 'fontSize' AND (jsonb_typeof(v_block->'fontSize') IS DISTINCT FROM 'number' OR (v_block->>'fontSize')::numeric NOT BETWEEN 8 AND 28) THEN
   RAISE EXCEPTION 'O tamanho da fonte deve ficar entre 8 e 28 pontos.' USING ERRCODE='22023'; END IF;
  IF (v_block ? 'fontFamily' AND coalesce(v_block->>'fontFamily','') NOT IN ('sans','serif','mono'))
   OR (v_block ? 'fontWeight' AND coalesce(v_block->>'fontWeight','') NOT IN ('normal','bold'))
   OR (v_block ? 'align' AND coalesce(v_block->>'align','') NOT IN ('left','center','right')) THEN
   RAISE EXCEPTION 'Confira fonte, peso e alinhamento do bloco.' USING ERRCODE='22023'; END IF;
  IF v_type='text' AND (jsonb_typeof(v_block->'text') IS DISTINCT FROM 'string' OR length(v_block->>'text')>2000) THEN
   RAISE EXCEPTION 'Blocos de texto aceitam até 2000 caracteres.' USING ERRCODE='22023'; END IF;
  IF (v_type<>'text' AND v_block ? 'text') OR (v_type NOT IN ('field','signature') AND v_block ? 'field') THEN
   RAISE EXCEPTION 'Texto e campo não correspondem ao tipo do bloco.' USING ERRCODE='22023'; END IF;
  IF v_type='field' AND (v_field IS NULL OR v_field NOT IN ('requestNumber','companyName','companyAddress','serviceValue','returnDate','notes','requesterName','directorName','createdAt','decidedAt','createdByName','status','verificationCode')) THEN
   RAISE EXCEPTION 'Selecione um campo de documento permitido.' USING ERRCODE='22023'; END IF;
  IF v_type='signature' AND (v_field IS NULL OR v_field NOT IN ('requester','director')) THEN
   RAISE EXCEPTION 'Selecione a assinatura do solicitante ou do diretor geral.' USING ERRCODE='22023'; END IF;
 END LOOP;
END $$;
CREATE FUNCTION billing_private.current_request_template() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT jsonb_build_object('key',t.key,'name',t.name,'module','requests','version',t.version,'layout',t.layout,'updatedAt',t.updated_at,'updatedBy',t.updated_by)
  FROM public.billing_document_templates t WHERE t.owner_id=billing_private.current_owner_id() AND t.key='service-request'),billing_private.default_request_template())
$$;
CREATE FUNCTION billing_private.document_templates_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();v_current public.billing_document_templates;v_expected integer;v_name text;v_key text;v_template jsonb;
BEGIN
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('list','get','save') THEN RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023'; END IF;
 IF p_action='save' THEN PERFORM billing_private.lock_request_actor();v_owner=billing_private.current_owner_id();PERFORM billing_private.authorize('report-headers.write');
 ELSIF NOT billing_private.has_permission('requests.read') AND NOT billing_private.has_permission('report-headers.read') THEN
  RAISE EXCEPTION 'Você não tem permissão para consultar modelos de documento.' USING ERRCODE='42501'; END IF;
 IF p_action='list' THEN
  PERFORM billing_private.request_payload(p_payload,'{}');
  RETURN jsonb_build_object('items',jsonb_build_array(billing_private.current_request_template()),'canManage',billing_private.has_permission('report-headers.write'));
 END IF;
 PERFORM billing_private.request_payload(p_payload,CASE p_action WHEN 'get' THEN ARRAY['key'] ELSE ARRAY['key','name','layout','expectedVersion'] END);
 v_key=p_payload->>'key';
 IF v_key IS DISTINCT FROM 'service-request' THEN RAISE EXCEPTION 'Modelo de documento não encontrado.' USING ERRCODE='P0002'; END IF;
 IF p_action='get' THEN RETURN jsonb_build_object('template',billing_private.current_request_template(),'canManage',billing_private.has_permission('report-headers.write')); END IF;
 IF jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'name')) NOT BETWEEN 2 AND 120
  OR jsonb_typeof(p_payload->'expectedVersion') IS DISTINCT FROM 'number' OR (p_payload->>'expectedVersion')!~'^[0-9]+$' THEN
  RAISE EXCEPTION 'Informe nome e versão atual do modelo.' USING ERRCODE='22023'; END IF;
 v_name=btrim(p_payload->>'name');v_expected=(p_payload->>'expectedVersion')::integer;
 PERFORM billing_private.validate_document_layout(p_payload->'layout');
 PERFORM pg_advisory_xact_lock(hashtextextended('billing-document-template:'||v_owner::text,0));
 SELECT * INTO v_current FROM public.billing_document_templates WHERE owner_id=v_owner AND key=v_key FOR UPDATE;
 IF coalesce(v_current.version,0)<>v_expected THEN RAISE EXCEPTION 'O modelo foi alterado por outra pessoa. Atualize antes de salvar.' USING ERRCODE='40001'; END IF;
 INSERT INTO public.billing_document_templates(owner_id,key,name,version,layout,updated_by)
 VALUES(v_owner,v_key,v_name,v_expected+1,p_payload->'layout',auth.uid())
 ON CONFLICT(owner_id,key) DO UPDATE SET name=excluded.name,version=excluded.version,layout=excluded.layout,updated_by=excluded.updated_by,updated_at=date_trunc('second',clock_timestamp());
 RETURN jsonb_build_object('template',billing_private.current_request_template());
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'Confira as dimensões, fontes e versão do modelo.' USING ERRCODE='22023';
END $$;

CREATE FUNCTION billing_private.request_document_hash(p_request public.billing_service_requests) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('schemaVersion',1,'id',p_request.id,'ownerId',p_request.owner_id,'number',p_request.number,
 'companyName',p_request.company_name,'companyAddress',p_request.company_address,'items',p_request.items,
 'serviceValue',billing_private.decimal_text(p_request.service_value),'returnDate',p_request.return_date,'notes',p_request.notes,
 'createdBy',jsonb_build_object('userId',p_request.created_by,'name',p_request.creator_name),
 'requester',jsonb_build_object('signatureId',p_request.requester_signature_id,'name',p_request.requester_name,'path',p_request.requester_signature_path,'signingMode',p_request.requester_signing_mode),
 'createdAt',to_char(p_request.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'attachmentIds',p_request.input_payload->'attachmentIds','template',p_request.template_snapshot)::text,'UTF8')),'hex')
$$;
CREATE FUNCTION billing_private.request_signer_hash(p_request public.billing_service_requests,p_kind text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN (p_kind='requester' AND p_request.requester_signing_mode='registered') OR (p_kind='manager' AND p_request.decision_signing_mode='registered')
 THEN encode(sha256(convert_to(jsonb_build_object('schemaVersion',1,'documentHash',p_request.document_hash,'kind',p_kind,
  'signatureId',CASE p_kind WHEN 'requester' THEN p_request.requester_signature_id ELSE p_request.decider_signature_id END,
  'name',CASE p_kind WHEN 'requester' THEN p_request.requester_name ELSE p_request.decider_name END,
  'path',CASE p_kind WHEN 'requester' THEN p_request.requester_signature_path ELSE p_request.decider_signature_path END,
  'actorId',CASE p_kind WHEN 'requester' THEN p_request.created_by ELSE p_request.decided_by END,
  'at',to_char((CASE p_kind WHEN 'requester' THEN p_request.created_at ELSE p_request.decided_at END) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'decision',CASE WHEN p_kind='manager' THEN p_request.status END,'reason',CASE WHEN p_kind='manager' THEN p_request.decision_reason END)::text,'UTF8')),'hex') END
$$;
-- Existing documents keep their current content; legacy layouts receive the
-- default template snapshot. The new evidence columns never rewrite history.
UPDATE public.billing_service_requests SET template_snapshot=billing_private.default_request_template(),
 decision_signing_mode=CASE WHEN status<>'pending' THEN 'registered' END,
 input_payload=input_payload||jsonb_build_object('requesterSigningMode','registered');
UPDATE public.billing_service_requests r SET document_hash=billing_private.request_document_hash(r);
UPDATE public.billing_service_requests r SET requester_signature_hash=billing_private.request_signer_hash(r,'requester'),decision_signature_hash=billing_private.request_signer_hash(r,'manager');
UPDATE public.billing_service_request_events e SET signature_hash=CASE e.action WHEN 'created' THEN r.requester_signature_hash ELSE r.decision_signature_hash END
 FROM public.billing_service_requests r WHERE r.owner_id=e.owner_id AND r.id=e.request_id;
ALTER TABLE public.billing_service_requests ALTER COLUMN template_snapshot SET NOT NULL;
ALTER TABLE public.billing_service_requests ALTER COLUMN document_hash SET NOT NULL;
ALTER TABLE public.billing_service_requests ADD CONSTRAINT billing_document_hash_shape CHECK(document_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE public.billing_service_requests ADD CONSTRAINT billing_requester_signature_mode CHECK(
 (requester_signing_mode='manual' AND requester_signature_path IS NULL AND requester_signature_hash IS NULL)
 OR (requester_signing_mode='registered' AND requester_signature_path IS NOT NULL AND requester_signature_hash IS NOT NULL AND requester_signature_hash ~ '^[a-f0-9]{64}$'));
ALTER TABLE public.billing_service_requests ADD CONSTRAINT billing_decision_signature_mode CHECK(
 (status='pending' AND decision_signing_mode IS NULL AND decision_signature_hash IS NULL)
 OR (status<>'pending' AND decision_signing_mode IS NOT NULL AND decision_signing_mode='manual' AND decider_signature_path IS NULL AND decision_signature_hash IS NULL)
 OR (status<>'pending' AND decision_signing_mode IS NOT NULL AND decision_signing_mode='registered' AND decider_signature_path IS NOT NULL AND decision_signature_hash IS NOT NULL AND decision_signature_hash ~ '^[a-f0-9]{64}$'));
CREATE FUNCTION billing_private.snapshot_request_document() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('billing-document-template:'||NEW.owner_id::text,0));
  NEW.template_snapshot=billing_private.current_request_template();
  NEW.document_hash=billing_private.request_document_hash(NEW);
  NEW.requester_signature_hash=billing_private.request_signer_hash(NEW,'requester');
 ELSE
  IF NEW.template_snapshot IS DISTINCT FROM OLD.template_snapshot OR NEW.document_hash IS DISTINCT FROM OLD.document_hash
   OR NEW.requester_signature_hash IS DISTINCT FROM OLD.requester_signature_hash
   OR billing_private.request_document_hash(NEW) IS DISTINCT FROM OLD.document_hash THEN
   RAISE EXCEPTION 'O conteúdo e o modelo do documento enviado são imutáveis.' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'pending' AND ROW(NEW.status,NEW.decided_by,NEW.decider_name,NEW.decider_signature_id,NEW.decider_signature_path,NEW.decided_at,NEW.decision_reason,NEW.decision_signing_mode)
   IS DISTINCT FROM ROW(OLD.status,OLD.decided_by,OLD.decider_name,OLD.decider_signature_id,OLD.decider_signature_path,OLD.decided_at,OLD.decision_reason,OLD.decision_signing_mode) THEN
   RAISE EXCEPTION 'A decisão registrada é imutável.' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.decision_signature_hash=billing_private.request_signer_hash(NEW,'manager');
 RETURN NEW;
END $$;
CREATE TRIGGER billing_request_document_snapshot BEFORE INSERT OR UPDATE ON public.billing_service_requests
 FOR EACH ROW EXECUTE FUNCTION billing_private.snapshot_request_document();

-- Updated RPC implementations.
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
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecione um usuário ativo deste espaço para o diretor geral.' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('billing-signature:'||v_owner::text||':'||v_user::text||':manager',0));
 ELSIF v_user IS NOT NULL THEN
  RAISE EXCEPTION 'Solicitantes são pessoas cadastradas sem vínculo com uma conta. Não informe usuário.' USING ERRCODE='22023';
 END IF;
 IF v_id IS NOT NULL THEN
  SELECT * INTO v_signature FROM public.billing_signatures WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assinatura não encontrada.' USING ERRCODE='P0002'; END IF;
 END IF;
 v_file_id=CASE WHEN p_payload ? 'fileId' THEN nullif(p_payload->>'fileId','')::uuid ELSE v_signature.file_id END;
 IF v_file_id IS NOT NULL THEN
 SELECT * INTO v_file FROM public.billing_request_files WHERE owner_id=v_owner AND id=v_file_id AND kind='signature' FOR UPDATE;
 IF NOT FOUND OR (v_file_id IS DISTINCT FROM v_signature.file_id AND (v_file.actor_id<>v_actor OR v_file.consumed_at IS NOT NULL)) THEN
  RAISE EXCEPTION 'Envie um novo arquivo PNG para esta assinatura.' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=v_file.bucket AND name=v_file.path) THEN
  RAISE EXCEPTION 'O envio da assinatura ainda não foi concluído.' USING ERRCODE='23514'; END IF;
 END IF;
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

CREATE OR REPLACE FUNCTION billing_private.signature_json(p_signature public.billing_signatures) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',p_signature.id,'userId',p_signature.user_id,'name',p_signature.name,'role',p_signature.role,
 'fileId',p_signature.file_id,'filePath',(SELECT f.path FROM public.billing_request_files f WHERE f.owner_id=p_signature.owner_id AND f.id=p_signature.file_id),
 'active',p_signature.active,'createdAt',p_signature.created_at,'updatedAt',p_signature.updated_at)
$$;

CREATE OR REPLACE FUNCTION billing_private.request_json(p_request public.billing_service_requests) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',p_request.id,'number',p_request.number,'status',p_request.status,'companyName',p_request.company_name,
  'companyAddress',p_request.company_address,'items',p_request.items,'serviceValue',billing_private.decimal_text(p_request.service_value),
  'returnDate',p_request.return_date,'notes',p_request.notes,'createdAt',p_request.created_at,
  'template',p_request.template_snapshot,'documentHash',p_request.document_hash,
  'createdBy',jsonb_build_object('userId',p_request.created_by,'name',p_request.creator_name),
  'requester',jsonb_build_object('userId',p_request.requester_id,'name',p_request.requester_name,'signatureId',p_request.requester_signature_id,'signaturePath',p_request.requester_signature_path,'signingMode',p_request.requester_signing_mode,'signatureHash',p_request.requester_signature_hash),
  'decision',CASE WHEN p_request.status='pending' THEN NULL ELSE jsonb_build_object('userId',p_request.decided_by,'name',p_request.decider_name,
   'signatureId',p_request.decider_signature_id,'signaturePath',p_request.decider_signature_path,'signingMode',p_request.decision_signing_mode,'signatureHash',p_request.decision_signature_hash,'at',p_request.decided_at,'reason',p_request.decision_reason) END,
  'canDecide',p_request.status='pending' AND billing_private.has_permission('requests.approve') AND EXISTS(
    SELECT 1 FROM public.billing_signatures s JOIN public.billing_memberships m ON m.owner_id=s.owner_id AND m.user_id=s.user_id AND m.status='active'
    WHERE s.owner_id=p_request.owner_id AND s.user_id=auth.uid() AND s.role='manager' AND s.active),
  'attachments',coalesce((SELECT jsonb_agg(billing_private.request_file_json(f) ORDER BY f.created_at,f.id)
   FROM public.billing_request_files f WHERE f.owner_id=p_request.owner_id AND f.request_id=p_request.id AND f.consumed_at IS NOT NULL),'[]'::jsonb),
  'history',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'actorId',e.actor_id,'actorName',e.actor_name,
    'signaturePath',e.signature_path,'signingMode',e.signing_mode,'signatureHash',e.signature_hash,'at',e.created_at,'reason',e.reason) ORDER BY e.created_at,CASE e.action WHEN 'created' THEN 0 ELSE 1 END,e.id)
   FROM public.billing_service_request_events e WHERE e.owner_id=p_request.owner_id AND e.request_id=p_request.id),'[]'::jsonb))
$$;

CREATE OR REPLACE FUNCTION billing_private.service_requests_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();v_actor uuid:=auth.uid();v_request public.billing_service_requests;
 v_signature public.billing_signatures;v_file public.billing_request_files;v_id uuid;v_requester uuid;v_file_ids uuid[];
 v_signature_id uuid;v_creator_name text;v_signing_mode text;v_value numeric;v_return date;v_items jsonb:='[]';v_item jsonb;v_input jsonb;v_rows jsonb;v_users jsonb;v_requester_signatures jsonb;v_manager_signature jsonb;
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
  PERFORM billing_private.request_payload(p_payload,ARRAY['id','decision','reason','managerSigningMode']);
  IF p_payload ? 'managerSigningMode' AND coalesce(p_payload->>'managerSigningMode','') NOT IN ('registered','manual') THEN RAISE EXCEPTION 'Selecione assinatura cadastrada ou manual.' USING ERRCODE='22023'; END IF;
  v_id=(p_payload->>'id')::uuid;v_decision=p_payload->>'decision';v_reason=coalesce(btrim(p_payload->>'reason'),'');
  IF v_id IS NULL OR v_decision IS NULL OR v_decision NOT IN ('approved','rejected') OR length(v_reason)>2000
   OR (p_payload ? 'reason' AND jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string')
   OR (v_decision='rejected' AND length(v_reason)<3) THEN
   RAISE EXCEPTION 'Informe uma decisão válida e o motivo da recusa.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_request FROM public.billing_service_requests WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.' USING ERRCODE='P0002'; END IF;
  IF v_request.status<>'pending' THEN
   IF v_request.status=v_decision AND v_request.decided_by=v_actor AND v_request.decision_reason=v_reason AND coalesce(p_payload->>'managerSigningMode',v_request.decision_signing_mode)=v_request.decision_signing_mode THEN
    RETURN jsonb_build_object('request',billing_private.request_json(v_request)); END IF;
   RAISE EXCEPTION 'Esta solicitação já foi finalizada. Atualize a lista.' USING ERRCODE='40001';
  END IF;
  SELECT * INTO v_signature FROM public.billing_signatures
   WHERE owner_id=v_owner AND user_id=v_actor AND role='manager' AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cadastre o diretor geral vinculado ao seu usuário antes de decidir.' USING ERRCODE='23514'; END IF;
  v_signing_mode=coalesce(p_payload->>'managerSigningMode',CASE WHEN v_signature.file_id IS NULL THEN 'manual' ELSE 'registered' END);
  IF v_signing_mode='registered' AND v_signature.file_id IS NULL THEN RAISE EXCEPTION 'O diretor geral não tem PNG cadastrado. Selecione assinatura manual.' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_file FROM public.billing_request_files WHERE owner_id=v_owner AND id=v_signature.file_id;
  v_at=date_trunc('second',clock_timestamp());
  UPDATE public.billing_service_requests SET status=v_decision,decided_by=v_actor,decider_name=v_signature.name,
   decider_signature_id=v_signature.id,decider_signature_path=CASE WHEN v_signing_mode='registered' THEN v_file.path END,decided_at=v_at,decision_reason=v_reason,decision_signing_mode=v_signing_mode
   WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_request;
  INSERT INTO public.billing_service_request_events(owner_id,request_id,action,actor_id,actor_name,signature_path,reason,created_at,signing_mode,signature_hash)
   VALUES(v_owner,v_id,v_decision,v_actor,v_signature.name,v_request.decider_signature_path,v_reason,v_at,v_signing_mode,v_request.decision_signature_hash);
  RETURN jsonb_build_object('request',billing_private.request_json(v_request));
 END IF;
 IF p_action<>'create' THEN RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023'; END IF;
 PERFORM billing_private.authorize('requests.write');
 PERFORM billing_private.request_payload(p_payload,ARRAY['requestId','requesterSignatureId','requesterSigningMode','companyName','companyAddress','items','serviceValue','returnDate','notes','attachmentIds']);
 IF p_payload ? 'requesterSigningMode' AND coalesce(p_payload->>'requesterSigningMode','') NOT IN ('registered','manual') THEN RAISE EXCEPTION 'Selecione assinatura cadastrada ou manual.' USING ERRCODE='22023'; END IF;
 v_id=(p_payload->>'requestId')::uuid;v_signature_id=(p_payload->>'requesterSignatureId')::uuid;v_name=btrim(p_payload->>'companyName');v_address=coalesce(btrim(p_payload->>'companyAddress'),'');v_notes=coalesce(btrim(p_payload->>'notes'),'');
 IF v_id IS NULL OR v_signature_id IS NULL OR jsonb_typeof(p_payload->'companyName') IS DISTINCT FROM 'string' OR length(v_name) NOT BETWEEN 2 AND 200
  OR length(v_address)>500 OR length(v_notes)>4000
  OR (p_payload ? 'companyAddress' AND jsonb_typeof(p_payload->'companyAddress') IS DISTINCT FROM 'string')
  OR (p_payload ? 'notes' AND jsonb_typeof(p_payload->'notes') IS DISTINCT FROM 'string')
  OR jsonb_typeof(p_payload->'serviceValue') IS DISTINCT FROM 'string' OR (p_payload->>'serviceValue')!~'^[0-9]{1,14}([.][0-9]{1,2})?$'
  OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_typeof(p_payload->'attachmentIds') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Confira empresa, itens, valor do serviço e orçamento.' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 50 OR jsonb_array_length(p_payload->'attachmentIds') NOT BETWEEN 0 AND 5 THEN
  RAISE EXCEPTION 'Inclua de 1 a 50 itens e até 5 arquivos de orçamento.' USING ERRCODE='22023'; END IF;
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
 SELECT coalesce(array_agg(value::uuid ORDER BY value::uuid),'{}'::uuid[]) INTO v_file_ids FROM jsonb_array_elements_text(p_payload->'attachmentIds');
 IF cardinality(v_file_ids)<>(SELECT count(DISTINCT id) FROM unnest(v_file_ids) id) THEN
  RAISE EXCEPTION 'Anexos repetidos não são permitidos.' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('billing-service-request:'||v_owner::text||':'||v_id::text,0));
 SELECT * INTO v_request FROM public.billing_service_requests WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
 IF NOT FOUND THEN
  SELECT * INTO v_signature FROM public.billing_signatures WHERE owner_id=v_owner AND id=v_signature_id AND role='requester' AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecione uma pessoa solicitante ativa deste espaço antes de enviar.' USING ERRCODE='23514'; END IF;
 END IF;
 v_signing_mode=coalesce(p_payload->>'requesterSigningMode',v_request.requester_signing_mode,CASE WHEN v_signature.file_id IS NULL THEN 'manual' ELSE 'registered' END);
 v_input=jsonb_build_object('requesterSignatureId',v_signature_id,'requesterSigningMode',v_signing_mode,'companyName',v_name,'companyAddress',v_address,'items',v_items,'serviceValue',billing_private.decimal_text(v_value),
  'returnDate',v_return,'notes',v_notes,'attachmentIds',to_jsonb(v_file_ids));
 IF v_request.id IS NOT NULL THEN
  IF v_request.created_by=v_actor AND v_request.input_payload=v_input THEN RETURN jsonb_build_object('request',billing_private.request_json(v_request)); END IF;
  RAISE EXCEPTION 'O identificador já foi utilizado com outros dados.' USING ERRCODE='23505';
 END IF;
 IF v_signing_mode='registered' AND v_signature.file_id IS NULL THEN RAISE EXCEPTION 'O solicitante não tem PNG cadastrado. Selecione assinatura manual.' USING ERRCODE='23514'; END IF;
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
  requester_id,requester_name,requester_signature_id,requester_signature_path,created_at,input_payload,created_by,creator_name,requester_signing_mode)
 VALUES(v_id,v_owner,v_number,v_name,v_address,v_items,v_value,v_return,v_notes,NULL,v_signature.name,v_signature.id,CASE WHEN v_signing_mode='registered' THEN v_file.path END,v_at,v_input,v_actor,v_creator_name,v_signing_mode)
 RETURNING * INTO v_request;
 UPDATE public.billing_request_files SET consumed_at=v_at WHERE owner_id=v_owner AND id=ANY(v_file_ids);
 INSERT INTO public.billing_service_request_events(owner_id,request_id,action,actor_id,actor_name,signature_path,created_at,signing_mode,signature_hash)
  VALUES(v_owner,v_id,'created',v_actor,v_creator_name,v_request.requester_signature_path,v_at,v_signing_mode,v_request.requester_signature_hash);
 RETURN jsonb_build_object('request',billing_private.request_json(v_request));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow OR invalid_datetime_format THEN
 RAISE EXCEPTION 'Confira identificadores, valores, datas e filtros informados.' USING ERRCODE='22023';
END $$;

ALTER TABLE public.billing_document_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.billing_document_templates FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.billing_document_templates TO authenticated;
CREATE POLICY billing_owner_read ON public.billing_document_templates FOR SELECT TO authenticated USING(
 billing_private.can_access_owner(owner_id,'requests.read') OR billing_private.can_access_owner(owner_id,'report-headers.read'));
ALTER TABLE public.billing_document_templates REPLICA IDENTITY FULL;
DO $$
DECLARE v_function regprocedure;v_definition text;v_marker text:='PERFORM billing_private.ensure_actor_workspace();';
BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND NOT EXISTS(
  SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='billing_document_templates') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_document_templates;
 END IF;
 FOR v_function IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='billing_private' AND p.proname IN ('default_request_template','validate_document_layout','current_request_template',
   'document_templates_dispatch','request_document_hash','request_signer_hash','snapshot_request_document')
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',v_function); END LOOP;
 GRANT EXECUTE ON FUNCTION billing_private.document_templates_dispatch(text,jsonb) TO authenticated;
 SELECT pg_get_functiondef('public.billing_rpc(text,text,jsonb)'::regprocedure) INTO v_definition;
 IF strpos(v_definition,v_marker)=0 THEN RAISE EXCEPTION 'Unexpected public dispatcher. Review integration before applying.'; END IF;
 v_definition=replace(v_definition,v_marker,v_marker||E'\n IF p_resource=''document-templates'' THEN RETURN billing_private.document_templates_dispatch(p_action,p_payload); END IF;');
 EXECUTE v_definition;
END $$;
COMMENT ON COLUMN public.billing_service_requests.document_hash IS 'SHA-256 of immutable original record and template snapshot; remains stable after decision. Not a PNG byte checksum or a certified digital signature.';
COMMENT ON COLUMN public.billing_service_requests.requester_signature_hash IS 'SHA-256 of registered requester evidence tied to documentHash, person, operator, immutable PNG path and timestamp. NULL for handwritten signature.';
COMMENT ON COLUMN public.billing_service_requests.decision_signature_hash IS 'SHA-256 of registered manager evidence tied to documentHash, authenticated decision actor, immutable PNG path, timestamp and decision. NULL for handwritten signature.';
