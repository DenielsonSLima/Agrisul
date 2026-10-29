BEGIN;
-- Aggregate the authorized daily NUMERIC projections before JSON formatting.
DO $migration$
DECLARE definition text:=pg_get_functiondef('billing_private.summary_dashboard(jsonb)'::regprocedure);
 cte_anchor text:='), farm_totals AS (';json_anchor text:='''financialTimeline'',coalesce(';
BEGIN
 IF strpos(definition,'summary_validate_selection(v_company,p_payload)')=0
  OR strpos(definition,'financial_timeline AS')=0 OR strpos(definition,cte_anchor)=0
  OR strpos(definition,json_anchor)=0 OR strpos(definition,'financialGroupings')>0 THEN
  RAISE EXCEPTION 'Unexpected financial timeline; inspect before adding period groups.';
 END IF;
 definition=replace(definition,cte_anchor,$periods$), financial_period_days AS (
  SELECT g.grouping,d.*,
   CASE WHEN g.grouping='week' THEN date_trunc('week',d.activity_date::timestamp)::date
    ELSE date_trunc('month',d.activity_date::timestamp)::date+CASE WHEN extract(day FROM d.activity_date)<=15 THEN 0 ELSE 15 END END period_start,
   CASE WHEN g.grouping='week' THEN date_trunc('week',d.activity_date::timestamp)::date+6
    WHEN extract(day FROM d.activity_date)<=15 THEN date_trunc('month',d.activity_date::timestamp)::date+14
    ELSE (date_trunc('month',d.activity_date::timestamp)+interval '1 month - 1 day')::date END period_end
  FROM financial_timeline d CROSS JOIN (VALUES('week'),('fortnight')) g(grouping)
 ), financial_periods AS (
  SELECT grouping,greatest(period_start,v_from) period_start,least(period_end,v_to) period_end,
   sum(load_count)::integer load_count,sum(pending_load_count)::integer pending_load_count,
   sum(gross_amount) gross_amount,sum(net_amount) net_amount,sum(received_amount) received_amount
  FROM financial_period_days GROUP BY grouping,period_start,period_end
 ), financial_groupings AS (
  SELECT grouping,jsonb_agg(jsonb_build_object(
   'date',period_start::text,'endDate',period_end::text,'loadCount',load_count,'pendingLoadCount',pending_load_count,
   'billingPending',pending_load_count>0,
   'grossAmount',CASE WHEN pending_load_count>0 THEN '' ELSE billing_private.decimal_text(gross_amount) END,
   'netAmount',CASE WHEN pending_load_count>0 THEN '' ELSE billing_private.decimal_text(net_amount) END,
   'receivedAmount',billing_private.decimal_text(received_amount)) ORDER BY period_start) items
  FROM financial_periods GROUP BY grouping
 ), farm_totals AS ($periods$);
 definition=replace(definition,json_anchor,$json$'financialGroupings',jsonb_build_object(
  'week',coalesce((SELECT items FROM financial_groupings WHERE grouping='week'),'[]'::jsonb),
  'fortnight',coalesce((SELECT items FROM financial_groupings WHERE grouping='fortnight'),'[]'::jsonb)),
  'financialTimeline',coalesce($json$);
 EXECUTE definition;
END $migration$;
COMMIT;
