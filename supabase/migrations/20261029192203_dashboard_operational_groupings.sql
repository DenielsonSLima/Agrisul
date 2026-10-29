BEGIN;
-- Reuse the exact authorized load set, including client, contract, status and
-- origin selections. Aggregate raw NUMERIC values for each calendar period;
-- averaging the already-rounded daily ATR would distort weighted quality.
DO $migration$
DECLARE
 definition text:=pg_get_functiondef('billing_private.summary_operational_intelligence(jsonb)'::regprocedure);
 cte_anchor text:='), farm_performance AS (';
 json_anchor text:='''monthlyOperations'',coalesce(';
BEGIN
 IF strpos(definition,'summary_validate_selection(v_company,p_payload)')=0
  OR strpos(definition,'current_loads AS MATERIALIZED')=0
  OR strpos(definition,'v_plot_ids')=0
  OR strpos(definition,cte_anchor)=0 OR strpos(definition,json_anchor)=0
  OR strpos(definition,'operationalGroupings')>0 THEN
  RAISE EXCEPTION 'Unexpected operational projection; inspect before adding period groups.';
 END IF;
 definition=replace(definition,cte_anchor,$periods$), operational_period_loads AS (
  SELECT g.grouping,l.*,
   CASE g.grouping WHEN 'day' THEN l.loaded_at
    WHEN 'week' THEN date_trunc('week',l.loaded_at::timestamp)::date
    ELSE date_trunc('month',l.loaded_at::timestamp)::date+CASE WHEN extract(day FROM l.loaded_at)<=15 THEN 0 ELSE 15 END END period_start,
   CASE g.grouping WHEN 'day' THEN l.loaded_at
    WHEN 'week' THEN date_trunc('week',l.loaded_at::timestamp)::date+6
    ELSE CASE WHEN extract(day FROM l.loaded_at)<=15 THEN date_trunc('month',l.loaded_at::timestamp)::date+14
     ELSE (date_trunc('month',l.loaded_at::timestamp)+interval '1 month - 1 day')::date END END period_end
  FROM current_loads l CROSS JOIN (VALUES('day'),('week'),('fortnight')) g(grouping)
 ), operational_periods AS (
  SELECT grouping,greatest(period_start,v_from) period_start,least(period_end,v_to) period_end,
   count(*)::integer load_count,sum(volume) loaded_volume,
   CASE WHEN count(*) FILTER(WHERE atr IS NULL)>0 THEN NULL
    ELSE round(sum(volume*atr)/nullif(sum(volume),0),6) END average_atr,
   round(sum(volume)/count(*),6) average_load_volume,
   count(DISTINCT contract_id)::integer contract_count,count(DISTINCT farm_id)::integer farm_count,
   count(DISTINCT plot_id)::integer plot_count
  FROM operational_period_loads GROUP BY grouping,period_start,period_end
 ), operational_groupings AS (
  SELECT grouping,jsonb_agg(jsonb_build_object(
   'date',period_start::text,'endDate',period_end::text,'loadCount',load_count,
   'loadedVolume',billing_private.decimal_text(loaded_volume),
   'averageAtr',coalesce(billing_private.decimal_text(average_atr),''),
   'averageLoadVolume',billing_private.decimal_text(average_load_volume),
   'contractCount',contract_count,'farmCount',farm_count,'plotCount',plot_count) ORDER BY period_start) items
  FROM operational_periods GROUP BY grouping
 ), farm_performance AS ($periods$);
 definition=replace(definition,json_anchor,$json$'operationalTimeline',coalesce((SELECT items FROM operational_groupings WHERE grouping='day'),'[]'::jsonb),
  'operationalGroupings',jsonb_build_object(
   'week',coalesce((SELECT items FROM operational_groupings WHERE grouping='week'),'[]'::jsonb),
   'fortnight',coalesce((SELECT items FROM operational_groupings WHERE grouping='fortnight'),'[]'::jsonb)),
  'monthlyOperations',coalesce($json$);
 EXECUTE definition;
END $migration$;
COMMIT;
