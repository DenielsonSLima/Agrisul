-- Financial KPIs sum the same filtered, cent-allocated loads shown in the table.
-- Unknown gross/net amounts stay pending; discounts remain known and empty filters total zero.
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
  SELECT l.*,f.name farm_name,p.name plot_name,finance.gross_amount,finance.discount_amount,finance.net_amount,finance.atr_quote,
   CASE v_group WHEN 'month' THEN to_char(l.loaded_at,'YYYY-MM') WHEN 'farm' THEN f.id::text ELSE 'all' END group_key,
   CASE v_group WHEN 'month' THEN to_char(l.loaded_at,'YYYY-MM') WHEN 'farm' THEN f.name ELSE 'Todos os carregamentos' END group_label
  FROM public.billing_contract_loads l
  JOIN billing_private.contract_load_financials(v_contract) finance ON finance.load_id=l.id
  JOIN public.billing_farms f ON f.owner_id=l.owner_id AND f.id=l.farm_id
  JOIN public.billing_farm_plots p ON p.owner_id=l.owner_id AND p.farm_id=l.farm_id AND p.id=l.plot_id
  WHERE l.owner_id=v_owner AND l.contract_id=v_contract.id
   AND (v_from IS NULL OR l.loaded_at>=v_from) AND (v_to IS NULL OR l.loaded_at<=v_to)
   AND (v_search='' OR strpos(lower(concat_ws(' ',f.name,p.name,l.document,l.notes)),lower(v_search))>0)
 ), grouped AS (
  SELECT group_key,group_label,count(*) load_count,sum(volume) volume,
   CASE WHEN count(*) FILTER(WHERE atr IS NULL)>0 THEN NULL ELSE round(sum(volume*atr)/nullif(sum(volume),0),6) END average_atr,
   jsonb_agg(jsonb_build_object('id',id,'contractId',contract_id,'farmId',farm_id,'plotId',plot_id,
    'farmName',farm_name,'plotName',plot_name,'loadedAt',loaded_at,
    'volume',billing_private.decimal_text(volume),'atr',coalesce(billing_private.decimal_text(atr),''),
    'atrReferenceMonth',to_char(date_trunc('month',loaded_at)-interval '1 month','YYYY-MM'),
    'atrQuote',coalesce(billing_private.decimal_text(atr_quote),''),
    'grossAmount',coalesce(billing_private.decimal_text(gross_amount),''),
    'discountAmount',billing_private.decimal_text(discount_amount),
    'netAmount',coalesce(billing_private.decimal_text(net_amount),''),'billingPending',gross_amount IS NULL,
    'document',document,'notes',notes,'createdAt',created_at,'updatedAt',updated_at
   ) ORDER BY loaded_at DESC,created_at DESC,id) loads
  FROM filtered GROUP BY group_key,group_label
 ), totals AS (
  SELECT count(*) load_count,coalesce(sum(volume),0) volume,count(DISTINCT farm_id) farm_count,count(DISTINCT plot_id) plot_count,
   CASE WHEN count(*) FILTER(WHERE atr IS NULL)>0 THEN NULL ELSE round(sum(volume*atr)/nullif(sum(volume),0),6) END average_atr,min(loaded_at) first_date,max(loaded_at) last_date,
   CASE WHEN count(*) FILTER(WHERE gross_amount IS NULL)>0 THEN NULL ELSE coalesce(sum(gross_amount),0) END gross_amount,
   coalesce(sum(discount_amount),0) discount_amount,
   CASE WHEN count(*) FILTER(WHERE net_amount IS NULL)>0 THEN NULL ELSE coalesce(sum(net_amount),0) END net_amount
  FROM filtered
 )
 SELECT jsonb_build_object(
  'filters',jsonb_build_object('search',v_search,'from',coalesce(v_from::text,''),'to',coalesce(v_to::text,''),'groupBy',v_group),
  'summary',(SELECT jsonb_build_object('loadCount',load_count,'volume',billing_private.decimal_text(volume),
   'farmCount',farm_count,'plotCount',plot_count,'averageAtr',coalesce(billing_private.decimal_text(average_atr),''),
   'firstLoadedAt',coalesce(first_date::text,''),'lastLoadedAt',coalesce(last_date::text,''),
   'grossAmount',coalesce(billing_private.decimal_text(gross_amount),''),
   'discountAmount',billing_private.decimal_text(discount_amount),
   'netAmount',coalesce(billing_private.decimal_text(net_amount),''),'billingPending',gross_amount IS NULL) FROM totals),
  'groups',coalesce((SELECT jsonb_agg(jsonb_build_object('key',group_key,'label',group_label,'loadCount',load_count,
   'volume',billing_private.decimal_text(volume),'averageAtr',coalesce(billing_private.decimal_text(average_atr),''),'loads',loads)
   ORDER BY CASE WHEN v_group='month' THEN group_key END DESC,lower(group_label),group_key) FROM grouped),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
 RAISE EXCEPTION 'Informe datas e identificadores válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.contract_loads_list(jsonb) FROM PUBLIC,anon,authenticated;

