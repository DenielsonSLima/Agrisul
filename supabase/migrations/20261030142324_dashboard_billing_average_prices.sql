BEGIN;
-- Reuse the already authorized, date/origin-filtered per-contract financials.
-- Their amounts were valued across the full contract before this selection.
CREATE FUNCTION billing_private.summary_billing_prices(p_summary jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_result jsonb;v_owner uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para continuar.' USING ERRCODE='28000'; END IF;
 v_owner=billing_private.current_owner_id();
 IF jsonb_typeof(p_summary->'contracts') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Não foi possível conferir os contratos.' USING ERRCODE='22023'; END IF;
 WITH contracts AS MATERIALIZED (
  SELECT coalesce(billing_private.contract_import_harvest_method(c.type_name),'unknown') code,
   (item.value->>'loadedVolume')::numeric volume,nullif(item.value->>'grossAmount','')::numeric gross,
   nullif(item.value->>'netAmount','')::numeric net,(item.value->>'billingPending')::boolean pending
  FROM jsonb_array_elements(p_summary->'contracts') item(value)
  JOIN public.billing_contracts c ON c.owner_id=v_owner AND c.id=(item.value->>'id')::uuid
 ), statistics AS (
  SELECT method.code,method.label,coalesce(sum(c.volume),0) volume,coalesce(bool_or(c.pending),false) pending,sum(c.gross) gross,sum(c.net) net
  FROM (VALUES ('1','Manual'),('2','Mecanizada'),('unknown','Não classificado')) method(code,label)
  LEFT JOIN contracts c ON c.code=method.code GROUP BY method.code,method.label
 )
 SELECT jsonb_build_object('averageNetPricePerTon',CASE WHEN (p_summary#>>'{totals,billingPending}')::boolean THEN '' ELSE
  billing_private.decimal_text(coalesce(round(nullif(p_summary#>>'{totals,netAmount}','')::numeric/nullif((p_summary#>>'{totals,loadedVolume}')::numeric,0),2),0)) END,
  'billingPriceMethods',jsonb_agg(jsonb_build_object('code',code,'label',label,'loadedVolume',billing_private.decimal_text(volume),'billingPending',pending,
   'averageGrossPricePerTon',CASE WHEN pending THEN '' ELSE billing_private.decimal_text(coalesce(round(gross/nullif(volume,0),2),0)) END,
   'averageNetPricePerTon',CASE WHEN pending THEN '' ELSE billing_private.decimal_text(coalesce(round(net/nullif(volume,0),2),0)) END) ORDER BY code)) INTO v_result FROM statistics;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION billing_private.summary_billing_prices(jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $prices$
DECLARE definition text:=pg_get_functiondef('billing_private.summary_dispatch(text,jsonb)'::regprocedure);
 anchor text:='v_owner=billing_private.current_owner_id();v_company=(p_payload->>''companyId'')::uuid;';
BEGIN
 IF strpos(definition,anchor)=0 OR strpos(definition,'summary_billing_prices')>0 THEN RAISE EXCEPTION 'Inspect Dashboard dispatcher before average prices.'; END IF;
 EXECUTE replace(definition,anchor,'v_result=v_result||billing_private.summary_billing_prices(v_result);'||E'\n '||anchor);
END $prices$;
COMMIT;
