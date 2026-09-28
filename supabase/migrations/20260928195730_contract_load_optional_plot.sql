-- A farm is the required origin of a load. A plot refines that origin when
-- available, but must not prevent recording deliveries made before the field
-- subdivision is known or registered.
ALTER TABLE public.billing_contract_loads
 ALTER COLUMN plot_id DROP NOT NULL;

COMMENT ON COLUMN public.billing_contract_loads.plot_id IS
 'Optional origin plot. When present it must belong to the same owner and farm through the composite foreign key.';

-- Keep the canonical contract dispatcher and all wrappers around it intact.
-- Only relax the plot input while preserving owner/farm validation and the
-- composite foreign-key guarantee for a supplied plot.
DO $optional_plot_dispatch$
DECLARE
 v_target regprocedure:='billing_private.contracts_dispatch(text,jsonb)'::regprocedure;
 v_definition text;
 v_old_types text:=$old$IF jsonb_typeof(p_payload->'loadedAt') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'farmId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'plotId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'volume') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'atr') IS DISTINCT FROM 'string' THEN$old$;
 v_new_types text:=$new$IF jsonb_typeof(p_payload->'loadedAt') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'farmId') IS DISTINCT FROM 'string'
  OR (p_payload ? 'plotId' AND jsonb_typeof(p_payload->'plotId') IS DISTINCT FROM 'string') OR jsonb_typeof(p_payload->'volume') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'atr') IS DISTINCT FROM 'string' THEN$new$;
 v_old_origin text:=$old$v_farm_id=(p_payload->>'farmId')::uuid;v_plot_id=(p_payload->>'plotId')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.billing_farm_plots plot WHERE plot.owner_id=v_owner AND plot.farm_id=v_farm_id AND plot.id=v_plot_id) THEN RAISE EXCEPTION 'Selecione um talhão válido para a fazenda de origem.' USING ERRCODE='22023'; END IF;$old$;
 v_new_origin text:=$new$v_farm_id=nullif(p_payload->>'farmId','')::uuid;v_plot_id=nullif(p_payload->>'plotId','')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.billing_farms farm WHERE farm.owner_id=v_owner AND farm.id=v_farm_id) THEN RAISE EXCEPTION 'Selecione uma fazenda de origem válida.' USING ERRCODE='22023'; END IF;
 IF v_plot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.billing_farm_plots plot WHERE plot.owner_id=v_owner AND plot.farm_id=v_farm_id AND plot.id=v_plot_id) THEN RAISE EXCEPTION 'Selecione um talhão válido para a fazenda de origem.' USING ERRCODE='22023'; END IF;$new$;
BEGIN
 SELECT pg_get_functiondef(v_target) INTO v_definition;
 IF strpos(v_definition,v_old_types)=0 OR strpos(v_definition,v_old_origin)=0 THEN
  RAISE EXCEPTION 'Unexpected contract load validation definition';
 END IF;
 v_definition=replace(v_definition,v_old_types,v_new_types);
 v_definition=replace(v_definition,v_old_origin,v_new_origin);
 EXECUTE v_definition;
END
$optional_plot_dispatch$;

REVOKE ALL ON FUNCTION billing_private.contracts_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.contracts_dispatch(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION billing_private.present_contract_load(p_load public.billing_contract_loads)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT billing_private.present(to_jsonb(p_load)) || jsonb_build_object(
  'plotId',coalesce(p_load.plot_id::text,''),
  'loadedAt',p_load.loaded_at::text,
  'volume',billing_private.decimal_text(p_load.volume),
  'atr',coalesce(billing_private.decimal_text(p_load.atr),''),
  'atrReferenceMonth',to_char(reference.atr_reference_month,'YYYY-MM'),
  'farmName',farm.name,
  'plotName',coalesce(plot.name,'')
 )
 FROM public.billing_contracts contract
 JOIN public.billing_farms farm ON farm.owner_id=contract.owner_id AND farm.id=p_load.farm_id
 LEFT JOIN public.billing_farm_plots plot
  ON plot.owner_id=farm.owner_id AND plot.farm_id=farm.id AND plot.id=p_load.plot_id
 CROSS JOIN LATERAL billing_private.contract_atr_reference(contract,p_load.loaded_at) reference
 WHERE contract.owner_id=p_load.owner_id AND contract.id=p_load.contract_id
$$;
REVOKE ALL ON FUNCTION billing_private.present_contract_load(public.billing_contract_loads) FROM PUBLIC,anon,authenticated;

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
 IF length(v_search)>200 OR v_group NOT IN ('day','month','farm','none') THEN RAISE EXCEPTION 'Confira a busca e o agrupamento.' USING ERRCODE='22023'; END IF;
 FOREACH v_text IN ARRAY ARRAY[coalesce(p_payload->>'from',''),coalesce(p_payload->>'to','')] LOOP
  IF v_text<>'' AND (v_text!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_text::date<'1900-01-01' OR v_text::date>'9999-12-31') THEN
   RAISE EXCEPTION 'Informe um período válido.' USING ERRCODE='22023';
  END IF;
 END LOOP;
 v_from=nullif(p_payload->>'from','')::date; v_to=nullif(p_payload->>'to','')::date;
 IF v_from>v_to THEN RAISE EXCEPTION 'A data inicial deve ser igual ou anterior à data final.' USING ERRCODE='22023'; END IF;
 WITH filtered AS MATERIALIZED (
  SELECT l.*,f.name farm_name,coalesce(p.name,'') plot_name,
   finance.gross_amount,finance.discount_amount,finance.net_amount,finance.atr_quote,
   reference.atr_reference_month,
   CASE v_group WHEN 'day' THEN to_char(l.loaded_at,'YYYY-MM-DD') WHEN 'month' THEN to_char(l.loaded_at,'YYYY-MM') WHEN 'farm' THEN f.id::text ELSE 'all' END group_key,
   CASE v_group WHEN 'day' THEN to_char(l.loaded_at,'YYYY-MM-DD') WHEN 'month' THEN to_char(l.loaded_at,'YYYY-MM') WHEN 'farm' THEN f.name ELSE 'Todos os carregamentos' END group_label
  FROM public.billing_contract_loads l
  JOIN billing_private.contract_load_financials(v_contract) finance ON finance.load_id=l.id
  JOIN public.billing_farms f ON f.owner_id=l.owner_id AND f.id=l.farm_id
  LEFT JOIN public.billing_farm_plots p ON p.owner_id=l.owner_id AND p.farm_id=l.farm_id AND p.id=l.plot_id
  CROSS JOIN LATERAL billing_private.contract_atr_reference(v_contract,l.loaded_at) reference
  WHERE l.owner_id=v_owner AND l.contract_id=v_contract.id
   AND (v_from IS NULL OR l.loaded_at>=v_from) AND (v_to IS NULL OR l.loaded_at<=v_to)
   AND (v_search='' OR strpos(lower(concat_ws(' ',f.name,p.name,l.document,l.notes)),lower(v_search))>0)
 ), grouped AS (
  SELECT group_key,group_label,count(*) load_count,sum(volume) volume,
   CASE WHEN count(*) FILTER(WHERE atr IS NULL)>0 THEN NULL ELSE round(sum(volume*atr)/nullif(sum(volume),0),6) END average_atr,
   jsonb_agg(jsonb_build_object('id',id,'contractId',contract_id,'farmId',farm_id,'plotId',coalesce(plot_id::text,''),
    'farmName',farm_name,'plotName',plot_name,'loadedAt',loaded_at,
    'volume',billing_private.decimal_text(volume),'atr',coalesce(billing_private.decimal_text(atr),''),
    'atrReferenceMonth',to_char(atr_reference_month,'YYYY-MM'),
    'atrQuote',coalesce(billing_private.decimal_text(atr_quote),''),
    'grossAmount',coalesce(billing_private.decimal_text(gross_amount),''),
    'discountAmount',billing_private.decimal_text(discount_amount),
    'netAmount',coalesce(billing_private.decimal_text(net_amount),''),'billingPending',gross_amount IS NULL,
    'document',document,'notes',notes,'createdAt',created_at,'updatedAt',updated_at
   ) ORDER BY loaded_at DESC,created_at DESC,id) loads
  FROM filtered GROUP BY group_key,group_label
 ), totals AS (
  SELECT count(*) load_count,coalesce(sum(volume),0) volume,count(DISTINCT farm_id) farm_count,count(DISTINCT plot_id) plot_count,
   count(DISTINCT loaded_at) active_day_count,count(DISTINCT date_trunc('month',loaded_at)) month_count,
   CASE WHEN count(DISTINCT loaded_at)=0 THEN 0 ELSE round(sum(volume)/count(DISTINCT loaded_at),6) END average_daily_volume,
   CASE WHEN count(*) FILTER(WHERE atr IS NULL)>0 THEN NULL ELSE round(sum(volume*atr)/nullif(sum(volume),0),6) END average_atr,min(loaded_at) first_date,max(loaded_at) last_date,
   CASE WHEN count(*) FILTER(WHERE gross_amount IS NULL)>0 THEN NULL ELSE coalesce(sum(gross_amount),0) END gross_amount,
   coalesce(sum(discount_amount),0) discount_amount,
   CASE WHEN count(*) FILTER(WHERE net_amount IS NULL)>0 THEN NULL ELSE coalesce(sum(net_amount),0) END net_amount
  FROM filtered
 ), monthly_volumes AS (
  SELECT date_trunc('month',loaded_at)::date month_start,count(*) load_count,sum(volume) volume
  FROM filtered GROUP BY date_trunc('month',loaded_at)::date
 )
 SELECT jsonb_build_object(
  'filters',jsonb_build_object('search',v_search,'from',coalesce(v_from::text,''),'to',coalesce(v_to::text,''),'groupBy',v_group),
  'summary',(SELECT jsonb_build_object('loadCount',load_count,'volume',billing_private.decimal_text(volume),
   'farmCount',farm_count,'plotCount',plot_count,'activeDayCount',active_day_count,'monthCount',month_count,
   'averageDailyVolume',billing_private.decimal_text(average_daily_volume),
   'averageAtr',coalesce(billing_private.decimal_text(average_atr),''),
   'firstLoadedAt',coalesce(first_date::text,''),'lastLoadedAt',coalesce(last_date::text,''),
   'grossAmount',coalesce(billing_private.decimal_text(gross_amount),''),
   'discountAmount',billing_private.decimal_text(discount_amount),
   'netAmount',coalesce(billing_private.decimal_text(net_amount),''),'billingPending',gross_amount IS NULL) FROM totals),
  'monthlyVolumes',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'month',to_char(month_start,'YYYY-MM'),'volume',billing_private.decimal_text(volume),'loadCount',load_count
  ) ORDER BY month_start) FROM monthly_volumes),'[]'::jsonb),
  'groups',coalesce((SELECT jsonb_agg(jsonb_build_object('key',group_key,'label',group_label,'loadCount',load_count,
   'volume',billing_private.decimal_text(volume),'averageAtr',coalesce(billing_private.decimal_text(average_atr),''),'loads',loads)
   ORDER BY CASE WHEN v_group IN ('day','month') THEN group_key END DESC,lower(group_label),group_key) FROM grouped),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
 RAISE EXCEPTION 'Informe datas e identificadores válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.contract_loads_list(jsonb) FROM PUBLIC,anon,authenticated;

-- General projections must retain plotless loads. Plot-specific planning
-- metrics continue to count only rows that can be attributed to a plot.
DO $optional_plot_projections$
DECLARE
 v_definition text;
 v_original text;
BEGIN
 SELECT pg_get_functiondef('billing_private.reports_loads_dispatch(jsonb)'::regprocedure) INTO v_definition;
 v_original=v_definition;
 v_definition=replace(v_definition,
  'f.name farm_name,p.name plot_name,finance.gross_amount',
  'f.name farm_name,coalesce(p.name,'''') plot_name,finance.gross_amount');
 v_definition=replace(v_definition,
  'JOIN public.billing_farm_plots p ON p.owner_id=l.owner_id AND p.farm_id=l.farm_id AND p.id=l.plot_id',
  'LEFT JOIN public.billing_farm_plots p ON p.owner_id=l.owner_id AND p.farm_id=l.farm_id AND p.id=l.plot_id');
 v_definition=replace(v_definition,
  'coalesce(jsonb_agg(DISTINCT jsonb_build_object(''id'',p.id,''name'',p.name) ORDER BY jsonb_build_object(''id'',p.id,''name'',p.name)),''[]''::jsonb) plots',
  'coalesce(jsonb_agg(DISTINCT jsonb_build_object(''id'',p.id,''name'',p.name) ORDER BY jsonb_build_object(''id'',p.id,''name'',p.name)) FILTER(WHERE p.id IS NOT NULL),''[]''::jsonb) plots');
 v_definition=replace(v_definition,
  '''id'',s.id,''contractId'',s.contract_id,''farmId'',s.farm_id,''plotId'',s.plot_id,''loadedAt'',s.loaded_at,',
  '''id'',s.id,''contractId'',s.contract_id,''farmId'',s.farm_id,''plotId'',coalesce(s.plot_id::text,''''),''loadedAt'',s.loaded_at,');
 IF v_definition=v_original OR strpos(v_definition,'LEFT JOIN public.billing_farm_plots p')=0
    OR strpos(v_definition,'coalesce(p.name,'''') plot_name')=0
    OR strpos(v_definition,'FILTER(WHERE p.id IS NOT NULL)')=0
    OR strpos(v_definition,'coalesce(s.plot_id::text,'''')')=0 THEN
  RAISE EXCEPTION 'Unexpected detailed load report projection';
 END IF;
 EXECUTE v_definition;

 SELECT pg_get_functiondef('billing_private.agenda_dispatch(text,jsonb)'::regprocedure) INTO v_definition;
 v_original=v_definition;
 v_definition=replace(v_definition,
  'JOIN public.billing_farms f ON f.owner_id=l.owner_id AND f.id=l.farm_id JOIN public.billing_farm_plots p ON p.owner_id=l.owner_id AND p.id=l.plot_id',
  'JOIN public.billing_farms f ON f.owner_id=l.owner_id AND f.id=l.farm_id LEFT JOIN public.billing_farm_plots p ON p.owner_id=l.owner_id AND p.farm_id=l.farm_id AND p.id=l.plot_id');
 IF v_definition=v_original OR strpos(v_definition,'LEFT JOIN public.billing_farm_plots p')=0 THEN
  RAISE EXCEPTION 'Unexpected agenda load projection';
 END IF;
 EXECUTE v_definition;

 SELECT pg_get_functiondef('billing_private.summary_dashboard(jsonb)'::regprocedure) INTO v_definition;
 v_original=v_definition;
 v_definition=replace(v_definition,
  'f.name farm_name,p.name plot_name,finance.gross_amount',
  'f.name farm_name,coalesce(p.name,'''') plot_name,finance.gross_amount');
 v_definition=replace(v_definition,
  'JOIN public.billing_farm_plots p ON p.owner_id=l.owner_id AND p.farm_id=l.farm_id AND p.id=l.plot_id',
  'LEFT JOIN public.billing_farm_plots p ON p.owner_id=l.owner_id AND p.farm_id=l.farm_id AND p.id=l.plot_id');
 IF v_definition=v_original OR strpos(v_definition,'LEFT JOIN public.billing_farm_plots p')=0
    OR strpos(v_definition,'coalesce(p.name,'''') plot_name')=0 THEN
  RAISE EXCEPTION 'Unexpected executive summary load projection';
 END IF;
 EXECUTE v_definition;

 SELECT pg_get_functiondef('billing_private.summary_operational_intelligence(jsonb)'::regprocedure) INTO v_definition;
 v_original=v_definition;
 v_definition=replace(v_definition,
  'f.name farm_name,f.area_ha farm_area_ha,p.name plot_name,p.area_ha plot_area_ha',
  'f.name farm_name,f.area_ha farm_area_ha,coalesce(p.name,'''') plot_name,p.area_ha plot_area_ha');
 v_definition=replace(v_definition,
  'JOIN public.billing_farm_plots p ON p.owner_id=v_owner AND p.farm_id=l.farm_id AND p.id=l.plot_id',
  'LEFT JOIN public.billing_farm_plots p ON p.owner_id=v_owner AND p.farm_id=l.farm_id AND p.id=l.plot_id');
 v_definition=replace(v_definition,
  'FROM current_loads GROUP BY plot_id,plot_name,farm_id,farm_name',
  'FROM current_loads WHERE plot_id IS NOT NULL GROUP BY plot_id,plot_name,farm_id,farm_name');
 IF v_definition=v_original OR strpos(v_definition,'LEFT JOIN public.billing_farm_plots p')=0
    OR strpos(v_definition,'coalesce(p.name,'''') plot_name')=0
    OR strpos(v_definition,'FROM current_loads WHERE plot_id IS NOT NULL GROUP BY plot_id')=0 THEN
  RAISE EXCEPTION 'Unexpected operational summary load projection';
 END IF;
 EXECUTE v_definition;

 SELECT pg_get_functiondef('billing_private.planning_v9_dispatch(text,jsonb)'::regprocedure) INTO v_definition;
 v_original=v_definition;
 v_definition=replace(v_definition,
  '''farmId'',l.farm_id,''farmName'',f.name,''plotId'',l.plot_id,''plotName'',p.name,''loadedAt'',l.loaded_at,',
  '''farmId'',l.farm_id,''farmName'',f.name,''plotId'',coalesce(l.plot_id::text,''''),''plotName'',coalesce(p.name,''''),''loadedAt'',l.loaded_at,');
 v_definition=replace(v_definition,$old$
 FROM public.billing_contract_loads l
 JOIN billing_private.planning_v5_harvest_scope(v_owner,v_period_id) scope
  ON scope.farm_id=l.farm_id AND scope.plot_id=l.plot_id
 JOIN public.billing_contracts c ON c.owner_id=l.owner_id AND c.id=l.contract_id
 JOIN public.billing_farms f ON f.owner_id=l.owner_id AND f.id=l.farm_id
 JOIN public.billing_farm_plots p ON p.owner_id=l.owner_id AND p.id=l.plot_id
 WHERE l.owner_id=v_owner AND l.loaded_at BETWEEN v_from AND v_to;$old$,$new$
 FROM public.billing_contract_loads l
 JOIN public.billing_contracts c ON c.owner_id=l.owner_id AND c.id=l.contract_id
 JOIN public.billing_farms f ON f.owner_id=l.owner_id AND f.id=l.farm_id
 LEFT JOIN public.billing_farm_plots p ON p.owner_id=l.owner_id AND p.farm_id=l.farm_id AND p.id=l.plot_id
 WHERE l.owner_id=v_owner AND l.loaded_at BETWEEN v_from AND v_to
  AND EXISTS(SELECT 1 FROM billing_private.planning_v5_harvest_scope(v_owner,v_period_id) scope
   WHERE scope.farm_id=l.farm_id AND (l.plot_id IS NULL OR scope.plot_id=l.plot_id));$new$);
 v_definition=replace(v_definition,$old$
  FROM public.billing_contract_loads l
  JOIN billing_private.planning_v5_harvest_scope(v_owner,v_period_id) scope
   ON scope.farm_id=l.farm_id AND scope.plot_id=l.plot_id
  WHERE l.owner_id=v_owner AND l.loaded_at BETWEEN v_from AND v_to
  GROUP BY$old$,$new$
  FROM public.billing_contract_loads l
  WHERE l.owner_id=v_owner AND l.loaded_at BETWEEN v_from AND v_to
   AND EXISTS(SELECT 1 FROM billing_private.planning_v5_harvest_scope(v_owner,v_period_id) scope
    WHERE scope.farm_id=l.farm_id AND (l.plot_id IS NULL OR scope.plot_id=l.plot_id))
  GROUP BY$new$);
 IF v_definition=v_original
    OR strpos(v_definition,'''plotId'',coalesce(l.plot_id::text,''''),''plotName'',coalesce(p.name,'''')')=0
    OR strpos(v_definition,'LEFT JOIN public.billing_farm_plots p')=0
    OR strpos(v_definition,'AND (l.plot_id IS NULL OR scope.plot_id=l.plot_id)')=0
    OR strpos(v_definition,'JOIN billing_private.planning_v5_harvest_scope(v_owner,v_period_id) scope')>0 THEN
  RAISE EXCEPTION 'Unexpected planning diary load projection';
 END IF;
 EXECUTE v_definition;
END
$optional_plot_projections$;

REVOKE ALL ON FUNCTION billing_private.reports_loads_dispatch(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION billing_private.agenda_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION billing_private.summary_dashboard(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION billing_private.summary_operational_intelligence(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION billing_private.planning_v9_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.agenda_dispatch(text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION billing_private.summary_dashboard(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION billing_private.summary_operational_intelligence(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION billing_private.planning_v9_dispatch(text,jsonb) TO authenticated;

COMMENT ON FUNCTION billing_private.contracts_dispatch(text,jsonb) IS
 'Owner-scoped contract persistence. Farm is required for every load; plot is optional and, when supplied, must belong to that owner and farm.';
COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS
 'Authenticated workspace RPC. Contract loads require a farm and may omit a plot; detail, reports, agenda and executive totals preserve unassigned loads.';
