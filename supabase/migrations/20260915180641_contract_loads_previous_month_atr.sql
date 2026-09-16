-- Loads record weight only. Keep historical manual ATR values for audit;
-- all public responses and billing derive the selected previous-month quote.
ALTER TABLE public.billing_contract_loads ALTER COLUMN atr DROP NOT NULL;
COMMENT ON COLUMN public.billing_contract_loads.atr IS 'Legacy manual ATR, retained for audit only. Never used in billing or public load responses.';

CREATE FUNCTION billing_private.contract_atr_quote(p_contract public.billing_contracts,p_loaded_at date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE p_contract.atr_period_type
  WHEN 'monthly' THEN CASE p_contract.atr_price_type WHEN 'gross' THEN q.monthly_gross_value ELSE q.monthly_net_value END
  ELSE CASE p_contract.atr_price_type WHEN 'gross' THEN q.accumulated_gross_value ELSE q.accumulated_net_value END
 END
 FROM public.billing_atr_records q
 WHERE q.owner_id=p_contract.owner_id
  AND q.year=extract(year FROM (date_trunc('month',p_loaded_at)-interval '1 month'))::integer
  AND q.month=extract(month FROM (date_trunc('month',p_loaded_at)-interval '1 month'))::integer
$$;
REVOKE ALL ON FUNCTION billing_private.contract_atr_quote(public.billing_contracts,date) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.contract_monthly_summary(p_contract public.billing_contracts)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH priced AS (
  SELECT date_trunc('month',load.loaded_at)::date month_start,load.volume,
   billing_private.contract_atr_quote(p_contract,load.loaded_at) atr_quote
  FROM public.billing_contract_loads load
  WHERE load.owner_id=p_contract.owner_id AND load.contract_id=p_contract.id
 ), monthly AS (
  SELECT month_start,sum(volume) loaded_volume,
   CASE WHEN count(*) FILTER(WHERE atr_quote IS NULL)>0 THEN NULL ELSE round(sum(volume*atr_quote)/nullif(sum(volume),0),6) END average_load_atr,
   max(atr_quote) atr_quote,
   count(*) FILTER(WHERE atr_quote IS NULL) missing_quotes,
   CASE WHEN count(*) FILTER(WHERE atr_quote IS NULL)>0 THEN NULL
    ELSE round(sum(volume*atr_quote),2) END billing_amount
  FROM priced GROUP BY month_start
 ), overall AS (
  SELECT coalesce(sum(volume),0) loaded_volume,
   CASE WHEN count(*) FILTER(WHERE atr_quote IS NULL)>0 THEN NULL ELSE round(sum(volume*atr_quote)/nullif(sum(volume),0),6) END average_load_atr,
   count(*) FILTER(WHERE atr_quote IS NULL) missing_quotes,
   CASE WHEN count(*) FILTER(WHERE atr_quote IS NULL)>0 THEN NULL
    ELSE (SELECT coalesce(sum(billing_amount),0) FROM monthly) END billing_amount
  FROM priced
 )
 SELECT jsonb_build_object(
  'criteria',jsonb_build_object('atrPriceType',p_contract.atr_price_type,'atrPeriodType',p_contract.atr_period_type),
  'months',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'month',to_char(item.month_start,'YYYY-MM'),
   'atrReferenceMonth',to_char(item.month_start-interval '1 month','YYYY-MM'),
   'loadedVolume',billing_private.decimal_text(item.loaded_volume),
   'averageLoadAtr',coalesce(billing_private.decimal_text(item.average_load_atr),''),
   'atrQuote',coalesce(billing_private.decimal_text(item.atr_quote),''),
   'billingAmount',coalesce(billing_private.decimal_text(item.billing_amount),''),
   'billingPending',item.missing_quotes>0,
   'expenseAmount','','expensesPending',true,'resultAmount',''
  ) ORDER BY item.month_start) FROM monthly item),'[]'::jsonb),
  'totals',(SELECT jsonb_build_object(
   'contractedVolume',billing_private.decimal_text(p_contract.contracted_volume),
   'loadedVolume',billing_private.decimal_text(summary.loaded_volume),
   'remainingVolume',billing_private.decimal_text(greatest(p_contract.contracted_volume-summary.loaded_volume,0)),
   'averageLoadAtr',coalesce(billing_private.decimal_text(summary.average_load_atr),''),
   'billingAmount',coalesce(billing_private.decimal_text(summary.billing_amount),''),
   'billingPending',summary.missing_quotes>0,
   'pendingQuoteMonths',(SELECT count(*) FROM monthly WHERE missing_quotes>0),
   'expenseAmount','','expensesPending',true,'resultAmount',''
  ) FROM overall summary)
 )
$$;
REVOKE ALL ON FUNCTION billing_private.contract_monthly_summary(public.billing_contracts) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.present_contract(p_contract public.billing_contracts) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (billing_private.present(to_jsonb(p_contract))-'contract_number') || jsonb_build_object(
  'contractNumber',p_contract.contract_number,
  'companyName',coalesce(company.name,''),
  'companyCnpj',coalesce(company.cnpj,''),
  'clientName',client.legal_name,
  'clientCnpj',client.cnpj,
  'startDate',coalesce(p_contract.start_date::text,''),
  'endDate',coalesce(p_contract.end_date::text,''),
  'contractedVolume',billing_private.decimal_text(p_contract.contracted_volume),
  'atrPriceType',p_contract.atr_price_type,
  'atrPeriodType',p_contract.atr_period_type,
  'value',coalesce(billing_private.decimal_text(p_contract.value),''),
  'loadedVolume',summary.data->'totals'->>'loadedVolume',
  'remainingVolume',summary.data->'totals'->>'remainingVolume',
  'averageAtr',summary.data->'totals'->>'averageLoadAtr',
  'billingAmount',summary.data->'totals'->>'billingAmount',
  'billingPending',(summary.data->'totals'->>'billingPending')::boolean
 )
 FROM public.billing_clients client
 LEFT JOIN public.billing_companies company ON company.owner_id=p_contract.owner_id AND company.id=p_contract.company_id
 CROSS JOIN LATERAL (SELECT billing_private.contract_monthly_summary(p_contract) data) summary
 WHERE client.owner_id=p_contract.owner_id AND client.id=p_contract.client_id
$$;
REVOKE ALL ON FUNCTION billing_private.present_contract(public.billing_contracts) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.present_contract_load(p_load public.billing_contract_loads) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (billing_private.present(to_jsonb(p_load))-'atr') || jsonb_build_object(
  'loadedAt',p_load.loaded_at::text,
  'volume',billing_private.decimal_text(p_load.volume),
  'atr',coalesce(billing_private.decimal_text(billing_private.contract_atr_quote(contract,p_load.loaded_at)),''),
  'atrReferenceMonth',to_char(date_trunc('month',p_load.loaded_at)-interval '1 month','YYYY-MM'),
  'farmName',farm.name,
  'plotName',plot.name
 )
 FROM public.billing_contracts contract
 JOIN public.billing_farms farm ON farm.owner_id=contract.owner_id
 JOIN public.billing_farm_plots plot ON plot.owner_id=farm.owner_id AND plot.farm_id=farm.id
 WHERE contract.owner_id=p_load.owner_id AND contract.id=p_load.contract_id AND farm.owner_id=p_load.owner_id AND farm.id=p_load.farm_id AND plot.id=p_load.plot_id
$$;
REVOKE ALL ON FUNCTION billing_private.present_contract_load(public.billing_contract_loads) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.contracts_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;v_contract_id uuid;v_company_id uuid;v_client_id uuid;v_type_id uuid;v_farm_id uuid;v_plot_id uuid;
 v_contract public.billing_contracts%ROWTYPE;v_load public.billing_contract_loads%ROWTYPE;
 v_data jsonb;v_result jsonb;v_counts jsonb;v_loads jsonb;
 v_search text;v_bucket text;v_from date;v_to date;v_text text;v_volume_text text;v_value_text text;
 v_loaded numeric;v_existing_volume numeric:=0;
BEGIN
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize_resource('contracts',p_action);
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
  OR jsonb_typeof(p_payload->'plotId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'volume') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Confira os dados do carregamento.' USING ERRCODE='22023'; END IF;
 v_text=btrim(p_payload->>'loadedAt');IF v_text!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_text::date<'1900-01-01' THEN RAISE EXCEPTION 'Informe uma data de carregamento válida.' USING ERRCODE='22023'; END IF;
 v_farm_id=(p_payload->>'farmId')::uuid;v_plot_id=(p_payload->>'plotId')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.billing_farm_plots plot WHERE plot.owner_id=v_owner AND plot.farm_id=v_farm_id AND plot.id=v_plot_id) THEN RAISE EXCEPTION 'Selecione um talhão válido para a fazenda de origem.' USING ERRCODE='22023'; END IF;
 v_volume_text=replace(btrim(p_payload->>'volume'),',','.');
 IF v_volume_text!~'^[0-9]{1,12}([.][0-9]{1,3})?$' OR v_volume_text::numeric<=0 THEN RAISE EXCEPTION 'Informe um volume válido, com até três casas decimais.' USING ERRCODE='22023'; END IF;
 IF length(btrim(coalesce(p_payload->>'document','')))>100 OR length(btrim(coalesce(p_payload->>'notes','')))>1000 THEN RAISE EXCEPTION 'Confira o documento e as observações do carregamento.' USING ERRCODE='22023'; END IF;
 IF v_id IS NOT NULL THEN
  SELECT volume INTO v_existing_volume FROM public.billing_contract_loads WHERE owner_id=v_owner AND contract_id=v_contract_id AND id=v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE='P0002'; END IF;
 END IF;
 SELECT coalesce(sum(volume),0) INTO v_loaded FROM public.billing_contract_loads WHERE owner_id=v_owner AND contract_id=v_contract_id;
 IF v_loaded-v_existing_volume+v_volume_text::numeric>v_contract.contracted_volume THEN RAISE EXCEPTION 'O carregamento ultrapassa o saldo de volume do contrato.' USING ERRCODE='23514'; END IF;
 IF v_id IS NULL THEN
  INSERT INTO public.billing_contract_loads(owner_id,contract_id,farm_id,plot_id,loaded_at,volume,document,notes)
   VALUES(v_owner,v_contract_id,v_farm_id,v_plot_id,v_text::date,v_volume_text::numeric,btrim(coalesce(p_payload->>'document','')),btrim(coalesce(p_payload->>'notes','')))
   RETURNING * INTO v_load;
 ELSE
  UPDATE public.billing_contract_loads SET farm_id=v_farm_id,plot_id=v_plot_id,loaded_at=v_text::date,volume=v_volume_text::numeric,document=btrim(coalesce(p_payload->>'document','')),notes=btrim(coalesce(p_payload->>'notes',''))
   WHERE owner_id=v_owner AND contract_id=v_contract_id AND id=v_id RETURNING * INTO v_load;
 END IF;
 RETURN jsonb_build_object('load',billing_private.present_contract_load(v_load));
EXCEPTION
 WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Informe datas, valores e identificadores válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.contracts_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.contracts_dispatch(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION billing_private.contract_loads_list(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_contract public.billing_contracts%ROWTYPE;
 v_from date; v_to date; v_search text; v_group text; v_text text;
 v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize_resource('contracts','list');
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Confira os filtros dos carregamentos.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_payload) e WHERE e.key NOT IN ('view','companyId','contractId','search','from','to','groupBy') OR jsonb_typeof(e.value)<>'string') THEN
  RAISE EXCEPTION 'Os filtros contêm campos inválidos.' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_contract FROM public.billing_contracts
  WHERE owner_id=v_owner AND id=nullif(p_payload->>'contractId','')::uuid AND company_id=nullif(p_payload->>'companyId','')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado para a empresa ativa.' USING ERRCODE='P0002'; END IF;
 v_search=btrim(coalesce(p_payload->>'search',''));
 v_group=coalesce(p_payload->>'groupBy','month');
 IF length(v_search)>200 OR v_group NOT IN ('month','farm','none') THEN RAISE EXCEPTION 'Confira a busca e o agrupamento.' USING ERRCODE='22023'; END IF;
 FOREACH v_text IN ARRAY ARRAY[coalesce(p_payload->>'from',''),coalesce(p_payload->>'to','')] LOOP
  IF v_text<>'' AND (v_text!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_text::date<'1900-01-01' OR v_text::date>'9999-12-31') THEN
   RAISE EXCEPTION 'Informe um período válido.' USING ERRCODE='22023';
  END IF;
 END LOOP;
 v_from=nullif(p_payload->>'from','')::date; v_to=nullif(p_payload->>'to','')::date;
 IF v_from>v_to THEN RAISE EXCEPTION 'A data inicial deve ser igual ou anterior à data final.' USING ERRCODE='22023'; END IF;
 WITH filtered AS MATERIALIZED (
  SELECT l.*,billing_private.contract_atr_quote(v_contract,l.loaded_at) resolved_atr,f.name farm_name,p.name plot_name,
   CASE v_group WHEN 'month' THEN to_char(l.loaded_at,'YYYY-MM') WHEN 'farm' THEN f.id::text ELSE 'all' END group_key,
   CASE v_group WHEN 'month' THEN to_char(l.loaded_at,'YYYY-MM') WHEN 'farm' THEN f.name ELSE 'Todos os carregamentos' END group_label
  FROM public.billing_contract_loads l
  JOIN public.billing_farms f ON f.owner_id=l.owner_id AND f.id=l.farm_id
  JOIN public.billing_farm_plots p ON p.owner_id=l.owner_id AND p.farm_id=l.farm_id AND p.id=l.plot_id
  WHERE l.owner_id=v_owner AND l.contract_id=v_contract.id
   AND (v_from IS NULL OR l.loaded_at>=v_from) AND (v_to IS NULL OR l.loaded_at<=v_to)
   AND (v_search='' OR strpos(lower(concat_ws(' ',f.name,p.name,l.document,l.notes)),lower(v_search))>0)
 ), grouped AS (
  SELECT group_key,group_label,count(*) load_count,sum(volume) volume,
   CASE WHEN count(*) FILTER(WHERE resolved_atr IS NULL)>0 THEN NULL ELSE round(sum(volume*resolved_atr)/nullif(sum(volume),0),6) END average_atr,
   jsonb_agg(jsonb_build_object('id',id,'contractId',contract_id,'farmId',farm_id,'plotId',plot_id,
    'farmName',farm_name,'plotName',plot_name,'loadedAt',loaded_at,
    'volume',billing_private.decimal_text(volume),'atr',coalesce(billing_private.decimal_text(resolved_atr),''),
    'atrReferenceMonth',to_char(date_trunc('month',loaded_at)-interval '1 month','YYYY-MM'),
    'document',document,'notes',notes,'createdAt',created_at,'updatedAt',updated_at
   ) ORDER BY loaded_at DESC,created_at DESC,id) loads
  FROM filtered GROUP BY group_key,group_label
 ), totals AS (
  SELECT count(*) load_count,coalesce(sum(volume),0) volume,count(DISTINCT farm_id) farm_count,count(DISTINCT plot_id) plot_count,
   CASE WHEN count(*) FILTER(WHERE resolved_atr IS NULL)>0 THEN NULL ELSE round(sum(volume*resolved_atr)/nullif(sum(volume),0),6) END average_atr,min(loaded_at) first_date,max(loaded_at) last_date
  FROM filtered
 )
 SELECT jsonb_build_object(
  'filters',jsonb_build_object('search',v_search,'from',coalesce(v_from::text,''),'to',coalesce(v_to::text,''),'groupBy',v_group),
  'summary',(SELECT jsonb_build_object('loadCount',load_count,'volume',billing_private.decimal_text(volume),
   'farmCount',farm_count,'plotCount',plot_count,'averageAtr',coalesce(billing_private.decimal_text(average_atr),''),
   'firstLoadedAt',coalesce(first_date::text,''),'lastLoadedAt',coalesce(last_date::text,'')) FROM totals),
  'groups',coalesce((SELECT jsonb_agg(jsonb_build_object('key',group_key,'label',group_label,'loadCount',load_count,
   'volume',billing_private.decimal_text(volume),'averageAtr',coalesce(billing_private.decimal_text(average_atr),''),'loads',loads)
   ORDER BY CASE WHEN v_group='month' THEN group_key END DESC,lower(group_label),group_key) FROM grouped),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
 RAISE EXCEPTION 'Informe datas e identificadores válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.contract_loads_list(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.contracts_company_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_allowed text[];
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize_resource('contracts',p_action);
 IF p_action='list' AND p_payload->>'view'='loads' THEN RETURN billing_private.contract_loads_list(p_payload); END IF;
 IF p_action IN ('save-load','delete-load') THEN
  v_allowed=ARRAY['id','companyId','contractId'];
  IF p_action='save-load' THEN v_allowed=v_allowed||ARRAY['loadedAt','farmId','plotId','volume','document','notes']; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Confira os dados do carregamento.' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(p_payload) e WHERE NOT e.key=ANY(v_allowed) OR jsonb_typeof(e.value)<>'string') THEN
   RAISE EXCEPTION 'O carregamento contém campos inválidos.' USING ERRCODE='22023';
  END IF;
 END IF;
 -- Existing save/delete keep the contract lock, exact decimals and origin FKs.
 RETURN billing_private.contracts_before_loads_dispatch(p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION billing_private.contracts_company_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.contracts_company_dispatch(text,jsonb) TO authenticated;

COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS 'Loads accept weight only. ATR quotation is selected by contract criteria from the calendar month before loadedAt; billing is weight times that quotation, calculated in Postgres.';
