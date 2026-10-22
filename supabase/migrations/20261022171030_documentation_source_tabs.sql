BEGIN;

-- Extend the list branch in place, preserving all prior dispatcher changes,
-- authentication, permissions and the source documents projected by the RPC.
DO $$
DECLARE
 v_sql text := pg_get_functiondef('billing_private.documentation_dispatch(text,jsonb)'::regprocedure);
 v_before text;
 v_after text;
BEGIN
 v_before := $old$ARRAY['search','kind','status','providerId','dateFrom','dateTo','page','includePending']$old$;
 IF position(v_before IN v_sql)=0 THEN RAISE EXCEPTION 'Documentation list whitelist not found'; END IF;
 v_sql := replace(v_sql,v_before,$new$ARRAY['search','kind','status','providerId','dateFrom','dateTo','page','includePending','sourceCategory']$new$);

 v_before := $old$v_page=coalesce((p_payload->>'page')::integer,1);$old$;
 v_after := $new$v_page=coalesce((p_payload->>'page')::integer,1);
  v_type=coalesce(p_payload->>'sourceCategory','');
  IF v_type NOT IN ('','service','purchase') THEN RAISE EXCEPTION 'Categoria documental inválida.' USING ERRCODE='22023'; END IF;$new$;
 IF position(v_before IN v_sql)=0 THEN RAISE EXCEPTION 'Documentation pagination not found'; END IF;
 v_sql := replace(v_sql,v_before,v_after);

 v_before := $old$WHERE d.owner_id=v_owner AND (v_kind='' OR d.kind=v_kind) AND (v_status='' OR d.status=v_status)$old$;
 v_after := v_before || $new$
    AND (v_type='' OR EXISTS (
     SELECT 1 FROM public.billing_document_links l WHERE l.owner_id=d.owner_id AND l.document_id=d.id
      AND ((v_type='service' AND l.service_request_id IS NOT NULL)
       OR (v_type='purchase' AND (l.quotation_id IS NOT NULL OR l.purchase_order_id IS NOT NULL)))))$new$;
 IF position(v_before IN v_sql)=0 THEN RAISE EXCEPTION 'Documentation list predicate not found'; END IF;
 v_sql := replace(v_sql,v_before,v_after);

 v_before := $old$WHERE (v_kind='' OR item->>'kind'=v_kind) AND (v_status='' OR item->>'reason'=v_status)$old$;
 v_after := v_before || $new$
    AND (v_type='' OR (v_type='service' AND item->'source'->>'type'='service')
     OR (v_type='purchase' AND item->'source'->>'type' IN ('quotation','order'))
     OR EXISTS (SELECT 1 FROM public.billing_document_links l WHERE l.owner_id=v_owner AND l.document_id=(item->>'documentId')::uuid
      AND ((v_type='service' AND l.service_request_id IS NOT NULL)
       OR (v_type='purchase' AND (l.quotation_id IS NOT NULL OR l.purchase_order_id IS NOT NULL)))))$new$;
 IF position(v_before IN v_sql)=0 THEN RAISE EXCEPTION 'Documentation pending predicate not found'; END IF;
 v_sql := replace(v_sql,v_before,v_after);
 EXECUTE v_sql;
END;
$$;

COMMIT;
