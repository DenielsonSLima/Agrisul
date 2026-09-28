-- An operator can remove an item from an open quotation even after suppliers
-- have priced or approved it. The removal is deliberately destructive only
-- inside that quotation: current prices, version history and the award for the
-- item are deleted in one owner-scoped transaction. The material registry is
-- not changed.

ALTER FUNCTION billing_private.quotation_json(public.billing_quotations)
 RENAME TO quotation_json_before_item_removal;
REVOKE ALL ON FUNCTION billing_private.quotation_json_before_item_removal(
 public.billing_quotations
) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotation_json(
 p_quote public.billing_quotations
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE
 v_result jsonb:=billing_private.quotation_json_before_item_removal(p_quote);
 v_items jsonb;
 v_item_count integer:=jsonb_array_length(
  coalesce(v_result->'items','[]'::jsonb)
 );
BEGIN
 SELECT coalesce(jsonb_agg(
  entry.value || jsonb_build_object(
   'canRemove',p_quote.status='open' AND v_item_count>1,
   'removeBlockedReason',CASE
    WHEN p_quote.status<>'open'
     THEN 'Apenas cotações em aberto podem ter o escopo alterado.'
    WHEN v_item_count<=1
     THEN 'A cotação precisa manter ao menos um material.'
    ELSE ''
   END
  ) ORDER BY entry.position
 ),'[]'::jsonb)
 INTO v_items
 FROM jsonb_array_elements(
  coalesce(v_result->'items','[]'::jsonb)
 ) WITH ORDINALITY entry(value,position);

 RETURN jsonb_set(v_result,'{items}',v_items,true);
END $$;
REVOKE ALL ON FUNCTION billing_private.quotation_json(
 public.billing_quotations
) FROM PUBLIC,anon,authenticated;

COMMENT ON FUNCTION billing_private.quotation_json(
 public.billing_quotations
) IS 'Owner-scoped quotation projection. Any item except the last can be removed while the quotation is open.';

ALTER FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 RENAME TO quotations_dispatch_before_item_removal;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch_before_item_removal(
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
 v_item_count integer;
 v_quote public.billing_quotations;
BEGIN
 IF p_resource<>'quotations' OR p_action<>'remove-item' THEN
  RETURN billing_private.quotations_dispatch_before_item_removal(
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
 PERFORM billing_private.authorize('registrations.write');
 PERFORM billing_private.request_payload(
  p_payload,ARRAY['id','quotationItemId']
 );
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
  RAISE EXCEPTION 'Apenas cotações em aberto podem ter materiais removidos.'
   USING ERRCODE='23514';
 END IF;

 PERFORM 1
 FROM public.billing_quotation_items i
 WHERE i.owner_id=v_owner AND i.quotation_id=v_quote_id AND i.id=v_item_id
 FOR UPDATE;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote));
 END IF;
 SELECT count(*)::integer INTO v_item_count
 FROM public.billing_quotation_items i
 WHERE i.owner_id=v_owner AND i.quotation_id=v_quote_id;
 IF v_item_count<=1 THEN
  RAISE EXCEPTION 'A cotação precisa manter ao menos um material.'
   USING ERRCODE='23514';
 END IF;

 DELETE FROM public.billing_quotation_item_awards a
 WHERE a.owner_id=v_owner AND a.quotation_id=v_quote_id
  AND a.quotation_item_id=v_item_id;
 DELETE FROM public.billing_quotation_negotiations n
 WHERE n.owner_id=v_owner AND n.quotation_id=v_quote_id
  AND n.quotation_item_id=v_item_id;
 DELETE FROM public.billing_quotation_provider_values v
 WHERE v.owner_id=v_owner AND v.quotation_id=v_quote_id
  AND v.quotation_item_id=v_item_id;
 DELETE FROM public.billing_quotation_items i
 WHERE i.owner_id=v_owner AND i.quotation_id=v_quote_id AND i.id=v_item_id;

 UPDATE public.billing_quotations q SET updated_at=now()
 WHERE q.owner_id=v_owner AND q.id=v_quote_id
 RETURNING * INTO v_quote;
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
 'Routes quotation operations and removes an open quotation item together with its prices, history and award.';
