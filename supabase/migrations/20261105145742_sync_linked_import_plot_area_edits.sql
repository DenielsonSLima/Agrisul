BEGIN;
-- Inline/bulk plot edits use a dedicated area lookup rather than save-bulk.
DO $$
DECLARE definition text:=pg_get_functiondef('billing_private.import_documents_dispatch(text,jsonb)'::regprocedure);
 actions text:=$a$'number-groups','save-harvest-orders','append-source-entries')$a$;
 sync_anchor text:=$a$IF jsonb_array_length(previous)>0 THEN$a$;
BEGIN
 IF strpos(definition,actions)=0 OR strpos(definition,sync_anchor)=0 THEN
  RAISE EXCEPTION 'Unexpected linked import edit dispatcher';
 END IF;
 definition=replace(definition,actions,$a$'number-groups','save-harvest-orders','append-source-entries','save-plot-area')$a$);
 definition=replace(definition,sync_anchor,$a$IF result->>'saved'='false' THEN RETURN result;END IF;
 IF jsonb_array_length(previous)>0 THEN$a$);
 EXECUTE definition;
END $$;
COMMIT;
