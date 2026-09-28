-- Allow an open quotation item to return to the pending state without
-- deleting its supplier prices or append-only negotiation history.
ALTER FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 RENAME TO quotations_dispatch_before_item_unaward;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch_before_item_unaward(
 text,text,jsonb
) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotations_dispatch(
 p_resource text,p_action text,p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_quote_id uuid;
 v_item_id uuid;
 v_affected integer;
 v_quote public.billing_quotations;
BEGIN
 IF p_resource<>'quotations' OR p_action<>'unaward-item' THEN
  RETURN billing_private.quotations_dispatch_before_item_unaward(
   p_resource,p_action,p_payload);
 END IF;
 IF v_owner IS NULL OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
  RAISE EXCEPTION 'Dados da aprovação inválidos.' USING ERRCODE='22023';
 END IF;

 PERFORM billing_private.lock_request_actor();
 v_owner=billing_private.current_owner_id();
 PERFORM billing_private.authorize('registrations.write');
 PERFORM billing_private.request_payload(
  p_payload,ARRAY['id','quotationItemId']);
 IF jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'quotationItemId') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Selecione a cotação e o material.' USING ERRCODE='22023';
 END IF;
 v_quote_id=nullif(btrim(p_payload->>'id'),'')::uuid;
 v_item_id=nullif(btrim(p_payload->>'quotationItemId'),'')::uuid;
 IF v_quote_id IS NULL OR v_item_id IS NULL THEN
  RAISE EXCEPTION 'Selecione a cotação e o material.' USING ERRCODE='22023';
 END IF;

 SELECT * INTO v_quote
 FROM public.billing_quotations q
 WHERE q.owner_id=v_owner AND q.id=v_quote_id
 FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE='P0002';
 END IF;
 IF v_quote.status<>'open' THEN
  RAISE EXCEPTION 'A cotação precisa estar em aberto para remover a aprovação.'
   USING ERRCODE='23514';
 END IF;
 PERFORM 1
 FROM public.billing_quotation_items i
 WHERE i.owner_id=v_owner AND i.quotation_id=v_quote_id AND i.id=v_item_id
 FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Selecione um material desta cotação.' USING ERRCODE='23514';
 END IF;

 DELETE FROM public.billing_quotation_item_awards a
 WHERE a.owner_id=v_owner AND a.quotation_id=v_quote_id
  AND a.quotation_item_id=v_item_id;
 GET DIAGNOSTICS v_affected=ROW_COUNT;
 IF v_affected>0 THEN
  UPDATE public.billing_quotations q SET updated_at=now()
  WHERE q.owner_id=v_owner AND q.id=v_quote_id
  RETURNING * INTO v_quote;
 END IF;

 RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote));
EXCEPTION
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Selecione a cotação e o material.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 TO authenticated;

COMMENT ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb) IS
 'Routes quotation operations and removes an item award without changing prices or history.';
