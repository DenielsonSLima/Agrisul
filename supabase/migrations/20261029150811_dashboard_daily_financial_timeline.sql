BEGIN;
-- Reuse the already-authorized company/contract/date projections and the
-- original per-load financial valuation. No client-side sums or re-rounding.
DO $migration$
DECLARE definition text:=pg_get_functiondef('billing_private.summary_dashboard(jsonb)'::regprocedure);
 cte_anchor text:='), farm_totals AS (';
 json_anchor text:='''months'',coalesce(';
BEGIN
 IF strpos(definition,'summary_validate_selection(v_company,p_payload)')=0
  OR strpos(definition,cte_anchor)=0 OR strpos(definition,json_anchor)=0
  OR strpos(definition,'financialTimeline')>0 THEN
  RAISE EXCEPTION 'Unexpected Dashboard financial projection; inspect before adding daily series.';
 END IF;
 definition=replace(definition,cte_anchor,$daily$), day_loads AS (
  SELECT loaded_at activity_date,count(*)::integer load_count,
   count(*) FILTER(WHERE gross_amount IS NULL)::integer pending_load_count,
   coalesce(sum(gross_amount),0) gross_amount,coalesce(sum(net_amount),0) net_amount
  FROM current_loads GROUP BY loaded_at
 ), day_cash AS (
  SELECT received_at activity_date,coalesce(sum(amount),0) received_amount
  FROM current_cash WHERE kind IN ('advance','receipt') GROUP BY received_at
 ), financial_days AS (
  SELECT activity_date FROM day_loads UNION SELECT activity_date FROM day_cash
 ), financial_timeline AS (
  SELECT d.activity_date,coalesce(l.load_count,0) load_count,coalesce(l.pending_load_count,0) pending_load_count,
   coalesce(l.gross_amount,0) gross_amount,coalesce(l.net_amount,0) net_amount,
   coalesce(c.received_amount,0) received_amount
  FROM financial_days d LEFT JOIN day_loads l USING(activity_date) LEFT JOIN day_cash c USING(activity_date)
 ), farm_totals AS ($daily$);
 definition=replace(definition,json_anchor,$json$'financialTimeline',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'date',d.activity_date::text,'loadCount',d.load_count,'pendingLoadCount',d.pending_load_count,
   'billingPending',d.pending_load_count>0,
   'grossAmount',CASE WHEN d.pending_load_count>0 THEN '' ELSE billing_private.decimal_text(d.gross_amount) END,
   'netAmount',CASE WHEN d.pending_load_count>0 THEN '' ELSE billing_private.decimal_text(d.net_amount) END,
   'receivedAmount',billing_private.decimal_text(d.received_amount)) ORDER BY d.activity_date) FROM financial_timeline d),'[]'::jsonb),
  'months',coalesce($json$);
 EXECUTE definition;
END $migration$;
COMMIT;
