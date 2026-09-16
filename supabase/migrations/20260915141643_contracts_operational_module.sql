-- Operational contract workspace: company, contracted volume and owner-scoped loads.
ALTER TABLE public.billing_contracts
 ADD COLUMN company_id uuid,
 ADD COLUMN contracted_volume numeric(15,3) NOT NULL DEFAULT 0
  CHECK(contracted_volume>=0 AND contracted_volume<1000000000000);

UPDATE public.billing_contracts c SET company_id=(
 SELECT company.id FROM public.billing_companies company
 WHERE company.owner_id=c.owner_id
 ORDER BY company.is_primary DESC,company.created_at,company.id LIMIT 1
) WHERE c.company_id IS NULL;

ALTER TABLE public.billing_contracts
 ADD CONSTRAINT billing_contracts_company_owner_fk
 FOREIGN KEY(owner_id,company_id) REFERENCES public.billing_companies(owner_id,id);
CREATE INDEX billing_contracts_company ON public.billing_contracts(owner_id,company_id);
CREATE UNIQUE INDEX billing_contracts_owner_id_unique ON public.billing_contracts(owner_id,id);
CREATE UNIQUE INDEX billing_farm_plots_owner_farm_id ON public.billing_farm_plots(owner_id,farm_id,id);

CREATE TABLE public.billing_contract_loads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 contract_id uuid NOT NULL,
 farm_id uuid NOT NULL,
 plot_id uuid NOT NULL,
 loaded_at date NOT NULL CHECK(loaded_at>='1900-01-01'),
 volume numeric(15,3) NOT NULL CHECK(volume>0 AND volume<1000000000000),
 atr numeric(15,6) NOT NULL CHECK(atr>0 AND atr<1000000000),
 document text NOT NULL DEFAULT '' CHECK(length(document)<=100),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=1000),
 UNIQUE(owner_id,id),
 FOREIGN KEY(owner_id,contract_id) REFERENCES public.billing_contracts(owner_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,farm_id) REFERENCES public.billing_farms(owner_id,id),
 FOREIGN KEY(owner_id,farm_id,plot_id) REFERENCES public.billing_farm_plots(owner_id,farm_id,id)
);
CREATE INDEX billing_contract_loads_contract ON public.billing_contract_loads(owner_id,contract_id,loaded_at DESC,id);
CREATE INDEX billing_contract_loads_origin ON public.billing_contract_loads(owner_id,farm_id,plot_id);
ALTER TABLE public.billing_contract_loads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_contract_loads FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_contract_loads TO authenticated;
CREATE POLICY billing_owner_read ON public.billing_contract_loads FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'contracts.read'));
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_contract_loads
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();

CREATE FUNCTION billing_private.present_contract_load(p_load public.billing_contract_loads) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT billing_private.present(to_jsonb(p_load)) || jsonb_build_object(
  'loadedAt',p_load.loaded_at::text,
  'volume',billing_private.decimal_text(p_load.volume),
  'atr',billing_private.decimal_text(p_load.atr),
  'farmName',farm.name,
  'plotName',plot.name
 )
 FROM public.billing_farms farm
 JOIN public.billing_farm_plots plot ON plot.owner_id=farm.owner_id AND plot.farm_id=farm.id
 WHERE farm.owner_id=p_load.owner_id AND farm.id=p_load.farm_id AND plot.id=p_load.plot_id
$$;
REVOKE ALL ON FUNCTION billing_private.present_contract_load(public.billing_contract_loads) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.present_contract(p_contract public.billing_contracts) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT billing_private.present(to_jsonb(p_contract)) || jsonb_build_object(
  'companyName',coalesce(company.name,''),
  'companyCnpj',coalesce(company.cnpj,''),
  'clientName',client.legal_name,
  'clientCnpj',client.cnpj,
  'startDate',coalesce(p_contract.start_date::text,''),
  'endDate',coalesce(p_contract.end_date::text,''),
  'contractedVolume',billing_private.decimal_text(p_contract.contracted_volume),
  'value',coalesce(billing_private.decimal_text(p_contract.value),''),
  'loadedVolume',billing_private.decimal_text(totals.loaded_volume),
  'remainingVolume',billing_private.decimal_text(greatest(p_contract.contracted_volume-totals.loaded_volume,0)),
  'averageAtr',coalesce(billing_private.decimal_text(totals.average_atr),'')
 )
 FROM public.billing_clients client
 LEFT JOIN public.billing_companies company ON company.owner_id=p_contract.owner_id AND company.id=p_contract.company_id
 CROSS JOIN LATERAL (
  SELECT coalesce(sum(load.volume),0) loaded_volume,
   sum(load.volume*load.atr)/nullif(sum(load.volume),0) average_atr
  FROM public.billing_contract_loads load
  WHERE load.owner_id=p_contract.owner_id AND load.contract_id=p_contract.id
 ) totals
 WHERE client.owner_id=p_contract.owner_id AND client.id=p_contract.client_id
$$;
REVOKE ALL ON FUNCTION billing_private.present_contract(public.billing_contracts) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.contracts_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;v_contract_id uuid;v_company_id uuid;v_client_id uuid;v_type_id uuid;v_farm_id uuid;v_plot_id uuid;
 v_contract public.billing_contracts%ROWTYPE;v_load public.billing_contract_loads%ROWTYPE;
 v_data jsonb;v_result jsonb;v_counts jsonb;v_loads jsonb;
 v_search text;v_bucket text;v_from date;v_to date;v_text text;v_volume_text text;v_atr_text text;v_value_text text;
 v_loaded numeric;v_existing_volume numeric:=0;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_action NOT IN ('list','get','save','save-load','delete-load') THEN
  RAISE EXCEPTION 'Operação de contrato inválida.' USING ERRCODE='22023';
 END IF;

 IF p_action='list' THEN
  v_bucket=coalesce(nullif(p_payload->>'bucket',''),'open');
  v_search=btrim(coalesce(p_payload->>'search',''));
  IF v_bucket NOT IN ('open','finished') OR length(v_search)>200 THEN RAISE EXCEPTION 'Confira os filtros dos contratos.' USING ERRCODE='22023'; END IF;
  FOREACH v_text IN ARRAY ARRAY[coalesce(p_payload->>'from',''),coalesce(p_payload->>'to','')] LOOP
   IF v_text<>'' AND (v_text!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_text::date<'1900-01-01') THEN RAISE EXCEPTION 'Informe um período válido.' USING ERRCODE='22023'; END IF;
  END LOOP;
  v_from=nullif(p_payload->>'from','')::date;v_to=nullif(p_payload->>'to','')::date;
  IF v_from IS NOT NULL AND v_to IS NOT NULL AND v_from>v_to THEN RAISE EXCEPTION 'A data inicial deve ser igual ou anterior à data final.' USING ERRCODE='22023'; END IF;

  WITH filtered AS (
   SELECT c.* FROM public.billing_contracts c
   JOIN public.billing_clients client ON client.owner_id=c.owner_id AND client.id=c.client_id
   LEFT JOIN public.billing_companies company ON company.owner_id=c.owner_id AND company.id=c.company_id
   WHERE c.owner_id=v_owner
    AND (v_search='' OR strpos(lower(concat_ws(' ',c.title,c.type_name,client.legal_name,client.cnpj,company.name,company.legal_name,company.cnpj)),lower(v_search))>0)
    AND (v_from IS NULL OR c.start_date>=v_from) AND (v_to IS NULL OR c.start_date<=v_to)
  ), selected AS (
   SELECT * FROM filtered WHERE (v_bucket='open' AND status IN ('Rascunho','Ativo')) OR (v_bucket='finished' AND status IN ('Concluído','Cancelado'))
  )
  SELECT
   coalesce((SELECT jsonb_agg(billing_private.present_contract(c) ORDER BY c.start_date DESC NULLS LAST,c.created_at DESC,c.id) FROM selected c),'[]'::jsonb),
   jsonb_build_object('open',(SELECT count(*) FROM filtered WHERE status IN ('Rascunho','Ativo')),'finished',(SELECT count(*) FROM filtered WHERE status IN ('Concluído','Cancelado')))
  INTO v_result,v_counts;
  RETURN jsonb_build_object('contracts',v_result,'counts',v_counts,'total',jsonb_array_length(v_result));
 END IF;

 v_id=nullif(p_payload->>'id','')::uuid;
 IF p_action='get' THEN
  IF v_id IS NULL THEN RAISE EXCEPTION 'Informe o contrato.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_contract FROM public.billing_contracts WHERE owner_id=v_owner AND id=v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado.' USING ERRCODE='P0002'; END IF;
  SELECT coalesce(jsonb_agg(billing_private.present_contract_load(load) ORDER BY load.loaded_at DESC,load.created_at DESC,load.id),'[]'::jsonb)
   INTO v_loads FROM public.billing_contract_loads load WHERE load.owner_id=v_owner AND load.contract_id=v_id;
  RETURN jsonb_build_object('contract',billing_private.present_contract(v_contract)||jsonb_build_object('loads',v_loads));
 END IF;

 IF p_action='save' THEN
  IF jsonb_typeof(p_payload->'title') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'companyId') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_payload->'clientId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'typeId') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_payload->'status') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'startDate') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_payload->'contractedVolume') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Confira os campos do contrato.' USING ERRCODE='22023';
  END IF;
  IF length(btrim(p_payload->>'title')) NOT BETWEEN 2 AND 150 OR p_payload->>'status' NOT IN ('Rascunho','Ativo','Concluído','Cancelado') THEN RAISE EXCEPTION 'Confira o nome e a situação do contrato.' USING ERRCODE='22023'; END IF;
  v_company_id=(p_payload->>'companyId')::uuid;v_client_id=(p_payload->>'clientId')::uuid;v_type_id=(p_payload->>'typeId')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.billing_companies WHERE owner_id=v_owner AND id=v_company_id) THEN RAISE EXCEPTION 'Selecione uma empresa cadastrada.' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.billing_clients WHERE owner_id=v_owner AND id=v_client_id) THEN RAISE EXCEPTION 'Selecione um cliente cadastrado.' USING ERRCODE='22023'; END IF;
  SELECT jsonb_build_object('type_name',name,'stages',stages) INTO v_data FROM public.billing_contract_types WHERE owner_id=v_owner AND id=v_type_id;
  IF v_data IS NULL THEN RAISE EXCEPTION 'Selecione um tipo de contrato válido.' USING ERRCODE='22023'; END IF;
  v_text=btrim(p_payload->>'startDate');
  IF v_text!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_text::date<'1900-01-01' THEN RAISE EXCEPTION 'Informe a data do contrato.' USING ERRCODE='22023'; END IF;
  IF coalesce(p_payload->>'endDate','')<>'' AND ((p_payload->>'endDate')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR (p_payload->>'endDate')::date<v_text::date) THEN RAISE EXCEPTION 'A data final deve ser igual ou posterior à data do contrato.' USING ERRCODE='22023'; END IF;
  v_volume_text=replace(btrim(p_payload->>'contractedVolume'),',','.');
  IF v_volume_text!~'^[0-9]{1,12}([.][0-9]{1,3})?$' OR v_volume_text::numeric<=0 THEN RAISE EXCEPTION 'Informe um volume válido, com até três casas decimais.' USING ERRCODE='22023'; END IF;
  v_value_text=replace(btrim(coalesce(p_payload->>'value','')),',','.');
  IF v_value_text<>'' AND v_value_text!~'^[0-9]{1,12}([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'Informe um valor válido, com até duas casas decimais.' USING ERRCODE='22023'; END IF;
  IF length(btrim(coalesce(p_payload->>'notes','')))>4000 THEN RAISE EXCEPTION 'As observações devem ter até 4.000 caracteres.' USING ERRCODE='22023'; END IF;
  IF v_id IS NOT NULL THEN
   SELECT * INTO v_contract FROM public.billing_contracts WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado.' USING ERRCODE='P0002'; END IF;
   IF v_contract.type_id=v_type_id THEN v_data=jsonb_build_object('type_name',v_contract.type_name,'stages',v_contract.stages); END IF;
   SELECT coalesce(sum(volume),0) INTO v_loaded FROM public.billing_contract_loads WHERE owner_id=v_owner AND contract_id=v_id;
   IF v_volume_text::numeric<v_loaded THEN RAISE EXCEPTION 'O volume contratado não pode ficar abaixo do volume já carregado.' USING ERRCODE='23514'; END IF;
  END IF;
  v_id=coalesce(v_id,gen_random_uuid());
  INSERT INTO public.billing_contracts(id,owner_id,title,company_id,client_id,type_id,type_name,stages,status,start_date,end_date,contracted_volume,value,notes)
  VALUES(v_id,v_owner,btrim(p_payload->>'title'),v_company_id,v_client_id,v_type_id,v_data->>'type_name',v_data->'stages',p_payload->>'status',v_text::date,nullif(p_payload->>'endDate','')::date,v_volume_text::numeric,nullif(v_value_text,'')::numeric,btrim(coalesce(p_payload->>'notes','')))
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,company_id=excluded.company_id,client_id=excluded.client_id,type_id=excluded.type_id,type_name=excluded.type_name,stages=excluded.stages,status=excluded.status,start_date=excluded.start_date,end_date=excluded.end_date,contracted_volume=excluded.contracted_volume,value=excluded.value,notes=excluded.notes
   WHERE billing_contracts.owner_id=v_owner RETURNING * INTO v_contract;
  RETURN jsonb_build_object('contract',billing_private.present_contract(v_contract));
 END IF;

 v_contract_id=nullif(p_payload->>'contractId','')::uuid;
 IF v_contract_id IS NULL THEN RAISE EXCEPTION 'Informe o contrato.' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_contract FROM public.billing_contracts WHERE owner_id=v_owner AND id=v_contract_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado.' USING ERRCODE='P0002'; END IF;

 IF p_action='delete-load' THEN
  IF v_id IS NULL THEN RAISE EXCEPTION 'Informe o lançamento.' USING ERRCODE='22023'; END IF;
  DELETE FROM public.billing_contract_loads WHERE owner_id=v_owner AND contract_id=v_contract_id AND id=v_id RETURNING * INTO v_load;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('id',v_id,'deleted',true);
 END IF;

 IF jsonb_typeof(p_payload->'loadedAt') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'farmId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'plotId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'volume') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'atr') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Confira os dados do carregamento.' USING ERRCODE='22023'; END IF;
 v_text=btrim(p_payload->>'loadedAt');IF v_text!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_text::date<'1900-01-01' THEN RAISE EXCEPTION 'Informe uma data de carregamento válida.' USING ERRCODE='22023'; END IF;
 v_farm_id=(p_payload->>'farmId')::uuid;v_plot_id=(p_payload->>'plotId')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.billing_farm_plots plot WHERE plot.owner_id=v_owner AND plot.farm_id=v_farm_id AND plot.id=v_plot_id) THEN RAISE EXCEPTION 'Selecione um talhão válido para a fazenda de origem.' USING ERRCODE='22023'; END IF;
 v_volume_text=replace(btrim(p_payload->>'volume'),',','.');v_atr_text=replace(btrim(p_payload->>'atr'),',','.');
 IF v_volume_text!~'^[0-9]{1,12}([.][0-9]{1,3})?$' OR v_volume_text::numeric<=0 THEN RAISE EXCEPTION 'Informe um volume válido, com até três casas decimais.' USING ERRCODE='22023'; END IF;
 IF v_atr_text!~'^[0-9]{1,9}([.][0-9]{1,6})?$' OR v_atr_text::numeric<=0 THEN RAISE EXCEPTION 'Informe um ATR válido, com até seis casas decimais.' USING ERRCODE='22023'; END IF;
 IF length(btrim(coalesce(p_payload->>'document','')))>100 OR length(btrim(coalesce(p_payload->>'notes','')))>1000 THEN RAISE EXCEPTION 'Confira o documento e as observações do carregamento.' USING ERRCODE='22023'; END IF;
 IF v_id IS NOT NULL THEN
  SELECT volume INTO v_existing_volume FROM public.billing_contract_loads WHERE owner_id=v_owner AND contract_id=v_contract_id AND id=v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE='P0002'; END IF;
 END IF;
 SELECT coalesce(sum(volume),0) INTO v_loaded FROM public.billing_contract_loads WHERE owner_id=v_owner AND contract_id=v_contract_id;
 IF v_loaded-v_existing_volume+v_volume_text::numeric>v_contract.contracted_volume THEN RAISE EXCEPTION 'O carregamento ultrapassa o saldo de volume do contrato.' USING ERRCODE='23514'; END IF;
 IF v_id IS NULL THEN
  INSERT INTO public.billing_contract_loads(owner_id,contract_id,farm_id,plot_id,loaded_at,volume,atr,document,notes)
   VALUES(v_owner,v_contract_id,v_farm_id,v_plot_id,v_text::date,v_volume_text::numeric,v_atr_text::numeric,btrim(coalesce(p_payload->>'document','')),btrim(coalesce(p_payload->>'notes','')))
   RETURNING * INTO v_load;
 ELSE
  UPDATE public.billing_contract_loads SET farm_id=v_farm_id,plot_id=v_plot_id,loaded_at=v_text::date,volume=v_volume_text::numeric,atr=v_atr_text::numeric,document=btrim(coalesce(p_payload->>'document','')),notes=btrim(coalesce(p_payload->>'notes',''))
   WHERE owner_id=v_owner AND contract_id=v_contract_id AND id=v_id RETURNING * INTO v_load;
 END IF;
 RETURN jsonb_build_object('load',billing_private.present_contract_load(v_load));
EXCEPTION
 WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Informe datas, valores e identificadores válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.contracts_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.contracts_dispatch(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.billing_rpc(p_resource text,p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.ensure_actor_workspace();
 IF p_resource IN ('settings','profile') THEN RETURN billing_private.workspace_settings(p_action,p_payload); END IF;
 IF p_resource='users' THEN RETURN billing_private.users_dispatch(p_action,p_payload); END IF;
 IF p_resource='access-profiles' THEN RETURN billing_private.access_profiles_dispatch(p_action,p_payload); END IF;
 IF p_resource='report-headers' THEN RETURN billing_private.report_headers_dispatch(p_action,p_payload); END IF;
 IF p_resource='planning' THEN RETURN billing_private.planning_dispatch(p_action,p_payload); END IF;
 PERFORM billing_private.authorize_resource(p_resource,p_action);
 IF p_resource='contracts' THEN RETURN billing_private.contracts_dispatch(p_action,p_payload); END IF;
 IF p_resource='cultural-practices' AND p_action='bootstrap-sugarcane' THEN RETURN billing_private.bootstrap_sugarcane_management(p_payload); END IF;
 IF p_resource='cultural-practices' THEN RETURN billing_private.management_dispatch(p_action,p_payload); END IF;
 IF p_resource='atr' THEN RETURN billing_private.atr_dispatch(p_action,p_payload); END IF;
 IF p_resource='farms' AND p_action='list' THEN RETURN billing_private.farm_summary_list(); END IF;
 IF p_resource='companies' AND p_action='save' THEN RETURN billing_private.save_company(p_payload); END IF;
 IF p_resource IN ('watermark','watermarks') THEN RETURN billing_private.watermark_variants(p_action,p_payload); END IF;
 RETURN billing_private.dispatch(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION public.billing_rpc(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_rpc(text,text,jsonb) TO authenticated;
COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS 'Authenticated workspace RPC. Contract volumes, load capacity and weighted ATR are calculated and protected transactionally in Postgres.';

DO $realtime$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND
    NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='billing_contract_loads') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_contract_loads;
 END IF;
END $realtime$;
