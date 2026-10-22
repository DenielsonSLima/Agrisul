BEGIN;
-- Source summaries use database column names, independent of frontend DTO names.
DO $$
DECLARE v_sql text;
BEGIN
 SELECT pg_get_functiondef('billing_private.documentation_source(text,uuid)'::regprocedure) INTO v_sql;
 IF strpos(v_sql,'q.number')=0 OR strpos(v_sql,'p.number')=0 THEN RAISE EXCEPTION 'Unexpected documentation source projection'; END IF;
 v_sql=replace(replace(v_sql,'q.number','q.quotation_number'),'p.number','p.order_number');
 EXECUTE v_sql;
END $$;

-- Existing budget files satisfy a request for an available budget. They remain
-- in their original private bucket and are never duplicated as new documents.
ALTER FUNCTION billing_private.documentation_pending() RENAME TO documentation_pending_before_origin_files;
REVOKE ALL ON FUNCTION billing_private.documentation_pending_before_origin_files() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.documentation_pending() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(item ORDER BY position),'[]') FROM jsonb_array_elements(billing_private.documentation_pending_before_origin_files()) WITH ORDINALITY x(item,position)
 WHERE NOT (item->>'kind'='budget' AND item->>'reason'='missing' AND (
  item->'source'->>'type'='service' AND EXISTS(SELECT 1 FROM public.billing_request_files f WHERE f.owner_id=billing_private.current_owner_id()
    AND f.request_id=(item->'source'->>'id')::uuid AND f.kind='budget' AND f.consumed_at IS NOT NULL)
  OR item->'source'->>'type' IN ('quotation','order') AND EXISTS(
   SELECT 1 FROM public.billing_quotations q WHERE q.owner_id=billing_private.current_owner_id() AND q.attachment_key IS NOT NULL
    AND q.id=CASE WHEN item->'source'->>'type'='quotation' THEN (item->'source'->>'id')::uuid
     ELSE (SELECT p.quotation_id FROM public.billing_purchase_orders p WHERE p.owner_id=q.owner_id AND p.id=(item->'source'->>'id')::uuid) END)
 ));
$$;
REVOKE ALL ON FUNCTION billing_private.documentation_pending() FROM PUBLIC,anon,authenticated;
COMMIT;
