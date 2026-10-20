-- Removing a supplier from an open quotation also removes its commercial
-- history and awards in that quotation. Registry data and other suppliers
-- remain intact; generated purchase orders must never be removed by this action.
ALTER FUNCTION billing_private.quotation_json(public.billing_quotations)
 RENAME TO quotation_json_before_provider_removal;
REVOKE ALL ON FUNCTION billing_private.quotation_json_before_provider_removal(
 public.billing_quotations
) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotation_json(
 p_quote public.billing_quotations
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE
 v_result jsonb:=billing_private.quotation_json_before_provider_removal(p_quote);
 v_providers jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(
  entry.value || jsonb_build_object(
   'canRemove',p_quote.status='open' AND NOT EXISTS(
    SELECT 1 FROM public.billing_purchase_orders o
    WHERE o.owner_id=p_quote.owner_id AND o.quotation_id=p_quote.id
     AND o.quotation_provider_id=(entry.value->>'id')::uuid
   ),
   'removeBlockedReason',CASE
    WHEN p_quote.status<>'open'
     THEN 'Apenas cotações em aberto podem ter fornecedores removidos.'
    WHEN EXISTS(
     SELECT 1 FROM public.billing_purchase_orders o
     WHERE o.owner_id=p_quote.owner_id AND o.quotation_id=p_quote.id
      AND o.quotation_provider_id=(entry.value->>'id')::uuid
    ) THEN 'Fornecedores com pedido gerado não podem ser removidos.'
    ELSE '' END
  ) ORDER BY entry.position
 ),'[]'::jsonb) INTO v_providers
 FROM jsonb_array_elements(
  coalesce(v_result->'providers','[]'::jsonb)
 ) WITH ORDINALITY entry(value,position);
 RETURN jsonb_set(v_result,'{providers}',v_providers,true);
END $$;
REVOKE ALL ON FUNCTION billing_private.quotation_json(public.billing_quotations)
 FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 RENAME TO quotations_dispatch_before_provider_removal;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch_before_provider_removal(
 text,text,jsonb
) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotations_dispatch(
 p_resource text,p_action text,p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_quote_id uuid;
 v_provider_id uuid;
 v_quote public.billing_quotations;
BEGIN
 IF p_resource<>'quotations' OR p_action<>'remove-provider' THEN
  RETURN billing_private.quotations_dispatch_before_provider_removal(
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
 PERFORM billing_private.request_payload(p_payload,ARRAY['id','quotationProviderId']);
 IF jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'quotationProviderId') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Selecione a cotação e o fornecedor.' USING ERRCODE='22023';
 END IF;
 v_quote_id=nullif(btrim(p_payload->>'id'),'')::uuid;
 v_provider_id=nullif(btrim(p_payload->>'quotationProviderId'),'')::uuid;
 IF v_quote_id IS NULL OR v_provider_id IS NULL THEN
  RAISE EXCEPTION 'Selecione a cotação e o fornecedor.' USING ERRCODE='22023';
 END IF;

 SELECT * INTO v_quote FROM public.billing_quotations q
 WHERE q.owner_id=v_owner AND q.id=v_quote_id FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE='P0002';
 END IF;
 IF v_quote.status<>'open' THEN
  RAISE EXCEPTION 'Apenas cotações em aberto podem ter fornecedores removidos.'
   USING ERRCODE='23514';
 END IF;
 PERFORM 1 FROM public.billing_quotation_providers qp
 WHERE qp.owner_id=v_owner AND qp.quotation_id=v_quote_id AND qp.id=v_provider_id
 FOR UPDATE;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote));
 END IF;
 IF EXISTS(SELECT 1 FROM public.billing_purchase_orders o
  WHERE o.owner_id=v_owner AND o.quotation_id=v_quote_id
   AND o.quotation_provider_id=v_provider_id) THEN
  RAISE EXCEPTION 'Fornecedores com pedido gerado não podem ser removidos.'
   USING ERRCODE='23514';
 END IF;

 DELETE FROM public.billing_quotation_item_awards a
 WHERE a.owner_id=v_owner AND a.quotation_id=v_quote_id
  AND a.quotation_provider_id=v_provider_id;
 DELETE FROM public.billing_quotation_negotiations n
 WHERE n.owner_id=v_owner AND n.quotation_id=v_quote_id
  AND n.quotation_provider_id=v_provider_id;
 DELETE FROM public.billing_quotation_provider_values v
 WHERE v.owner_id=v_owner AND v.quotation_id=v_quote_id
  AND v.quotation_provider_id=v_provider_id;
 DELETE FROM public.billing_quotation_providers qp
 WHERE qp.owner_id=v_owner AND qp.quotation_id=v_quote_id AND qp.id=v_provider_id;

 UPDATE public.billing_quotations q SET updated_at=now()
 WHERE q.owner_id=v_owner AND q.id=v_quote_id RETURNING * INTO v_quote;
 RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote));
EXCEPTION
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Selecione a cotação e o fornecedor.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 TO authenticated;

COMMENT ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb) IS
 'Removes an open quotation supplier together with its prices, negotiation history and awards, preserving registry data and generated orders.';
