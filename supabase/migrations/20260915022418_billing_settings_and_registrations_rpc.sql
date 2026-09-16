-- Configurações e Cadastros: tenant isolation, RPC-only writes, exact NUMERIC arithmetic.
-- This migration creates only billing_* objects and one private Storage bucket.
CREATE SCHEMA IF NOT EXISTS billing_private;
REVOKE ALL ON SCHEMA billing_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA billing_private TO authenticated;

CREATE FUNCTION billing_private.name_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT lower(regexp_replace(translate(btrim(value),'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ','AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'),'[[:space:]]+',' ','g'))
$$;
REVOKE ALL ON FUNCTION billing_private.name_key(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.updated_at=clock_timestamp(); RETURN NEW; END $$;
REVOKE ALL ON FUNCTION billing_private.touch_updated_at() FROM PUBLIC,anon,authenticated;

CREATE TABLE public.billing_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,id),
  legal_name text NOT NULL CHECK(length(legal_name) BETWEEN 2 AND 200),
  trade_name text NOT NULL DEFAULT '' CHECK(length(trade_name)<=200),
  cnpj text NOT NULL DEFAULT '', street text NOT NULL DEFAULT '' CHECK(length(street)<=200),
  number text NOT NULL DEFAULT '' CHECK(length(number)<=30),
  complement text NOT NULL DEFAULT '' CHECK(length(complement)<=150),
  district text NOT NULL DEFAULT '' CHECK(length(district)<=100),
  city text NOT NULL DEFAULT '' CHECK(length(city)<=100),
  state text NOT NULL DEFAULT '' CHECK(state='' OR state ~ '^[A-Z]{2}$'),
  zip_code text NOT NULL DEFAULT '' CHECK(length(zip_code)<=9),
  phone text NOT NULL DEFAULT '' CHECK(length(phone)<=40),
  email text NOT NULL DEFAULT '' CHECK(length(email)<=150 AND (email='' OR email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')), name text NOT NULL, is_primary boolean NOT NULL DEFAULT false, CHECK(cnpj='' OR cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$')
);
ALTER TABLE public.billing_companies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_companies FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_companies TO authenticated;
CREATE POLICY billing_owner_read ON public.billing_companies FOR SELECT TO authenticated USING ((SELECT auth.uid())=owner_id);
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_companies
FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();
CREATE TABLE public.billing_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,id),
  legal_name text NOT NULL CHECK(length(legal_name) BETWEEN 2 AND 200),
  trade_name text NOT NULL DEFAULT '' CHECK(length(trade_name)<=200),
  cnpj text NOT NULL DEFAULT '', street text NOT NULL DEFAULT '' CHECK(length(street)<=200),
  number text NOT NULL DEFAULT '' CHECK(length(number)<=30),
  complement text NOT NULL DEFAULT '' CHECK(length(complement)<=150),
  district text NOT NULL DEFAULT '' CHECK(length(district)<=100),
  city text NOT NULL DEFAULT '' CHECK(length(city)<=100),
  state text NOT NULL DEFAULT '' CHECK(state='' OR state ~ '^[A-Z]{2}$'),
  zip_code text NOT NULL DEFAULT '' CHECK(length(zip_code)<=9),
  phone text NOT NULL DEFAULT '' CHECK(length(phone)<=40),
  email text NOT NULL DEFAULT '' CHECK(length(email)<=150 AND (email='' OR email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')), CHECK(cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'), UNIQUE(owner_id,cnpj)
);
ALTER TABLE public.billing_clients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_clients FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_clients TO authenticated;
CREATE POLICY billing_owner_read ON public.billing_clients FOR SELECT TO authenticated USING ((SELECT auth.uid())=owner_id);
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_clients
FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();
CREATE TABLE public.billing_atr_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,id),
  year integer NOT NULL CHECK(year BETWEEN 1900 AND 9999), month integer NOT NULL CHECK(month BETWEEN 1 AND 12), value numeric(15,6) NOT NULL CHECK(value>=0 AND value<1000000000), UNIQUE(owner_id,year,month)
);
ALTER TABLE public.billing_atr_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_atr_records FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_atr_records TO authenticated;
CREATE POLICY billing_owner_read ON public.billing_atr_records FOR SELECT TO authenticated USING ((SELECT auth.uid())=owner_id);
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_atr_records
FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();
CREATE TABLE public.billing_farms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,id),
  name text NOT NULL CHECK(length(name) BETWEEN 2 AND 150), area_ha numeric(15,6) NOT NULL CHECK(area_ha>0 AND area_ha<1000000000), city text NOT NULL CHECK(length(city) BETWEEN 2 AND 100), state text NOT NULL CHECK(state IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'))
);
ALTER TABLE public.billing_farms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_farms FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_farms TO authenticated;
CREATE POLICY billing_owner_read ON public.billing_farms FOR SELECT TO authenticated USING ((SELECT auth.uid())=owner_id);
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_farms
FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();
CREATE TABLE public.billing_farm_plots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,id),
  name text NOT NULL CHECK(length(name) BETWEEN 2 AND 150), area_ha numeric(15,6) NOT NULL CHECK(area_ha>0 AND area_ha<1000000000), farm_id uuid NOT NULL, FOREIGN KEY(owner_id,farm_id) REFERENCES public.billing_farms(owner_id,id) ON DELETE CASCADE, UNIQUE(owner_id,farm_id,name)
);
ALTER TABLE public.billing_farm_plots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_farm_plots FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_farm_plots TO authenticated;
CREATE POLICY billing_owner_read ON public.billing_farm_plots FOR SELECT TO authenticated USING ((SELECT auth.uid())=owner_id);
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_farm_plots
FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();
CREATE TABLE public.billing_contract_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,id),
  name text NOT NULL CHECK(length(name) BETWEEN 2 AND 150), name_key text GENERATED ALWAYS AS (billing_private.name_key(name)) STORED, stages jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(stages)='array' AND jsonb_array_length(stages)<=50), UNIQUE(owner_id,name_key)
);
ALTER TABLE public.billing_contract_types ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_contract_types FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_contract_types TO authenticated;
CREATE POLICY billing_owner_read ON public.billing_contract_types FOR SELECT TO authenticated USING ((SELECT auth.uid())=owner_id);
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_contract_types
FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();
CREATE TABLE public.billing_cultures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,id),
  name text NOT NULL CHECK(length(name) BETWEEN 2 AND 150), name_key text GENERATED ALWAYS AS (billing_private.name_key(name)) STORED, UNIQUE(owner_id,name_key)
);
ALTER TABLE public.billing_cultures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_cultures FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_cultures TO authenticated;
CREATE POLICY billing_owner_read ON public.billing_cultures FOR SELECT TO authenticated USING ((SELECT auth.uid())=owner_id);
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_cultures
FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();
CREATE TABLE public.billing_culture_subtypes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,id),
  name text NOT NULL CHECK(length(name) BETWEEN 2 AND 150), name_key text GENERATED ALWAYS AS (billing_private.name_key(name)) STORED, culture_id uuid NOT NULL, FOREIGN KEY(owner_id,culture_id) REFERENCES public.billing_cultures(owner_id,id) ON DELETE CASCADE, UNIQUE(owner_id,culture_id,name_key)
);
ALTER TABLE public.billing_culture_subtypes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_culture_subtypes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_culture_subtypes TO authenticated;
CREATE POLICY billing_owner_read ON public.billing_culture_subtypes FOR SELECT TO authenticated USING ((SELECT auth.uid())=owner_id);
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_culture_subtypes
FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();
CREATE TABLE public.billing_cultural_practices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,id),
  name text NOT NULL CHECK(length(name) BETWEEN 2 AND 150), name_key text GENERATED ALWAYS AS (billing_private.name_key(name)) STORED, description text NOT NULL DEFAULT '' CHECK(length(description)<=2000), UNIQUE(owner_id,name_key)
);
ALTER TABLE public.billing_cultural_practices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_cultural_practices FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_cultural_practices TO authenticated;
CREATE POLICY billing_owner_read ON public.billing_cultural_practices FOR SELECT TO authenticated USING ((SELECT auth.uid())=owner_id);
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_cultural_practices
FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();
CREATE TABLE public.billing_watermarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,id),
  orientation text NOT NULL DEFAULT 'portrait' CHECK(orientation IN ('portrait','landscape')), opacity integer NOT NULL DEFAULT 15 CHECK(opacity BETWEEN 0 AND 100), size integer NOT NULL DEFAULT 60 CHECK(size BETWEEN 10 AND 100), image_key text, image_name text NOT NULL DEFAULT '' CHECK(length(image_name)<=255), UNIQUE(owner_id), CHECK(image_key IS NULL OR image_key LIKE owner_id::text || '/%')
);
ALTER TABLE public.billing_watermarks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_watermarks FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_watermarks TO authenticated;
CREATE POLICY billing_owner_read ON public.billing_watermarks FOR SELECT TO authenticated USING ((SELECT auth.uid())=owner_id);
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_watermarks
FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();
CREATE TABLE public.billing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,id),
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 150), company text NOT NULL CHECK(length(btrim(company)) BETWEEN 1 AND 200), compact boolean NOT NULL DEFAULT false, UNIQUE(owner_id)
);
ALTER TABLE public.billing_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_profiles FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_profiles TO authenticated;
CREATE POLICY billing_owner_read ON public.billing_profiles FOR SELECT TO authenticated USING ((SELECT auth.uid())=owner_id);
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_profiles
FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();

CREATE TABLE public.billing_contracts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 title text NOT NULL CHECK(length(title) BETWEEN 2 AND 150), client_id uuid NOT NULL, type_id uuid NOT NULL,
 type_name text NOT NULL, stages jsonb NOT NULL CHECK(jsonb_typeof(stages)='array'),
 status text NOT NULL CHECK(status IN ('Rascunho','Ativo','Concluído','Cancelado')),
 start_date date CHECK(start_date>='1900-01-01'), end_date date CHECK(end_date>='1900-01-01'),
 value numeric(14,2) CHECK(value>=0 AND value<1000000000000), notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 CHECK(end_date IS NULL OR start_date IS NULL OR end_date>=start_date),
 FOREIGN KEY(owner_id,client_id) REFERENCES public.billing_clients(owner_id,id),
 FOREIGN KEY(owner_id,type_id) REFERENCES public.billing_contract_types(owner_id,id)
);
CREATE INDEX billing_contracts_owner_order ON public.billing_contracts(owner_id,created_at DESC,id);
CREATE INDEX billing_contracts_client ON public.billing_contracts(owner_id,client_id);
CREATE INDEX billing_contracts_type ON public.billing_contracts(owner_id,type_id);
ALTER TABLE public.billing_contracts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_contracts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_contracts TO authenticated;
CREATE POLICY billing_owner_read ON public.billing_contracts FOR SELECT TO authenticated USING ((SELECT auth.uid())=owner_id);
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_contracts FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();

CREATE UNIQUE INDEX billing_companies_primary ON public.billing_companies(owner_id) WHERE is_primary;
CREATE UNIQUE INDEX billing_companies_cnpj ON public.billing_companies(owner_id,cnpj) WHERE cnpj<>'';
CREATE INDEX billing_plots_farm ON public.billing_farm_plots(owner_id,farm_id);
CREATE INDEX billing_subtypes_culture ON public.billing_culture_subtypes(owner_id,culture_id);
CREATE INDEX billing_atr_order ON public.billing_atr_records(owner_id,year DESC,month);

-- Decimal strings keep six-place precision without JavaScript floating point.
CREATE FUNCTION billing_private.decimal_text(value numeric) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$ SELECT trim_scale(value)::text $$;
REVOKE ALL ON FUNCTION billing_private.decimal_text(numeric) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.present(value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT coalesce(jsonb_object_agg(
 CASE key WHEN 'legal_name' THEN 'legalName' WHEN 'trade_name' THEN 'tradeName'
 WHEN 'zip_code' THEN 'zipCode' WHEN 'is_primary' THEN 'isPrimary'
 WHEN 'created_at' THEN 'createdAt' WHEN 'updated_at' THEN 'updatedAt'
 WHEN 'client_id' THEN 'clientId' WHEN 'type_id' THEN 'typeId' WHEN 'type_name' THEN 'typeName' WHEN 'start_date' THEN 'startDate' WHEN 'end_date' THEN 'endDate' WHEN 'farm_id' THEN 'farmId' WHEN 'culture_id' THEN 'cultureId'
 WHEN 'area_ha' THEN 'areaHa' WHEN 'image_key' THEN 'imageKey' WHEN 'image_name' THEN 'imageName' ELSE key END,
 CASE WHEN key IN ('area_ha','value') THEN to_jsonb(billing_private.decimal_text((v #>> '{}')::numeric)) ELSE v END),'{}')
 FROM jsonb_each(value) AS e(key,v) WHERE key NOT IN ('owner_id','name_key')
$$;
REVOKE ALL ON FUNCTION billing_private.present(jsonb) FROM PUBLIC,anon,authenticated;

-- Not exposed through PostgREST. Definer is required because table DML is revoked
-- from browser roles; ownership is checked explicitly on every query below.
CREATE FUNCTION billing_private.dispatch(p_resource text,p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid := auth.uid(); v_resource text := p_resource; v_table text; v_plural text; v_singular text;
 v_id uuid; v_farm_id uuid; v_culture_id uuid; v_result jsonb; v_row jsonb; v_data jsonb := '{}'::jsonb;
 v_existing jsonb; v_item jsonb; v_key text; v_column text; v_text text; v_columns text; v_values text; v_updates text;
 v_area numeric; v_used numeric; v_total numeric; v_primary boolean; v_email text; v_display_name text;
BEGIN
 IF v_owner IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=v_owner) THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Dados inválidos.' USING ERRCODE='22023'; END IF;
 IF p_action NOT IN ('list','get','save','delete') THEN RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023'; END IF;
 IF v_resource='watermarks' THEN v_resource='watermark'; END IF;
 IF v_resource='settings' THEN v_resource='profile'; END IF;
 -- Serialize writes for one owner, including a first company before any row exists.
 -- Farm row locks below also serialize plot capacity against farm edits.
 IF p_action IN ('save','delete') THEN PERFORM pg_advisory_xact_lock(hashtextextended('billing:'||v_owner::text,0)); END IF;
 IF v_resource IN ('profile','users') THEN
  SELECT email,coalesce(nullif(btrim(raw_user_meta_data->>'display_name'),''),nullif(email,''),'Minha conta') INTO v_email,v_display_name FROM auth.users WHERE id=v_owner;
  IF p_action='delete' OR (v_resource='users' AND p_action='save') THEN RAISE EXCEPTION 'Esta operação não está disponível para o perfil.' USING ERRCODE='22023'; END IF;
  IF p_action='save' THEN
   IF jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'company') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'compact') IS DISTINCT FROM 'boolean' OR length(btrim(p_payload->>'name')) NOT BETWEEN 1 AND 150 OR length(btrim(p_payload->>'company')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Preencha seu nome e o nome do espaço.' USING ERRCODE='22023'; END IF;
   INSERT INTO public.billing_profiles(owner_id,name,company,compact)
    VALUES(v_owner,btrim(coalesce(p_payload->>'name','')),btrim(coalesce(p_payload->>'company','')),coalesce((p_payload->>'compact')::boolean,false))
    ON CONFLICT(owner_id) DO UPDATE SET name=excluded.name,company=excluded.company,compact=excluded.compact;
  END IF;
  SELECT billing_private.present(to_jsonb(t)) INTO v_row FROM public.billing_profiles t WHERE owner_id=v_owner;
  v_row=coalesce(v_row,jsonb_build_object('name',left(v_display_name,150),'company','Meu espaço de trabalho','compact',false,'createdAt',null,'updatedAt',null)) || jsonb_build_object('id',v_owner,'email',coalesce(v_email,''),'role','owner');
  IF v_resource='users' THEN RETURN jsonb_build_object('users',jsonb_build_array(v_row)); END IF;
  RETURN jsonb_build_object('profile',v_row,'settings',v_row);
 END IF;
 IF v_resource='contracts' THEN
  v_id=nullif(p_payload->>'id','')::uuid;
  IF v_id IS NOT NULL THEN
   SELECT to_jsonb(t) INTO v_existing FROM public.billing_contracts t WHERE owner_id=v_owner AND id=v_id;
   IF v_existing IS NULL THEN RAISE EXCEPTION 'Contrato não encontrado.' USING ERRCODE='P0002'; END IF;
  END IF;
  IF p_action='delete' THEN
   IF v_id IS NULL THEN RAISE EXCEPTION 'Informe o contrato.' USING ERRCODE='22023'; END IF;
   DELETE FROM public.billing_contracts WHERE owner_id=v_owner AND id=v_id;
   RETURN jsonb_build_object('id',v_id,'deleted',true);
  END IF;
  IF p_action='save' THEN
   IF jsonb_typeof(p_payload->'title') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'status') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Confira os campos do contrato.' USING ERRCODE='22023'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.billing_clients WHERE owner_id=v_owner AND id=nullif(p_payload->>'clientId','')::uuid) THEN RAISE EXCEPTION 'Selecione um cliente cadastrado.' USING ERRCODE='22023'; END IF;
   SELECT jsonb_build_object('type_name',name,'stages',stages) INTO v_data FROM public.billing_contract_types WHERE owner_id=v_owner AND id=nullif(p_payload->>'typeId','')::uuid;
   IF v_data IS NULL THEN RAISE EXCEPTION 'Selecione um tipo de contrato válido.' USING ERRCODE='22023'; END IF;
   IF v_existing IS NOT NULL AND v_existing->>'type_id'=p_payload->>'typeId' THEN v_data=jsonb_build_object('type_name',v_existing->>'type_name','stages',v_existing->'stages'); END IF;
   FOREACH v_key IN ARRAY ARRAY['startDate','endDate'] LOOP
    v_text=btrim(coalesce(p_payload->>v_key,''));
    IF v_text<>'' AND (v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_text::date<'1900-01-01'::date) THEN RAISE EXCEPTION 'Informe uma data válida.' USING ERRCODE='22023'; END IF;
   END LOOP;
   v_text=replace(btrim(coalesce(p_payload->>'value','')),',','.');
   IF v_text<>'' AND v_text !~ '^[0-9]{1,12}([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'Informe um valor válido, com até duas casas decimais.' USING ERRCODE='22023'; END IF;
   v_id=coalesce(v_id,gen_random_uuid());
   INSERT INTO public.billing_contracts(id,owner_id,title,client_id,type_id,type_name,stages,status,start_date,end_date,value,notes)
   VALUES(v_id,v_owner,btrim(p_payload->>'title'),(p_payload->>'clientId')::uuid,(p_payload->>'typeId')::uuid,v_data->>'type_name',v_data->'stages',p_payload->>'status',nullif(btrim(p_payload->>'startDate'),'')::date,nullif(btrim(p_payload->>'endDate'),'')::date,nullif(v_text,'')::numeric,btrim(coalesce(p_payload->>'notes','')))
   ON CONFLICT(id) DO UPDATE SET title=excluded.title,client_id=excluded.client_id,type_id=excluded.type_id,type_name=excluded.type_name,stages=excluded.stages,status=excluded.status,start_date=excluded.start_date,end_date=excluded.end_date,value=excluded.value,notes=excluded.notes WHERE billing_contracts.owner_id=v_owner;
  END IF;
  IF p_action='get' AND v_id IS NULL THEN RAISE EXCEPTION 'Informe o contrato.' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(billing_private.present(to_jsonb(c))||jsonb_build_object('clientName',p.legal_name,'clientCnpj',p.cnpj,'startDate',coalesce(c.start_date::text,''),'endDate',coalesce(c.end_date::text,''),'value',coalesce(c.value::text,'')) ORDER BY c.created_at DESC,c.id),'[]') INTO v_result
   FROM public.billing_contracts c JOIN public.billing_clients p ON p.owner_id=c.owner_id AND p.id=c.client_id
   WHERE c.owner_id=v_owner AND (p_action='list' OR c.id=v_id);
  IF p_action='list' THEN RETURN jsonb_build_object('contracts',v_result); END IF;
  RETURN jsonb_build_object('contract',v_result->0);
 END IF;
 IF v_resource='watermark' THEN
  SELECT to_jsonb(t) INTO v_existing FROM public.billing_watermarks t WHERE owner_id=v_owner;
  IF p_action='delete' THEN
   DELETE FROM public.billing_watermarks WHERE owner_id=v_owner;
   v_existing=null;
  ELSIF p_action='save' THEN
   v_text=CASE WHEN coalesce((p_payload->>'removeImage')::boolean,false) THEN null WHEN p_payload ? 'imageKey' THEN nullif(p_payload->>'imageKey','') ELSE v_existing->>'image_key' END;
   IF v_text IS NOT NULL AND (split_part(v_text,'/',1)<>v_owner::text OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='billing-watermarks' AND name=v_text)) THEN
    RAISE EXCEPTION 'Envie uma imagem válida para sua conta antes de salvar.' USING ERRCODE='22023';
   END IF;
   INSERT INTO public.billing_watermarks(owner_id,orientation,opacity,size,image_key,image_name)
   VALUES(v_owner,p_payload->>'orientation',(p_payload->>'opacity')::integer,(p_payload->>'size')::integer,v_text,
    CASE WHEN v_text IS NULL THEN '' ELSE coalesce(p_payload->>'imageName',v_existing->>'image_name','') END)
   ON CONFLICT(owner_id) DO UPDATE SET orientation=excluded.orientation,opacity=excluded.opacity,size=excluded.size,image_key=excluded.image_key,image_name=excluded.image_name;
   SELECT to_jsonb(t) INTO v_existing FROM public.billing_watermarks t WHERE owner_id=v_owner;
  END IF;
  RETURN jsonb_build_object('settings',coalesce(billing_private.present(v_existing),jsonb_build_object('orientation','portrait','opacity',15,'size',60,'imageKey',null,'imageName','','updatedAt',null))||jsonb_build_object('imageUrl',null));
 END IF;
 CASE v_resource
 WHEN 'companies' THEN v_table='billing_companies'; v_plural='companies'; v_singular='company';
 WHEN 'clients' THEN v_table='billing_clients'; v_plural='clients'; v_singular='client';
 WHEN 'atr' THEN v_table='billing_atr_records'; v_plural='records'; v_singular='record';
 WHEN 'farms' THEN v_table='billing_farms'; v_plural='farms'; v_singular='farm';
 WHEN 'plots' THEN v_table='billing_farm_plots'; v_plural='plots'; v_singular='plot';
 WHEN 'contract-types' THEN v_table='billing_contract_types'; v_plural='types'; v_singular='type';
 WHEN 'cultures' THEN v_table='billing_cultures'; v_plural='cultures'; v_singular='culture';
 WHEN 'cultural-practices' THEN v_table='billing_cultural_practices'; v_plural='practices'; v_singular='practice';
 ELSE RAISE EXCEPTION 'Recurso inválido.' USING ERRCODE='22023'; END CASE;
 IF v_resource='cultures' AND p_payload->>'kind'='subtype' AND p_action IN ('save','delete') THEN v_table='billing_culture_subtypes'; END IF;
 v_id=nullif(p_payload->>'id','')::uuid;
 IF v_id IS NOT NULL THEN
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE owner_id=$1 AND id=$2',v_table) INTO v_existing USING v_owner,v_id;
  IF v_existing IS NULL THEN RAISE EXCEPTION 'Registro não encontrado.' USING ERRCODE='P0002'; END IF;
 END IF;
 IF v_resource='plots' THEN
  v_farm_id=coalesce(nullif(p_payload->>'farmId','')::uuid,(v_existing->>'farm_id')::uuid);
  SELECT area_ha INTO v_total FROM public.billing_farms WHERE owner_id=v_owner AND id=v_farm_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fazenda não encontrada.' USING ERRCODE='P0002'; END IF;
  IF v_existing IS NOT NULL AND (v_existing->>'farm_id')::uuid<>v_farm_id THEN RAISE EXCEPTION 'Talhão não encontrado nesta fazenda.' USING ERRCODE='P0002'; END IF;
 END IF;
 IF p_action='delete' THEN
  IF v_id IS NULL THEN RAISE EXCEPTION 'Informe o registro.' USING ERRCODE='22023'; END IF;
  IF v_resource='companies' AND (v_existing->>'is_primary')::boolean AND EXISTS(SELECT 1 FROM public.billing_companies WHERE owner_id=v_owner AND id<>v_id) THEN
   RAISE EXCEPTION 'Defina outra empresa como principal antes de excluir esta.' USING ERRCODE='23514';
  END IF;
  EXECUTE format('DELETE FROM public.%I WHERE owner_id=$1 AND id=$2',v_table) USING v_owner,v_id;
  IF v_resource<>'plots' THEN RETURN jsonb_build_object('id',v_id,'deleted',true); END IF;
 ELSIF p_action='save' THEN
  v_id=coalesce(v_id,gen_random_uuid());
  IF v_resource IN ('companies','clients') THEN
   FOREACH v_key IN ARRAY ARRAY['legalName','tradeName','cnpj','street','number','complement','district','city','state','zipCode','phone','email'] LOOP
    IF jsonb_typeof(p_payload->v_key) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Preencha os campos do cadastro.' USING ERRCODE='22023'; END IF;
    v_text=btrim(p_payload->>v_key);
    IF v_key='cnpj' THEN v_text=upper(regexp_replace(v_text,'[./[:space:]-]','','g')); END IF;
    IF v_key='state' THEN v_text=upper(v_text); END IF;
    v_column=CASE v_key WHEN 'legalName' THEN 'legal_name' WHEN 'tradeName' THEN 'trade_name' WHEN 'zipCode' THEN 'zip_code' ELSE v_key END;
    v_data=v_data||jsonb_build_object(v_column,v_text);
   END LOOP;
   IF v_resource='companies' THEN
    IF jsonb_typeof(p_payload->'isPrimary') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Escolha o tipo da empresa.' USING ERRCODE='22023'; END IF;
    IF coalesce((v_existing->>'is_primary')::boolean,false) AND NOT (p_payload->>'isPrimary')::boolean THEN RAISE EXCEPTION 'Defina outra empresa como principal antes de alterar esta para unidade.' USING ERRCODE='23514'; END IF;
    v_primary=(p_payload->>'isPrimary')::boolean OR NOT EXISTS(SELECT 1 FROM public.billing_companies WHERE owner_id=v_owner AND is_primary);
    IF v_primary THEN UPDATE public.billing_companies SET is_primary=false WHERE owner_id=v_owner AND is_primary; END IF;
    v_data=v_data||jsonb_build_object('name',coalesce(nullif(v_data->>'trade_name',''),v_data->>'legal_name'),'is_primary',v_primary);
   END IF;
  ELSIF v_resource='atr' THEN
   IF coalesce(p_payload->>'year','')!~'^[0-9]{4}$' OR coalesce(p_payload->>'month','')!~'^[0-9]{1,2}$' THEN RAISE EXCEPTION 'Informe ano e mês válidos.' USING ERRCODE='22023'; END IF;
   v_text=replace(btrim(p_payload->>'value'),',','.');
   IF v_text IS NULL OR v_text !~ '^[0-9]{1,9}([.][0-9]{1,6})?$' THEN RAISE EXCEPTION 'Informe um valor de ATR válido, com até seis casas decimais.' USING ERRCODE='22023'; END IF;
   v_data=jsonb_build_object('year',(p_payload->>'year')::integer,'month',(p_payload->>'month')::integer,'value',v_text::numeric);
  ELSE
   IF jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Informe um nome.' USING ERRCODE='22023'; END IF;
   v_data=jsonb_build_object('name',btrim(p_payload->>'name'));
   IF v_resource IN ('farms','plots') THEN
    v_text=replace(btrim(p_payload->>'areaHa'),',','.');
    IF v_text IS NULL OR v_text !~ '^[0-9]{1,9}([.][0-9]{1,6})?$' OR v_text::numeric<=0 THEN RAISE EXCEPTION 'Informe uma área maior que zero, com até seis casas decimais.' USING ERRCODE='22023'; END IF;
    v_area=v_text::numeric; v_data=v_data||jsonb_build_object('area_ha',v_area);
    IF v_resource='farms' THEN
     PERFORM 1 FROM public.billing_farms WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
     SELECT coalesce(sum(area_ha),0) INTO v_used FROM public.billing_farm_plots WHERE owner_id=v_owner AND farm_id=v_id;
     IF v_area<v_used THEN RAISE EXCEPTION 'A área da fazenda não pode ser menor que a soma dos talhões cadastrados.' USING ERRCODE='23514'; END IF;
     v_data=v_data||jsonb_build_object('city',btrim(p_payload->>'city'),'state',upper(btrim(p_payload->>'state')));
    ELSE
     SELECT coalesce(sum(area_ha),0) INTO v_used FROM public.billing_farm_plots WHERE owner_id=v_owner AND farm_id=v_farm_id AND id<>v_id;
     IF v_area+v_used>v_total THEN RAISE EXCEPTION 'A soma dos talhões não pode ultrapassar a área da fazenda. Confira a área disponível.' USING ERRCODE='23514'; END IF;
     v_data=v_data||jsonb_build_object('farm_id',v_farm_id);
    END IF;
   ELSIF v_resource='contract-types' THEN
    IF jsonb_typeof(p_payload->'stages') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'stages')>50 THEN RAISE EXCEPTION 'Cadastre até 50 etapas por tipo.' USING ERRCODE='22023'; END IF;
    v_result='[]'::jsonb;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'stages') LOOP
     IF jsonb_typeof(v_item->'id') IS DISTINCT FROM 'string' OR length(v_item->>'id') NOT BETWEEN 1 AND 100 OR jsonb_typeof(v_item->'name') IS DISTINCT FROM 'string' OR length(btrim(v_item->>'name')) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Preencha nome e identificador de cada etapa.' USING ERRCODE='22023'; END IF;
     IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_result) e WHERE e->>'id'=v_item->>'id') THEN RAISE EXCEPTION 'Identificador de etapa duplicado.' USING ERRCODE='22023'; END IF;
     v_result=v_result||jsonb_build_array(jsonb_build_object('id',v_item->>'id','name',btrim(v_item->>'name')));
    END LOOP;
    v_data=v_data||jsonb_build_object('stages',v_result);
   ELSIF v_resource='cultures' THEN
    IF coalesce(p_payload->>'kind','culture') NOT IN ('culture','subtype') THEN RAISE EXCEPTION 'Tipo de cultura inválido.' USING ERRCODE='22023'; END IF;
    IF v_table='billing_culture_subtypes' THEN
     v_culture_id=nullif(p_payload->>'cultureId','')::uuid;
     IF NOT EXISTS(SELECT 1 FROM public.billing_cultures WHERE owner_id=v_owner AND id=v_culture_id) OR (v_existing IS NOT NULL AND (v_existing->>'culture_id')::uuid<>v_culture_id) THEN RAISE EXCEPTION 'Cultura ou subtipo não encontrado.' USING ERRCODE='P0002'; END IF;
     v_data=v_data||jsonb_build_object('culture_id',v_culture_id);
    END IF;
   ELSIF v_resource='cultural-practices' THEN
    IF jsonb_typeof(p_payload->'description') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Informe uma descrição válida.' USING ERRCODE='22023'; END IF;
    v_data=v_data||jsonb_build_object('description',btrim(p_payload->>'description'));
   END IF;
  END IF;
  -- Identifiers come exclusively from the fixed resource mapping and normalized
  -- field allowlist above; user payload is passed through typed JSON parameters.
  SELECT string_agg(format('%I',key),',' ORDER BY key),string_agg(format('r.%I',key),',' ORDER BY key),string_agg(format('%1$I=r.%1$I',key),',' ORDER BY key)
   INTO v_columns,v_values,v_updates FROM jsonb_object_keys(v_data) key;
  IF v_existing IS NULL THEN
   EXECUTE format('INSERT INTO public.%1$I (id,owner_id,%2$s) SELECT $1,$2,%3$s FROM jsonb_populate_record(NULL::public.%1$I,$3) r RETURNING to_jsonb(%1$I.*)',v_table,v_columns,v_values) INTO v_row USING v_id,v_owner,v_data;
  ELSE
   EXECUTE format('UPDATE public.%1$I t SET %2$s FROM jsonb_populate_record(NULL::public.%1$I,$3) r WHERE t.id=$1 AND t.owner_id=$2 RETURNING to_jsonb(t.*)',v_table,v_updates) INTO v_row USING v_id,v_owner,v_data;
  END IF;
  IF v_resource IN ('companies','cultures') THEN RETURN jsonb_build_object('id',v_id); END IF;
  IF v_resource<>'plots' THEN RETURN jsonb_build_object(v_singular,billing_private.present(v_row)); END IF;
 END IF;
 IF v_resource='plots' THEN
  SELECT coalesce(sum(area_ha),0) INTO v_used FROM public.billing_farm_plots WHERE owner_id=v_owner AND farm_id=v_farm_id;
  SELECT billing_private.present(to_jsonb(t)) INTO v_row FROM public.billing_farms t WHERE owner_id=v_owner AND id=v_farm_id;
  SELECT coalesce(jsonb_agg(billing_private.present(to_jsonb(t))||jsonb_build_object('areaUnits',(area_ha*1000000)::bigint,'maxAreaHa',billing_private.decimal_text(v_total-v_used+area_ha)) ORDER BY lower(name),id),'[]') INTO v_result FROM public.billing_farm_plots t WHERE owner_id=v_owner AND farm_id=v_farm_id;
  RETURN jsonb_build_object('data',jsonb_build_object('farm',v_row,'plots',v_result,'totalUnits',(v_total*1000000)::bigint,'usedUnits',(v_used*1000000)::bigint,'availableUnits',((v_total-v_used)*1000000)::bigint,'totalHa',billing_private.decimal_text(v_total),'usedHa',billing_private.decimal_text(v_used),'availableHa',billing_private.decimal_text(v_total-v_used),'usedPercent',round(v_used/v_total*100,4),'canAddPlot',v_used<v_total));
 END IF;
 IF p_action='get' THEN
  IF v_existing IS NULL THEN RAISE EXCEPTION 'Registro não encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object(v_singular,billing_private.present(v_existing));
 END IF;
 IF v_resource='cultures' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'subtypes',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) ORDER BY lower(s.name),s.id) FROM public.billing_culture_subtypes s WHERE s.owner_id=v_owner AND s.culture_id=c.id),'[]')) ORDER BY lower(c.name),c.id),'[]') INTO v_result FROM public.billing_cultures c WHERE c.owner_id=v_owner;
 ELSE
  EXECUTE format('SELECT coalesce(jsonb_agg(billing_private.present(to_jsonb(t)) ORDER BY %s),''[]'') FROM public.%I t WHERE owner_id=$1',
   CASE v_resource WHEN 'companies' THEN 'is_primary DESC,lower(name),id' WHEN 'clients' THEN 'lower(legal_name),id' WHEN 'atr' THEN 'year DESC,month,id' ELSE 'lower(name),id' END,v_table) INTO v_result USING v_owner;
 END IF;
 RETURN jsonb_build_object(v_plural,v_result);
EXCEPTION
 WHEN unique_violation THEN RAISE EXCEPTION 'Já existe um cadastro com estes dados. Verifique CNPJ, nome ou mês de referência.' USING ERRCODE='23505';
 WHEN not_null_violation OR check_violation THEN
  -- Preserve deliberate business-rule messages; replace internal constraint detail.
  IF SQLERRM LIKE '%violates%' THEN RAISE EXCEPTION 'Verifique os campos: tamanho, formato ou limites inválidos.' USING ERRCODE='22023'; ELSE RAISE; END IF;
 WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'Informe valores e identificadores válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.dispatch(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.dispatch(text,text,jsonb) TO authenticated;

CREATE FUNCTION public.billing_rpc(p_resource text,p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 RETURN billing_private.dispatch(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION public.billing_rpc(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_rpc(text,text,jsonb) TO authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('billing-watermarks','billing-watermarks',false,3145728,ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
CREATE POLICY billing_watermarks_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='billing-watermarks' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
CREATE POLICY billing_watermarks_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='billing-watermarks' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
CREATE POLICY billing_watermarks_update ON storage.objects FOR UPDATE TO authenticated USING(bucket_id='billing-watermarks' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text) WITH CHECK(bucket_id='billing-watermarks' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
CREATE POLICY billing_watermarks_delete ON storage.objects FOR DELETE TO authenticated USING(bucket_id='billing-watermarks' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);

-- Keep the existing publication and its projects; add only these module tables.
DO $$ DECLARE t text; BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN CREATE PUBLICATION supabase_realtime; END IF;
 FOREACH t IN ARRAY ARRAY['billing_companies','billing_clients','billing_atr_records','billing_farms','billing_farm_plots','billing_contract_types','billing_cultures','billing_culture_subtypes','billing_cultural_practices','billing_watermarks','billing_profiles','billing_contracts'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t); END IF;
 END LOOP;
END $$;
COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS 'Authenticated Configurações/Cadastros RPC. Public invoker delegates to private definer with explicit owner isolation; no direct client DML.';
