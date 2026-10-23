BEGIN;
-- These are extracted source identifiers, never ERP identities or permissions.
-- Keep all earlier source fields and the existing authorization/revision guards.
DO $$
DECLARE
 definition text;
 old_fragment text := '''equipamento'',''notaFiscal''';
 new_fragment text := '''equipamento'',''equipamentoPrincipal'',''fazendaZonaTalhao'',''notaFiscal''';
BEGIN
 definition=pg_get_functiondef('billing_private.import_profiles_dispatch(text,jsonb)'::regprocedure);
 IF strpos(definition,old_fragment)=0 THEN
  RAISE EXCEPTION 'Expected Taquari source whitelist was not found.';
 END IF;
 EXECUTE replace(definition,old_fragment,new_fragment);
END $$;
REVOKE ALL ON FUNCTION billing_private.import_profiles_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
COMMIT;
