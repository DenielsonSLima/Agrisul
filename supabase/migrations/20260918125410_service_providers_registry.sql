-- Separate provider registry, using the same contact/address fields as clients.
-- CNPJ check digits: Receita Federal manual (ASCII - 48, modulus 11):
-- https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf
CREATE FUNCTION billing_private.valid_provider_document(p_type text,p_document text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path='' AS $$
DECLARE v_length integer;v_sum integer;v_remainder integer;v_digit integer;v_weight integer;i integer;pass integer;
BEGIN
 IF p_type NOT IN ('CPF','CNPJ') THEN RETURN false; END IF;
 IF p_type='CPF' AND p_document!~'^[0-9]{11}$' OR p_type='CNPJ' AND p_document!~'^[A-Z0-9]{12}[0-9]{2}$' THEN RETURN false; END IF;
 IF p_document=repeat(left(p_document,1),length(p_document)) THEN RETURN false; END IF;
 FOR pass IN 0..1 LOOP
  v_length=CASE WHEN p_type='CPF' THEN 9 ELSE 12 END+pass;v_sum=0;
  FOR i IN 1..v_length LOOP
   v_weight=CASE WHEN p_type='CPF' THEN v_length+2-i ELSE ((v_length-i)%8)+2 END;
   v_sum=v_sum+(ascii(substr(p_document,i,1))-48)*v_weight;
  END LOOP;
  v_remainder=v_sum%11;v_digit=CASE WHEN v_remainder<2 THEN 0 ELSE 11-v_remainder END;
  IF substr(p_document,v_length+1,1)<>v_digit::text THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;

CREATE TABLE public.billing_service_providers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 document_type text NOT NULL CHECK(document_type IN ('CPF','CNPJ')),document text NOT NULL,
 legal_name text NOT NULL CHECK(length(legal_name) BETWEEN 2 AND 200),trade_name text NOT NULL DEFAULT '' CHECK(length(trade_name)<=200),
 street text NOT NULL DEFAULT '' CHECK(length(street)<=200),number text NOT NULL DEFAULT '' CHECK(length(number)<=30),
 complement text NOT NULL DEFAULT '' CHECK(length(complement)<=150),district text NOT NULL DEFAULT '' CHECK(length(district)<=100),
 city text NOT NULL DEFAULT '' CHECK(length(city)<=100),state text NOT NULL DEFAULT '' CHECK(state='' OR state IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
 zip_code text NOT NULL DEFAULT '' CHECK(zip_code='' OR zip_code~'^[0-9]{8}$'),
 phone text NOT NULL DEFAULT '' CHECK(length(phone)<=40),email text NOT NULL DEFAULT '' CHECK(length(email)<=150 AND (email='' OR email~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id),UNIQUE(owner_id,document_type,document),CHECK(billing_private.valid_provider_document(document_type,document))
);
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_service_providers FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();
CREATE FUNCTION billing_private.provider_json(p_provider public.billing_service_providers) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT billing_private.present(to_jsonb(p_provider)-'document_type')||jsonb_build_object('documentType',p_provider.document_type,
 'address',concat_ws(' · ',nullif(concat_ws(', ',nullif(p_provider.street,''),nullif(p_provider.number,'')),''),nullif(p_provider.complement,''),nullif(p_provider.district,''),
 nullif(concat_ws(' / ',nullif(p_provider.city,''),nullif(p_provider.state,'')),''),nullif(p_provider.zip_code,'')))
$$;

CREATE FUNCTION billing_private.service_providers_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();v_actor uuid:=auth.uid();v_provider public.billing_service_providers;v_id uuid;v_key text;v_column text;v_text text;v_data jsonb:='{}';v_rows jsonb;
BEGIN
 IF v_actor IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar os prestadores.' USING ERRCODE='28000'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('list','get','options','save') THEN RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023'; END IF;
 IF p_action='save' THEN
  PERFORM billing_private.lock_request_actor();v_owner=billing_private.current_owner_id();PERFORM billing_private.authorize('registrations.write');
  PERFORM billing_private.request_payload(p_payload,ARRAY['id','documentType','document','legalName','tradeName','street','number','complement','district','city','state','zipCode','phone','email']);
  v_id=nullif(p_payload->>'id','')::uuid;
  IF v_id IS NOT NULL THEN
   SELECT * INTO v_provider FROM public.billing_service_providers WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Prestador não encontrado.' USING ERRCODE='P0002'; END IF;
  END IF;
  FOREACH v_key IN ARRAY ARRAY['documentType','document','legalName','tradeName','street','number','complement','district','city','state','zipCode','phone','email'] LOOP
   IF jsonb_typeof(p_payload->v_key) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Preencha os campos do prestador.' USING ERRCODE='22023'; END IF;
   v_text=btrim(p_payload->>v_key);
   IF v_key='document' THEN v_text=upper(regexp_replace(v_text,'[./[:space:]-]','','g')); END IF;
   IF v_key='zipCode' THEN v_text=regexp_replace(v_text,'[[:space:]-]','','g'); END IF;
   IF v_key='state' THEN v_text=upper(v_text); END IF;
   v_column=CASE v_key WHEN 'documentType' THEN 'document_type' WHEN 'legalName' THEN 'legal_name' WHEN 'tradeName' THEN 'trade_name' WHEN 'zipCode' THEN 'zip_code' ELSE v_key END;
   v_data=v_data||jsonb_build_object(v_column,v_text);
  END LOOP;
  IF NOT billing_private.valid_provider_document(v_data->>'document_type',v_data->>'document') THEN RAISE EXCEPTION 'Informe um CPF ou CNPJ válido para o tipo selecionado.' USING ERRCODE='22023'; END IF;
  IF length(v_data->>'legal_name') NOT BETWEEN 2 AND 200 THEN RAISE EXCEPTION 'Informe o nome ou a razão social do prestador.' USING ERRCODE='22023'; END IF;
  v_data=v_data||jsonb_build_object('id',coalesce(v_id,gen_random_uuid()),'owner_id',v_owner,'created_at',coalesce(v_provider.created_at,now()),'updated_at',now());
  SELECT * INTO v_provider FROM jsonb_populate_record(NULL::public.billing_service_providers,v_data);
  INSERT INTO public.billing_service_providers SELECT (v_provider).* ON CONFLICT(id) DO UPDATE SET
   document_type=excluded.document_type,document=excluded.document,legal_name=excluded.legal_name,trade_name=excluded.trade_name,
   street=excluded.street,number=excluded.number,complement=excluded.complement,district=excluded.district,city=excluded.city,state=excluded.state,
   zip_code=excluded.zip_code,phone=excluded.phone,email=excluded.email
   WHERE public.billing_service_providers.owner_id=v_owner RETURNING * INTO v_provider;
  RETURN jsonb_build_object('provider',billing_private.provider_json(v_provider));
 END IF;
 IF NOT billing_private.has_permission('registrations.read') AND NOT billing_private.has_permission('requests.read') THEN
  RAISE EXCEPTION 'Você não tem permissão para consultar os prestadores.' USING ERRCODE='42501'; END IF;
 IF p_action='get' THEN
  PERFORM billing_private.request_payload(p_payload,ARRAY['id']);
  SELECT * INTO v_provider FROM public.billing_service_providers WHERE owner_id=v_owner AND id=(p_payload->>'id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prestador não encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('provider',billing_private.provider_json(v_provider),'canManage',billing_private.has_permission('registrations.write'));
 END IF;
 PERFORM billing_private.request_payload(p_payload,ARRAY[]::text[]);
 SELECT coalesce(jsonb_agg(billing_private.provider_json(p) ORDER BY lower(p.legal_name),p.id),'[]') INTO v_rows FROM public.billing_service_providers p WHERE p.owner_id=v_owner;
 RETURN jsonb_build_object('providers',v_rows,'canManage',billing_private.has_permission('registrations.write'));
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Já existe um prestador com este CPF ou CNPJ.' USING ERRCODE='23505';
 WHEN check_violation OR not_null_violation THEN RAISE EXCEPTION 'Confira nome, CPF/CNPJ, endereço e contato do prestador.' USING ERRCODE='22023';
 WHEN invalid_text_representation THEN RAISE EXCEPTION 'Identificador do prestador inválido.' USING ERRCODE='22023';
END $$;

ALTER TABLE public.billing_service_providers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.billing_service_providers FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.billing_service_providers TO authenticated;
CREATE POLICY billing_provider_read ON public.billing_service_providers FOR SELECT TO authenticated USING(
 billing_private.can_access_owner(owner_id,'registrations.read') OR billing_private.can_access_owner(owner_id,'requests.read'));
ALTER TABLE public.billing_service_providers REPLICA IDENTITY FULL;
ALTER TABLE public.billing_service_requests ADD COLUMN provider_id uuid,ADD COLUMN provider_snapshot jsonb,
 ADD CONSTRAINT billing_request_provider_fk FOREIGN KEY(owner_id,provider_id) REFERENCES public.billing_service_providers(owner_id,id),
 ADD CONSTRAINT billing_request_provider_snapshot CHECK((provider_id IS NULL AND provider_snapshot IS NULL) OR
 (provider_id IS NOT NULL AND provider_snapshot IS NOT NULL AND jsonb_typeof(provider_snapshot)='object' AND provider_snapshot->>'id'=provider_id::text));
CREATE INDEX billing_requests_provider ON public.billing_service_requests(owner_id,provider_id) WHERE provider_id IS NOT NULL;
ALTER TABLE public.billing_service_requests DROP CONSTRAINT billing_service_requests_company_address_check,
 ADD CONSTRAINT billing_service_requests_company_address_check CHECK(length(company_address)<=800);

-- Extend the current dispatcher without replacing its approvals, file checks,
-- idempotency or manual-signature behavior. Existing free-text records remain
-- valid, including their hashes. New UI requests send only the provider ID.
DO $$
DECLARE v_definition text;v_marker text;v_function regprocedure;
BEGIN
 SELECT pg_get_functiondef('billing_private.service_requests_dispatch(text,jsonb)'::regprocedure) INTO v_definition;
 v_marker='v_signature_id uuid;';
 IF strpos(v_definition,v_marker)=0 OR strpos(v_definition,'''requesterSigningMode'',''companyName''')=0 THEN RAISE EXCEPTION 'Unexpected requests dispatcher'; END IF;
 v_definition=replace(v_definition,v_marker,'v_provider_id uuid;v_provider jsonb;v_previous public.billing_service_requests;'||v_marker);
 v_definition=replace(v_definition,'''requesterSigningMode'',''companyName''','''requesterSigningMode'',''providerId'',''companyName''');
 v_definition=replace(v_definition,'length(v_address)>500','length(v_address)>800');
 v_marker=' IF v_id IS NULL OR v_signature_id IS NULL OR jsonb_typeof(p_payload->''companyName'')';
 IF strpos(v_definition,v_marker)=0 THEN RAISE EXCEPTION 'Unexpected request create validation'; END IF;
 v_definition=replace(v_definition,v_marker,$code$
 IF p_payload ? 'providerId' THEN
  IF jsonb_typeof(p_payload->'providerId') IS DISTINCT FROM 'string' OR nullif(p_payload->>'providerId','') IS NULL THEN RAISE EXCEPTION 'Selecione um prestador cadastrado.' USING ERRCODE='22023'; END IF;
  v_provider_id=(p_payload->>'providerId')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended('billing-service-request:'||v_owner::text||':'||v_id::text,0));
  SELECT * INTO v_previous FROM public.billing_service_requests WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
  IF FOUND THEN
   IF v_previous.provider_id IS DISTINCT FROM v_provider_id THEN RAISE EXCEPTION 'O identificador já foi utilizado com outros dados.' USING ERRCODE='23505'; END IF;
   v_provider=v_previous.provider_snapshot;v_name=v_previous.company_name;v_address=v_previous.company_address;
  ELSE
   SELECT billing_private.provider_json(p) INTO v_provider FROM public.billing_service_providers p WHERE owner_id=v_owner AND id=v_provider_id FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Selecione um prestador cadastrado neste espaço.' USING ERRCODE='23514'; END IF;
   v_name=v_provider->>'legalName';v_address=v_provider->>'address';
  END IF;
  p_payload=p_payload||jsonb_build_object('companyName',v_name,'companyAddress',v_address);
 END IF;
$code$||v_marker);
 v_marker=' IF v_request.id IS NOT NULL THEN';
 IF strpos(v_definition,v_marker)=0 THEN RAISE EXCEPTION 'Unexpected request retry'; END IF;
 v_definition=replace(v_definition,v_marker,' IF v_provider_id IS NOT NULL THEN v_input=v_input||jsonb_build_object(''providerId'',v_provider_id); END IF;'||E'\n'||v_marker);
 v_definition=replace(v_definition,'created_by,creator_name,requester_signing_mode)','created_by,creator_name,requester_signing_mode,provider_id,provider_snapshot)');
 v_definition=replace(v_definition,'v_actor,v_creator_name,v_signing_mode)','v_actor,v_creator_name,v_signing_mode,v_provider_id,v_provider)');
 EXECUTE v_definition;
 SELECT pg_get_functiondef('billing_private.request_json(public.billing_service_requests)'::regprocedure) INTO v_definition;
 v_definition=replace(v_definition,'''companyName'',p_request.company_name,','''providerId'',p_request.provider_id,''provider'',p_request.provider_snapshot,''companyName'',p_request.company_name,');EXECUTE v_definition;
 SELECT pg_get_functiondef('billing_private.request_document_hash(public.billing_service_requests)'::regprocedure) INTO v_definition;
 v_marker='jsonb_build_object(''schemaVersion'',1,';
 IF strpos(v_definition,v_marker)=0 OR strpos(v_definition,'''template'',p_request.template_snapshot)::text')=0 THEN RAISE EXCEPTION 'Unexpected request hash'; END IF;
 v_definition=replace(v_definition,v_marker,'(jsonb_build_object(''schemaVersion'',1,');
 v_definition=replace(v_definition,'''template'',p_request.template_snapshot)::text','''template'',p_request.template_snapshot)||CASE WHEN p_request.provider_id IS NULL THEN ''{}''::jsonb ELSE jsonb_build_object(''schemaVersion'',2,''providerId'',p_request.provider_id,''provider'',p_request.provider_snapshot) END)::text');EXECUTE v_definition;
 SELECT pg_get_functiondef('public.billing_rpc(text,text,jsonb)'::regprocedure) INTO v_definition;
 v_marker='PERFORM billing_private.ensure_actor_workspace();';
 IF strpos(v_definition,v_marker)=0 THEN RAISE EXCEPTION 'Unexpected public dispatcher'; END IF;
 v_definition=replace(v_definition,v_marker,v_marker||E'\n IF p_resource=''service-providers'' THEN RETURN billing_private.service_providers_dispatch(p_action,p_payload); END IF;');EXECUTE v_definition;
 FOR v_function IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='billing_private' AND p.proname IN ('valid_provider_document','provider_json','service_providers_dispatch')
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',v_function); END LOOP;
 GRANT EXECUTE ON FUNCTION billing_private.service_providers_dispatch(text,jsonb) TO authenticated;
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_service_providers; END IF;
END $$;
