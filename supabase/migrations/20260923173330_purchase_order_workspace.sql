-- Registered payment terms replace free text on purchase orders. The order
-- keeps the selected label as an immutable display snapshot while the FK
-- preserves the operational relationship with the owner's registry.
CREATE TABLE public.billing_payment_methods (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 100),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=300),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id)
);
CREATE UNIQUE INDEX billing_payment_methods_owner_name
 ON public.billing_payment_methods(owner_id,lower(name));
CREATE TRIGGER billing_touch_updated_at
 BEFORE UPDATE ON public.billing_payment_methods
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();

ALTER TABLE public.billing_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_payment_methods REPLICA IDENTITY FULL;
REVOKE ALL ON public.billing_payment_methods FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_payment_methods TO authenticated;
CREATE POLICY billing_payment_methods_read ON public.billing_payment_methods
 FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'registrations.read'));

-- Give existing workspaces useful starting choices. Existing legacy labels are
-- also registered and linked so no saved order loses its payment information.
INSERT INTO public.billing_payment_methods(owner_id,name)
SELECT owners.owner_id,defaults.name
FROM (
 SELECT DISTINCT owner_id FROM public.billing_memberships
 UNION SELECT DISTINCT owner_id FROM public.billing_purchase_orders
) owners
CROSS JOIN (VALUES
 ('À vista'),('7/14 dias'),('30/60 dias'),('Adiantamento')
) defaults(name)
WHERE NOT EXISTS(
 SELECT 1 FROM public.billing_payment_methods pm
 WHERE pm.owner_id=owners.owner_id AND lower(pm.name)=lower(defaults.name)
);
INSERT INTO public.billing_payment_methods(owner_id,name)
SELECT DISTINCT o.owner_id,btrim(o.payment_method)
FROM public.billing_purchase_orders o
WHERE btrim(o.payment_method)<>'' AND NOT EXISTS(
 SELECT 1 FROM public.billing_payment_methods pm
 WHERE pm.owner_id=o.owner_id AND lower(pm.name)=lower(btrim(o.payment_method))
);

ALTER TABLE public.billing_purchase_orders
 DROP CONSTRAINT billing_purchase_orders_status_check,
 ADD COLUMN payment_method_id uuid,
 ADD COLUMN finished_at timestamptz,
 ADD CONSTRAINT billing_purchase_orders_status_check
  CHECK(status IN ('open','finished')),
 ADD CONSTRAINT billing_purchase_orders_payment_method_fk
  FOREIGN KEY(owner_id,payment_method_id)
  REFERENCES public.billing_payment_methods(owner_id,id);
UPDATE public.billing_purchase_orders o SET payment_method_id=pm.id
FROM public.billing_payment_methods pm
WHERE pm.owner_id=o.owner_id AND lower(pm.name)=lower(btrim(o.payment_method))
 AND btrim(o.payment_method)<>'';
CREATE INDEX billing_purchase_orders_payment_method
 ON public.billing_purchase_orders(owner_id,payment_method_id)
 WHERE payment_method_id IS NOT NULL;

-- Product photos are snapshotted with the commercial result, just like name,
-- internal code, references, quantity and negotiated price.
ALTER TABLE public.billing_purchase_order_items
 ADD COLUMN material_image_key text,
 ADD COLUMN material_image_name text NOT NULL DEFAULT '',
 ADD CONSTRAINT billing_purchase_order_items_image_check CHECK(
  (material_image_key IS NULL AND material_image_name='') OR
  (material_image_key IS NOT NULL
   AND length(material_image_key)<=500
   AND material_image_key LIKE owner_id::text||'/materials/%'
   AND length(btrim(material_image_name)) BETWEEN 1 AND 255)
 );
UPDATE public.billing_purchase_order_items i SET
 material_image_key=m.image_key,material_image_name=m.image_name
FROM public.billing_materials m
WHERE m.owner_id=i.owner_id AND m.id=i.material_id AND m.image_key IS NOT NULL;

CREATE FUNCTION billing_private.purchase_order_item_image_snapshot()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.material_image_key IS NULL THEN
  SELECT m.image_key,m.image_name
   INTO NEW.material_image_key,NEW.material_image_name
  FROM public.billing_materials m
  WHERE m.owner_id=NEW.owner_id AND m.id=NEW.material_id;
  NEW.material_image_name=coalesce(NEW.material_image_name,'');
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION billing_private.purchase_order_item_image_snapshot()
 FROM PUBLIC,anon,authenticated;
CREATE TRIGGER billing_purchase_order_item_image_snapshot
 BEFORE INSERT ON public.billing_purchase_order_items
 FOR EACH ROW EXECUTE FUNCTION billing_private.purchase_order_item_image_snapshot();

CREATE FUNCTION billing_private.payment_method_json(
 p_method public.billing_payment_methods
) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p_method.id,'name',p_method.name,'description',p_method.description,
  'createdAt',p_method.created_at,'updatedAt',p_method.updated_at
 )
$$;
REVOKE ALL ON FUNCTION billing_private.payment_method_json(
 public.billing_payment_methods) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.payment_methods_dispatch(
 p_action text,p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;
 v_method public.billing_payment_methods;
 v_rows jsonb;
 v_name text;
 v_description text;
BEGIN
 IF v_owner IS NULL OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar as formas de pagamento.' USING ERRCODE='28000';
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR p_action NOT IN ('list','save','delete') THEN
  RAISE EXCEPTION 'Operação de forma de pagamento inválida.' USING ERRCODE='22023';
 END IF;
 IF p_action='list' THEN
  PERFORM billing_private.authorize('registrations.read');
  PERFORM billing_private.request_payload(p_payload,ARRAY[]::text[]);
  SELECT coalesce(jsonb_agg(billing_private.payment_method_json(pm)
   ORDER BY lower(pm.name),pm.id),'[]'::jsonb) INTO v_rows
  FROM public.billing_payment_methods pm WHERE pm.owner_id=v_owner;
  RETURN jsonb_build_object('paymentMethods',v_rows);
 END IF;
 PERFORM billing_private.lock_request_actor();
 v_owner=billing_private.current_owner_id();
 PERFORM billing_private.authorize('registrations.write');
 PERFORM billing_private.request_payload(p_payload,
  CASE WHEN p_action='save' THEN ARRAY['id','name','description'] ELSE ARRAY['id'] END);
 IF jsonb_typeof(p_payload->'id')='string' THEN
  v_id=nullif(p_payload->>'id','')::uuid;
 ELSIF p_payload ? 'id' AND jsonb_typeof(p_payload->'id')<>'null' THEN
  RAISE EXCEPTION 'Informe uma forma de pagamento válida.' USING ERRCODE='22023';
 END IF;
 IF p_action='delete' THEN
  IF v_id IS NULL THEN
   RAISE EXCEPTION 'Informe a forma de pagamento.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_method FROM public.billing_payment_methods
  WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Forma de pagamento não encontrada.' USING ERRCODE='P0002';
  END IF;
  IF EXISTS(SELECT 1 FROM public.billing_purchase_orders o
   WHERE o.owner_id=v_owner AND o.payment_method_id=v_id) THEN
   RAISE EXCEPTION 'Esta forma de pagamento está vinculada a pedidos e não pode ser excluída.'
    USING ERRCODE='23514';
  END IF;
  DELETE FROM public.billing_payment_methods WHERE owner_id=v_owner AND id=v_id;
  RETURN jsonb_build_object('id',v_id,'deleted',true);
 END IF;
 IF jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'description') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Informe o nome e a descrição da forma de pagamento.' USING ERRCODE='22023';
 END IF;
 v_name=btrim(p_payload->>'name');
 v_description=btrim(p_payload->>'description');
 IF length(v_name) NOT BETWEEN 2 AND 100 OR length(v_description)>300 THEN
  RAISE EXCEPTION 'Confira o nome e a descrição da forma de pagamento.' USING ERRCODE='22023';
 END IF;
 IF v_id IS NULL THEN
  INSERT INTO public.billing_payment_methods(owner_id,name,description)
  VALUES(v_owner,v_name,v_description) RETURNING * INTO v_method;
 ELSE
  SELECT * INTO v_method FROM public.billing_payment_methods
  WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Forma de pagamento não encontrada.' USING ERRCODE='P0002';
  END IF;
  UPDATE public.billing_payment_methods SET name=v_name,description=v_description
  WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_method;
  -- Keep the commercial label shown by existing linked orders synchronized;
  -- all financial values and item snapshots remain immutable.
  UPDATE public.billing_purchase_orders SET payment_method=v_method.name
  WHERE owner_id=v_owner AND payment_method_id=v_method.id;
 END IF;
 RETURN jsonb_build_object('paymentMethod',billing_private.payment_method_json(v_method));
EXCEPTION
 WHEN unique_violation THEN
  RAISE EXCEPTION 'Já existe uma forma de pagamento com este nome.' USING ERRCODE='23505';
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Informe uma forma de pagamento válida.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.payment_methods_dispatch(text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.payment_methods_dispatch(text,jsonb)
 TO authenticated;

CREATE OR REPLACE FUNCTION billing_private.purchase_order_json(
 p_order public.billing_purchase_orders
) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p_order.id,'number',p_order.order_number,'status',p_order.status,
  'purchaseOrderNumber',p_order.purchase_order_number,
  'paymentMethodId',p_order.payment_method_id,
  'paymentMethod',coalesce(pm.name,p_order.payment_method),
  'payment',CASE WHEN pm.id IS NULL THEN NULL
   ELSE billing_private.payment_method_json(pm) END,
  'finishedAt',p_order.finished_at,
  'quotationId',p_order.quotation_id,'quotationNumber',p_order.quotation_number,
  'quotationTitle',p_order.quotation_title,
  'requestDate',p_order.quotation_request_date,
  'quotationRequestDate',p_order.quotation_request_date,
  'quotationRequester',p_order.quotation_requester,
  'quotationNotes',p_order.quotation_notes,
  'quotationProviderId',p_order.quotation_provider_id,
  'providerId',p_order.provider_id,
  'providerName',coalesce(p_order.provider_snapshot->>'legalName',''),
  'providerLegalName',coalesce(p_order.provider_snapshot->>'legalName',''),
  'providerTradeName',coalesce(p_order.provider_snapshot->>'tradeName',''),
  'providerDocumentType',coalesce(p_order.provider_snapshot->>'documentType',''),
  'providerDocument',coalesce(p_order.provider_snapshot->>'document',''),
  'providerEmail',coalesce(p_order.provider_snapshot->>'email',''),
  'providerPhone',coalesce(p_order.provider_snapshot->>'phone',''),
  'providerAddress',coalesce(p_order.provider_snapshot->>'address',''),
  'provider',p_order.provider_snapshot,
  'total',billing_private.decimal_text(p_order.total),
  'itemCount',(SELECT count(*)::integer
   FROM public.billing_purchase_order_items c
   WHERE c.owner_id=p_order.owner_id AND c.purchase_order_id=p_order.id),
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',i.id,'quotationItemId',i.quotation_item_id,
    'materialId',i.material_id,'materialName',i.material_name,
    'materialInternalCode',i.material_internal_code,
    'materialApplication',i.material_application,
    'materialReferences',i.material_references,
    'materialImageKey',i.material_image_key,
    'materialImageName',i.material_image_name,
    'quantity',billing_private.decimal_text(i.quantity),'unit',i.unit,
    'unitPrice',billing_private.decimal_text(i.unit_price),
    'lineTotal',billing_private.decimal_text(i.line_total),'notes',i.notes
   ) ORDER BY i.created_at,i.id)
   FROM public.billing_purchase_order_items i
   WHERE i.owner_id=p_order.owner_id AND i.purchase_order_id=p_order.id
  ),'[]'::jsonb),
  'createdAt',p_order.created_at,'updatedAt',p_order.updated_at
 )
 FROM (SELECT 1) present
 LEFT JOIN public.billing_payment_methods pm
  ON pm.owner_id=p_order.owner_id AND pm.id=p_order.payment_method_id
$$;
REVOKE ALL ON FUNCTION billing_private.purchase_order_json(
 public.billing_purchase_orders) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.purchase_orders_dispatch(
 p_action text,p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;
 v_order public.billing_purchase_orders;
 v_method public.billing_payment_methods;
 v_result jsonb;
 v_status text;
 v_search text;
 v_search_document text;
 v_date_from date;
 v_date_to date;
 v_purchase_order_number text;
 v_payment_method_id uuid;
 v_change_payment boolean:=false;
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
      o.provider_snapshot->>'tradeName',o.provider_snapshot->>'document')
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
   WHEN 'save' THEN ARRAY['id','purchaseOrderNumber','paymentMethodId','paymentMethod']
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

-- Add the registry route without disturbing the existing dispatcher chain.
ALTER FUNCTION billing_private.dispatch(text,text,jsonb)
 RENAME TO dispatch_before_payment_methods;
REVOKE ALL ON FUNCTION billing_private.dispatch_before_payment_methods(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.dispatch(
 p_resource text,p_action text,p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_resource='payment-methods' THEN
  RETURN billing_private.payment_methods_dispatch(p_action,p_payload);
 END IF;
 RETURN billing_private.dispatch_before_payment_methods(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION billing_private.dispatch(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.dispatch(text,text,jsonb) TO authenticated;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
  AND NOT EXISTS(SELECT 1 FROM pg_publication_tables
   WHERE pubname='supabase_realtime' AND schemaname='public'
    AND tablename='billing_payment_methods') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_payment_methods;
 END IF;
END $$;

COMMENT ON TABLE public.billing_payment_methods IS
 'Owner-scoped payment terms selected by purchase orders through billing_rpc.';
COMMENT ON COLUMN public.billing_purchase_orders.finished_at IS
 'Server timestamp recorded when an open purchase order is finalized.';
