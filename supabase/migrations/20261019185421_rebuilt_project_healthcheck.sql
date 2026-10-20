BEGIN;

-- The previous project was retired; monitoring must identify the replacement.
CREATE OR REPLACE FUNCTION public.billing_healthcheck()
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'ok', true,
    'projectRef', 'ykounjabfsrtkzostbbz',
    'checkedAt', pg_catalog.clock_timestamp()
  );
$$;

REVOKE ALL ON FUNCTION public.billing_healthcheck() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billing_healthcheck() TO anon, authenticated, service_role;

COMMIT;
