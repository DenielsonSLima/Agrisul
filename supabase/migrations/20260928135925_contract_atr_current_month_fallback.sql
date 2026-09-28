-- Prefer the quotation registered for the load's own calendar month. When
-- that month has not been registered, retain the previous-month fallback.
-- The selected reference month and quotation come from one resolver so every
-- projection reports the same month used by the financial calculation.
CREATE FUNCTION billing_private.contract_atr_reference(
 p_contract public.billing_contracts,
 p_loaded_at date
)
RETURNS TABLE(atr_reference_month date,atr_quote numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH target AS (
  SELECT CASE WHEN EXISTS(
   SELECT 1 FROM public.billing_atr_records current_quote
   WHERE current_quote.owner_id=p_contract.owner_id
    AND current_quote.year=extract(year FROM date_trunc('month',p_loaded_at))::integer
    AND current_quote.month=extract(month FROM date_trunc('month',p_loaded_at))::integer
  ) THEN date_trunc('month',p_loaded_at)::date
  ELSE (date_trunc('month',p_loaded_at)-interval '1 month')::date END reference_month
 )
 SELECT target.reference_month,
  CASE p_contract.atr_period_type
   WHEN 'monthly' THEN CASE p_contract.atr_price_type WHEN 'gross' THEN quote.monthly_gross_value ELSE quote.monthly_net_value END
   ELSE CASE p_contract.atr_price_type WHEN 'gross' THEN quote.accumulated_gross_value ELSE quote.accumulated_net_value END
  END
 FROM target
 LEFT JOIN public.billing_atr_records quote
  ON quote.owner_id=p_contract.owner_id
  AND quote.year=extract(year FROM target.reference_month)::integer
  AND quote.month=extract(month FROM target.reference_month)::integer
$$;
REVOKE ALL ON FUNCTION billing_private.contract_atr_reference(public.billing_contracts,date) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.contract_atr_quote(p_contract public.billing_contracts,p_loaded_at date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT reference.atr_quote
 FROM billing_private.contract_atr_reference(p_contract,p_loaded_at) reference
$$;
REVOKE ALL ON FUNCTION billing_private.contract_atr_quote(public.billing_contracts,date) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.contract_monthly_summary(p_contract public.billing_contracts)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH priced AS (
  SELECT date_trunc('month',load.loaded_at)::date month_start,load.volume,load.atr load_atr,
   reference.atr_reference_month,reference.atr_quote
  FROM public.billing_contract_loads load
  CROSS JOIN LATERAL billing_private.contract_atr_reference(p_contract,load.loaded_at) reference
  WHERE load.owner_id=p_contract.owner_id AND load.contract_id=p_contract.id
 ), monthly AS (
  SELECT month_start,max(atr_reference_month) atr_reference_month,sum(volume) loaded_volume,
   CASE WHEN count(*) FILTER(WHERE load_atr IS NULL)>0 THEN NULL ELSE round(sum(volume*load_atr)/nullif(sum(volume),0),6) END average_load_atr,
   max(atr_quote) atr_quote,
   count(*) FILTER(WHERE atr_quote IS NULL) missing_quotes,
   count(*) FILTER(WHERE load_atr IS NULL) missing_atrs,
   CASE WHEN count(*) FILTER(WHERE atr_quote IS NULL OR load_atr IS NULL)>0 THEN NULL
    ELSE round(sum(volume*load_atr*atr_quote),2) END billing_amount
  FROM priced GROUP BY month_start
 ), overall AS (
  SELECT coalesce(sum(volume),0) loaded_volume,
   CASE WHEN count(*) FILTER(WHERE load_atr IS NULL)>0 THEN NULL ELSE round(sum(volume*load_atr)/nullif(sum(volume),0),6) END average_load_atr,
   count(*) FILTER(WHERE atr_quote IS NULL) missing_quotes,
   count(*) FILTER(WHERE load_atr IS NULL) missing_atrs,
   CASE WHEN count(*) FILTER(WHERE atr_quote IS NULL OR load_atr IS NULL)>0 THEN NULL
    ELSE (SELECT coalesce(sum(billing_amount),0) FROM monthly) END billing_amount
  FROM priced
 )
 SELECT jsonb_build_object(
  'criteria',jsonb_build_object('atrPriceType',p_contract.atr_price_type,'atrPeriodType',p_contract.atr_period_type),
  'months',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'month',to_char(item.month_start,'YYYY-MM'),
   'atrReferenceMonth',to_char(item.atr_reference_month,'YYYY-MM'),
   'loadedVolume',billing_private.decimal_text(item.loaded_volume),
   'averageLoadAtr',coalesce(billing_private.decimal_text(item.average_load_atr),''),
   'atrQuote',coalesce(billing_private.decimal_text(item.atr_quote),''),
   'billingAmount',coalesce(billing_private.decimal_text(item.billing_amount),''),
   'billingPending',item.missing_quotes>0 OR item.missing_atrs>0,
   'expenseAmount','','expensesPending',true,'resultAmount',''
  ) ORDER BY item.month_start) FROM monthly item),'[]'::jsonb),
  'totals',(SELECT jsonb_build_object(
   'contractedVolume',billing_private.decimal_text(p_contract.contracted_volume),
   'loadedVolume',billing_private.decimal_text(summary.loaded_volume),
   'remainingVolume',billing_private.decimal_text(greatest(p_contract.contracted_volume-summary.loaded_volume,0)),
   'averageLoadAtr',coalesce(billing_private.decimal_text(summary.average_load_atr),''),
   'billingAmount',coalesce(billing_private.decimal_text(summary.billing_amount),''),
   'billingPending',summary.missing_quotes>0 OR summary.missing_atrs>0,
   'pendingQuoteMonths',(SELECT count(*) FROM monthly WHERE missing_quotes>0),
   'expenseAmount','','expensesPending',true,'resultAmount',''
  ) FROM overall summary)
 )
$$;
REVOKE ALL ON FUNCTION billing_private.contract_monthly_summary(public.billing_contracts) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.present_contract_load(p_load public.billing_contract_loads) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT billing_private.present(to_jsonb(p_load)) || jsonb_build_object(
  'loadedAt',p_load.loaded_at::text,
  'volume',billing_private.decimal_text(p_load.volume),
  'atr',coalesce(billing_private.decimal_text(p_load.atr),''),
  'atrReferenceMonth',to_char(reference.atr_reference_month,'YYYY-MM'),
  'farmName',farm.name,
  'plotName',plot.name
 )
 FROM public.billing_contracts contract
 JOIN public.billing_farms farm ON farm.owner_id=contract.owner_id
 JOIN public.billing_farm_plots plot ON plot.owner_id=farm.owner_id AND plot.farm_id=farm.id
 CROSS JOIN LATERAL billing_private.contract_atr_reference(contract,p_load.loaded_at) reference
 WHERE contract.owner_id=p_load.owner_id AND contract.id=p_load.contract_id
  AND farm.owner_id=p_load.owner_id AND farm.id=p_load.farm_id AND plot.id=p_load.plot_id
$$;
REVOKE ALL ON FUNCTION billing_private.present_contract_load(public.billing_contract_loads) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.contract_atr_quote_summary(p_contract public.billing_contracts)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH priced AS MATERIALIZED (
  SELECT load.loaded_at,load.volume,reference.atr_reference_month,reference.atr_quote quote
  FROM public.billing_contract_loads load
  CROSS JOIN LATERAL billing_private.contract_atr_reference(p_contract,load.loaded_at) reference
  WHERE load.owner_id=p_contract.owner_id AND load.contract_id=p_contract.id
 )
 SELECT jsonb_build_object(
  'average',CASE WHEN count(*) FILTER(WHERE quote IS NULL)>0 THEN ''
   ELSE coalesce(billing_private.decimal_text(round(sum(volume*quote)/nullif(sum(volume),0),6)),'') END,
  'pending',count(*) FILTER(WHERE quote IS NULL)>0,
  'loadedMonths',coalesce(jsonb_agg(DISTINCT to_char(loaded_at,'YYYY-MM') ORDER BY to_char(loaded_at,'YYYY-MM')),'[]'::jsonb),
  'referenceMonths',coalesce(jsonb_agg(DISTINCT to_char(atr_reference_month,'YYYY-MM') ORDER BY to_char(atr_reference_month,'YYYY-MM')),'[]'::jsonb)
 ) FROM priced
$$;
REVOKE ALL ON FUNCTION billing_private.contract_atr_quote_summary(public.billing_contracts) FROM PUBLIC,anon,authenticated;

-- Add daily grouping and dashboard aggregates without moving business totals to
-- the browser. All new aggregates respect the same date/search scope as rows.
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
  SELECT l.*,f.name farm_name,p.name plot_name,finance.gross_amount,finance.discount_amount,finance.net_amount,finance.atr_quote,
   reference.atr_reference_month,
   CASE v_group WHEN 'day' THEN to_char(l.loaded_at,'YYYY-MM-DD') WHEN 'month' THEN to_char(l.loaded_at,'YYYY-MM') WHEN 'farm' THEN f.id::text ELSE 'all' END group_key,
   CASE v_group WHEN 'day' THEN to_char(l.loaded_at,'YYYY-MM-DD') WHEN 'month' THEN to_char(l.loaded_at,'YYYY-MM') WHEN 'farm' THEN f.name ELSE 'Todos os carregamentos' END group_label
  FROM public.billing_contract_loads l
  JOIN billing_private.contract_load_financials(v_contract) finance ON finance.load_id=l.id
  JOIN public.billing_farms f ON f.owner_id=l.owner_id AND f.id=l.farm_id
  JOIN public.billing_farm_plots p ON p.owner_id=l.owner_id AND p.farm_id=l.farm_id AND p.id=l.plot_id
  CROSS JOIN LATERAL billing_private.contract_atr_reference(v_contract,l.loaded_at) reference
  WHERE l.owner_id=v_owner AND l.contract_id=v_contract.id
   AND (v_from IS NULL OR l.loaded_at>=v_from) AND (v_to IS NULL OR l.loaded_at<=v_to)
   AND (v_search='' OR strpos(lower(concat_ws(' ',f.name,p.name,l.document,l.notes)),lower(v_search))>0)
 ), grouped AS (
  SELECT group_key,group_label,count(*) load_count,sum(volume) volume,
   CASE WHEN count(*) FILTER(WHERE atr IS NULL)>0 THEN NULL ELSE round(sum(volume*atr)/nullif(sum(volume),0),6) END average_atr,
   jsonb_agg(jsonb_build_object('id',id,'contractId',contract_id,'farmId',farm_id,'plotId',plot_id,
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

-- The detailed company report has its own load projection. Replace only the
-- legacy reference expression and fail the migration if its known definition
-- is no longer present, avoiding a silently inconsistent API.
DO $update_report_reference$
DECLARE
 v_definition text;
 v_old text:=$old$'atrReferenceMonth',to_char(date_trunc('month',s.loaded_at)-interval '1 month','YYYY-MM')$old$;
 v_new text:=$new$'atrReferenceMonth',to_char((SELECT reference.atr_reference_month FROM public.billing_contracts reference_contract CROSS JOIN LATERAL billing_private.contract_atr_reference(reference_contract,s.loaded_at) reference WHERE reference_contract.owner_id=s.owner_id AND reference_contract.id=s.contract_id),'YYYY-MM')$new$;
BEGIN
 SELECT pg_get_functiondef('billing_private.reports_loads_dispatch(jsonb)'::regprocedure) INTO v_definition;
 IF strpos(v_definition,v_old)=0 THEN RAISE EXCEPTION 'Expected the legacy report ATR reference expression'; END IF;
 EXECUTE replace(v_definition,v_old,v_new);
END
$update_report_reference$;

COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS 'Contract load billing uses the selected ATR quotation from the load month, falling back to the previous calendar month only when the current month is not registered. Measurements, reference months, daily/monthly aggregates and financial totals are calculated in Postgres.';
