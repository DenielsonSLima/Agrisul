BEGIN;
CREATE TABLE public.billing_import_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 client_id uuid, name text NOT NULL CHECK(length(name) BETWEEN 2 AND 160), config jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id), FOREIGN KEY(owner_id,client_id) REFERENCES public.billing_clients(owner_id,id)
);
CREATE UNIQUE INDEX billing_import_profiles_name ON public.billing_import_profiles(owner_id,lower(name));
CREATE TABLE public.billing_import_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 client_id uuid NOT NULL,profile_id uuid NOT NULL,profile_snapshot jsonb NOT NULL,
 source_name text NOT NULL CHECK(length(source_name) BETWEEN 1 AND 250),source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','finished')),finished_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id),UNIQUE(owner_id,client_id,source_hash),
 FOREIGN KEY(owner_id,client_id) REFERENCES public.billing_clients(owner_id,id),
 FOREIGN KEY(owner_id,profile_id) REFERENCES public.billing_import_profiles(owner_id,id)
);
CREATE INDEX billing_import_documents_status ON public.billing_import_documents(owner_id,status,created_at DESC);
CREATE TABLE public.billing_import_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL,document_id uuid NOT NULL,
 entry_date date NOT NULL,source jsonb NOT NULL DEFAULT '{}',source_page integer NOT NULL DEFAULT 0 CHECK(source_page BETWEEN 0 AND 10000),
 source_line text NOT NULL DEFAULT '' CHECK(length(source_line)<=12000),reviewed boolean NOT NULL DEFAULT false,
 position integer NOT NULL,UNIQUE(owner_id,id),FOREIGN KEY(owner_id,document_id) REFERENCES public.billing_import_documents(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX billing_import_entries_document ON public.billing_import_entries(owner_id,document_id,entry_date,position);
CREATE TABLE public.billing_import_entry_values (
 owner_id uuid NOT NULL,entry_id uuid NOT NULL,field_key text NOT NULL,
 text_value text,decimal_value numeric,date_value date,
 PRIMARY KEY(owner_id,entry_id,field_key),FOREIGN KEY(owner_id,entry_id) REFERENCES public.billing_import_entries(owner_id,id) ON DELETE CASCADE,
 CHECK(num_nonnulls(text_value,decimal_value,date_value)=1)
);
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_import_profiles FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_import_documents FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();

CREATE FUNCTION billing_private.import_profile_json(r public.billing_import_profiles) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$ SELECT r.config||jsonb_build_object('id',r.id,'name',r.name,'clientId',r.client_id,'createdAt',r.created_at,'updatedAt',r.updated_at) $$;

CREATE FUNCTION billing_private.import_values_json(p_owner uuid,p_entry uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_object_agg(v.field_key,coalesce(v.text_value,billing_private.decimal_text(v.decimal_value),to_char(v.date_value,'YYYY-MM-DD'))),'{}'::jsonb)
 FROM public.billing_import_entry_values v WHERE v.owner_id=p_owner AND v.entry_id=p_entry
$$;

CREATE FUNCTION billing_private.import_entry_pending(p_owner uuid,p_entry uuid,p_fields jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT NOT e.reviewed OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_fields) f WHERE (f->>'required')::boolean
  AND coalesce(btrim(billing_private.import_values_json(p_owner,p_entry)->>(f->>'key')),'')='')
 FROM public.billing_import_entries e WHERE e.owner_id=p_owner AND e.id=p_entry
$$;

CREATE FUNCTION billing_private.import_document_json(r public.billing_import_documents) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',r.id,'clientId',r.client_id,
 'clientName',(SELECT c.legal_name FROM public.billing_clients c WHERE c.owner_id=r.owner_id AND c.id=r.client_id),
 'profileId',r.profile_id,'profileSnapshot',r.profile_snapshot,'sourceName',r.source_name,'sourceHash',r.source_hash,
 'status',r.status,'createdAt',r.created_at,'updatedAt',r.updated_at,'finishedAt',r.finished_at,
 'entryCount',(SELECT count(*) FROM public.billing_import_entries e WHERE e.owner_id=r.owner_id AND e.document_id=r.id),
 'pendingCount',(SELECT count(*) FROM public.billing_import_entries e WHERE e.owner_id=r.owner_id AND e.document_id=r.id
  AND billing_private.import_entry_pending(r.owner_id,e.id,r.profile_snapshot->'fields')),
 'entries',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'date',to_char(e.entry_date,'YYYY-MM-DD'),
  'values',billing_private.import_values_json(e.owner_id,e.id),'source',e.source,'sourcePage',e.source_page,'sourceLine',e.source_line,'reviewed',e.reviewed)
  ORDER BY e.entry_date,e.position,e.id) FROM public.billing_import_entries e WHERE e.owner_id=r.owner_id AND e.document_id=r.id),'[]'::jsonb))
$$;

CREATE FUNCTION billing_private.import_store_values(p_owner uuid,p_entry uuid,p_fields jsonb,p_values jsonb,p_require boolean) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE f jsonb;v text;v_key text;
BEGIN
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR length(p_values::text)>300000 THEN RAISE EXCEPTION 'Valores do lançamento inválidos.' USING ERRCODE='22023'; END IF;
 FOR v_key IN SELECT jsonb_object_keys(p_values) LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_fields) x WHERE x->>'key'=v_key) THEN RAISE EXCEPTION 'Campo de lançamento desconhecido: %',v_key USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_values->v_key) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Os valores devem ser enviados como texto.' USING ERRCODE='22023'; END IF;
 END LOOP;
 DELETE FROM public.billing_import_entry_values WHERE owner_id=p_owner AND entry_id=p_entry;
 FOR f IN SELECT value FROM jsonb_array_elements(p_fields) LOOP
  v_key=f->>'key';v=btrim(coalesce(p_values->>v_key,''));
  IF length(v)>4000 THEN RAISE EXCEPTION 'Valor muito longo: %',f->>'label' USING ERRCODE='22023'; END IF;
  IF p_require AND (f->>'required')::boolean AND v='' THEN RAISE EXCEPTION 'Preencha o campo obrigatório: %',f->>'label' USING ERRCODE='23514'; END IF;
  IF v='' THEN INSERT INTO public.billing_import_entry_values(owner_id,entry_id,field_key,text_value) VALUES(p_owner,p_entry,v_key,'');
  ELSIF f->>'type'='decimal' THEN
   IF v!~'^-?[0-9]{1,15}([.,][0-9]{1,6})?$' THEN RAISE EXCEPTION 'Número inválido: %',f->>'label' USING ERRCODE='22023'; END IF;
   INSERT INTO public.billing_import_entry_values(owner_id,entry_id,field_key,decimal_value) VALUES(p_owner,p_entry,v_key,replace(v,',','.')::numeric);
  ELSIF f->>'type'='date' THEN
   IF v!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Data inválida: %',f->>'label' USING ERRCODE='22023'; END IF;
   INSERT INTO public.billing_import_entry_values(owner_id,entry_id,field_key,date_value) VALUES(p_owner,p_entry,v_key,v::date);
  ELSE INSERT INTO public.billing_import_entry_values(owner_id,entry_id,field_key,text_value) VALUES(p_owner,p_entry,v_key,v);
  END IF;
 END LOOP;
END $$;

CREATE FUNCTION billing_private.import_profiles_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();r public.billing_import_profiles;old public.billing_import_profiles;f jsonb;v_id uuid;v_client uuid;v_config jsonb;v_key text;
BEGIN
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Entre para acessar as importações.' USING ERRCODE='28000'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('list','save') THEN RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023'; END IF;
 PERFORM billing_private.authorize(CASE WHEN p_action='list' THEN 'registrations.read' ELSE 'registrations.write' END);
 PERFORM billing_private.request_payload(p_payload,CASE WHEN p_action='list' THEN ARRAY[]::text[] ELSE ARRAY['id','name','clientId','parser','sheetName','startRow','fields','templateBase64','templateName','expectedUpdatedAt'] END);
 IF p_action='list' THEN RETURN jsonb_build_object('profiles',coalesce((SELECT jsonb_agg(billing_private.import_profile_json(p) ORDER BY p.name) FROM public.billing_import_profiles p WHERE p.owner_id=v_owner),'[]'::jsonb),'canManage',billing_private.has_permission('registrations.write')); END IF;
 PERFORM billing_private.lock_request_actor();PERFORM pg_advisory_xact_lock(hashtextextended('billing:imports:'||v_owner::text,0));
 v_id=nullif(p_payload->>'id','')::uuid;v_client=nullif(p_payload->>'clientId','')::uuid;
 IF v_client IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.billing_clients WHERE owner_id=v_owner AND id=v_client) THEN RAISE EXCEPTION 'Selecione um cliente deste espaço.' USING ERRCODE='22023'; END IF;
 IF v_id IS NOT NULL THEN
  SELECT * INTO old FROM public.billing_import_profiles WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Perfil não encontrado.' USING ERRCODE='P0002'; END IF;
  IF nullif(p_payload->>'expectedUpdatedAt','')::timestamptz IS DISTINCT FROM old.updated_at THEN RAISE EXCEPTION 'O perfil foi alterado. Atualize antes de salvar.' USING ERRCODE='40001'; END IF;
 END IF;
 IF length(btrim(coalesce(p_payload->>'name',''))) NOT BETWEEN 2 AND 160 OR coalesce(p_payload->>'parser','')<>'taquari-equipment-v1'
  OR length(coalesce(p_payload->>'sheetName','')) NOT BETWEEN 1 AND 31 OR (p_payload->>'sheetName')~'[\[\]:*?/\\]'
  OR coalesce(p_payload->>'startRow','')!~'^[1-9][0-9]{0,5}$' OR jsonb_typeof(p_payload->'fields') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Confira nome, extrator, aba, linha inicial e campos.' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_payload->'fields') NOT BETWEEN 1 AND 100 OR length(coalesce(p_payload->>'templateBase64',''))>12000000
  OR coalesce(p_payload->>'templateBase64','')!~'^[A-Za-z0-9+/=]*$' OR length(coalesce(p_payload->>'templateName',''))>250 THEN RAISE EXCEPTION 'Confira os campos e o arquivo modelo (máximo 8 MB).' USING ERRCODE='22023'; END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(p_payload->'fields') LOOP
  PERFORM billing_private.request_payload(f,ARRAY['key','label','source','type','required','column','defaultValue','sourceKey','pattern','mappings']);
  IF coalesce(f->>'key','')!~'^[A-Za-z][A-Za-z0-9_]{0,79}$' OR length(coalesce(f->>'label','')) NOT BETWEEN 1 AND 160
   OR (coalesce(f->>'column','')<>'' AND (f->>'column'!~'^[A-Z]{1,3}$' OR length(f->>'column')=3 AND f->>'column'>'XFD')) OR coalesce(f->>'source','') NOT IN ('pdf','manual','fixed')
   OR coalesce(f->>'type','') NOT IN ('text','decimal','date') OR jsonb_typeof(f->'required') IS DISTINCT FROM 'boolean'
   OR jsonb_typeof(f->'defaultValue') IS DISTINCT FROM 'string' OR length(f->>'defaultValue')>4000
   OR length(coalesce(f->>'pattern',''))>500 OR length(coalesce(f->>'sourceKey',''))>80
   OR (coalesce(f->>'sourceKey','')<>'' AND f->>'sourceKey' NOT IN ('entrada','sequencia','dataChegada','horaChegada','dataSaida','horaSaida','dataMovimento','fazendaOrigem','fazendaNome','zona','talhao','itens','ordemCorte','numeroAnalise','bituca','enc','equipamento','notaFiscal','pesoBruto','tara','pesoLiquido'))
   OR (f?'mappings' AND (jsonb_typeof(f->'mappings') IS DISTINCT FROM 'object' OR length((f->'mappings')::text)>100000)) THEN RAISE EXCEPTION 'Confira os campos de extração e as colunas Excel.' USING ERRCODE='22023'; END IF;
  IF f?'mappings' AND EXISTS(SELECT 1 FROM jsonb_each(f->'mappings') m WHERE jsonb_typeof(m.value)<>'string') THEN RAISE EXCEPTION 'O de/para deve usar valores de texto.' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'fields') ff GROUP BY ff->>'key' HAVING count(*)>1)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'fields') ff WHERE coalesce(ff->>'column','')<>'' GROUP BY ff->>'column' HAVING count(*)>1) THEN RAISE EXCEPTION 'Não repita nomes de campo ou colunas Excel.' USING ERRCODE='23505'; END IF;
 v_config=jsonb_build_object('parser',p_payload->>'parser','sheetName',p_payload->>'sheetName','startRow',(p_payload->>'startRow')::integer,'fields',p_payload->'fields','templateBase64',coalesce(p_payload->>'templateBase64',''),'templateName',coalesce(p_payload->>'templateName',''));
 IF old.id IS NULL THEN INSERT INTO public.billing_import_profiles(owner_id,client_id,name,config) VALUES(v_owner,v_client,btrim(p_payload->>'name'),v_config) RETURNING * INTO r;
 ELSE UPDATE public.billing_import_profiles SET client_id=v_client,name=btrim(p_payload->>'name'),config=v_config WHERE owner_id=v_owner AND id=v_id RETURNING * INTO r; END IF;
 RETURN jsonb_build_object('profile',billing_private.import_profile_json(r));
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN RAISE EXCEPTION 'Confira os dados do perfil.' USING ERRCODE='22023';
END $$;

CREATE FUNCTION billing_private.import_documents_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();r public.billing_import_documents;p public.billing_import_profiles;
 v_id uuid;v_entry uuid;v_client uuid;e jsonb;v_status text;v_search text;v_fields jsonb;v_date date;v_result jsonb;v_total integer;v_position integer:=0;v_day jsonb;v_ids uuid[];v_keys text[];v_field text;v_values jsonb;
BEGIN
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Entre para acessar as importações.' USING ERRCODE='28000'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('list','get','import','save-entry','remove-entry','finalize','reopen','export','save-bulk','change-column-type') THEN RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023'; END IF;
 PERFORM billing_private.authorize(CASE WHEN p_action IN ('list','get','export') THEN 'registrations.read' ELSE 'registrations.write' END);
 PERFORM billing_private.request_payload(p_payload,CASE WHEN p_action='list' THEN ARRAY['status','search']
  WHEN p_action IN ('get','export') THEN ARRAY['id'] WHEN p_action='import' THEN ARRAY['id','profileId','clientId','sourceName','sourceHash','entries']
  WHEN p_action='save-entry' THEN ARRAY['id','entryId','date','values','reviewed','expectedUpdatedAt']
  WHEN p_action='save-bulk' THEN ARRAY['id','entryIds','fieldKey','fieldKeys','value','expectedUpdatedAt']
  WHEN p_action='change-column-type' THEN ARRAY['id','fieldKey','fieldKeys','type','expectedUpdatedAt']
  WHEN p_action='remove-entry' THEN ARRAY['id','entryId','expectedUpdatedAt'] ELSE ARRAY['id','expectedUpdatedAt'] END);
 IF p_action='list' THEN
  v_status=coalesce(p_payload->>'status','open');v_search=btrim(coalesce(p_payload->>'search',''));
  IF v_status NOT IN ('open','finished','all') OR length(v_search)>160 THEN RAISE EXCEPTION 'Filtros inválidos.' USING ERRCODE='22023'; END IF;
  WITH docs AS MATERIALIZED(SELECT d.* FROM public.billing_import_documents d JOIN public.billing_clients c ON c.owner_id=d.owner_id AND c.id=d.client_id
   WHERE d.owner_id=v_owner AND (v_status='all' OR d.status=v_status) AND (v_search='' OR strpos(lower(c.legal_name||' '||d.source_name),lower(v_search))>0)),
  days AS(SELECT d.client_id,c.legal_name,e.entry_date,jsonb_agg(billing_private.import_document_json(d)||jsonb_build_object(
   'dayEntryCount',(SELECT count(*) FROM public.billing_import_entries de WHERE de.owner_id=d.owner_id AND de.document_id=d.id AND de.entry_date=e.entry_date),
   'dayPendingCount',(SELECT count(*) FROM public.billing_import_entries de WHERE de.owner_id=d.owner_id AND de.document_id=d.id AND de.entry_date=e.entry_date AND billing_private.import_entry_pending(d.owner_id,de.id,d.profile_snapshot->'fields')))
   ORDER BY d.created_at DESC) documents
   FROM docs d JOIN (SELECT DISTINCT owner_id,document_id,entry_date FROM public.billing_import_entries WHERE owner_id=v_owner) e ON e.owner_id=d.owner_id AND e.document_id=d.id
   JOIN public.billing_clients c ON c.owner_id=d.owner_id AND c.id=d.client_id
   GROUP BY d.client_id,c.legal_name,e.entry_date),
  clients AS(SELECT client_id,legal_name,jsonb_agg(jsonb_build_object('date',to_char(entry_date,'YYYY-MM-DD'),'documents',documents) ORDER BY entry_date DESC) days FROM days GROUP BY client_id,legal_name)
  SELECT (SELECT count(*) FROM docs),coalesce(jsonb_agg(jsonb_build_object('clientId',client_id,'clientName',legal_name,'days',days) ORDER BY legal_name),'[]'::jsonb) INTO v_total,v_result FROM clients;
  RETURN jsonb_build_object('clients',v_result,'total',v_total,'canManage',billing_private.has_permission('registrations.write'));
 END IF;
 IF p_action NOT IN ('get','export') THEN
  PERFORM billing_private.lock_request_actor();PERFORM pg_advisory_xact_lock(hashtextextended('billing:imports:'||v_owner::text,0));
 END IF;
 IF p_action='import' THEN
  v_client=nullif(p_payload->>'clientId','')::uuid;
  SELECT * INTO p FROM public.billing_import_profiles WHERE owner_id=v_owner AND id=nullif(p_payload->>'profileId','')::uuid FOR SHARE;
  IF NOT FOUND OR (p.client_id IS NOT NULL AND p.client_id IS DISTINCT FROM v_client) THEN RAISE EXCEPTION 'Selecione um perfil compatível com o cliente.' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.billing_clients WHERE owner_id=v_owner AND id=v_client) THEN RAISE EXCEPTION 'Selecione um cliente deste espaço.' USING ERRCODE='22023'; END IF;
  IF coalesce(p_payload->>'sourceHash','')!~'^[a-f0-9]{64}$' OR length(coalesce(p_payload->>'sourceName','')) NOT BETWEEN 1 AND 250
   OR jsonb_typeof(p_payload->'entries') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Arquivo ou lançamentos inválidos.' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(p_payload->'entries') NOT BETWEEN 1 AND 3000 THEN RAISE EXCEPTION 'Importe entre 1 e 3.000 lançamentos por arquivo.' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM public.billing_import_documents WHERE owner_id=v_owner AND client_id=v_client AND source_hash=p_payload->>'sourceHash';
  IF FOUND THEN RETURN jsonb_build_object('document',billing_private.import_document_json(r),'created',false); END IF;
  INSERT INTO public.billing_import_documents(id,owner_id,client_id,profile_id,profile_snapshot,source_name,source_hash)
   VALUES(coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid()),v_owner,v_client,p.id,billing_private.import_profile_json(p),p_payload->>'sourceName',p_payload->>'sourceHash') RETURNING * INTO r;
  FOR e IN SELECT value FROM jsonb_array_elements(p_payload->'entries') LOOP
   PERFORM billing_private.request_payload(e,ARRAY['date','values','source','sourcePage','sourceLine']);
   IF coalesce(e->>'date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR coalesce(e->>'sourcePage','0')!~'^[0-9]{1,5}$'
    OR length(coalesce(e->>'sourceLine',''))>12000 OR (e?'source' AND (jsonb_typeof(e->'source') IS DISTINCT FROM 'object' OR length((e->'source')::text)>30000)) THEN RAISE EXCEPTION 'Confira a origem e a data do lançamento.' USING ERRCODE='22023'; END IF;
   IF e?'source' AND EXISTS(SELECT 1 FROM jsonb_each(e->'source') x WHERE jsonb_typeof(x.value)<>'string') THEN RAISE EXCEPTION 'A origem deve usar valores de texto.' USING ERRCODE='22023'; END IF;
   v_position=v_position+1;
   INSERT INTO public.billing_import_entries(owner_id,document_id,entry_date,source,source_page,source_line,position)
    VALUES(v_owner,r.id,(e->>'date')::date,coalesce(e->'source','{}'::jsonb),coalesce((e->>'sourcePage')::integer,0),coalesce(e->>'sourceLine',''),v_position) RETURNING id INTO v_entry;
   PERFORM billing_private.import_store_values(v_owner,v_entry,r.profile_snapshot->'fields',e->'values',false);
  END LOOP;
  RETURN jsonb_build_object('document',billing_private.import_document_json(r),'created',true);
 END IF;
 v_id=nullif(p_payload->>'id','')::uuid;
 IF p_action IN ('get','export') THEN SELECT * INTO r FROM public.billing_import_documents WHERE owner_id=v_owner AND id=v_id;
 ELSE SELECT * INTO r FROM public.billing_import_documents WHERE owner_id=v_owner AND id=v_id FOR UPDATE; END IF;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Importação não encontrada.' USING ERRCODE='P0002'; END IF;
 IF p_action='get' THEN RETURN jsonb_build_object('document',billing_private.import_document_json(r)); END IF;
 IF p_action='export' THEN
  IF r.status<>'finished' THEN RAISE EXCEPTION 'Finalize a revisão antes de exportar.' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('document',billing_private.import_document_json(r),'sheetName',r.profile_snapshot->>'sheetName','startRow',(r.profile_snapshot->>'startRow')::integer,
   'columns',(SELECT coalesce(jsonb_agg(jsonb_build_object('key',f->>'key','column',f->>'column','label',f->>'label','type',f->>'type')),'[]'::jsonb) FROM jsonb_array_elements(r.profile_snapshot->'fields') f WHERE coalesce(f->>'column','')<>''),
   'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('entryId',e.id,'values',(SELECT coalesce(jsonb_object_agg(f->>'column',coalesce(billing_private.import_values_json(v_owner,e.id)->>(f->>'key'),'')),'{}'::jsonb) FROM jsonb_array_elements(r.profile_snapshot->'fields') f WHERE coalesce(f->>'column','')<>'')) ORDER BY e.entry_date,e.position,e.id) FROM public.billing_import_entries e WHERE e.owner_id=v_owner AND e.document_id=r.id),'[]'::jsonb));
 END IF;
 IF nullif(p_payload->>'expectedUpdatedAt','')::timestamptz IS DISTINCT FROM r.updated_at THEN RAISE EXCEPTION 'A importação foi alterada. Atualize antes de salvar.' USING ERRCODE='40001'; END IF;
 IF p_action='reopen' THEN
  IF r.status<>'finished' THEN RAISE EXCEPTION 'A importação já está em aberto.' USING ERRCODE='23514'; END IF;
  UPDATE public.billing_import_documents SET status='open',finished_at=NULL WHERE owner_id=v_owner AND id=v_id RETURNING * INTO r;
 ELSE
  IF r.status<>'open' THEN RAISE EXCEPTION 'Reabra a importação antes de alterar os lançamentos.' USING ERRCODE='23514'; END IF;
  IF p_action IN ('save-bulk','change-column-type') THEN
   IF p_payload?'fieldKeys' THEN
    IF p_payload?'fieldKey' OR jsonb_typeof(p_payload->'fieldKeys') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Selecione as colunas deste documento.' USING ERRCODE='22023'; END IF;
    IF jsonb_array_length(p_payload->'fieldKeys') NOT BETWEEN 1 AND 100 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'fieldKeys') k WHERE jsonb_typeof(k)<>'string') THEN RAISE EXCEPTION 'Selecione entre 1 e 100 colunas.' USING ERRCODE='22023'; END IF;
    SELECT array_agg(DISTINCT value) INTO v_keys FROM jsonb_array_elements_text(p_payload->'fieldKeys');
    IF cardinality(v_keys)<>jsonb_array_length(p_payload->'fieldKeys') THEN RAISE EXCEPTION 'Não repita colunas na seleção.' USING ERRCODE='22023'; END IF;
   ELSE v_keys=ARRAY[p_payload->>'fieldKey']; END IF;
   IF EXISTS(SELECT 1 FROM unnest(v_keys) k WHERE k IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.profile_snapshot->'fields') f WHERE f->>'key'=k)) THEN RAISE EXCEPTION 'Selecione uma coluna deste documento.' USING ERRCODE='22023'; END IF;
   v_fields=r.profile_snapshot->'fields';
   IF p_action='save-bulk' THEN
    IF jsonb_typeof(p_payload->'entryIds') IS DISTINCT FROM 'array' OR jsonb_typeof(p_payload->'value') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Selecione os lançamentos e o valor do lote.' USING ERRCODE='22023'; END IF;
    IF jsonb_array_length(p_payload->'entryIds') NOT BETWEEN 1 AND 3000 THEN RAISE EXCEPTION 'Selecione entre 1 e 3.000 lançamentos.' USING ERRCODE='22023'; END IF;
    SELECT array_agg(DISTINCT value::uuid) INTO v_ids FROM jsonb_array_elements_text(p_payload->'entryIds');
    IF cardinality(v_ids)<>jsonb_array_length(p_payload->'entryIds') OR (SELECT count(*) FROM public.billing_import_entries WHERE owner_id=v_owner AND document_id=v_id AND id=ANY(v_ids))<>cardinality(v_ids) THEN RAISE EXCEPTION 'A seleção contém lançamentos fora deste documento.' USING ERRCODE='22023'; END IF;
   ELSE
    IF coalesce(p_payload->>'type','') NOT IN ('text','decimal','date') THEN RAISE EXCEPTION 'Tipo de coluna inválido.' USING ERRCODE='22023'; END IF;
    SELECT jsonb_agg(CASE WHEN f->>'key'=ANY(v_keys) THEN jsonb_set(f,'{type}',to_jsonb(p_payload->>'type')) ELSE f END ORDER BY n) INTO v_fields FROM jsonb_array_elements(v_fields) WITH ORDINALITY fields(f,n);
    SELECT array_agg(id) INTO v_ids FROM public.billing_import_entries WHERE owner_id=v_owner AND document_id=v_id;
   END IF;
   FOREACH v_entry IN ARRAY v_ids LOOP
    v_values=billing_private.import_values_json(v_owner,v_entry);
    IF p_action='save-bulk' THEN FOREACH v_field IN ARRAY v_keys LOOP v_values=jsonb_set(v_values,ARRAY[v_field],to_jsonb(p_payload->>'value')); END LOOP; END IF;
    PERFORM billing_private.import_store_values(v_owner,v_entry,v_fields,v_values,false);
   END LOOP;
   UPDATE public.billing_import_entries SET reviewed=false WHERE owner_id=v_owner AND document_id=v_id AND id=ANY(v_ids);
   IF p_action='change-column-type' THEN UPDATE public.billing_import_documents SET profile_snapshot=jsonb_set(profile_snapshot,'{fields}',v_fields) WHERE owner_id=v_owner AND id=v_id; END IF;
  ELSIF p_action='save-entry' THEN
   IF coalesce(p_payload->>'date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR jsonb_typeof(p_payload->'reviewed') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Confira a data e a revisão.' USING ERRCODE='22023'; END IF;
   v_entry=nullif(p_payload->>'entryId','')::uuid;v_date=(p_payload->>'date')::date;
   IF v_entry IS NULL THEN
    IF (SELECT count(*) FROM public.billing_import_entries WHERE owner_id=v_owner AND document_id=v_id)>=3000 THEN RAISE EXCEPTION 'Limite de lançamentos atingido.' USING ERRCODE='23514'; END IF;
    INSERT INTO public.billing_import_entries(owner_id,document_id,entry_date,position) SELECT v_owner,v_id,v_date,coalesce(max(position),0)+1 FROM public.billing_import_entries WHERE owner_id=v_owner AND document_id=v_id RETURNING id INTO v_entry;
   ELSE
    UPDATE public.billing_import_entries SET entry_date=v_date WHERE owner_id=v_owner AND document_id=v_id AND id=v_entry;
    IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE='P0002'; END IF;
   END IF;
   PERFORM billing_private.import_store_values(v_owner,v_entry,r.profile_snapshot->'fields',p_payload->'values',(p_payload->>'reviewed')::boolean);
   UPDATE public.billing_import_entries SET reviewed=(p_payload->>'reviewed')::boolean WHERE owner_id=v_owner AND id=v_entry;
  ELSIF p_action='remove-entry' THEN
   IF (SELECT count(*) FROM public.billing_import_entries WHERE owner_id=v_owner AND document_id=v_id)<=1 THEN RAISE EXCEPTION 'Mantenha ao menos um lançamento na importação.' USING ERRCODE='23514'; END IF;
   DELETE FROM public.billing_import_entries WHERE owner_id=v_owner AND document_id=v_id AND id=nullif(p_payload->>'entryId','')::uuid;
   IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE='P0002'; END IF;
  ELSIF p_action='finalize' THEN
   IF EXISTS(SELECT 1 FROM public.billing_import_entries e WHERE e.owner_id=v_owner AND e.document_id=v_id AND billing_private.import_entry_pending(v_owner,e.id,r.profile_snapshot->'fields')) THEN RAISE EXCEPTION 'Revise todos os lançamentos e preencha os campos obrigatórios.' USING ERRCODE='23514'; END IF;
   UPDATE public.billing_import_documents SET status='finished',finished_at=clock_timestamp() WHERE owner_id=v_owner AND id=v_id;
  END IF;
  UPDATE public.billing_import_documents SET updated_at=clock_timestamp() WHERE owner_id=v_owner AND id=v_id RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('document',billing_private.import_document_json(r));
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN RAISE EXCEPTION 'Confira as datas, valores e vínculos da importação.' USING ERRCODE='22023';
END $$;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['billing_import_profiles','billing_import_documents','billing_import_entries','billing_import_entry_values'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('CREATE POLICY import_workflow_read ON public.%I FOR SELECT TO authenticated USING(billing_private.can_access_owner(owner_id,''registrations.read''))',t);
  EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL',t);
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t); END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION billing_private.import_profile_json(public.billing_import_profiles),billing_private.import_values_json(uuid,uuid),billing_private.import_entry_pending(uuid,uuid,jsonb),billing_private.import_document_json(public.billing_import_documents),billing_private.import_store_values(uuid,uuid,jsonb,jsonb,boolean),billing_private.import_profiles_dispatch(text,jsonb),billing_private.import_documents_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
ALTER FUNCTION billing_private.dispatch(text,text,jsonb) RENAME TO dispatch_before_import_workflow;
REVOKE ALL ON FUNCTION billing_private.dispatch_before_import_workflow(text,text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.dispatch(p_resource text,p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF p_resource='import-profiles' THEN RETURN billing_private.import_profiles_dispatch(p_action,p_payload); END IF;
 IF p_resource='import-documents' THEN RETURN billing_private.import_documents_dispatch(p_action,p_payload); END IF;
 RETURN billing_private.dispatch_before_import_workflow(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION billing_private.dispatch(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.dispatch(text,text,jsonb) TO authenticated;
COMMIT;
