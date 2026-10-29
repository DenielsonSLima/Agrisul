BEGIN;

-- Extend the already authorized summary snapshot. Contract financial projections
-- retain discount allocation, cent rounding, refunds and per-contract balances.
CREATE FUNCTION billing_private.summary_dimensions(p_payload jsonb,p_summary jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid;v_company uuid;v_from date;v_to date;v_result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para continuar.' USING ERRCODE='28000'; END IF;
 v_company=billing_private.overview_scope(p_payload,ARRAY['companyId','from','to','contractId','status']);
 PERFORM billing_private.authorize_resource('contracts','list');
 PERFORM billing_private.authorize('registrations.read');
 v_owner=billing_private.current_owner_id();
 PERFORM billing_private.summary_validate_selection(v_company,p_payload);
 IF p_payload->>'from' IS NULL AND p_payload->>'to' IS NULL THEN
  v_to=(now() AT TIME ZONE 'America/Sao_Paulo')::date;v_from=v_to-364;
 ELSIF p_payload->>'from' IS NULL OR p_payload->>'to' IS NULL OR
  p_payload->>'from'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR p_payload->>'to'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
  RAISE EXCEPTION 'Informe o período completo do Dashboard.' USING ERRCODE='22023';
 ELSE v_from=(p_payload->>'from')::date;v_to=(p_payload->>'to')::date;
 END IF;
 IF v_from<'1900-01-01' OR v_to>'9999-12-31' OR v_to<v_from OR v_to-v_from+1>1827 THEN
  RAISE EXCEPTION 'O Dashboard aceita períodos de um dia até cinco anos.' USING ERRCODE='22023';
 END IF;
 WITH selected AS MATERIALIZED (
  SELECT c.id,c.client_id,client.legal_name partner_name,c.type_id,coalesce(kind.name,c.type_name) type_name,
   metrics.value metric
  FROM public.billing_contracts c
  JOIN public.billing_clients client ON client.owner_id=c.owner_id AND client.id=c.client_id
  LEFT JOIN public.billing_contract_types kind ON kind.owner_id=c.owner_id AND kind.id=c.type_id
  JOIN jsonb_array_elements(p_summary->'contracts') metrics(value) ON metrics.value->>'id'=c.id::text
  WHERE c.owner_id=v_owner AND c.company_id=v_company
   AND (nullif(p_payload->>'contractId','') IS NULL OR c.id=nullif(p_payload->>'contractId','')::uuid)
   AND (coalesce(p_payload->>'status','')='' OR c.status=p_payload->>'status')
 ), atr AS MATERIALIZED (
  SELECT l.contract_id,sum(l.volume*l.atr) weighted_atr,
   count(*) FILTER(WHERE l.atr IS NULL) missing_atr
  FROM public.billing_contract_loads l JOIN selected c ON c.id=l.contract_id
  WHERE l.owner_id=v_owner AND l.loaded_at BETWEEN v_from AND v_to
  GROUP BY l.contract_id
 ), dimension_contracts AS (
  SELECT dimension.kind,dimension.id,dimension.name,c.id contract_id,c.metric,
   coalesce(a.weighted_atr,0) weighted_atr,coalesce(a.missing_atr,0) missing_atr
  FROM selected c LEFT JOIN atr a ON a.contract_id=c.id
  CROSS JOIN LATERAL (VALUES
   ('partners',c.client_id,c.partner_name),('contractTypes',c.type_id,c.type_name)
  ) dimension(kind,id,name)
 ), grouped AS (
  SELECT kind,id,min(name) name,count(*)::integer contract_count,
   sum((metric->>'loadCount')::integer)::integer load_count,
   sum((metric->>'loadedVolume')::numeric) loaded_volume,
   CASE WHEN sum(missing_atr)>0 THEN NULL ELSE round(sum(weighted_atr)/nullif(sum((metric->>'loadedVolume')::numeric),0),6) END average_atr,
   bool_or((metric->>'billingPending')::boolean) billing_pending,
   sum(nullif(metric->>'netAmount','')::numeric) net_amount,
   sum((metric->>'receivedAmount')::numeric) received_amount,
   sum(nullif(metric->>'pendingAmount','')::numeric) pending_amount
  FROM dimension_contracts GROUP BY kind,id
 ), rows AS (
  SELECT kind,name,id,loaded_volume,jsonb_build_object('id',id,'name',name,
   'contractCount',contract_count,'loadCount',load_count,
   'loadedVolume',billing_private.decimal_text(loaded_volume),
   'averageAtr',coalesce(billing_private.decimal_text(average_atr),''),
   'netAmount',CASE WHEN billing_pending THEN '' ELSE billing_private.decimal_text(coalesce(net_amount,0)) END,
   'receivedAmount',billing_private.decimal_text(coalesce(received_amount,0)),
   'pendingAmount',CASE WHEN billing_pending THEN '' ELSE billing_private.decimal_text(coalesce(pending_amount,0)) END,
   'billingPending',billing_pending,
   'sharePercent',billing_private.decimal_text(coalesce(round(loaded_volume*100/nullif(sum(loaded_volume) OVER(PARTITION BY kind),0),2),0))) value
  FROM grouped
 )
 SELECT jsonb_build_object(
  'partners',coalesce((SELECT jsonb_agg(value ORDER BY loaded_volume DESC,lower(name),id) FROM rows WHERE kind='partners'),'[]'::jsonb),
  'contractTypes',coalesce((SELECT jsonb_agg(value ORDER BY loaded_volume DESC,lower(name),id) FROM rows WHERE kind='contractTypes'),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Confira as datas e os filtros do Dashboard.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.summary_dimensions(jsonb,jsonb) FROM PUBLIC,anon,authenticated;

DO $migration$
DECLARE definition text;anchor text:='v_owner=billing_private.current_owner_id();v_company=(p_payload->>''companyId'')::uuid;';
BEGIN
 definition=pg_get_functiondef('billing_private.summary_dispatch(text,jsonb)'::regprocedure);
 IF strpos(definition,anchor)=0 OR strpos(definition,'summary_harvest_methods(p_payload)')=0 OR strpos(definition,'summary_dimensions(')>0 THEN
  RAISE EXCEPTION 'Unexpected Dashboard dispatcher; review before extending dimensions.';
 END IF;
 EXECUTE replace(definition,anchor,'v_result=v_result||jsonb_build_object(''dimensions'',billing_private.summary_dimensions(p_payload,v_result));'||chr(10)||anchor);
END $migration$;

COMMIT;
