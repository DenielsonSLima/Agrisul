BEGIN;
-- Keep origin/provider/document FKs restrictive at commit, while allowing all
-- owner-scoped cascades of one Auth account to finish in the same transaction.
-- No application DELETE or direct DML permission is added.
DO $$
DECLARE c record;
BEGIN
 FOR c IN SELECT conrelid::regclass relation,conname FROM pg_constraint WHERE contype='f'
  AND conrelid IN ('public.billing_documents'::regclass,'public.billing_document_links'::regclass,
   'public.billing_document_events'::regclass,'public.billing_document_expectations'::regclass)
  AND confrelid<>'auth.users'::regclass
 LOOP EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I DEFERRABLE INITIALLY DEFERRED',c.relation,c.conname); END LOOP;
END $$;
COMMIT;
