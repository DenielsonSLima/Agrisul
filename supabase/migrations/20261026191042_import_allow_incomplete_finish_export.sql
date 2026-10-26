BEGIN;

-- Export uses the original typed projection for either operational status.
DO $$
DECLARE definition text;gate text := $gate$IF r.status<>'finished' THEN RAISE EXCEPTION 'Finalize a revisão antes de exportar.' USING ERRCODE='23514'; END IF;$gate$;
read_statement text := $read$IF p_action IN ('get','export') THEN SELECT * INTO r FROM public.billing_import_documents WHERE owner_id=v_owner AND id=v_id;$read$;
BEGIN
 definition=pg_get_functiondef('billing_private.import_documents_dispatch_before_client_summaries(text,jsonb)'::regprocedure);
 IF strpos(definition,gate)=0 THEN RAISE EXCEPTION 'Expected export status guard was not found.'; END IF;
 IF strpos(definition,read_statement)=0 THEN RAISE EXCEPTION 'Expected export document read was not found.'; END IF;
 definition=replace(definition,gate,'');
 -- An open document may be edited. Keep its field types, cells and snapshot
 -- consistent throughout export; writers already lock this same row first.
 EXECUTE replace(definition,read_statement,$read$IF p_action='export' THEN SELECT * INTO r FROM public.billing_import_documents WHERE owner_id=v_owner AND id=v_id FOR SHARE;
 ELSIF p_action='get' THEN SELECT * INTO r FROM public.billing_import_documents WHERE owner_id=v_owner AND id=v_id;$read$);
END $$;

-- Finishing records the operator's explicit choice. Missing cells and review
-- flags remain evidence and still contribute to the pending counts. This outer
-- action intentionally bypasses the legacy generic and numbering review gates.
ALTER FUNCTION billing_private.import_documents_dispatch(text,jsonb) RENAME TO import_documents_dispatch_before_optional_review;
REVOKE ALL ON FUNCTION billing_private.import_documents_dispatch_before_optional_review(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.import_documents_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();r public.billing_import_documents;
BEGIN
 IF p_action IS DISTINCT FROM 'finalize' THEN
  RETURN billing_private.import_documents_dispatch_before_optional_review(p_action,p_payload);
 END IF;
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Entre para acessar as importações.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize('registrations.write');
 PERFORM billing_private.request_payload(p_payload,ARRAY['id','expectedUpdatedAt']);
 PERFORM billing_private.lock_request_actor();
 PERFORM pg_advisory_xact_lock(hashtextextended('billing:imports:'||v_owner::text,0));
 SELECT * INTO r FROM public.billing_import_documents
  WHERE owner_id=v_owner AND id=nullif(p_payload->>'id','')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Importação não encontrada.' USING ERRCODE='P0002'; END IF;
 IF nullif(p_payload->>'expectedUpdatedAt','')::timestamptz IS DISTINCT FROM r.updated_at THEN
  RAISE EXCEPTION 'A importação foi alterada. Atualize antes de continuar.' USING ERRCODE='PT409'; END IF;
 IF r.status<>'open' THEN RAISE EXCEPTION 'A importação já está finalizada.' USING ERRCODE='23514'; END IF;
 UPDATE public.billing_import_documents SET status='finished',finished_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE owner_id=v_owner AND id=r.id RETURNING * INTO r;
 RETURN jsonb_build_object('document',billing_private.import_document_json(r));
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Confira o documento e sua revisão atual.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.import_documents_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
COMMIT;
