BEGIN;
-- Add exact production volumes to the already-filtered daily/period series.
-- Monthly volumes already exist. No financial values or comparisons change.
DO $migration$
DECLARE definition text:=pg_get_functiondef('billing_private.summary_dashboard(jsonb)'::regprocedure);anchor text;
 day_anchor text:='SELECT loaded_at activity_date,count(*)::integer load_count,';
 timeline_anchor text:='SELECT d.activity_date,coalesce(l.load_count,0) load_count,';
 period_anchor text:='sum(load_count)::integer load_count,sum(pending_load_count)::integer pending_load_count,';
 period_json text:='''receivedAmount'',billing_private.decimal_text(received_amount)) ORDER BY period_start)';
 day_json text:='''receivedAmount'',billing_private.decimal_text(d.received_amount)) ORDER BY d.activity_date)';
BEGIN
 IF strpos(definition,'summary_validate_selection(v_company,p_payload)')=0 OR strpos(definition,'dashboard_gross_variations')=0 THEN
  RAISE EXCEPTION 'Unexpected Dashboard projection; inspect before adding loading volumes.';
 END IF;
 FOREACH anchor IN ARRAY ARRAY[day_anchor,timeline_anchor,period_anchor,period_json,day_json] LOOP
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Missing loading projection anchor: %',anchor;END IF;
 END LOOP;
 definition=replace(definition,day_anchor,day_anchor||'coalesce(sum(volume),0) loaded_volume,');
 definition=replace(definition,timeline_anchor,timeline_anchor||'coalesce(l.loaded_volume,0) loaded_volume,');
 definition=replace(definition,period_anchor,period_anchor||'sum(loaded_volume) loaded_volume,');
 definition=replace(definition,period_json,'''receivedAmount'',billing_private.decimal_text(received_amount),''loadedVolume'',billing_private.decimal_text(loaded_volume)) ORDER BY period_start)');
 definition=replace(definition,day_json,'''receivedAmount'',billing_private.decimal_text(d.received_amount),''loadedVolume'',billing_private.decimal_text(d.loaded_volume)) ORDER BY d.activity_date)');
 EXECUTE definition;
END $migration$;
COMMIT;
