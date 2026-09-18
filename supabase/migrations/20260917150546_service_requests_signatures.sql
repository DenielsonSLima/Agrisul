-- Internal service requests. Files are immutable objects; workflow actors and
-- timestamps always come from the authenticated session and the database.
DO $$
DECLARE v_constraint text;v_definition text;
BEGIN
 FOR v_constraint IN SELECT conname FROM pg_constraint
  WHERE conrelid='public.billing_access_profiles'::regclass AND contype='c'
   AND pg_get_constraintdef(oid) LIKE '%permissions%'
 LOOP EXECUTE format('ALTER TABLE public.billing_access_profiles DROP CONSTRAINT %I',v_constraint); END LOOP;
 ALTER TABLE public.billing_access_profiles ADD CONSTRAINT billing_access_profiles_permission_catalog CHECK(
  cardinality(permissions)<=17 AND permissions <@ ARRAY[
   'companies.read','companies.write','registrations.read','registrations.write','contracts.read','contracts.write','settings.write',
   'watermarks.read','watermarks.write','users.manage','access-profiles.manage','report-headers.read','report-headers.write',
   'requests.read','requests.write','requests.approve','signatures.manage']::text[]);
 -- Preserve the existing profile administration and its delegation restrictions.
 SELECT pg_get_functiondef('billing_private.access_profiles_dispatch(text,jsonb)'::regprocedure) INTO v_definition;
 v_definition=replace(v_definition,'cardinality(v_permissions)>13','cardinality(v_permissions)>17');
 v_definition=replace(v_definition,'''report-headers.read'',''report-headers.write'']::text[]',
  '''report-headers.read'',''report-headers.write'',''requests.read'',''requests.write'',''requests.approve'',''signatures.manage'']::text[]');
 v_definition=replace(v_definition,'IF (''companies.write''=ANY(v_permissions)',
  'IF ((v_permissions && ARRAY[''requests.write'',''requests.approve'']::text[]) AND NOT (''requests.read''=ANY(v_permissions))) OR (''companies.write''=ANY(v_permissions)');
 EXECUTE v_definition;
 SELECT pg_get_functiondef('billing_private.create_workspace_defaults(uuid)'::regprocedure) INTO v_definition;
 v_definition=replace(v_definition,'''users.manage'',''access-profiles.manage'',''report-headers.read'',''report-headers.write''',
  '''users.manage'',''access-profiles.manage'',''report-headers.read'',''report-headers.write'',''requests.read'',''requests.write'',''requests.approve'',''signatures.manage''');
 v_definition=replace(v_definition,'''contracts.read'',''watermarks.read'',''report-headers.read''',
  '''contracts.read'',''watermarks.read'',''report-headers.read'',''requests.read''');
 EXECUTE v_definition;
END $$;
UPDATE public.billing_access_profiles SET permissions=permissions||ARRAY['requests.read','requests.write','requests.approve','signatures.manage']::text[]
 WHERE is_system AND name='Administrador';
UPDATE public.billing_access_profiles SET permissions=permissions||ARRAY['requests.read']::text[]
 WHERE is_system AND name='Somente leitura';

CREATE TABLE public.billing_request_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL,request_id uuid,kind text NOT NULL CHECK(kind IN ('signature','budget')),
 bucket text NOT NULL CHECK(bucket IN ('billing-signatures','billing-request-files')),path text NOT NULL,
 file_name text NOT NULL CHECK(length(file_name) BETWEEN 1 AND 200),content_type text NOT NULL,
 size_bytes bigint NOT NULL CHECK(size_bytes>0 AND size_bytes<=10485760),
 created_at timestamptz NOT NULL DEFAULT date_trunc('second',clock_timestamp()),consumed_at timestamptz,
 UNIQUE(owner_id,id),UNIQUE(bucket,path),
 CHECK((kind='signature' AND bucket='billing-signatures' AND request_id IS NULL AND content_type='image/png' AND size_bytes<=3145728)
  OR (kind='budget' AND bucket='billing-request-files' AND request_id IS NOT NULL AND content_type IN ('application/pdf','image/jpeg','image/png')))
);
CREATE TABLE public.billing_signatures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 user_id uuid NOT NULL,name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 150),
 role text NOT NULL CHECK(role IN ('requester','manager')),file_id uuid NOT NULL,
 active boolean NOT NULL DEFAULT true,created_by uuid NOT NULL,updated_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT date_trunc('second',clock_timestamp()),updated_at timestamptz NOT NULL DEFAULT date_trunc('second',clock_timestamp()),
 UNIQUE(owner_id,id),FOREIGN KEY(owner_id,file_id) REFERENCES public.billing_request_files(owner_id,id)
);
CREATE UNIQUE INDEX billing_signatures_active_user_role ON public.billing_signatures(owner_id,user_id,role) WHERE active;
CREATE TABLE public.billing_service_requests (
 id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 number bigint NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 company_name text NOT NULL CHECK(length(btrim(company_name)) BETWEEN 2 AND 200),
 company_address text NOT NULL DEFAULT '' CHECK(length(company_address)<=500),
 items jsonb NOT NULL CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items) BETWEEN 1 AND 50),
 service_value numeric(16,2) NOT NULL CHECK(service_value>=0),return_date date,notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 requester_id uuid NOT NULL,requester_name text NOT NULL,requester_signature_id uuid NOT NULL,requester_signature_path text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT date_trunc('second',clock_timestamp()),
 decided_by uuid,decider_name text,decider_signature_id uuid,decider_signature_path text,decided_at timestamptz,decision_reason text,
 input_payload jsonb NOT NULL,
 UNIQUE(owner_id,id),UNIQUE(owner_id,number),
 FOREIGN KEY(owner_id,requester_signature_id) REFERENCES public.billing_signatures(owner_id,id),
 FOREIGN KEY(owner_id,decider_signature_id) REFERENCES public.billing_signatures(owner_id,id),
 CHECK((status='pending' AND decided_by IS NULL AND decided_at IS NULL AND decider_signature_id IS NULL)
  OR (status<>'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND decider_signature_id IS NOT NULL)),
 CHECK(status<>'rejected' OR length(btrim(decision_reason)) BETWEEN 3 AND 2000)
);
CREATE TABLE public.billing_service_request_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,action text NOT NULL CHECK(action IN ('created','approved','rejected')),
 actor_id uuid NOT NULL,actor_name text NOT NULL,signature_path text NOT NULL,reason text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT date_trunc('second',clock_timestamp()),
 FOREIGN KEY(owner_id,request_id) REFERENCES public.billing_service_requests(owner_id,id) ON DELETE CASCADE,
 UNIQUE(owner_id,request_id,action)
);
CREATE INDEX billing_request_files_actor ON public.billing_request_files(owner_id,actor_id,created_at);
CREATE INDEX billing_request_files_request ON public.billing_request_files(owner_id,request_id);
CREATE INDEX billing_signatures_file ON public.billing_signatures(owner_id,file_id);
CREATE INDEX billing_service_requests_list ON public.billing_service_requests(owner_id,status,created_at DESC,id);
CREATE INDEX billing_service_requests_requester ON public.billing_service_requests(owner_id,requester_id,created_at DESC);
CREATE INDEX billing_service_requests_signature ON public.billing_service_requests(owner_id,requester_signature_id);
CREATE INDEX billing_service_requests_decider_signature ON public.billing_service_requests(owner_id,decider_signature_id);

CREATE FUNCTION billing_private.lock_request_actor() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_profile uuid;
BEGIN
 SELECT access_profile_id INTO v_profile FROM public.billing_memberships WHERE user_id=auth.uid() AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Seu acesso a este espaço não está ativo.' USING ERRCODE='42501'; END IF;
 IF v_profile IS NOT NULL THEN PERFORM 1 FROM public.billing_access_profiles WHERE id=v_profile FOR SHARE; END IF;
END $$;
CREATE FUNCTION billing_private.request_payload(p_payload jsonb,p_allowed text[]) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT k=ANY(p_allowed)) THEN
  RAISE EXCEPTION 'Campos inválidos para esta operação.' USING ERRCODE='22023';
 END IF;
END $$;
CREATE FUNCTION billing_private.request_file_json(p_file public.billing_request_files) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',p_file.id,'bucket',p_file.bucket,'path',p_file.path,'fileName',p_file.file_name,'contentType',p_file.content_type,'size',p_file.size_bytes)
$$;
CREATE FUNCTION billing_private.signature_json(p_signature public.billing_signatures) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',p_signature.id,'userId',p_signature.user_id,'name',p_signature.name,'role',p_signature.role,
 'fileId',p_signature.file_id,'filePath',f.path,'active',p_signature.active,'createdAt',p_signature.created_at,'updatedAt',p_signature.updated_at)
 FROM public.billing_request_files f WHERE f.owner_id=p_signature.owner_id AND f.id=p_signature.file_id
$$;
CREATE FUNCTION billing_private.request_json(p_request public.billing_service_requests) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',p_request.id,'number',p_request.number,'status',p_request.status,'companyName',p_request.company_name,
  'companyAddress',p_request.company_address,'items',p_request.items,'serviceValue',billing_private.decimal_text(p_request.service_value),
  'returnDate',p_request.return_date,'notes',p_request.notes,'createdAt',p_request.created_at,
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

CREATE FUNCTION billing_private.prepare_request_file(p_kind text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();v_actor uuid:=auth.uid();v_file public.billing_request_files;v_request uuid;
 v_name text;v_type text;v_size bigint;v_id uuid:=gen_random_uuid();v_extension text;
BEGIN
 IF p_kind='signature' THEN
  PERFORM billing_private.authorize('signatures.manage');
  PERFORM billing_private.request_payload(p_payload,ARRAY['fileName','contentType','size']);
 ELSE
  PERFORM billing_private.authorize('requests.write');
  PERFORM billing_private.request_payload(p_payload,ARRAY['requestId','fileName','contentType','size']);
  v_request=(p_payload->>'requestId')::uuid;
  IF v_request IS NULL THEN RAISE EXCEPTION 'Identificador da solicitação obrigatório.' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('billing-service-request:'||v_owner::text||':'||v_request::text,0));
  IF EXISTS(SELECT 1 FROM public.billing_service_requests WHERE id=v_request) THEN
   RAISE EXCEPTION 'A solicitação já foi enviada; seus anexos estão protegidos.' USING ERRCODE='23514';
  END IF;
 END IF;
 IF jsonb_typeof(p_payload->'fileName') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'contentType') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'size') IS DISTINCT FROM 'number' OR (p_payload->>'size')!~'^[0-9]+$' THEN
  RAISE EXCEPTION 'Informe nome, tipo e tamanho do arquivo.' USING ERRCODE='22023';
 END IF;
 v_name=btrim(p_payload->>'fileName');v_type=p_payload->>'contentType';v_size=(p_payload->>'size')::bigint;
 IF length(v_name) NOT BETWEEN 1 AND 200 OR v_size<1 OR v_size>(CASE WHEN p_kind='signature' THEN 3145728 ELSE 10485760 END)
  OR (p_kind='signature' AND v_type<>'image/png') OR (p_kind='budget' AND v_type NOT IN ('application/pdf','image/jpeg','image/png')) THEN
  RAISE EXCEPTION 'Assinaturas aceitam PNG até 3 MB. Orçamentos aceitam PDF, JPG ou PNG até 10 MB.' USING ERRCODE='22023';
 END IF;
 v_extension=CASE v_type WHEN 'application/pdf' THEN 'pdf' WHEN 'image/jpeg' THEN 'jpg' ELSE 'png' END;
 INSERT INTO public.billing_request_files(id,owner_id,actor_id,request_id,kind,bucket,path,file_name,content_type,size_bytes)
 VALUES(v_id,v_owner,v_actor,v_request,p_kind,CASE p_kind WHEN 'signature' THEN 'billing-signatures' ELSE 'billing-request-files' END,
  v_owner::text||'/'||v_actor::text||'/'||v_id::text||'.'||v_extension,v_name,v_type,v_size) RETURNING * INTO v_file;
 RETURN jsonb_build_object('file',billing_private.request_file_json(v_file));
END $$;

CREATE FUNCTION billing_private.signatures_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();v_actor uuid:=auth.uid();v_signature public.billing_signatures;
 v_file public.billing_request_files;v_id uuid;v_user uuid;v_file_id uuid;v_role text;v_name text;v_search text;v_status text;
 v_page integer;v_size integer;v_total bigint;v_rows jsonb;
BEGIN
 IF v_actor IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
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
 IF v_user IS NULL OR v_role IS NULL OR v_role NOT IN ('requester','manager') OR jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string'
  OR length(v_name) NOT BETWEEN 2 AND 150 OR (p_payload ? 'active' AND p_payload->'active'<>'true'::jsonb) THEN
  RAISE EXCEPTION 'Confira o nome, usuário e função da assinatura.' USING ERRCODE='22023'; END IF;
 -- Membership locks serialize registration against disabling/removal.
 PERFORM 1 FROM public.billing_memberships WHERE owner_id=v_owner AND user_id=v_user AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Selecione um usuário ativo deste espaço.' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('billing-signature:'||v_owner::text||':'||v_user::text||':'||v_role,0));
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

CREATE FUNCTION billing_private.service_requests_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();v_actor uuid:=auth.uid();v_request public.billing_service_requests;
 v_signature public.billing_signatures;v_file public.billing_request_files;v_id uuid;v_requester uuid;v_file_ids uuid[];
 v_value numeric;v_return date;v_items jsonb:='[]';v_item jsonb;v_input jsonb;v_rows jsonb;v_users jsonb;v_requester_signature jsonb;v_manager_signature jsonb;
 v_search text;v_tab text;v_from date;v_to date;v_page integer;v_size integer;v_total bigint;v_pending bigint;v_finished bigint;
 v_decision text;v_reason text;v_at timestamptz;v_number bigint;v_name text;v_address text;v_notes text;
BEGIN
 IF v_actor IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 IF p_action IN ('prepare-upload','create','decide') THEN PERFORM billing_private.lock_request_actor();v_owner=billing_private.current_owner_id(); END IF;
 PERFORM billing_private.authorize('requests.read');
 IF p_action='prepare-upload' THEN RETURN billing_private.prepare_request_file('budget',p_payload); END IF;
 IF p_action='options' THEN
  PERFORM billing_private.request_payload(p_payload,'{}');
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.user_id,'name',u.name) ORDER BY lower(u.name),u.user_id),'[]') INTO v_users FROM (
   SELECT DISTINCT ON (user_id) user_id,name FROM (
    SELECT m.user_id,coalesce(s.name,'Usuário') AS name,0 AS priority FROM public.billing_memberships m
     LEFT JOIN public.billing_user_settings s ON s.owner_id=m.owner_id AND s.user_id=m.user_id WHERE m.owner_id=v_owner AND m.status='active'
    UNION ALL SELECT requester_id,requester_name,1 FROM public.billing_service_requests WHERE owner_id=v_owner
   ) candidates ORDER BY user_id,priority,name
  ) u;
  SELECT billing_private.signature_json(s) INTO v_requester_signature FROM public.billing_signatures s
   WHERE s.owner_id=v_owner AND s.user_id=v_actor AND s.role='requester' AND s.active;
  SELECT billing_private.signature_json(s) INTO v_manager_signature FROM public.billing_signatures s
   WHERE s.owner_id=v_owner AND s.user_id=v_actor AND s.role='manager' AND s.active;
  RETURN jsonb_build_object('requesters',v_users,'requesterSignature',v_requester_signature,'managerSignature',v_manager_signature,
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
    AND (v_requester IS NULL OR r.requester_id=v_requester)
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
 PERFORM billing_private.request_payload(p_payload,ARRAY['requestId','companyName','companyAddress','items','serviceValue','returnDate','notes','attachmentIds']);
 v_id=(p_payload->>'requestId')::uuid;v_name=btrim(p_payload->>'companyName');v_address=coalesce(btrim(p_payload->>'companyAddress'),'');v_notes=coalesce(btrim(p_payload->>'notes'),'');
 IF v_id IS NULL OR jsonb_typeof(p_payload->'companyName') IS DISTINCT FROM 'string' OR length(v_name) NOT BETWEEN 2 AND 200
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
 v_input=jsonb_build_object('companyName',v_name,'companyAddress',v_address,'items',v_items,'serviceValue',billing_private.decimal_text(v_value),
  'returnDate',v_return,'notes',v_notes,'attachmentIds',to_jsonb(v_file_ids));
 PERFORM pg_advisory_xact_lock(hashtextextended('billing-service-request:'||v_owner::text||':'||v_id::text,0));
 SELECT * INTO v_request FROM public.billing_service_requests WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
 IF FOUND THEN
  IF v_request.requester_id=v_actor AND v_request.input_payload=v_input THEN RETURN jsonb_build_object('request',billing_private.request_json(v_request)); END IF;
  RAISE EXCEPTION 'O identificador já foi utilizado com outros dados.' USING ERRCODE='23505';
 END IF;
 SELECT * INTO v_signature FROM public.billing_signatures
  WHERE owner_id=v_owner AND user_id=v_actor AND role='requester' AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cadastre uma assinatura de solicitante ativa para seu usuário antes de enviar.' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM public.billing_request_files WHERE owner_id=v_owner AND id=ANY(v_file_ids) ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.billing_request_files f WHERE f.owner_id=v_owner AND f.id=ANY(v_file_ids)
  AND f.actor_id=v_actor AND f.kind='budget' AND f.request_id=v_id AND f.consumed_at IS NULL
  AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=f.bucket AND o.name=f.path))<>cardinality(v_file_ids) THEN
  RAISE EXCEPTION 'Conclua o envio de todos os orçamentos desta solicitação.' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_file FROM public.billing_request_files WHERE owner_id=v_owner AND id=v_signature.file_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('billing-service-number:'||v_owner::text,0));
 SELECT coalesce(max(number),0)+1 INTO v_number FROM public.billing_service_requests WHERE owner_id=v_owner;
 v_at=date_trunc('second',clock_timestamp());
 INSERT INTO public.billing_service_requests(id,owner_id,number,company_name,company_address,items,service_value,return_date,notes,
  requester_id,requester_name,requester_signature_id,requester_signature_path,created_at,input_payload)
 VALUES(v_id,v_owner,v_number,v_name,v_address,v_items,v_value,v_return,v_notes,v_actor,v_signature.name,v_signature.id,v_file.path,v_at,v_input)
 RETURNING * INTO v_request;
 UPDATE public.billing_request_files SET consumed_at=v_at WHERE owner_id=v_owner AND id=ANY(v_file_ids);
 INSERT INTO public.billing_service_request_events(owner_id,request_id,action,actor_id,actor_name,signature_path,created_at)
  VALUES(v_owner,v_id,'created',v_actor,v_signature.name,v_file.path,v_at);
 RETURN jsonb_build_object('request',billing_private.request_json(v_request));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow OR invalid_datetime_format THEN
 RAISE EXCEPTION 'Confira identificadores, valores, datas e filtros informados.' USING ERRCODE='22023';
END $$;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES
 ('billing-signatures','billing-signatures',false,3145728,ARRAY['image/png']),
 ('billing-request-files','billing-request-files',false,10485760,ARRAY['application/pdf','image/jpeg','image/png']);

CREATE FUNCTION billing_private.can_read_request_file(p_bucket text,p_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.billing_request_files f WHERE f.bucket=p_bucket AND f.path=p_path
  AND f.owner_id=billing_private.current_owner_id() AND (
   (f.kind='budget' AND ((f.consumed_at IS NOT NULL AND billing_private.has_permission('requests.read'))
     OR (f.actor_id=auth.uid() AND billing_private.has_permission('requests.write'))))
   OR (f.kind='signature' AND (billing_private.has_permission('signatures.manage') OR billing_private.has_permission('registrations.read')
    OR (billing_private.has_permission('requests.read') AND (
      EXISTS(SELECT 1 FROM public.billing_signatures s WHERE s.owner_id=f.owner_id AND s.file_id=f.id AND s.user_id=auth.uid())
      OR EXISTS(SELECT 1 FROM public.billing_service_requests r WHERE r.owner_id=f.owner_id
       AND (r.requester_signature_path=f.path OR r.decider_signature_path=f.path))))))))
$$;
CREATE FUNCTION billing_private.can_upload_request_file(p_bucket text,p_path text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_file public.billing_request_files;
BEGIN
 PERFORM billing_private.lock_request_actor();
 SELECT * INTO v_file FROM public.billing_request_files
  WHERE bucket=p_bucket AND path=p_path AND owner_id=billing_private.current_owner_id() AND actor_id=auth.uid() FOR SHARE;
 IF NOT FOUND OR v_file.consumed_at IS NOT NULL OR v_file.created_at<clock_timestamp()-interval '24 hours' THEN RETURN false; END IF;
 IF v_file.kind='signature' THEN RETURN billing_private.has_permission('signatures.manage'); END IF;
 RETURN billing_private.has_permission('requests.write') AND NOT EXISTS(
  SELECT 1 FROM public.billing_service_requests WHERE owner_id=v_file.owner_id AND id=v_file.request_id);
END $$;
CREATE POLICY billing_request_files_storage_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id IN ('billing-signatures','billing-request-files') AND billing_private.can_read_request_file(bucket_id,name));
CREATE POLICY billing_request_files_storage_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id IN ('billing-signatures','billing-request-files') AND billing_private.can_upload_request_file(bucket_id,name));
-- Intentionally no UPDATE or DELETE policy. Replacing a signature reserves a new
-- object, preserving every file referenced by a historical snapshot.

DO $$
DECLARE v_table text;
BEGIN
 FOREACH v_table IN ARRAY ARRAY['billing_signatures','billing_request_files','billing_service_requests','billing_service_request_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',v_table);
  EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated',v_table);
  EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL',v_table);
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND NOT EXISTS(
   SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=v_table) THEN
   EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',v_table);
  END IF;
 END LOOP;
END $$;
CREATE POLICY billing_owner_read ON public.billing_signatures FOR SELECT TO authenticated USING(
 billing_private.can_access_owner(owner_id,'signatures.manage') OR billing_private.can_access_owner(owner_id,'registrations.read')
 OR (user_id=auth.uid() AND billing_private.can_access_owner(owner_id,'requests.read')));
CREATE POLICY billing_owner_read ON public.billing_request_files FOR SELECT TO authenticated USING(billing_private.can_read_request_file(bucket,path));
CREATE POLICY billing_owner_read ON public.billing_service_requests FOR SELECT TO authenticated USING(billing_private.can_access_owner(owner_id,'requests.read'));
CREATE POLICY billing_owner_read ON public.billing_service_request_events FOR SELECT TO authenticated USING(billing_private.can_access_owner(owner_id,'requests.read'));

DO $$
DECLARE v_function regprocedure;v_definition text;
BEGIN
 FOR v_function IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='billing_private' AND p.proname IN ('lock_request_actor','request_payload','request_file_json','signature_json','request_json',
   'prepare_request_file','signatures_dispatch','service_requests_dispatch','can_read_request_file','can_upload_request_file')
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',v_function); END LOOP;
 GRANT EXECUTE ON FUNCTION billing_private.signatures_dispatch(text,jsonb),billing_private.service_requests_dispatch(text,jsonb),
  billing_private.can_read_request_file(text,text),billing_private.can_upload_request_file(text,text) TO authenticated;
 SELECT pg_get_functiondef('public.billing_rpc(text,text,jsonb)'::regprocedure) INTO v_definition;
 IF strpos(v_definition,'PERFORM billing_private.ensure_actor_workspace();')=0 THEN
  RAISE EXCEPTION 'Dispatcher público inesperado; revise a integração antes de aplicar.';
 END IF;
 v_definition=replace(v_definition,'PERFORM billing_private.ensure_actor_workspace();',
  'PERFORM billing_private.ensure_actor_workspace();
 IF p_resource=''signatures'' THEN RETURN billing_private.signatures_dispatch(p_action,p_payload); END IF;
 IF p_resource=''service-requests'' THEN RETURN billing_private.service_requests_dispatch(p_action,p_payload); END IF;');
 EXECUTE v_definition;
END $$;
COMMENT ON TABLE public.billing_service_requests IS 'Immutable submitted service requests; explicit permission and logged-in manager signature authorize one audited final decision.';
COMMENT ON TABLE public.billing_service_request_events IS 'Append-only history through billing_rpc; actor, name, signature object and second-precision time are server snapshots.';
COMMENT ON TABLE public.billing_request_files IS 'Private immutable objects; actor IDs survive workspace member removal so historical evidence is preserved.';
