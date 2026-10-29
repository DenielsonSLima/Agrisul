BEGIN;
-- Reuse the authorized exact totals. Price is volume-weighted across loads,
-- not an average of per-load prices; incomplete billing stays unavailable.
DO $migration$
DECLARE definition text:=pg_get_functiondef('billing_private.summary_dashboard(jsonb)'::regprocedure);
BEGIN
 IF strpos(definition,'summary_validate_selection(v_company,p_payload)')=0
  OR strpos(definition,'dashboard_gross_variations')=0 OR strpos(definition,'RETURN v_result;')=0
  OR strpos(definition,'averageGrossPricePerTon')>0 THEN
  RAISE EXCEPTION 'Unexpected Dashboard projection; inspect before adding the gross price per ton.';
 END IF;
 definition=replace(definition,'RETURN v_result;',$return$
 v_result=v_result||jsonb_build_object('averageGrossPricePerTon',
  CASE WHEN (v_result#>>'{totals,billingPending}')::boolean THEN ''
   ELSE billing_private.decimal_text(coalesce(round(
    nullif(v_result#>>'{totals,grossAmount}','')::numeric/
    nullif((v_result#>>'{totals,loadedVolume}')::numeric,0),2),0)) END);
 RETURN v_result;$return$);
 EXECUTE definition;
END $migration$;
COMMIT;
