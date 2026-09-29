-- A purchase-order contact is useful context, but it is not required to save
-- an OC number or finish an order. When supplied, the contact still has to be
-- active and belong to the order provider so the snapshot remains trustworthy.
CREATE OR REPLACE FUNCTION billing_private.purchase_orders_dispatch(
 p_action text,p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;
 v_order public.billing_purchase_orders;
 v_method public.billing_payment_methods;
 v_contact public.billing_service_provider_contacts;
 v_result jsonb;
 v_status text;
 v_search text;
 v_search_document text;
 v_date_from date;
 v_date_to date;
 v_purchase_order_number text;
 v_payment_method_id uuid;
 v_change_payment boolean:=false;
 v_provider_contact_id uuid;
 v_provider_contact_snapshot jsonb;
 v_change_contact boolean:=false;
BEGIN
 IF v_owner IS NULL OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR p_action NOT IN ('list','get','save','finish') THEN
  RAISE EXCEPTION 'Operação de pedido inválida.' USING ERRCODE='22023';
 END IF;
 IF p_action IN ('list','get') THEN
  PERFORM billing_private.authorize('registrations.read');
 ELSE
  PERFORM billing_private.lock_request_actor();
  v_owner=billing_private.current_owner_id();
  PERFORM billing_private.authorize('registrations.write');
 END IF;

 IF p_action='list' THEN
  PERFORM billing_private.request_payload(p_payload,
   ARRAY['status','search','dateFrom','dateTo']);
  IF (p_payload ? 'status' AND jsonb_typeof(p_payload->'status') IS DISTINCT FROM 'string')
   OR (p_payload ? 'search' AND jsonb_typeof(p_payload->'search') IS DISTINCT FROM 'string')
   OR (p_payload ? 'dateFrom' AND jsonb_typeof(p_payload->'dateFrom') IS DISTINCT FROM 'string')
   OR (p_payload ? 'dateTo' AND jsonb_typeof(p_payload->'dateTo') IS DISTINCT FROM 'string') THEN
   RAISE EXCEPTION 'Confira os filtros dos pedidos.' USING ERRCODE='22023';
  END IF;
  v_status=coalesce(nullif(p_payload->>'status',''),'open');
  v_search=btrim(coalesce(p_payload->>'search',''));
  v_search_document=regexp_replace(upper(v_search),'[^A-Z0-9]','','g');
  v_date_from=nullif(p_payload->>'dateFrom','')::date;
  v_date_to=nullif(p_payload->>'dateTo','')::date;
  IF v_status NOT IN ('open','finished') OR length(v_search)>160
   OR (v_date_from IS NOT NULL AND v_date_to IS NOT NULL AND v_date_from>v_date_to) THEN
   RAISE EXCEPTION 'Confira os filtros dos pedidos.' USING ERRCODE='22023';
  END IF;
  WITH filtered AS (
   SELECT o.id FROM public.billing_purchase_orders o
   WHERE o.owner_id=v_owner
    AND (v_date_from IS NULL OR o.quotation_request_date>=v_date_from)
    AND (v_date_to IS NULL OR o.quotation_request_date<=v_date_to)
    AND (v_search='' OR concat_ws(' ',o.order_number,o.purchase_order_number,
      o.quotation_number,o.quotation_title,o.provider_snapshot->>'legalName',
      o.provider_snapshot->>'tradeName',o.provider_snapshot->>'document',
      o.provider_contact_snapshot->>'name',o.provider_contact_snapshot->>'phone')
      ILIKE '%'||v_search||'%'
     OR (length(v_search_document)>=3 AND regexp_replace(upper(
      coalesce(o.provider_snapshot->>'document','')),'[^A-Z0-9]','','g')
      LIKE '%'||v_search_document||'%'))
  ), summaries AS (
   SELECT o.id,o.status,o.created_at,
    (billing_private.purchase_order_json(o)-'items')||jsonb_build_object('items','[]'::jsonb) data
   FROM public.billing_purchase_orders o JOIN filtered f ON f.id=o.id
  )
  SELECT jsonb_build_object(
   'orders',coalesce(jsonb_agg(s.data ORDER BY s.created_at DESC,s.id)
    FILTER(WHERE s.status=v_status),'[]'::jsonb),
   'total',count(*) FILTER(WHERE s.status=v_status),
   'counts',jsonb_build_object(
    'open',count(*) FILTER(WHERE s.status='open'),
    'finished',count(*) FILTER(WHERE s.status='finished'))
  ) INTO v_result FROM summaries s;
  RETURN v_result;
 END IF;

 PERFORM billing_private.request_payload(p_payload,
  CASE p_action
   WHEN 'save' THEN ARRAY['id','purchaseOrderNumber','paymentMethodId','paymentMethod','providerContactId']
   ELSE ARRAY['id'] END);
 IF jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Informe o pedido.' USING ERRCODE='22023';
 END IF;
 v_id=nullif(p_payload->>'id','')::uuid;
 IF v_id IS NULL THEN RAISE EXCEPTION 'Informe o pedido.' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_order FROM public.billing_purchase_orders
 WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado.' USING ERRCODE='P0002'; END IF;
 IF p_action='get' THEN
  RETURN jsonb_build_object('order',billing_private.purchase_order_json(v_order));
 END IF;
 IF v_order.status<>'open' THEN
  RAISE EXCEPTION 'Este pedido já foi finalizado.' USING ERRCODE='23514';
 END IF;
 IF p_action='finish' THEN
  IF v_order.payment_method_id IS NULL THEN
   RAISE EXCEPTION 'Selecione e salve a forma de pagamento antes de finalizar o pedido.'
    USING ERRCODE='23514';
  END IF;
  UPDATE public.billing_purchase_orders SET status='finished',finished_at=now()
  WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_order;
  RETURN jsonb_build_object('order',billing_private.purchase_order_json(v_order));
 END IF;

 IF p_payload ? 'purchaseOrderNumber' THEN
  IF jsonb_typeof(p_payload->'purchaseOrderNumber') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Confira o número da ordem de compra.' USING ERRCODE='22023';
  END IF;
  v_purchase_order_number=btrim(p_payload->>'purchaseOrderNumber');
 ELSE
  v_purchase_order_number=v_order.purchase_order_number;
 END IF;
 IF length(v_purchase_order_number)>100 THEN
  RAISE EXCEPTION 'Confira o número da ordem de compra.' USING ERRCODE='22023';
 END IF;

 v_provider_contact_id=v_order.provider_contact_id;
 v_provider_contact_snapshot=v_order.provider_contact_snapshot;
 IF p_payload ? 'providerContactId' THEN
  IF jsonb_typeof(p_payload->'providerContactId') NOT IN ('string','null') THEN
   RAISE EXCEPTION 'Selecione um contato cadastrado para o prestador.' USING ERRCODE='22023';
  END IF;
  v_provider_contact_id=CASE
   WHEN jsonb_typeof(p_payload->'providerContactId')='null'
    OR nullif(p_payload->>'providerContactId','') IS NULL THEN NULL
   ELSE (p_payload->>'providerContactId')::uuid END;
  v_change_contact=true;
  IF v_provider_contact_id IS NULL THEN
   v_provider_contact_snapshot=NULL;
  ELSIF v_provider_contact_id IS DISTINCT FROM v_order.provider_contact_id
   OR v_order.provider_contact_snapshot IS NULL THEN
   SELECT * INTO v_contact FROM public.billing_service_provider_contacts
   WHERE owner_id=v_owner AND provider_id=v_order.provider_id
    AND id=v_provider_contact_id AND deleted_at IS NULL FOR SHARE;
   IF NOT FOUND THEN
    RAISE EXCEPTION 'Selecione um contato ativo deste prestador.' USING ERRCODE='23514';
   END IF;
   v_provider_contact_snapshot=billing_private.provider_contact_json(v_contact);
  END IF;
 END IF;

 v_payment_method_id=v_order.payment_method_id;
 IF p_payload ? 'paymentMethodId' THEN
  IF jsonb_typeof(p_payload->'paymentMethodId') NOT IN ('string','null') THEN
   RAISE EXCEPTION 'Selecione uma forma de pagamento cadastrada.' USING ERRCODE='22023';
  END IF;
  v_payment_method_id=CASE WHEN jsonb_typeof(p_payload->'paymentMethodId')='null'
   OR nullif(p_payload->>'paymentMethodId','') IS NULL THEN NULL
   ELSE (p_payload->>'paymentMethodId')::uuid END;
  v_change_payment=true;
 ELSIF p_payload ? 'paymentMethod' THEN
  IF jsonb_typeof(p_payload->'paymentMethod') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Selecione uma forma de pagamento cadastrada.' USING ERRCODE='22023';
  END IF;
  IF nullif(btrim(p_payload->>'paymentMethod'),'') IS NULL THEN
   v_payment_method_id=NULL;
  ELSE
   SELECT pm.id INTO v_payment_method_id FROM public.billing_payment_methods pm
   WHERE pm.owner_id=v_owner AND lower(pm.name)=lower(btrim(p_payload->>'paymentMethod'));
   IF NOT FOUND THEN
    RAISE EXCEPTION 'Selecione uma forma de pagamento cadastrada.' USING ERRCODE='23514';
   END IF;
  END IF;
  v_change_payment=true;
 END IF;
 IF v_payment_method_id IS NOT NULL THEN
  SELECT * INTO v_method FROM public.billing_payment_methods
  WHERE owner_id=v_owner AND id=v_payment_method_id FOR SHARE;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Selecione uma forma de pagamento cadastrada neste espaço.'
    USING ERRCODE='23514';
  END IF;
 END IF;
 UPDATE public.billing_purchase_orders SET
  purchase_order_number=v_purchase_order_number,
  provider_contact_id=CASE WHEN v_change_contact THEN v_provider_contact_id ELSE provider_contact_id END,
  provider_contact_snapshot=CASE WHEN v_change_contact THEN v_provider_contact_snapshot ELSE provider_contact_snapshot END,
  payment_method_id=CASE WHEN v_change_payment THEN v_payment_method_id ELSE payment_method_id END,
  payment_method=CASE WHEN v_change_payment THEN coalesce(v_method.name,'') ELSE payment_method END
 WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_order;
 RETURN jsonb_build_object('order',billing_private.purchase_order_json(v_order));
EXCEPTION
 WHEN invalid_text_representation OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Confira os dados informados para o pedido.' USING ERRCODE='22023';
END $$;

REVOKE ALL ON FUNCTION billing_private.purchase_orders_dispatch(text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.purchase_orders_dispatch(text,jsonb)
 TO authenticated;
