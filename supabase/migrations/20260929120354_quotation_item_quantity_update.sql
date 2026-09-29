ALTER FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 RENAME TO quotations_dispatch_before_item_quantity_update;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch_before_item_quantity_update(
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
 v_quantity numeric;
 v_quote public.billing_quotations;
BEGIN
 IF p_resource<>'quotations' OR p_action<>'update-item-quantity' THEN
  RETURN billing_private.quotations_dispatch_before_item_quantity_update(
   p_resource,p_action,p_payload
  );
 END IF;
 IF v_owner IS NULL OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
  RAISE EXCEPTION 'Dados da cotação inválidos.' USING ERRCODE='22023';
 END IF;

 PERFORM billing_private.lock_request_actor();
 v_owner=billing_private.current_owner_id();
 PERFORM billing_private.authorize('quotations.write');
 PERFORM billing_private.request_payload(
  p_payload,ARRAY['id','quotationItemId','quantity']
 );
 IF jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'quotationItemId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'quantity') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Informe uma quantidade válida.' USING ERRCODE='22023';
 END IF;
 v_quote_id=nullif(btrim(p_payload->>'id'),'')::uuid;
 v_item_id=nullif(btrim(p_payload->>'quotationItemId'),'')::uuid;
 v_quantity=replace(btrim(p_payload->>'quantity'),',','.')::numeric;
 IF v_quote_id IS NULL OR v_item_id IS NULL
  OR v_quantity<=0 OR v_quantity>=1000000000000
  OR scale(v_quantity)>3 THEN
  RAISE EXCEPTION 'Informe uma quantidade positiva com até três casas decimais.'
   USING ERRCODE='22023';
 END IF;

 SELECT * INTO v_quote
 FROM public.billing_quotations q
 WHERE q.owner_id=v_owner AND q.id=v_quote_id
 FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE='P0002';
 END IF;
 IF v_quote.status<>'open' THEN
  RAISE EXCEPTION 'Apenas cotações em aberto podem ter a quantidade alterada.'
   USING ERRCODE='23514';
 END IF;

 UPDATE public.billing_quotation_items i
 SET quantity=v_quantity
 WHERE i.owner_id=v_owner AND i.quotation_id=v_quote_id AND i.id=v_item_id;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Material da cotação não encontrado.' USING ERRCODE='P0002';
 END IF;
 UPDATE public.billing_quotations q SET updated_at=now()
 WHERE q.owner_id=v_owner AND q.id=v_quote_id
 RETURNING * INTO v_quote;

 RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote));
EXCEPTION
 WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Informe uma quantidade positiva com até três casas decimais.'
   USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 TO authenticated;

COMMENT ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb) IS
 'Routes quotations and updates item quantity under the quotation row lock so all projected totals are recalculated in Postgres.';
