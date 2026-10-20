-- Reopening a quotation removes its derived open orders from the operational
-- queue, but retains their complete database snapshots in owner-scoped history.
ALTER TABLE public.billing_quotations
 ADD COLUMN returned_purchase_orders jsonb NOT NULL DEFAULT '[]'::jsonb
 CHECK(jsonb_typeof(returned_purchase_orders)='array');
COMMENT ON COLUMN public.billing_quotations.returned_purchase_orders IS
 'Append-only RPC history of returned orders, items, commercial fields and actor. Not accepted from client payloads.';

ALTER FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 RENAME TO quotations_dispatch_before_order_return;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch_before_order_return(
 text,text,jsonb
) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotations_dispatch(
 p_resource text,p_action text,p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_quote_id uuid;
 v_quote public.billing_quotations;
 v_orders jsonb;
 v_items jsonb;
 v_count integer;
BEGIN
 IF p_resource<>'quotations' OR p_action<>'return-to-quotation' THEN
  RETURN billing_private.quotations_dispatch_before_order_return(
   p_resource,p_action,p_payload);
 END IF;
 IF auth.uid() IS NULL OR v_owner IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
  RAISE EXCEPTION 'Informe a cotação.' USING ERRCODE='22023';
 END IF;
 PERFORM billing_private.lock_request_actor();
 v_owner=billing_private.current_owner_id();
 PERFORM billing_private.authorize('registrations.write');
 PERFORM billing_private.request_payload(p_payload,ARRAY['id']);
 IF jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Informe a cotação.' USING ERRCODE='22023';
 END IF;
 v_quote_id=nullif(btrim(p_payload->>'id'),'')::uuid;
 IF v_quote_id IS NULL THEN
  RAISE EXCEPTION 'Informe a cotação.' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_quote FROM public.billing_quotations q
 WHERE q.owner_id=v_owner AND q.id=v_quote_id FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE='P0002';
 END IF;
 -- Use the existing finalization lock and lock all generated orders before
 -- reading their commercial fields, so a concurrent save/finish is serialized.
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'billing-purchase-order:'||v_owner::text,0));
 PERFORM 1 FROM public.billing_purchase_orders o
 WHERE o.owner_id=v_owner AND o.quotation_id=v_quote_id
 ORDER BY o.id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.billing_purchase_orders o
  WHERE o.owner_id=v_owner AND o.quotation_id=v_quote_id AND o.status<>'open') THEN
  RAISE EXCEPTION 'Pedidos finalizados não podem retornar à cotação.'
   USING ERRCODE='23514';
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]'::jsonb)
 INTO v_orders FROM public.billing_purchase_orders o
 WHERE o.owner_id=v_owner AND o.quotation_id=v_quote_id;
 v_count=jsonb_array_length(v_orders);
 IF v_count>0 THEN
  SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]'::jsonb)
  INTO v_items FROM public.billing_purchase_order_items i
  WHERE i.owner_id=v_owner AND i.quotation_id=v_quote_id;
  UPDATE public.billing_quotations q SET
   returned_purchase_orders=q.returned_purchase_orders||jsonb_build_array(
    jsonb_build_object('returnedAt',now(),'returnedBy',auth.uid(),
     'orders',v_orders,'items',v_items)),
   status='open'
  WHERE q.owner_id=v_owner AND q.id=v_quote_id RETURNING * INTO v_quote;
  -- Items cascade through the existing composite owner foreign key. Prices,
  -- materials, approvals, attachments and negotiation revisions remain intact.
  DELETE FROM public.billing_purchase_orders o
  WHERE o.owner_id=v_owner AND o.quotation_id=v_quote_id;
 ELSIF v_quote.status<>'open' THEN
  UPDATE public.billing_quotations q SET status='open'
  WHERE q.owner_id=v_owner AND q.id=v_quote_id RETURNING * INTO v_quote;
 END IF;
 RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote),
  'returnedOrderCount',v_count);
EXCEPTION
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Informe uma cotação válida.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 TO authenticated;
