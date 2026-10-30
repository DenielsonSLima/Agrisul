BEGIN;
DO $variation$
DECLARE definition text:=pg_get_functiondef('billing_private.summary_weekly(jsonb)'::regprocedure);
 anchor text:='FROM rows WHERE kind=''day'' AND load_count>0 AND loaded_volume>0)';
 replacement text:=$days$FROM (
   SELECT r.*,lag(from_date) OVER day_order previous_date,
    lag(loaded_volume) OVER day_order previous_volume,
    lag(gross_amount) OVER day_order previous_gross,
    lag(pending_load_count) OVER day_order previous_pending
   FROM rows r WHERE kind='day' AND load_count>0 AND loaded_volume>0
   WINDOW day_order AS (ORDER BY from_date)
  ) d)$days$;
 value_anchor text:='jsonb_agg(value||jsonb_build_object(''date'',from_date::text) ORDER BY from_date)';
BEGIN
 IF strpos(definition,anchor)=0 OR strpos(definition,value_anchor)=0 OR strpos(definition,'previousProductionDate')>0 THEN RAISE EXCEPTION 'Inspect weekly projection before adding daily changes.'; END IF;
 definition:=replace(definition,anchor,replacement);
 definition:=replace(definition,value_anchor,$value$jsonb_agg(value||jsonb_build_object('date',from_date::text,'previousProductionDate',coalesce(previous_date::text,''),
  'volumeChangePercent',CASE WHEN previous_volume IS NULL OR previous_volume=0 THEN '' ELSE billing_private.decimal_text(round((loaded_volume-previous_volume)*100/abs(previous_volume),2)) END,
  'grossChangePercent',CASE WHEN previous_gross IS NULL OR previous_gross=0 OR pending_load_count>0 OR previous_pending>0 THEN '' ELSE billing_private.decimal_text(round((gross_amount-previous_gross)*100/abs(previous_gross),2)) END) ORDER BY from_date)$value$);
 EXECUTE definition;
END $variation$;
COMMIT;
