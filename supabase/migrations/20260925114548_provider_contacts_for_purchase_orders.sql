-- Named contacts belong to a provider and can be snapshotted on a purchase
-- order. Soft deletion keeps historical foreign keys and document evidence
-- intact while hiding removed contacts from future selections.
CREATE TABLE public.billing_service_provider_contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 provider_id uuid NOT NULL,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 120),
 phone text NOT NULL CHECK(length(btrim(phone)) BETWEEN 3 AND 40),
 deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id),
 UNIQUE(owner_id,provider_id,id),
 CONSTRAINT billing_provider_contacts_provider_fk
  FOREIGN KEY(owner_id,provider_id)
  REFERENCES public.billing_service_providers(owner_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX billing_provider_contacts_active_identity
 ON public.billing_service_provider_contacts(
  owner_id,provider_id,lower(name),regexp_replace(phone,'[^0-9]','','g')
 ) WHERE deleted_at IS NULL;
CREATE INDEX billing_provider_contacts_provider
 ON public.billing_service_provider_contacts(owner_id,provider_id,lower(name),id)
 WHERE deleted_at IS NULL;
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE
 ON public.billing_service_provider_contacts FOR EACH ROW
 EXECUTE FUNCTION billing_private.touch_updated_at();

ALTER TABLE public.billing_service_provider_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_service_provider_contacts REPLICA IDENTITY FULL;
REVOKE ALL ON public.billing_service_provider_contacts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_service_provider_contacts TO authenticated;
CREATE POLICY billing_provider_contacts_read
 ON public.billing_service_provider_contacts FOR SELECT TO authenticated
 USING(
  billing_private.can_access_owner(owner_id,'registrations.read')
  OR billing_private.can_access_owner(owner_id,'requests.read')
 );

CREATE FUNCTION billing_private.provider_contact_json(
 p_contact public.billing_service_provider_contacts
) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p_contact.id,'providerId',p_contact.provider_id,
  'name',p_contact.name,'phone',p_contact.phone,
  'createdAt',p_contact.created_at,'updatedAt',p_contact.updated_at
 )
$$;
REVOKE ALL ON FUNCTION billing_private.provider_contact_json(
 public.billing_service_provider_contacts) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.service_providers_dispatch(text,jsonb)
 RENAME TO service_providers_dispatch_before_contacts;
REVOKE ALL ON FUNCTION billing_private.service_providers_dispatch_before_contacts(text,jsonb)
 FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.service_providers_dispatch(
 p_action text,p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_result jsonb;
 v_provider_id uuid;
 v_id uuid;
 v_contact public.billing_service_provider_contacts;
 v_contacts jsonb;
 v_name text;
 v_phone text;
BEGIN
 IF v_owner IS NULL OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar os prestadores.' USING ERRCODE='28000';
 END IF;
 IF p_action NOT IN ('save-contact','delete-contact') THEN
  v_result=billing_private.service_providers_dispatch_before_contacts(p_action,p_payload);
  IF p_action='get' THEN
   v_provider_id=(v_result->'provider'->>'id')::uuid;
   SELECT coalesce(jsonb_agg(billing_private.provider_contact_json(c)
    ORDER BY lower(c.name),c.id),'[]'::jsonb) INTO v_contacts
   FROM public.billing_service_provider_contacts c
   WHERE c.owner_id=v_owner AND c.provider_id=v_provider_id AND c.deleted_at IS NULL;
   v_result=v_result||jsonb_build_object('contacts',v_contacts);
  END IF;
  RETURN v_result;
 END IF;

 PERFORM billing_private.lock_request_actor();
 v_owner=billing_private.current_owner_id();
 PERFORM billing_private.authorize('registrations.write');
 IF p_action='delete-contact' THEN
  PERFORM billing_private.request_payload(p_payload,ARRAY['id']);
  IF jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Informe o contato.' USING ERRCODE='22023';
  END IF;
  v_id=nullif(p_payload->>'id','')::uuid;
  UPDATE public.billing_service_provider_contacts
   SET deleted_at=now()
  WHERE owner_id=v_owner AND id=v_id AND deleted_at IS NULL
  RETURNING * INTO v_contact;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Contato não encontrado.' USING ERRCODE='P0002';
  END IF;
  RETURN jsonb_build_object('contact',billing_private.provider_contact_json(v_contact));
 END IF;

 PERFORM billing_private.request_payload(p_payload,
  ARRAY['id','providerId','name','phone']);
 IF jsonb_typeof(p_payload->'providerId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'phone') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Preencha o nome e o telefone do contato.' USING ERRCODE='22023';
 END IF;
 v_id=nullif(p_payload->>'id','')::uuid;
 v_provider_id=nullif(p_payload->>'providerId','')::uuid;
 v_name=btrim(p_payload->>'name');
 v_phone=btrim(p_payload->>'phone');
 IF v_provider_id IS NULL OR length(v_name) NOT BETWEEN 2 AND 120
  OR length(v_phone) NOT BETWEEN 3 AND 40 THEN
  RAISE EXCEPTION 'Preencha o nome e o telefone do contato.' USING ERRCODE='22023';
 END IF;
 PERFORM 1 FROM public.billing_service_providers p
 WHERE p.owner_id=v_owner AND p.id=v_provider_id FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Prestador não encontrado.' USING ERRCODE='P0002';
 END IF;
 IF v_id IS NOT NULL THEN
  SELECT * INTO v_contact FROM public.billing_service_provider_contacts
  WHERE owner_id=v_owner AND provider_id=v_provider_id AND id=v_id
   AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contato não encontrado.' USING ERRCODE='P0002'; END IF;
  UPDATE public.billing_service_provider_contacts SET name=v_name,phone=v_phone
  WHERE owner_id=v_owner AND provider_id=v_provider_id AND id=v_id
  RETURNING * INTO v_contact;
 ELSE
  INSERT INTO public.billing_service_provider_contacts(owner_id,provider_id,name,phone)
  VALUES(v_owner,v_provider_id,v_name,v_phone) RETURNING * INTO v_contact;
 END IF;
 RETURN jsonb_build_object('contact',billing_private.provider_contact_json(v_contact));
EXCEPTION
 WHEN unique_violation THEN
  RAISE EXCEPTION 'Este contato já está cadastrado para o prestador.' USING ERRCODE='23505';
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Confira o contato informado.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.service_providers_dispatch(text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.service_providers_dispatch(text,jsonb)
 TO authenticated;

ALTER TABLE public.billing_purchase_orders
 ADD COLUMN provider_contact_id uuid,
 ADD COLUMN provider_contact_snapshot jsonb,
 ADD CONSTRAINT billing_purchase_orders_provider_contact_fk
  FOREIGN KEY(owner_id,provider_id,provider_contact_id)
  REFERENCES public.billing_service_provider_contacts(owner_id,provider_id,id),
 ADD CONSTRAINT billing_purchase_orders_provider_contact_snapshot_check CHECK(
  (provider_contact_id IS NULL AND provider_contact_snapshot IS NULL)
  OR (provider_contact_id IS NOT NULL
   AND jsonb_typeof(provider_contact_snapshot)='object'
   AND provider_contact_snapshot->>'id'=provider_contact_id::text
   AND provider_contact_snapshot->>'providerId'=provider_id::text
   AND length(btrim(provider_contact_snapshot->>'name')) BETWEEN 2 AND 120
   AND length(btrim(provider_contact_snapshot->>'phone')) BETWEEN 3 AND 40)
 );
CREATE INDEX billing_purchase_orders_provider_contact
 ON public.billing_purchase_orders(owner_id,provider_id,provider_contact_id)
 WHERE provider_contact_id IS NOT NULL;

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
  'providerContactId',p_order.provider_contact_id,
  'providerContactName',coalesce(p_order.provider_contact_snapshot->>'name',''),
  'providerContactPhone',coalesce(p_order.provider_contact_snapshot->>'phone',''),
  'providerContact',p_order.provider_contact_snapshot,
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
  IF v_order.purchase_order_number<>'' AND v_order.provider_contact_id IS NULL THEN
   RAISE EXCEPTION 'Selecione e salve o contato responsável pela ordem de compra.'
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
 IF v_purchase_order_number<>'' AND v_provider_contact_id IS NULL THEN
  RAISE EXCEPTION 'Selecione o contato responsável pela ordem de compra.' USING ERRCODE='23514';
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

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
  AND NOT EXISTS(SELECT 1 FROM pg_publication_tables
   WHERE pubname='supabase_realtime' AND schemaname='public'
    AND tablename='billing_service_provider_contacts') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_service_provider_contacts;
 END IF;
END $$;

COMMENT ON TABLE public.billing_service_provider_contacts IS
 'Owner-scoped named contacts selectable on purchase orders through billing_rpc.';
COMMENT ON COLUMN public.billing_purchase_orders.provider_contact_snapshot IS
 'Immutable name and phone captured when the responsible provider contact is selected.';
