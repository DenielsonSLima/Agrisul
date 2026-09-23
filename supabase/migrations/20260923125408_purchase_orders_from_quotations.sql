-- A purchase order is the immutable commercial result of one quotation.
-- The user explicitly chooses one complete quotation provider; finalization,
-- snapshotting and order creation happen in the same database transaction.
CREATE TABLE public.billing_purchase_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 quotation_id uuid NOT NULL,
 quotation_provider_id uuid NOT NULL,
 provider_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 order_number text NOT NULL CHECK(length(btrim(order_number)) BETWEEN 1 AND 60),
 purchase_order_number text NOT NULL DEFAULT '' CHECK(length(purchase_order_number)<=100),
 payment_method text NOT NULL DEFAULT '' CHECK(length(payment_method)<=250),
 status text NOT NULL DEFAULT 'open' CHECK(status='open'),
 quotation_number text NOT NULL CHECK(length(btrim(quotation_number)) BETWEEN 1 AND 60),
 quotation_title text NOT NULL CHECK(length(btrim(quotation_title)) BETWEEN 2 AND 150),
 quotation_request_date date NOT NULL,
 quotation_requester text NOT NULL CHECK(length(btrim(quotation_requester)) BETWEEN 2 AND 150),
 quotation_notes text NOT NULL DEFAULT '' CHECK(length(quotation_notes)<=4000),
 provider_snapshot jsonb NOT NULL,
 total numeric NOT NULL CHECK(total>=0),
 UNIQUE(owner_id,id),
 UNIQUE(owner_id,id,quotation_id),
 UNIQUE(owner_id,quotation_id),
 UNIQUE(owner_id,order_number),
 FOREIGN KEY(owner_id,quotation_id)
  REFERENCES public.billing_quotations(owner_id,id),
 FOREIGN KEY(owner_id,quotation_id,quotation_provider_id)
  REFERENCES public.billing_quotation_providers(owner_id,quotation_id,id),
 FOREIGN KEY(owner_id,provider_id)
  REFERENCES public.billing_service_providers(owner_id,id),
 CONSTRAINT billing_purchase_orders_provider_snapshot_check CHECK(
  jsonb_typeof(provider_snapshot)='object'
  AND provider_snapshot->>'id'=provider_id::text
 )
);
CREATE INDEX billing_purchase_orders_owner_status
 ON public.billing_purchase_orders(owner_id,status,created_at DESC,id);
CREATE INDEX billing_purchase_orders_provider
 ON public.billing_purchase_orders(owner_id,provider_id,created_at DESC,id);
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_purchase_orders
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();

CREATE TABLE public.billing_purchase_order_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 purchase_order_id uuid NOT NULL,
 quotation_id uuid NOT NULL,
 quotation_item_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 material_id uuid NOT NULL,
 material_name text NOT NULL CHECK(length(btrim(material_name)) BETWEEN 2 AND 150),
 material_internal_code text NOT NULL DEFAULT '' CHECK(length(material_internal_code)<=60),
 material_application text NOT NULL DEFAULT '' CHECK(length(material_application)<=1000),
 material_references jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(material_references)='array'),
 quantity numeric(15,3) NOT NULL CHECK(quantity>0 AND quantity<1000000000000),
 unit text NOT NULL CHECK(length(btrim(unit)) BETWEEN 1 AND 30),
 unit_price numeric(15,2) NOT NULL CHECK(unit_price>=0 AND unit_price<1000000000000),
 line_total numeric NOT NULL CHECK(line_total>=0 AND line_total=quantity*unit_price),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=1000),
 UNIQUE(owner_id,id),
 UNIQUE(owner_id,purchase_order_id,quotation_item_id),
 FOREIGN KEY(owner_id,purchase_order_id,quotation_id)
  REFERENCES public.billing_purchase_orders(owner_id,id,quotation_id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,quotation_id,quotation_item_id)
  REFERENCES public.billing_quotation_items(owner_id,quotation_id,id)
);
CREATE INDEX billing_purchase_order_items_order
 ON public.billing_purchase_order_items(owner_id,purchase_order_id,created_at,id);
CREATE INDEX billing_purchase_order_items_material
 ON public.billing_purchase_order_items(owner_id,material_id);

ALTER TABLE public.billing_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_purchase_order_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_purchase_orders,public.billing_purchase_order_items
 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_purchase_orders,public.billing_purchase_order_items
 TO authenticated;
CREATE POLICY billing_purchase_orders_read ON public.billing_purchase_orders
 FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'registrations.read'));
CREATE POLICY billing_purchase_order_items_read ON public.billing_purchase_order_items
 FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'registrations.read'));

CREATE FUNCTION billing_private.purchase_order_json(p_order public.billing_purchase_orders)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p_order.id,'number',p_order.order_number,
  'purchaseOrderNumber',p_order.purchase_order_number,
  'paymentMethod',p_order.payment_method,'status',p_order.status,
  'quotationId',p_order.quotation_id,'quotationNumber',p_order.quotation_number,
  'quotationTitle',p_order.quotation_title,
  'requestDate',p_order.quotation_request_date,
  'quotationRequestDate',p_order.quotation_request_date,
  'quotationRequester',p_order.quotation_requester,
  'quotationNotes',p_order.quotation_notes,
  'quotationProviderId',p_order.quotation_provider_id,
  'providerId',p_order.provider_id,
  'providerName',p_order.provider_snapshot->>'legalName',
  'providerEmail',coalesce(p_order.provider_snapshot->>'email',''),
  'providerPhone',coalesce(p_order.provider_snapshot->>'phone',''),
  'provider',p_order.provider_snapshot,
  'total',billing_private.decimal_text(p_order.total),
  'items',coalesce((
   SELECT jsonb_agg(jsonb_build_object(
    'id',i.id,'quotationItemId',i.quotation_item_id,
    'materialId',i.material_id,'materialName',i.material_name,
    'materialInternalCode',i.material_internal_code,
    'materialApplication',i.material_application,
    'materialReferences',i.material_references,
    'quantity',billing_private.decimal_text(i.quantity),'unit',i.unit,
    'unitPrice',billing_private.decimal_text(i.unit_price),
    'lineTotal',billing_private.decimal_text(i.line_total),'notes',i.notes
   ) ORDER BY i.created_at,i.id)
   FROM public.billing_purchase_order_items i
   WHERE i.owner_id=p_order.owner_id AND i.purchase_order_id=p_order.id
  ),'[]'::jsonb),
  'createdAt',p_order.created_at,'updatedAt',p_order.updated_at
 )
$$;
REVOKE ALL ON FUNCTION billing_private.purchase_order_json(public.billing_purchase_orders)
 FROM PUBLIC,anon,authenticated;

-- Keep the existing quotation projection and expose the generated order so a
-- finalized quotation can navigate back to it after a page reload.
CREATE OR REPLACE FUNCTION billing_private.quotation_json(p_quote public.billing_quotations)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 WITH item_count AS (
  SELECT count(*)::integer AS total FROM public.billing_quotation_items i
  WHERE i.owner_id=p_quote.owner_id AND i.quotation_id=p_quote.id
 ), provider_stats AS (
  SELECT qp.*,
   (SELECT count(*)::integer FROM public.billing_quotation_provider_values qv
    WHERE qv.owner_id=qp.owner_id AND qv.quotation_id=qp.quotation_id
     AND qv.quotation_provider_id=qp.id) AS quoted_item_count,
   coalesce((SELECT sum(i.quantity*qv.unit_price)
    FROM public.billing_quotation_provider_values qv
    JOIN public.billing_quotation_items i ON i.owner_id=qv.owner_id
     AND i.quotation_id=qv.quotation_id AND i.id=qv.quotation_item_id
    WHERE qv.owner_id=qp.owner_id AND qv.quotation_id=qp.quotation_id
     AND qv.quotation_provider_id=qp.id),0::numeric) AS total
  FROM public.billing_quotation_providers qp
  WHERE qp.owner_id=p_quote.owner_id AND qp.quotation_id=p_quote.id
 ), complete_minimum AS (
  SELECT min(ps.total) AS total FROM provider_stats ps CROSS JOIN item_count ic
  WHERE ic.total>0 AND ps.quoted_item_count=ic.total
 )
 SELECT jsonb_build_object(
  'id',p_quote.id,'title',p_quote.title,'number',p_quote.quotation_number,
  'requestDate',p_quote.request_date,'requester',p_quote.requester,
  'requesterSignatureId',p_quote.requester_signature_id,'notes',p_quote.notes,
  'status',p_quote.status,
  'purchaseOrderId',(SELECT o.id FROM public.billing_purchase_orders o
   WHERE o.owner_id=p_quote.owner_id AND o.quotation_id=p_quote.id),
  'createdAt',p_quote.created_at,'updatedAt',p_quote.updated_at,
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',i.id,'materialId',i.material_id,'materialVariantId',i.material_variant_id,
   'materialName',i.material_name,'materialCode',i.material_code,
   'materialApplication',i.material_application,'materialReferences',i.material_references,
   'quantity',billing_private.decimal_text(i.quantity),'unit',i.unit,'notes',i.notes
  ) ORDER BY i.created_at,i.id) FROM public.billing_quotation_items i
   WHERE i.owner_id=p_quote.owner_id AND i.quotation_id=p_quote.id),'[]'::jsonb),
  'providers',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',qp.id,'providerId',qp.provider_id,'providerName',qp.provider_snapshot->>'legalName',
   'providerEmail',coalesce(qp.provider_snapshot->>'email',''),
   'providerPhone',coalesce(qp.provider_snapshot->>'phone',''),'provider',qp.provider_snapshot,
   'notes',qp.notes,'sentAt',qp.sent_at,'values',coalesce((SELECT jsonb_object_agg(
    i.id::text,coalesce(billing_private.decimal_text(qv.unit_price),'') ORDER BY i.created_at,i.id)
    FROM public.billing_quotation_items i LEFT JOIN public.billing_quotation_provider_values qv
     ON qv.owner_id=i.owner_id AND qv.quotation_id=i.quotation_id
     AND qv.quotation_provider_id=qp.id AND qv.quotation_item_id=i.id
    WHERE i.owner_id=p_quote.owner_id AND i.quotation_id=p_quote.id),'{}'::jsonb),
   'quotedItemCount',qp.quoted_item_count,'isComplete',ic.total>0 AND qp.quoted_item_count=ic.total,
   'total',billing_private.decimal_text(qp.total)
  ) ORDER BY lower(coalesce(qp.provider_snapshot->>'legalName','')),qp.id)
   FROM provider_stats qp CROSS JOIN item_count ic),'[]'::jsonb),
  'winningProviderIds',coalesce((SELECT jsonb_agg(qp.id ORDER BY lower(
   coalesce(qp.provider_snapshot->>'legalName','')),qp.id)
   FROM provider_stats qp CROSS JOIN item_count ic CROSS JOIN complete_minimum cm
   WHERE ic.total>0 AND qp.quoted_item_count=ic.total AND qp.total=cm.total),'[]'::jsonb)
 )
$$;
REVOKE ALL ON FUNCTION billing_private.quotation_json(public.billing_quotations)
 FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.create_purchase_order_from_quotation(
 p_owner uuid,p_quotation_id uuid,p_quotation_provider_id uuid
) RETURNS public.billing_purchase_orders
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
 v_quote public.billing_quotations;
 v_quote_provider public.billing_quotation_providers;
 v_order public.billing_purchase_orders;
 v_item_count integer;
 v_value_count integer;
 v_total numeric;
 v_number text;
BEGIN
 IF auth.uid() IS NULL OR p_owner IS NULL
  OR p_owner IS DISTINCT FROM billing_private.current_owner_id() THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;

 SELECT * INTO v_order FROM public.billing_purchase_orders
 WHERE owner_id=p_owner AND quotation_id=p_quotation_id;
 IF FOUND THEN
  IF v_order.quotation_provider_id IS DISTINCT FROM p_quotation_provider_id THEN
   RAISE EXCEPTION 'Esta cotação já gerou um pedido para outro prestador.' USING ERRCODE='23514';
  END IF;
  RETURN v_order;
 END IF;

 SELECT * INTO v_quote FROM public.billing_quotations
 WHERE owner_id=p_owner AND id=p_quotation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE='P0002'; END IF;
 SELECT * INTO v_quote_provider FROM public.billing_quotation_providers
 WHERE owner_id=p_owner AND quotation_id=p_quotation_id
  AND id=p_quotation_provider_id FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Selecione um prestador desta cotação.' USING ERRCODE='23514';
 END IF;

 SELECT count(*)::integer INTO v_item_count FROM public.billing_quotation_items i
 WHERE i.owner_id=p_owner AND i.quotation_id=p_quotation_id;
 SELECT count(*)::integer,coalesce(sum(i.quantity*v.unit_price),0::numeric)
  INTO v_value_count,v_total
 FROM public.billing_quotation_provider_values v
 JOIN public.billing_quotation_items i
  ON i.owner_id=v.owner_id AND i.quotation_id=v.quotation_id
  AND i.id=v.quotation_item_id
 WHERE v.owner_id=p_owner AND v.quotation_id=p_quotation_id
  AND v.quotation_provider_id=p_quotation_provider_id;
 IF v_item_count=0 OR v_value_count<>v_item_count THEN
  RAISE EXCEPTION 'O prestador escolhido precisa ter valor em todos os materiais.' USING ERRCODE='23514';
 END IF;

 -- Different quotations can be finalized concurrently. Serialize only the
 -- short owner-specific number allocation, then rely on the unique index too.
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'billing-purchase-order:'||p_owner::text,0));
 SELECT 'PED-'||lpad((coalesce(max((regexp_match(order_number,
  '^PED-([0-9]+)$'))[1]::integer),0)+1)::text,3,'0') INTO v_number
 FROM public.billing_purchase_orders WHERE owner_id=p_owner;

 INSERT INTO public.billing_purchase_orders(
  owner_id,quotation_id,quotation_provider_id,provider_id,order_number,
  quotation_number,quotation_title,quotation_request_date,
  quotation_requester,quotation_notes,provider_snapshot,total
 ) VALUES(
  p_owner,v_quote.id,v_quote_provider.id,v_quote_provider.provider_id,v_number,
  v_quote.quotation_number,v_quote.title,v_quote.request_date,
  v_quote.requester,v_quote.notes,v_quote_provider.provider_snapshot,v_total
 ) RETURNING * INTO v_order;

 INSERT INTO public.billing_purchase_order_items(
  owner_id,purchase_order_id,quotation_id,quotation_item_id,
  material_id,material_name,material_internal_code,material_application,
  material_references,quantity,unit,unit_price,line_total,notes
 )
 SELECT i.owner_id,v_order.id,i.quotation_id,i.id,
  i.material_id,i.material_name,coalesce(m.code,''),i.material_application,
  i.material_references,i.quantity,i.unit,v.unit_price,
  i.quantity*v.unit_price,i.notes
 FROM public.billing_quotation_items i
 JOIN public.billing_quotation_provider_values v
  ON v.owner_id=i.owner_id AND v.quotation_id=i.quotation_id
  AND v.quotation_item_id=i.id AND v.quotation_provider_id=p_quotation_provider_id
 JOIN public.billing_materials m
  ON m.owner_id=i.owner_id AND m.id=i.material_id
 WHERE i.owner_id=p_owner AND i.quotation_id=p_quotation_id
 ORDER BY i.created_at,i.id;
 RETURN v_order;
END $$;
REVOKE ALL ON FUNCTION billing_private.create_purchase_order_from_quotation(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.purchase_orders_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;
 v_order public.billing_purchase_orders;
 v_result jsonb;
 v_status text;
 v_purchase_order_number text;
 v_payment_method text;
BEGIN
 IF v_owner IS NULL OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR p_action NOT IN ('list','get','save') THEN
  RAISE EXCEPTION 'Operação de pedido inválida.' USING ERRCODE='22023';
 END IF;
 IF p_action IN ('list','get') THEN
  PERFORM billing_private.authorize('registrations.read');
 ELSE
  PERFORM billing_private.lock_request_actor();
  PERFORM billing_private.authorize('registrations.write');
 END IF;

 IF p_action='list' THEN
  PERFORM billing_private.request_payload(p_payload,ARRAY['status']);
  IF p_payload ? 'status'
   AND (jsonb_typeof(p_payload->'status') IS DISTINCT FROM 'string'
    OR p_payload->>'status'<>'open') THEN
   RAISE EXCEPTION 'Situação do pedido inválida.' USING ERRCODE='22023';
  END IF;
  v_status=coalesce(nullif(p_payload->>'status',''),'open');
  SELECT coalesce(jsonb_agg(billing_private.purchase_order_json(o)
   ORDER BY o.created_at DESC,o.id),'[]'::jsonb) INTO v_result
  FROM public.billing_purchase_orders o
  WHERE o.owner_id=v_owner AND o.status=v_status;
  RETURN jsonb_build_object('orders',v_result,'total',jsonb_array_length(v_result));
 END IF;

 PERFORM billing_private.request_payload(p_payload,
  CASE WHEN p_action='save' THEN ARRAY['id','purchaseOrderNumber','paymentMethod']
   ELSE ARRAY['id'] END);
 v_id=nullif(p_payload->>'id','')::uuid;
 IF v_id IS NULL THEN RAISE EXCEPTION 'Informe o pedido.' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_order FROM public.billing_purchase_orders
 WHERE owner_id=v_owner AND id=v_id
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado.' USING ERRCODE='P0002'; END IF;
 IF p_action='get' THEN
  RETURN jsonb_build_object('order',billing_private.purchase_order_json(v_order));
 END IF;

 IF v_order.status<>'open' THEN
  RAISE EXCEPTION 'Este pedido não está mais em aberto.' USING ERRCODE='23514';
 END IF;
 IF (p_payload ? 'purchaseOrderNumber'
   AND jsonb_typeof(p_payload->'purchaseOrderNumber') IS DISTINCT FROM 'string')
  OR (p_payload ? 'paymentMethod'
   AND jsonb_typeof(p_payload->'paymentMethod') IS DISTINCT FROM 'string') THEN
  RAISE EXCEPTION 'Confira o número da ordem e a forma de pagamento.' USING ERRCODE='22023';
 END IF;
 v_purchase_order_number=CASE WHEN p_payload ? 'purchaseOrderNumber'
  THEN btrim(p_payload->>'purchaseOrderNumber') ELSE v_order.purchase_order_number END;
 v_payment_method=CASE WHEN p_payload ? 'paymentMethod'
  THEN btrim(p_payload->>'paymentMethod') ELSE v_order.payment_method END;
 IF length(v_purchase_order_number)>100 OR length(v_payment_method)>250 THEN
  RAISE EXCEPTION 'Confira o número da ordem e a forma de pagamento.' USING ERRCODE='22023';
 END IF;
 UPDATE public.billing_purchase_orders SET
  purchase_order_number=v_purchase_order_number,payment_method=v_payment_method
 WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_order;
 RETURN jsonb_build_object('order',billing_private.purchase_order_json(v_order));
EXCEPTION
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Informe um pedido válido.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.purchase_orders_dispatch(text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.purchase_orders_dispatch(text,jsonb)
 TO authenticated;

-- Keep all existing generic dispatcher routes and add only purchase orders.
ALTER FUNCTION billing_private.dispatch(text,text,jsonb)
 RENAME TO dispatch_before_purchase_orders;
REVOKE ALL ON FUNCTION billing_private.dispatch_before_purchase_orders(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.dispatch(p_resource text,p_action text,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_resource='purchase-orders' THEN
  RETURN billing_private.purchase_orders_dispatch(p_action,p_payload);
 END IF;
 RETURN billing_private.dispatch_before_purchase_orders(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION billing_private.dispatch(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.dispatch(text,text,jsonb) TO authenticated;

-- Add a one-way finalization action without changing the old quotation save/get
-- implementation. A quotation with an order can never be reopened or deleted.
ALTER FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 RENAME TO quotations_dispatch_before_purchase_orders;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch_before_purchase_orders(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.quotations_dispatch(p_resource text,p_action text,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;
 v_winner_id uuid;
 v_quote public.billing_quotations;
 v_order public.billing_purchase_orders;
BEGIN
 IF p_resource<>'quotations' OR p_action NOT IN ('finalize','toggle-status','delete') THEN
  RETURN billing_private.quotations_dispatch_before_purchase_orders(
   p_resource,p_action,p_payload);
 END IF;
 IF v_owner IS NULL OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 PERFORM billing_private.lock_request_actor();
 PERFORM billing_private.authorize('registrations.write');
 PERFORM billing_private.request_payload(p_payload,
  CASE WHEN p_action='finalize' THEN ARRAY['id','winnerProviderId'] ELSE ARRAY['id'] END);
 v_id=nullif(p_payload->>'id','')::uuid;
 IF v_id IS NULL THEN RAISE EXCEPTION 'Informe a cotação.' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_quote FROM public.billing_quotations
 WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE='P0002'; END IF;

 SELECT * INTO v_order FROM public.billing_purchase_orders
 WHERE owner_id=v_owner AND quotation_id=v_id;
 IF p_action='delete' THEN
  IF FOUND THEN
   RAISE EXCEPTION 'A cotação não pode ser excluída porque já gerou o pedido %.',v_order.order_number
    USING ERRCODE='23514';
  END IF;
  RETURN billing_private.quotations_dispatch_before_purchase_orders(
   p_resource,p_action,p_payload);
 END IF;
 IF p_action='toggle-status' THEN
  IF FOUND THEN
   RAISE EXCEPTION 'A cotação não pode ser reaberta porque já gerou o pedido %.',v_order.order_number
    USING ERRCODE='23514';
  END IF;
  IF v_quote.status='open' THEN
   RAISE EXCEPTION 'Escolha o prestador vencedor para finalizar a cotação.' USING ERRCODE='23514';
  END IF;
  -- Preserve reopening only for legacy finished quotations without an order.
  RETURN billing_private.quotations_dispatch_before_purchase_orders(
   p_resource,p_action,p_payload);
 END IF;

 IF jsonb_typeof(p_payload->'winnerProviderId') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Selecione o prestador vencedor.' USING ERRCODE='22023';
 END IF;
 v_winner_id=nullif(p_payload->>'winnerProviderId','')::uuid;
 IF v_winner_id IS NULL THEN
  RAISE EXCEPTION 'Selecione o prestador vencedor.' USING ERRCODE='22023';
 END IF;
 IF FOUND THEN
  IF v_order.quotation_provider_id IS DISTINCT FROM v_winner_id THEN
   RAISE EXCEPTION 'Esta cotação já gerou um pedido para outro prestador.' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote),
   'purchaseOrder',billing_private.purchase_order_json(v_order));
 END IF;

 v_order=billing_private.create_purchase_order_from_quotation(v_owner,v_id,v_winner_id);
 UPDATE public.billing_quotations SET status='finished'
 WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_quote;
 RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote),
  'purchaseOrder',billing_private.purchase_order_json(v_order));
EXCEPTION
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Selecione uma cotação e um prestador válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 TO authenticated;

DO $$ DECLARE t text;BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  FOREACH t IN ARRAY ARRAY['billing_purchase_orders','billing_purchase_order_items'] LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);
   END IF;
  END LOOP;
 END IF;
END $$;

COMMENT ON TABLE public.billing_purchase_orders IS
 'Open purchase orders created atomically from an explicitly selected complete quotation provider.';
COMMENT ON TABLE public.billing_purchase_order_items IS
 'Immutable material, reference, quantity, unit-price and line-total snapshots from the winning quotation proposal.';
COMMENT ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb) IS
 'Quotation aggregate with one-way, idempotent finalization that creates exactly one purchase order for the explicitly selected complete provider.';
