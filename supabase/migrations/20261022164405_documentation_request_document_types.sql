BEGIN;

ALTER TABLE public.billing_documents
 DROP CONSTRAINT billing_documents_kind_check,
 ADD CONSTRAINT billing_documents_kind_check
 CHECK(kind IN ('invoice','budget','boleto','payment','delivery','photo','other','service_request','purchase_request'));

ALTER TABLE public.billing_document_expectations
 DROP CONSTRAINT billing_document_expectations_kind_check,
 ADD CONSTRAINT billing_document_expectations_kind_check
 CHECK(kind IN ('invoice','budget','boleto','payment','delivery','photo','other','service_request','purchase_request'));

-- Extend both RPC whitelists while preserving the dispatcher permissions and
-- all existing ownership, revision, file and source validation rules.
DO $$
DECLARE
 v_sql text;
 v_before text := $kinds$'invoice','budget','boleto','payment','delivery','photo','other'$kinds$;
 v_after text := $kinds$'invoice','budget','boleto','payment','delivery','photo','other','service_request','purchase_request'$kinds$;
BEGIN
 SELECT pg_get_functiondef('billing_private.documentation_dispatch(text,jsonb)'::regprocedure) INTO v_sql;
 IF (length(v_sql)-length(replace(v_sql,v_before,'')))/length(v_before) <> 2 THEN
  RAISE EXCEPTION 'Expected both documentation kind whitelists before extending the dispatcher';
 END IF;
 EXECUTE replace(v_sql,v_before,v_after);
END;
$$;

COMMIT;
