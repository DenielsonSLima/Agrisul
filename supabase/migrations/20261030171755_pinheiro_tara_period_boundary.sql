BEGIN;

-- Keep the existing BA-period contract. Explicit Data Tara reports also admit
-- a BA preceding the start when its tare belongs to the printed period.
DO $$
DECLARE definition text:=pg_get_functiondef('billing_private.normalize_pinheiro_analyses(jsonb,jsonb)'::regprocedure);
 anchor text:=$a$IF v_ba<v_start OR v_ba>=v_end+interval '1 minute' OR v_tare<v_ba THEN$a$;
BEGIN
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected Pinheiro period validation';END IF;
 EXECUTE replace(definition,anchor,$n$IF (v_ba<v_start AND NOT (
   coalesce(s->>'relatorioPorDataTara','')='true'
   AND v_tare>=v_start AND v_tare<v_end+interval '1 minute'))
   OR v_ba>=v_end+interval '1 minute' OR v_tare<v_ba THEN$n$);
END $$;

COMMIT;
