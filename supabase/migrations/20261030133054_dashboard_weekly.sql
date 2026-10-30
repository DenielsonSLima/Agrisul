BEGIN;

-- A dedicated, bounded projection leaves the historical Dashboard/report
-- contract intact. Financial valuation still runs over each entire contract
-- before date/origin slicing, preserving its discount allocation and cents.
CREATE FUNCTION billing_private.summary_weekly(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid;v_company uuid;v_from date;v_to date;v_result jsonb;
 v_method text;v_partner_ids uuid[];v_contract_ids uuid[];v_farm_ids uuid[];v_plot_ids uuid[];
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para continuar.' USING ERRCODE='28000'; END IF;
 v_company=billing_private.summary_scope(p_payload-'contractMethod');
 PERFORM billing_private.authorize_resource('contracts','list');
 PERFORM billing_private.authorize('registrations.read');
 v_owner=billing_private.current_owner_id();
 PERFORM billing_private.summary_validate_selection(v_company,p_payload-'contractMethod');
 IF p_payload ? 'contractMethod' AND jsonb_typeof(p_payload->'contractMethod') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Modalidade inválida.' USING ERRCODE='22023';
 END IF;
 v_method=coalesce(p_payload->>'contractMethod','');
 IF v_method NOT IN ('','1','2','unknown') THEN RAISE EXCEPTION 'Modalidade inválida.' USING ERRCODE='22023'; END IF;
 IF NOT (p_payload ? 'from' OR p_payload ? 'to') THEN
  v_to=(now() AT TIME ZONE 'America/Sao_Paulo')::date;v_from=v_to-6;
 ELSIF coalesce(p_payload->>'from','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR coalesce(p_payload->>'to','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
  RAISE EXCEPTION 'Informe os sete dias completos.' USING ERRCODE='22023';
 ELSE v_from=(p_payload->>'from')::date;v_to=(p_payload->>'to')::date;
 END IF;
 IF v_from<'1900-01-01' OR v_to>'9999-12-31' OR v_to-v_from<>6 THEN
  RAISE EXCEPTION 'A aba Semanal exige sete dias corridos.' USING ERRCODE='22023';
 END IF;
 v_partner_ids=billing_private.summary_selection_ids(p_payload,'partnerIds','partnerId');
 v_contract_ids=billing_private.summary_selection_ids(p_payload,'contractIds','contractId');
 v_farm_ids=billing_private.summary_selection_ids(p_payload,'farmIds',CASE WHEN nullif(p_payload->>'plotId','') IS NULL THEN 'farmId' ELSE NULL END);
 v_plot_ids=billing_private.summary_selection_ids(p_payload,'plotIds','plotId');

 WITH company_contracts AS MATERIALIZED (
  SELECT c.*,cl.legal_name client_name FROM public.billing_contracts c
  JOIN public.billing_clients cl ON cl.owner_id=c.owner_id AND cl.id=c.client_id
  WHERE c.owner_id=v_owner AND c.company_id=v_company
 ), selected AS MATERIALIZED (
  SELECT c.* FROM company_contracts c
  WHERE (cardinality(v_partner_ids)=0 OR c.client_id=ANY(v_partner_ids))
   AND (cardinality(v_contract_ids)=0 OR c.id=ANY(v_contract_ids))
   AND (coalesce(p_payload->>'status','')='' OR c.status=p_payload->>'status')
   AND (v_method='' OR coalesce(billing_private.contract_import_harvest_method(c.type_name),'unknown')=v_method)
   AND ((cardinality(v_farm_ids)=0 AND cardinality(v_plot_ids)=0)
    OR EXISTS(SELECT 1 FROM public.billing_contract_loads origin WHERE origin.owner_id=v_owner AND origin.contract_id=c.id
     AND (origin.farm_id=ANY(v_farm_ids) OR origin.plot_id=ANY(v_plot_ids))))
 ), financial_loads AS MATERIALIZED (
  SELECT l.id,l.loaded_at,l.volume,l.atr,finance.gross_amount,finance.net_amount
  FROM selected s JOIN public.billing_contracts c ON c.owner_id=v_owner AND c.id=s.id
  JOIN LATERAL billing_private.contract_load_financials(c) finance ON true
  JOIN public.billing_contract_loads l ON l.owner_id=v_owner AND l.contract_id=c.id AND l.id=finance.load_id
  WHERE l.loaded_at BETWEEN v_from-7 AND v_to
   AND ((cardinality(v_farm_ids)=0 AND cardinality(v_plot_ids)=0)
    OR l.farm_id=ANY(v_farm_ids) OR l.plot_id=ANY(v_plot_ids))
 ), buckets(kind,from_date,to_date) AS (
  VALUES ('current',v_from,v_to),('previous',v_from-7,v_from-1)
  UNION ALL SELECT 'day',v_from+i,v_from+i FROM generate_series(0,6) i
 ), statistics AS MATERIALIZED (
  SELECT b.kind,b.from_date,b.to_date,count(l.id)::integer load_count,
   coalesce(sum(l.volume),0) loaded_volume,
   CASE WHEN count(l.id)=0 OR count(l.id) FILTER(WHERE l.atr IS NULL)>0 THEN NULL
    ELSE round(sum(l.volume*l.atr)/nullif(sum(l.volume),0),6) END average_atr,
   count(l.id) FILTER(WHERE l.gross_amount IS NULL)::integer pending_load_count,
   coalesce(sum(l.gross_amount),0) gross_amount,coalesce(sum(l.net_amount),0) net_amount
  FROM buckets b LEFT JOIN financial_loads l ON l.loaded_at BETWEEN b.from_date AND b.to_date
  GROUP BY b.kind,b.from_date,b.to_date
 ), rows AS MATERIALIZED (
  SELECT *,jsonb_build_object('loadCount',load_count,'loadedVolume',billing_private.decimal_text(loaded_volume),
   'averageAtr',coalesce(billing_private.decimal_text(average_atr),''),
   'billingPending',pending_load_count>0,'pendingLoadCount',pending_load_count,
   'grossAmount',CASE WHEN pending_load_count>0 THEN '' ELSE billing_private.decimal_text(gross_amount) END,
   'netAmount',CASE WHEN pending_load_count>0 THEN '' ELSE billing_private.decimal_text(net_amount) END) value
  FROM statistics
 )
 SELECT jsonb_build_object(
  'range',jsonb_build_object('from',v_from::text,'to',v_to::text,'dayCount',7,'generatedAt',now()::text),
  'totals',t.value,
  'comparison',p.value||jsonb_build_object('from',p.from_date::text,'to',p.to_date::text,
   'loadChangePercent',CASE WHEN p.load_count=0 THEN '' ELSE billing_private.decimal_text(round((t.load_count-p.load_count)*100::numeric/p.load_count,2)) END,
   'volumeChangePercent',CASE WHEN p.loaded_volume=0 THEN '' ELSE billing_private.decimal_text(round((t.loaded_volume-p.loaded_volume)*100/p.loaded_volume,2)) END,
   'atrChange',coalesce(billing_private.decimal_text(t.average_atr-p.average_atr),''),
   'grossChangePercent',CASE WHEN p.pending_load_count>0 OR t.pending_load_count>0 OR p.gross_amount=0 THEN ''
    ELSE billing_private.decimal_text(round((t.gross_amount-p.gross_amount)*100/abs(p.gross_amount),2)) END),
  'days',(SELECT jsonb_agg(value||jsonb_build_object('date',from_date::text) ORDER BY from_date) FROM rows WHERE kind='day'),
  'filters',jsonb_build_object('companyId',v_company,'contractId',coalesce(p_payload->>'contractId',''),
   'partnerId',coalesce(p_payload->>'partnerId',''),'farmId',coalesce(p_payload->>'farmId',''),'plotId',coalesce(p_payload->>'plotId',''),
   'status',coalesce(p_payload->>'status',''),'contractMethod',v_method,
   'partnerIds',to_jsonb(v_partner_ids),'contractIds',to_jsonb(v_contract_ids),'farmIds',to_jsonb(v_farm_ids),'plotIds',to_jsonb(v_plot_ids)),
  'filterOptions',jsonb_build_object(
   'contracts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'clientId',c.client_id,'clientName',c.client_name,
    'contractNumber',c.contract_number,'title',c.title,'status',c.status) ORDER BY lower(c.client_name),c.contract_number,c.id) FROM company_contracts c),'[]'::jsonb),
   'partners',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY lower(name),id) FROM
    (SELECT DISTINCT client_id id,client_name name FROM company_contracts) clients),'[]'::jsonb),
   'statuses',coalesce((SELECT jsonb_agg(status ORDER BY status) FROM (SELECT DISTINCT status FROM company_contracts) statuses),'[]'::jsonb),
   'farms',coalesce((SELECT jsonb_agg(jsonb_build_object('id',farm.id,'name',farm.name,'plots',
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',plot.id,'name',plot.name) ORDER BY lower(plot.name),plot.id)
     FROM public.billing_farm_plots plot WHERE plot.owner_id=v_owner AND plot.farm_id=farm.id),'[]'::jsonb)) ORDER BY lower(farm.name),farm.id)
    FROM public.billing_farms farm WHERE farm.owner_id=v_owner AND EXISTS(
     SELECT 1 FROM public.billing_contract_loads l JOIN company_contracts c ON c.id=l.contract_id
     WHERE l.owner_id=v_owner AND l.farm_id=farm.id)),'[]'::jsonb))
 ) INTO v_result FROM rows t CROSS JOIN rows p WHERE t.kind='current' AND p.kind='previous';
 RETURN v_result;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Confira as datas e os filtros da aba Semanal.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.summary_weekly(jsonb) FROM PUBLIC,anon,authenticated;
COMMENT ON FUNCTION billing_private.summary_weekly(jsonb) IS
 'Seven continuous days and preceding seven, authorized company/client/contract/origin/status/contract-type filters. Full-contract financial allocation, raw NUMERIC weighted ATR, explicit pending states; no cash-as-revenue substitution.';

DO $migration$
DECLARE definition text;anchor text:='IF p_action<>''dashboard'' THEN';
BEGIN
 definition=pg_get_functiondef('billing_private.summary_dispatch(text,jsonb)'::regprocedure);
 IF strpos(definition,anchor)=0 OR strpos(definition,'summary_weekly')>0 THEN
  RAISE EXCEPTION 'Unexpected Dashboard dispatcher before weekly projection';
 END IF;
 definition=replace(definition,anchor,'IF p_action=''weekly'' THEN RETURN billing_private.summary_weekly(p_payload); END IF;'||E'\n '||anchor);
 EXECUTE definition;
END $migration$;

COMMIT;
