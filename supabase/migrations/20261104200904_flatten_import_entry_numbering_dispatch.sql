BEGIN;

-- An anchored cell edit already holds the actor/import/document locks and has
-- passed all outer dispatchers. Re-enter the numbering dispatcher directly,
-- retaining its own authorization, revision, namespace and conflict checks.
-- Avoid recursively traversing every unrelated import feature a second time.
DO $$
DECLARE
 definition text:=pg_get_functiondef('billing_private.import_documents_dispatch_before_client_ledger(text,jsonb)'::regprocedure);
 recursive_call text:=$call$billing_private.import_documents_dispatch('number-groups',$call$;
BEGIN
 IF (length(definition)-length(replace(definition,recursive_call,'')))/length(recursive_call)<>1
  OR strpos(definition,'IF p_action=''number-groups'' THEN')=0 THEN
  RAISE EXCEPTION 'Unexpected import numbering implementation; inspect before flattening dispatch';
 END IF;
 EXECUTE replace(definition,recursive_call,$call$billing_private.import_documents_dispatch_before_client_ledger('number-groups',$call$);
END $$;

COMMIT;
