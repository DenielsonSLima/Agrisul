-- Stale drafts are business conflicts, not retryable database serialization failures.
DO $migration$
DECLARE target text;definition text;
BEGIN
 FOREACH target IN ARRAY ARRAY['billing_private.overtime_dispatch_before_workflow(text,jsonb)','billing_private.overtime_dispatch(text,jsonb)'] LOOP
  definition=pg_get_functiondef(target::regprocedure);
  IF strpos(definition,'ERRCODE=''40001''')=0 THEN
   RAISE EXCEPTION 'Review the overtime conflict contract before changing it.';
  END IF;
  definition=replace(definition,'ERRCODE=''40001''','ERRCODE=''23514''');
  EXECUTE definition;
 END LOOP;
END $migration$;
