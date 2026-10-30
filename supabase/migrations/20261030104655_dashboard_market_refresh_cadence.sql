BEGIN;
-- Use the next clock boundary, rather than completion time + TTL. Otherwise a
-- job started at :00 and finished at :01 would skip the next :00 Cron tick.
DO $cadence$
DECLARE definition text:=pg_get_functiondef('billing_private.refresh_dashboard_market(text,jsonb)'::regprocedure);
 anchor text:='next_refresh_at=now()+make_interval(secs=>refresh_seconds)';
BEGIN
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Inspect market refresh function before changing cadence.'; END IF;
 EXECUTE replace(definition,anchor,'next_refresh_at=date_bin(make_interval(secs=>refresh_seconds),now(),''2000-01-01 00:00:00+00''::timestamptz)+make_interval(secs=>refresh_seconds)');
END $cadence$;
UPDATE billing_private.market_refresh_state
 SET next_refresh_at=date_bin(make_interval(secs=>refresh_seconds),checked_at,'2000-01-01 00:00:00+00'::timestamptz)+make_interval(secs=>refresh_seconds)
 WHERE checked_at IS NOT NULL;
COMMIT;
