-- Remove unpriced quotation scope without rewriting the aggregate or erasing
-- immutable negotiation/award history.
ALTER FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 RENAME TO quotations_dispatch_before_scope_removals;

REVOKE ALL ON FUNCTION billing_private.quotations_dispatch_before_scope_removals(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotations_dispatch(
 p_resource text,p_action text,p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_quote_id uuid;
 v_item_id uuid;
 v_provider_id uuid;
 v_quote public.billing_quotations;
 v_item public.billing_quotation_items;
 v_provider public.billing_quotation_providers;
BEGIN
 IF p_resource<>'quotations' OR p_action NOT IN ('remove-item','remove-provider') THEN
  RETURN billing_private.quotations_dispatch_before_scope_removals(
   p_resource,p_action,p_payload);
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
  p_payload,
  CASE p_action
   WHEN 'remove-item' THEN ARRAY['id','quotationItemId']
   ELSE ARRAY['id','quotationProviderId']
  END
 );
 IF jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Informe a cotação.' USING ERRCODE='22023';
 END IF;
 v_quote_id=nullif(p_payload->>'id','')::uuid;
 IF v_quote_id IS NULL THEN
  RAISE EXCEPTION 'Informe a cotação.' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_quote FROM public.billing_quotations
 WHERE owner_id=v_owner AND id=v_quote_id FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE='P0002';
 END IF;
 IF v_quote.status<>'open' THEN
  RAISE EXCEPTION 'Apenas cotações em aberto podem ter o escopo alterado.'
   USING ERRCODE='23514';
 END IF;

 IF p_action='remove-item' THEN
  IF jsonb_typeof(p_payload->'quotationItemId') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Informe o material da cotação.' USING ERRCODE='22023';
  END IF;
  v_item_id=nullif(p_payload->>'quotationItemId','')::uuid;
  IF v_item_id IS NULL THEN
   RAISE EXCEPTION 'Informe o material da cotação.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_item FROM public.billing_quotation_items
  WHERE owner_id=v_owner AND quotation_id=v_quote_id AND id=v_item_id FOR UPDATE;
  IF NOT FOUND THEN
   RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote));
  END IF;
  IF (SELECT count(*) FROM public.billing_quotation_items
      WHERE owner_id=v_owner AND quotation_id=v_quote_id)<=1 THEN
   RAISE EXCEPTION 'A cotação precisa manter ao menos um material.'
    USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM public.billing_quotation_provider_values v
     WHERE v.owner_id=v_owner AND v.quotation_id=v_quote_id
      AND v.quotation_item_id=v_item_id)
   OR EXISTS(SELECT 1 FROM public.billing_quotation_negotiations n
     WHERE n.owner_id=v_owner AND n.quotation_id=v_quote_id
      AND n.quotation_item_id=v_item_id)
   OR EXISTS(SELECT 1 FROM public.billing_quotation_item_awards a
     WHERE a.owner_id=v_owner AND a.quotation_id=v_quote_id
      AND a.quotation_item_id=v_item_id) THEN
   RAISE EXCEPTION 'Este material já possui preço, histórico ou aprovação e não pode ser removido.'
    USING ERRCODE='23514';
  END IF;
  DELETE FROM public.billing_quotation_items
  WHERE owner_id=v_owner AND quotation_id=v_quote_id AND id=v_item_id;
 ELSE
  IF jsonb_typeof(p_payload->'quotationProviderId') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Informe o fornecedor da cotação.' USING ERRCODE='22023';
  END IF;
  v_provider_id=nullif(p_payload->>'quotationProviderId','')::uuid;
  IF v_provider_id IS NULL THEN
   RAISE EXCEPTION 'Informe o fornecedor da cotação.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_provider FROM public.billing_quotation_providers
  WHERE owner_id=v_owner AND quotation_id=v_quote_id AND id=v_provider_id FOR UPDATE;
  IF NOT FOUND THEN
   RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote));
  END IF;
  IF EXISTS(SELECT 1 FROM public.billing_quotation_provider_values v
     WHERE v.owner_id=v_owner AND v.quotation_id=v_quote_id
      AND v.quotation_provider_id=v_provider_id)
   OR EXISTS(SELECT 1 FROM public.billing_quotation_negotiations n
     WHERE n.owner_id=v_owner AND n.quotation_id=v_quote_id
      AND n.quotation_provider_id=v_provider_id)
   OR EXISTS(SELECT 1 FROM public.billing_quotation_item_awards a
     WHERE a.owner_id=v_owner AND a.quotation_id=v_quote_id
      AND a.quotation_provider_id=v_provider_id) THEN
   RAISE EXCEPTION 'Este fornecedor já possui preço, histórico ou aprovação e não pode ser removido.'
    USING ERRCODE='23514';
  END IF;
  DELETE FROM public.billing_quotation_providers
  WHERE owner_id=v_owner AND quotation_id=v_quote_id AND id=v_provider_id;
 END IF;

 UPDATE public.billing_quotations SET updated_at=now()
 WHERE owner_id=v_owner AND id=v_quote_id RETURNING * INTO v_quote;
 RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote));
EXCEPTION
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Informe identificadores válidos para alterar a cotação.' USING ERRCODE='22023';
END $$;

REVOKE ALL ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 TO authenticated;

COMMENT ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb) IS
 'Owner-scoped quotation scope removals. Only open, unpriced and unawarded items/providers can be removed; retries are idempotent and history is preserved.';
