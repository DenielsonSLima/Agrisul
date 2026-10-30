BEGIN;

-- Dashboard modality follows the linked contract's saved type, including
-- historical loads that predate the imported harvest_method field.
DO $migration$
DECLARE
 definition text:=pg_get_functiondef('billing_private.summary_harvest_methods(jsonb)'::regprocedure);
 load_method text:='coalesce(l.harvest_method,''unknown'')';
 contract_method text:='coalesce(billing_private.contract_import_harvest_method(c.type_name),''unknown'')';
BEGIN
 IF (length(definition)-length(replace(definition,load_method,'')))/length(load_method)<>2
  OR strpos(definition,'JOIN public.billing_contracts c ON c.owner_id=l.owner_id AND c.id=l.contract_id')=0 THEN
  RAISE EXCEPTION 'Review Dashboard harvest classification before changing its source.';
 END IF;
 definition:=replace(definition,load_method,contract_method);
 definition:=replace(definition,'''unknown'',''Não informado''','''unknown'',''Não classificado''');
 EXECUTE definition;
END $migration$;

REVOKE ALL ON FUNCTION billing_private.summary_harvest_methods(jsonb) FROM PUBLIC,anon,authenticated;
COMMENT ON FUNCTION billing_private.summary_harvest_methods(jsonb) IS
 'Authorized Dashboard volumes and load counts by linked contract type snapshot, using the canonical contract modality. Historical and imported loads follow the same classification. All Dashboard filters and NUMERIC text totals are preserved.';

COMMIT;
