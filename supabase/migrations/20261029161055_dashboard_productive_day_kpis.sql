BEGIN;
-- These daily averages use only production dates from authorized, filtered
-- loads. Cash-only dates and idle calendar dates never enter the denominator.
DO $migration$
DECLARE definition text:=pg_get_functiondef('billing_private.summary_dashboard(jsonb)'::regprocedure);
 cte_anchor text:='), farm_totals AS (';
 json_anchor text:='''financialGroupings'',jsonb_build_object(';
BEGIN
 IF strpos(definition,'summary_validate_selection(v_company,p_payload)')=0
  OR strpos(definition,'current_loads AS MATERIALIZED')=0
  OR strpos(definition,cte_anchor)=0 OR strpos(definition,json_anchor)=0
  OR strpos(definition,'dailyProductivity')>0 THEN
  RAISE EXCEPTION 'Unexpected Dashboard projection; inspect before adding production-day KPIs.';
 END IF;
 definition=replace(definition,cte_anchor,$productivity$), productive_day_totals AS (
  SELECT count(DISTINCT loaded_at)::integer production_day_count,
   coalesce(sum(volume),0) loaded_volume,coalesce(sum(net_amount),0) net_amount,
   count(*) FILTER(WHERE gross_amount IS NULL)::integer pending_load_count
  FROM current_loads WHERE volume>0
 ), farm_totals AS ($productivity$);
 definition=replace(definition,json_anchor,$json$'dailyProductivity',(SELECT jsonb_build_object(
  'productionDayCount',production_day_count,
  'averageLoadedVolume',billing_private.decimal_text(coalesce(round(loaded_volume/nullif(production_day_count,0),3),0)),
  'averageNetAmount',CASE WHEN pending_load_count>0 THEN ''
   ELSE billing_private.decimal_text(coalesce(round(net_amount/nullif(production_day_count,0),2),0)) END,
  'billingPending',pending_load_count>0,'pendingLoadCount',pending_load_count) FROM productive_day_totals),
  'financialGroupings',jsonb_build_object($json$);
 EXECUTE definition;
END $migration$;
COMMIT;
