BEGIN;
-- Pure private calculation over already-authorized projections. Preserve every
-- original row/amount; compare only periods displayed as financial activity.
CREATE FUNCTION billing_private.dashboard_gross_variations(p_rows jsonb,p_period_key text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $function$
 WITH source AS (
  SELECT item,ordinality,
   nullif(item->>'grossAmount','')::numeric gross,
   coalesce((item->>'billingPending')::boolean,false) pending,
   coalesce((item->>'loadCount')::integer,0)>0
    OR coalesce((item->>'billingPending')::boolean,false)
    OR coalesce(nullif(item->>'grossAmount','')::numeric,0)<>0
    OR coalesce(nullif(item->>'netAmount','')::numeric,0)<>0
    OR coalesce(nullif(item->>'receivedAmount','')::numeric,0)<>0 active
  FROM jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) WITH ORDINALITY entries(item,ordinality)
 ), previous AS (
  SELECT *,lag(gross) OVER chronological previous_gross,
   lag(pending) OVER chronological previous_pending,
   lag(item->>p_period_key) OVER chronological previous_period
  FROM source WHERE active WINDOW chronological AS (ORDER BY ordinality)
 ), changes AS (
  SELECT ordinality,jsonb_build_object(
   'grossChangeFrom',coalesce(previous_period,''),
   'grossChangePercent',CASE WHEN previous_period IS NOT NULL AND NOT pending AND NOT previous_pending
     AND gross IS NOT NULL AND previous_gross IS NOT NULL AND previous_gross<>0
    THEN billing_private.decimal_text(round(100*(gross-previous_gross)/abs(previous_gross),2)) ELSE '' END,
   'grossChangeReason',CASE WHEN previous_period IS NULL THEN 'initial'
    WHEN pending OR previous_pending OR gross IS NULL OR previous_gross IS NULL THEN 'pending'
    WHEN previous_gross=0 THEN 'zero-base' ELSE '' END) comparison
  FROM previous
 ) SELECT coalesce(jsonb_agg(source.item||coalesce(changes.comparison,'{}'::jsonb) ORDER BY source.ordinality),'[]'::jsonb)
 FROM source LEFT JOIN changes USING(ordinality);
$function$;
REVOKE ALL ON FUNCTION billing_private.dashboard_gross_variations(jsonb,text) FROM PUBLIC,anon,authenticated;

DO $migration$
DECLARE definition text:=pg_get_functiondef('billing_private.summary_dashboard(jsonb)'::regprocedure);
BEGIN
 IF strpos(definition,'summary_validate_selection(v_company,p_payload)')=0
  OR strpos(definition,'financialGroupings')=0 OR strpos(definition,'dailyProductivity')=0
  OR strpos(definition,'RETURN v_result;')=0 OR strpos(definition,'dashboard_gross_variations')>0 THEN
  RAISE EXCEPTION 'Unexpected Dashboard projection; inspect before adding gross evolution.';
 END IF;
 definition=replace(definition,'RETURN v_result;',$return$
 v_result=jsonb_set(v_result,'{months}',billing_private.dashboard_gross_variations(v_result->'months','month'));
 v_result=jsonb_set(v_result,'{financialTimeline}',billing_private.dashboard_gross_variations(v_result->'financialTimeline','date'));
 v_result=jsonb_set(v_result,'{financialGroupings,week}',billing_private.dashboard_gross_variations(v_result#>'{financialGroupings,week}','date'));
 v_result=jsonb_set(v_result,'{financialGroupings,fortnight}',billing_private.dashboard_gross_variations(v_result#>'{financialGroupings,fortnight}','date'));
 RETURN v_result;$return$);
 EXECUTE definition;
END $migration$;
COMMIT;
