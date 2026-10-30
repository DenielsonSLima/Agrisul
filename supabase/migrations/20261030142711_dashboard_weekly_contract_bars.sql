BEGIN;
CREATE FUNCTION billing_private.summary_weekly_contract_bars(p_summary jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_rows jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para continuar.' USING ERRCODE='28000'; END IF;
 SELECT coalesce(jsonb_agg(item||jsonb_build_object(
  'remainingVolume',CASE WHEN item->>'contractedVolume'='' THEN '' ELSE billing_private.decimal_text(greatest(contracted-delivered,0)) END,
  'previousDeliveryPercent',billing_private.decimal_text(coalesce(round(greatest(delivered-weekly,0)*100/nullif(greatest(contracted,delivered),0),6),0)),
  'weeklyDeliveryPercent',billing_private.decimal_text(coalesce(round(weekly*100/nullif(greatest(contracted,delivered),0),6),0))) ORDER BY ordinal),'[]'::jsonb) INTO v_rows
 FROM (SELECT item,ordinal,coalesce(nullif(item->>'contractedVolume','')::numeric,0) contracted,
  (item->>'deliveredVolume')::numeric delivered,(item->>'weeklyVolume')::numeric weekly
  FROM jsonb_array_elements(p_summary->'contractProgress') WITH ORDINALITY rows(item,ordinal)) q;
 RETURN p_summary||jsonb_build_object('contractProgress',v_rows);
END $$;
REVOKE ALL ON FUNCTION billing_private.summary_weekly_contract_bars(jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $bars$
DECLARE definition text:=pg_get_functiondef('billing_private.summary_weekly(jsonb)'::regprocedure);
BEGIN
 IF strpos(definition,'contractProgress')=0 OR strpos(definition,'RETURN v_result;')=0 OR strpos(definition,'summary_weekly_contract_bars')>0 THEN RAISE EXCEPTION 'Inspect weekly contract bars.'; END IF;
 EXECUTE replace(definition,'RETURN v_result;','RETURN billing_private.summary_weekly_contract_bars(v_result);');
END $bars$;
COMMIT;
