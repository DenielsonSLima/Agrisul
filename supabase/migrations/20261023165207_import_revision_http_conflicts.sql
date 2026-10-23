BEGIN;
-- Optimistic revision conflicts are application HTTP 409 errors. SQLSTATE 40001
-- represents transaction serialization failures (HTTP 500), which proxies/SDKs
-- may retry and eventually surface as an upstream timeout.
DO $$
DECLARE signature text; definition text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['billing_private.import_profiles_dispatch(text,jsonb)','billing_private.import_documents_dispatch(text,jsonb)'] LOOP
  definition=pg_get_functiondef(signature::regprocedure);
  IF strpos(definition,'''40001''')=0 THEN RAISE EXCEPTION 'Revision guard missing in %',signature; END IF;
  EXECUTE replace(definition,'''40001''','''PT409''');
 END LOOP;
END $$;
COMMIT;
