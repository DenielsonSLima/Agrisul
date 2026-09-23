-- A quotation can award each requested item to a different selected provider.
-- Awards remain editable while the quotation is open and become the immutable
-- source used to split finalization into one purchase order per provider.
ALTER TABLE public.billing_quotation_negotiations
 ADD COLUMN request_id uuid;
UPDATE public.billing_quotation_negotiations SET request_id=id;
ALTER TABLE public.billing_quotation_negotiations
 ALTER COLUMN request_id SET DEFAULT gen_random_uuid(),
 ALTER COLUMN request_id SET NOT NULL,
 ADD CONSTRAINT billing_quotation_negotiations_owner_request_key
  UNIQUE(owner_id,request_id);

CREATE TABLE public.billing_quotation_item_awards (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 quotation_id uuid NOT NULL,
 quotation_item_id uuid NOT NULL,
 quotation_provider_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id),
 UNIQUE(owner_id,quotation_id,quotation_item_id),
 FOREIGN KEY(owner_id,quotation_id)
  REFERENCES public.billing_quotations(owner_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,quotation_id,quotation_provider_id)
  REFERENCES public.billing_quotation_providers(owner_id,quotation_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,quotation_id,quotation_item_id)
  REFERENCES public.billing_quotation_items(owner_id,quotation_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,quotation_id,quotation_provider_id,quotation_item_id)
  REFERENCES public.billing_quotation_provider_values(
   owner_id,quotation_id,quotation_provider_id,quotation_item_id
  ) ON DELETE CASCADE
);
CREATE INDEX billing_quotation_item_awards_provider
 ON public.billing_quotation_item_awards(
  owner_id,quotation_id,quotation_provider_id,quotation_item_id
 );
CREATE TRIGGER billing_touch_updated_at
 BEFORE UPDATE ON public.billing_quotation_item_awards
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();

ALTER TABLE public.billing_quotation_item_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_quotation_item_awards REPLICA IDENTITY FULL;
REVOKE ALL ON public.billing_quotation_item_awards FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_quotation_item_awards TO authenticated;
CREATE POLICY billing_quotation_item_awards_read
 ON public.billing_quotation_item_awards FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'registrations.read'));

-- The former result had exactly one order per quotation. Keep the old scalar
-- projection when there is only one provider, while allowing a split result.
ALTER TABLE public.billing_purchase_orders
 DROP CONSTRAINT billing_purchase_orders_owner_id_quotation_id_key,
 ADD CONSTRAINT billing_purchase_orders_owner_quote_provider_key
 UNIQUE(owner_id,quotation_id,quotation_provider_id);
ALTER TABLE public.billing_purchase_order_items
 ADD CONSTRAINT billing_purchase_order_items_owner_quote_item_key
 UNIQUE(owner_id,quotation_id,quotation_item_id);

-- Preserve already finalized quotations as one award per order item.
INSERT INTO public.billing_quotation_item_awards(
 owner_id,quotation_id,quotation_item_id,quotation_provider_id,created_at,updated_at
)
SELECT o.owner_id,o.quotation_id,oi.quotation_item_id,o.quotation_provider_id,
 o.created_at,o.created_at
FROM public.billing_purchase_orders o
JOIN public.billing_purchase_order_items oi
 ON oi.owner_id=o.owner_id AND oi.purchase_order_id=o.id
 AND oi.quotation_id=o.quotation_id
;

CREATE OR REPLACE FUNCTION billing_private.quotation_json(
 p_quote public.billing_quotations
) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 WITH item_count AS (
  SELECT count(*)::integer AS total
  FROM public.billing_quotation_items i
  WHERE i.owner_id=p_quote.owner_id AND i.quotation_id=p_quote.id
 ), award_count AS (
  SELECT count(*)::integer AS total
  FROM public.billing_quotation_item_awards a
  WHERE a.owner_id=p_quote.owner_id AND a.quotation_id=p_quote.id
 ), provider_stats AS (
  SELECT qp.*,
   (SELECT count(*)::integer
    FROM public.billing_quotation_provider_values qv
    WHERE qv.owner_id=qp.owner_id AND qv.quotation_id=qp.quotation_id
     AND qv.quotation_provider_id=qp.id) AS quoted_item_count,
   coalesce((SELECT sum(i.quantity*qv.unit_price)
    FROM public.billing_quotation_provider_values qv
    JOIN public.billing_quotation_items i ON i.owner_id=qv.owner_id
     AND i.quotation_id=qv.quotation_id AND i.id=qv.quotation_item_id
    WHERE qv.owner_id=qp.owner_id AND qv.quotation_id=qp.quotation_id
     AND qv.quotation_provider_id=qp.id),0::numeric) AS total,
   (SELECT count(*)::integer
    FROM public.billing_quotation_item_awards a
    WHERE a.owner_id=qp.owner_id AND a.quotation_id=qp.quotation_id
     AND a.quotation_provider_id=qp.id) AS awarded_item_count,
   coalesce((SELECT sum(i.quantity*qv.unit_price)
    FROM public.billing_quotation_item_awards a
    JOIN public.billing_quotation_items i ON i.owner_id=a.owner_id
     AND i.quotation_id=a.quotation_id AND i.id=a.quotation_item_id
    JOIN public.billing_quotation_provider_values qv ON qv.owner_id=a.owner_id
     AND qv.quotation_id=a.quotation_id
     AND qv.quotation_provider_id=a.quotation_provider_id
     AND qv.quotation_item_id=a.quotation_item_id
    WHERE a.owner_id=qp.owner_id AND a.quotation_id=qp.quotation_id
     AND a.quotation_provider_id=qp.id),0::numeric) AS awarded_total
  FROM public.billing_quotation_providers qp
  WHERE qp.owner_id=p_quote.owner_id AND qp.quotation_id=p_quote.id
 ), complete_minimum AS (
  SELECT min(ps.total) AS total FROM provider_stats ps CROSS JOIN item_count ic
  WHERE ic.total>0 AND ps.quoted_item_count=ic.total
 ), generated_orders AS (
  SELECT o.* FROM public.billing_purchase_orders o
  WHERE o.owner_id=p_quote.owner_id AND o.quotation_id=p_quote.id
 ), order_count AS (
  SELECT count(*)::integer AS total FROM generated_orders
 )
 SELECT jsonb_build_object(
  'id',p_quote.id,'title',p_quote.title,'number',p_quote.quotation_number,
  'requestDate',p_quote.request_date,'requester',p_quote.requester,
  'requesterSignatureId',p_quote.requester_signature_id,'notes',p_quote.notes,
  'status',p_quote.status,
  'purchaseOrderId',(SELECT CASE WHEN oc.total=1 THEN
    (SELECT o.id FROM generated_orders o ORDER BY o.created_at,o.id LIMIT 1)
   ELSE NULL END FROM order_count oc),
  'winnerProviderId',(SELECT CASE WHEN oc.total=1 THEN
    (SELECT o.quotation_provider_id FROM generated_orders o
     ORDER BY o.created_at,o.id LIMIT 1)
   ELSE NULL END FROM order_count oc),
  -- Quotation list/get projections only need navigation and aggregate order
  -- metadata. Keep immutable item snapshots behind the purchase-orders RPC so
  -- listing quotations never expands every generated order and order item.
  'purchaseOrders',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',o.id,'number',o.order_number,'status',o.status,
    'quotationProviderId',o.quotation_provider_id,'providerId',o.provider_id,
    'providerName',coalesce(o.provider_snapshot->>'legalName',''),
    'total',billing_private.decimal_text(o.total),'createdAt',o.created_at
   ) ORDER BY o.created_at,o.id) FROM generated_orders o),'[]'::jsonb),
  'awardedItemCount',(SELECT ac.total FROM award_count ac),
  'awardComplete',(SELECT ic.total>0 AND ac.total=ic.total
   FROM item_count ic CROSS JOIN award_count ac),
  'createdAt',p_quote.created_at,'updatedAt',p_quote.updated_at,
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',i.id,'materialId',i.material_id,'materialVariantId',i.material_variant_id,
   'materialName',i.material_name,'materialCode',i.material_code,
   'materialApplication',i.material_application,
   'materialReferences',i.material_references,
   'quantity',billing_private.decimal_text(i.quantity),
   'unit',i.unit,'notes',i.notes
  ) ORDER BY i.created_at,i.id)
   FROM public.billing_quotation_items i
   WHERE i.owner_id=p_quote.owner_id AND i.quotation_id=p_quote.id),'[]'::jsonb),
  'providers',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',qp.id,'providerId',qp.provider_id,
   'providerName',qp.provider_snapshot->>'legalName',
   'providerDocumentType',coalesce(qp.provider_snapshot->>'documentType',''),
   'providerDocument',coalesce(qp.provider_snapshot->>'document',''),
   'providerTradeName',coalesce(qp.provider_snapshot->>'tradeName',''),
   'providerEmail',coalesce(qp.provider_snapshot->>'email',''),
   'providerPhone',coalesce(qp.provider_snapshot->>'phone',''),
   'provider',qp.provider_snapshot,'notes',qp.notes,'sentAt',qp.sent_at,
   'values',coalesce((SELECT jsonb_object_agg(
    i.id::text,coalesce(billing_private.decimal_text(qv.unit_price),'')
    ORDER BY i.created_at,i.id)
    FROM public.billing_quotation_items i
    LEFT JOIN public.billing_quotation_provider_values qv
     ON qv.owner_id=i.owner_id AND qv.quotation_id=i.quotation_id
     AND qv.quotation_provider_id=qp.id AND qv.quotation_item_id=i.id
    WHERE i.owner_id=p_quote.owner_id AND i.quotation_id=p_quote.id),'{}'::jsonb),
   'quotedItemCount',qp.quoted_item_count,
   'isComplete',ic.total>0 AND qp.quoted_item_count=ic.total,
   'total',billing_private.decimal_text(qp.total),
   'awardedItemCount',qp.awarded_item_count,
   'awardedTotal',billing_private.decimal_text(qp.awarded_total)
  ) ORDER BY lower(coalesce(qp.provider_snapshot->>'legalName','')),qp.id)
   FROM provider_stats qp CROSS JOIN item_count ic),'[]'::jsonb),
  'negotiations',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',n.id,'requestId',n.request_id,'providerId',n.quotation_provider_id,
   'itemId',n.quotation_item_id,'version',n.revision,
   'unitPrice',billing_private.decimal_text(n.unit_price),
   'notes',n.notes,'createdAt',n.created_at
  ) ORDER BY n.created_at,n.quotation_provider_id,n.quotation_item_id,
    n.revision,n.id)
   FROM public.billing_quotation_negotiations n
   WHERE n.owner_id=p_quote.owner_id AND n.quotation_id=p_quote.id),'[]'::jsonb),
  'itemAwards',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'itemId',a.quotation_item_id,'providerId',a.quotation_provider_id,
   'unitPrice',billing_private.decimal_text(qv.unit_price),
   'lineTotal',billing_private.decimal_text(i.quantity*qv.unit_price),
   'awardedAt',a.created_at,'updatedAt',a.updated_at
  ) ORDER BY i.created_at,i.id)
   FROM public.billing_quotation_item_awards a
   JOIN public.billing_quotation_items i ON i.owner_id=a.owner_id
    AND i.quotation_id=a.quotation_id AND i.id=a.quotation_item_id
   JOIN public.billing_quotation_provider_values qv ON qv.owner_id=a.owner_id
    AND qv.quotation_id=a.quotation_id
    AND qv.quotation_provider_id=a.quotation_provider_id
    AND qv.quotation_item_id=a.quotation_item_id
   WHERE a.owner_id=p_quote.owner_id AND a.quotation_id=p_quote.id),'[]'::jsonb),
  'winningProviderIds',coalesce((SELECT jsonb_agg(qp.id ORDER BY lower(
   coalesce(qp.provider_snapshot->>'legalName','')),qp.id)
   FROM provider_stats qp CROSS JOIN item_count ic CROSS JOIN complete_minimum cm
   WHERE ic.total>0 AND qp.quoted_item_count=ic.total AND qp.total=cm.total),'[]'::jsonb)
 )
$$;
REVOKE ALL ON FUNCTION billing_private.quotation_json(public.billing_quotations)
 FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.create_purchase_orders_from_awards(
 p_owner uuid,p_quotation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
 v_quote public.billing_quotations;
 v_quote_provider public.billing_quotation_providers;
 v_order public.billing_purchase_orders;
 v_item_count integer;
 v_award_count integer;
 v_total numeric;
 v_number text;
 v_orders jsonb;
BEGIN
 IF auth.uid() IS NULL OR p_owner IS NULL
  OR p_owner IS DISTINCT FROM billing_private.current_owner_id() THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 SELECT * INTO v_quote FROM public.billing_quotations
 WHERE owner_id=p_owner AND id=p_quotation_id FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE='P0002';
 END IF;
 SELECT count(*)::integer INTO v_item_count
 FROM public.billing_quotation_items i
 WHERE i.owner_id=p_owner AND i.quotation_id=p_quotation_id;
 SELECT count(*)::integer INTO v_award_count
 FROM public.billing_quotation_item_awards a
 WHERE a.owner_id=p_owner AND a.quotation_id=p_quotation_id;
 IF v_item_count=0 OR v_award_count<>v_item_count THEN
  RAISE EXCEPTION 'Aprove um fornecedor com preço para cada material.'
   USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.billing_purchase_orders o
  WHERE o.owner_id=p_owner AND o.quotation_id=p_quotation_id) THEN
  RAISE EXCEPTION 'Esta cotação já possui pedidos gerados.' USING ERRCODE='23514';
 END IF;

 -- Allocate all order numbers under one short owner-scoped lock. The quote row
 -- lock above serializes retries for the same quotation.
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'billing-purchase-order:'||p_owner::text,0));
 FOR v_quote_provider IN
  SELECT qp.* FROM public.billing_quotation_providers qp
  WHERE qp.owner_id=p_owner AND qp.quotation_id=p_quotation_id
   AND EXISTS(SELECT 1 FROM public.billing_quotation_item_awards a
    WHERE a.owner_id=qp.owner_id AND a.quotation_id=qp.quotation_id
     AND a.quotation_provider_id=qp.id)
  ORDER BY lower(coalesce(qp.provider_snapshot->>'legalName','')),qp.id
 LOOP
  SELECT coalesce(sum(i.quantity*qv.unit_price),0::numeric) INTO v_total
  FROM public.billing_quotation_item_awards a
  JOIN public.billing_quotation_items i ON i.owner_id=a.owner_id
   AND i.quotation_id=a.quotation_id AND i.id=a.quotation_item_id
  JOIN public.billing_quotation_provider_values qv ON qv.owner_id=a.owner_id
   AND qv.quotation_id=a.quotation_id
   AND qv.quotation_provider_id=a.quotation_provider_id
   AND qv.quotation_item_id=a.quotation_item_id
  WHERE a.owner_id=p_owner AND a.quotation_id=p_quotation_id
   AND a.quotation_provider_id=v_quote_provider.id;
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
   i.material_id,i.material_name,i.material_code,i.material_application,
   i.material_references,i.quantity,i.unit,qv.unit_price,
   i.quantity*qv.unit_price,i.notes
  FROM public.billing_quotation_item_awards a
  JOIN public.billing_quotation_items i ON i.owner_id=a.owner_id
   AND i.quotation_id=a.quotation_id AND i.id=a.quotation_item_id
  JOIN public.billing_quotation_provider_values qv ON qv.owner_id=a.owner_id
   AND qv.quotation_id=a.quotation_id
   AND qv.quotation_provider_id=a.quotation_provider_id
   AND qv.quotation_item_id=a.quotation_item_id
  WHERE a.owner_id=p_owner AND a.quotation_id=p_quotation_id
   AND a.quotation_provider_id=v_quote_provider.id
  ORDER BY i.created_at,i.id;
 END LOOP;
 SELECT coalesce(jsonb_agg(billing_private.purchase_order_json(o)
  ORDER BY o.created_at,o.id),'[]'::jsonb) INTO v_orders
 FROM public.billing_purchase_orders o
 WHERE o.owner_id=p_owner AND o.quotation_id=p_quotation_id;
 RETURN v_orders;
END $$;
REVOKE ALL ON FUNCTION billing_private.create_purchase_orders_from_awards(uuid,uuid)
 FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 RENAME TO quotations_dispatch_before_item_awards;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch_before_item_awards(
 text,text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotations_dispatch(
 p_resource text,p_action text,p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;
 v_item_id uuid;
 v_quote_provider_id uuid;
 v_registry_provider_id uuid;
 v_item_json jsonb;
 v_provider_json jsonb;
 v_quote public.billing_quotations;
 v_item public.billing_quotation_items;
 v_existing_item public.billing_quotation_items;
 v_material public.billing_materials;
 v_quote_provider public.billing_quotation_providers;
 v_existing_provider public.billing_quotation_providers;
 v_registry_provider public.billing_service_providers;
 v_quantity numeric;
 v_notes text;
 v_sent_at timestamptz;
 v_variant_id uuid;
 v_references jsonb;
 v_item_count integer;
 v_award_count integer;
 v_value_count integer;
 v_revision integer;
 v_affected integer;
 v_request_id uuid;
 v_price numeric;
 v_orders jsonb;
 v_result jsonb;
 v_negotiation public.billing_quotation_negotiations;
 v_changed boolean:=false;
BEGIN
 -- A decision approves the provider at its current negotiated price. Recording
 -- another price for that same provider/item clears the decision and requires
 -- an explicit reapproval, while the append-only price history is preserved.
 IF p_resource='quotations' AND p_action='record-negotiation' THEN
  IF v_owner IS NULL OR auth.uid() IS NULL THEN
   RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
   RAISE EXCEPTION 'Dados da negociação inválidos.' USING ERRCODE='22023';
  END IF;
  PERFORM billing_private.lock_request_actor();
  v_owner=billing_private.current_owner_id();
  PERFORM billing_private.authorize('registrations.write');
  PERFORM billing_private.request_payload(p_payload,
   ARRAY['id','quotationProviderId','quotationItemId','unitPrice','notes','requestId']);
  IF jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_payload->'quotationProviderId') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_payload->'quotationItemId') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_payload->'unitPrice') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_payload->'notes') IS DISTINCT FROM 'string'
   OR (p_payload ? 'requestId'
    AND jsonb_typeof(p_payload->'requestId') IS DISTINCT FROM 'string')
   OR length(p_payload->>'notes')>2000 THEN
   RAISE EXCEPTION 'Confira o fornecedor, o material, o valor e a observação.'
    USING ERRCODE='22023';
  END IF;
  v_id=nullif(p_payload->>'id','')::uuid;
  v_quote_provider_id=nullif(p_payload->>'quotationProviderId','')::uuid;
  v_item_id=nullif(p_payload->>'quotationItemId','')::uuid;
  v_request_id=CASE WHEN p_payload ? 'requestId'
   THEN nullif(btrim(p_payload->>'requestId'),'')::uuid ELSE NULL END;
  IF v_id IS NULL OR v_quote_provider_id IS NULL OR v_item_id IS NULL
   OR nullif(btrim(p_payload->>'unitPrice'),'') IS NULL
   OR (p_payload ? 'requestId' AND v_request_id IS NULL) THEN
   RAISE EXCEPTION 'Informe a cotação, o fornecedor, o material, o valor e a requisição.'
    USING ERRCODE='22023';
  END IF;
  v_price=replace(btrim(p_payload->>'unitPrice'),',','.')::numeric;
  IF v_price<0 OR v_price>=1000000000000 OR v_price<>round(v_price,2) THEN
   RAISE EXCEPTION 'Informe um valor com até duas casas decimais.' USING ERRCODE='22023';
  END IF;
  v_notes=btrim(p_payload->>'notes');
  SELECT * INTO v_quote FROM public.billing_quotations
  WHERE owner_id=v_owner AND id=v_id FOR SHARE;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE='P0002';
  END IF;

  -- Use the same lock key/order as the legacy revision writer. This makes an
  -- exact retry observe a stable current value even if another request for the
  -- same provider/item is concurrently recording the next revision.
  PERFORM pg_advisory_xact_lock(hashtextextended(
   'billing-quotation-negotiation:'||v_owner::text||':'||v_id::text||':'
    ||v_quote_provider_id::text||':'||v_item_id::text,0));
  IF v_request_id IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(
    'billing-quotation-negotiation-request:'||v_owner::text||':'||v_request_id::text,0));
   SELECT * INTO v_negotiation
   FROM public.billing_quotation_negotiations n
   WHERE n.owner_id=v_owner AND n.request_id=v_request_id FOR UPDATE;
   IF FOUND THEN
    IF v_negotiation.quotation_id IS DISTINCT FROM v_id
     OR v_negotiation.quotation_provider_id IS DISTINCT FROM v_quote_provider_id
     OR v_negotiation.quotation_item_id IS DISTINCT FROM v_item_id
     OR v_negotiation.unit_price IS DISTINCT FROM v_price
     OR v_negotiation.notes IS DISTINCT FROM v_notes THEN
     RAISE EXCEPTION 'A requisição da negociação já foi usada com outros dados.'
      USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote));
   END IF;
  END IF;

  IF v_quote.status<>'open' THEN
   RAISE EXCEPTION 'Reabra a cotação antes de negociar valores.' USING ERRCODE='23514';
  END IF;
  v_result=billing_private.quotations_dispatch_before_item_awards(
    p_resource,p_action,p_payload-'requestId');
   IF v_request_id IS NOT NULL THEN
    UPDATE public.billing_quotation_negotiations n SET request_id=v_request_id
    WHERE n.owner_id=v_owner AND n.quotation_id=v_id
     AND n.quotation_provider_id=v_quote_provider_id
     AND n.quotation_item_id=v_item_id
     AND n.revision=(SELECT max(latest.revision)
      FROM public.billing_quotation_negotiations latest
      WHERE latest.owner_id=v_owner AND latest.quotation_id=v_id
       AND latest.quotation_provider_id=v_quote_provider_id
       AND latest.quotation_item_id=v_item_id)
    RETURNING n.revision INTO v_revision;
    IF NOT FOUND THEN
     RAISE EXCEPTION 'A negociação não foi registrada.' USING ERRCODE='P0001';
    END IF;
   END IF;
  DELETE FROM public.billing_quotation_item_awards a
  WHERE a.owner_id=v_owner AND a.quotation_id=v_id
   AND a.quotation_item_id=v_item_id
   AND a.quotation_provider_id=v_quote_provider_id;
  SELECT * INTO v_quote FROM public.billing_quotations
  WHERE owner_id=v_owner AND id=v_id;
  RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote));
 END IF;
 IF p_resource<>'quotations' OR p_action NOT IN (
  'award-item','add-items','add-providers','finalize'
 ) THEN
  RETURN billing_private.quotations_dispatch_before_item_awards(
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
 PERFORM billing_private.request_payload(p_payload,
  CASE p_action
   WHEN 'award-item' THEN
    ARRAY['id','quotationItemId','quotationProviderId']
   WHEN 'add-items' THEN ARRAY['id','items']
   WHEN 'add-providers' THEN ARRAY['id','providers']
   ELSE ARRAY['id','winnerProviderId']
  END);
 IF jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Informe a cotação.' USING ERRCODE='22023';
 END IF;
 v_id=nullif(p_payload->>'id','')::uuid;
 IF v_id IS NULL THEN
  RAISE EXCEPTION 'Informe a cotação.' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_quote FROM public.billing_quotations
 WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE='P0002';
 END IF;

 IF p_action='finalize' THEN
  IF p_payload ? 'winnerProviderId'
   AND jsonb_typeof(p_payload->'winnerProviderId') NOT IN ('string','null') THEN
   RAISE EXCEPTION 'Selecione fornecedores válidos.' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(jsonb_agg(billing_private.purchase_order_json(o)
   ORDER BY o.created_at,o.id),'[]'::jsonb) INTO v_orders
  FROM public.billing_purchase_orders o
  WHERE o.owner_id=v_owner AND o.quotation_id=v_id;
  IF v_quote.status='finished' THEN
   IF jsonb_array_length(v_orders)=0 THEN
    RAISE EXCEPTION 'Esta cotação foi finalizada sem pedidos vinculados.'
     USING ERRCODE='23514';
   END IF;
   IF jsonb_typeof(p_payload->'winnerProviderId')='string'
    AND nullif(p_payload->>'winnerProviderId','') IS NOT NULL
    AND (jsonb_array_length(v_orders)<>1
     OR v_orders->0->>'quotationProviderId'<>p_payload->>'winnerProviderId') THEN
    RAISE EXCEPTION 'Esta cotação já foi finalizada com outra adjudicação.'
     USING ERRCODE='23514';
   END IF;
   RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote),
    'purchaseOrders',v_orders,
    'purchaseOrder',CASE WHEN jsonb_array_length(v_orders)=1
     THEN v_orders->0 ELSE 'null'::jsonb END);
  END IF;
  SELECT count(*)::integer INTO v_item_count
  FROM public.billing_quotation_items i
  WHERE i.owner_id=v_owner AND i.quotation_id=v_id;
  SELECT count(*)::integer INTO v_award_count
  FROM public.billing_quotation_item_awards a
  WHERE a.owner_id=v_owner AND a.quotation_id=v_id;

  -- Backward compatibility for a cached single-winner client. It is accepted
  -- only before any per-item decision and converted into explicit awards.
  IF v_award_count=0 AND jsonb_typeof(p_payload->'winnerProviderId')='string'
   AND nullif(p_payload->>'winnerProviderId','') IS NOT NULL THEN
   v_quote_provider_id=(p_payload->>'winnerProviderId')::uuid;
   PERFORM 1 FROM public.billing_quotation_providers qp
   WHERE qp.owner_id=v_owner AND qp.quotation_id=v_id
    AND qp.id=v_quote_provider_id FOR SHARE;
   IF NOT FOUND THEN
    RAISE EXCEPTION 'Selecione um fornecedor desta cotação.' USING ERRCODE='23514';
   END IF;
   SELECT count(*)::integer INTO v_value_count
   FROM public.billing_quotation_provider_values qv
   WHERE qv.owner_id=v_owner AND qv.quotation_id=v_id
    AND qv.quotation_provider_id=v_quote_provider_id;
   IF v_item_count=0 OR v_value_count<>v_item_count THEN
    RAISE EXCEPTION 'O fornecedor escolhido precisa ter valor em todos os materiais.'
     USING ERRCODE='23514';
   END IF;
   INSERT INTO public.billing_quotation_item_awards(
    owner_id,quotation_id,quotation_item_id,quotation_provider_id
   ) SELECT v_owner,v_id,i.id,v_quote_provider_id
   FROM public.billing_quotation_items i
   WHERE i.owner_id=v_owner AND i.quotation_id=v_id
   ORDER BY i.created_at,i.id;
   v_award_count=v_item_count;
  ELSIF jsonb_typeof(p_payload->'winnerProviderId')='string'
   AND nullif(p_payload->>'winnerProviderId','') IS NOT NULL
   AND EXISTS(SELECT 1 FROM public.billing_quotation_item_awards a
    WHERE a.owner_id=v_owner AND a.quotation_id=v_id
     AND a.quotation_provider_id<>(p_payload->>'winnerProviderId')::uuid) THEN
   RAISE EXCEPTION 'As aprovações por material não correspondem ao fornecedor informado.'
    USING ERRCODE='23514';
  END IF;
  IF v_item_count=0 OR v_award_count<>v_item_count THEN
   RAISE EXCEPTION 'Aprove um fornecedor com preço para cada material antes de finalizar.'
    USING ERRCODE='23514';
  END IF;
  v_orders=billing_private.create_purchase_orders_from_awards(v_owner,v_id);
  UPDATE public.billing_quotations SET status='finished'
  WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_quote;
  RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote),
   'purchaseOrders',v_orders,
   'purchaseOrder',CASE WHEN jsonb_array_length(v_orders)=1
    THEN v_orders->0 ELSE 'null'::jsonb END);
 END IF;

 IF v_quote.status<>'open' THEN
  RAISE EXCEPTION 'A cotação precisa estar em aberto para alterar o escopo.'
   USING ERRCODE='23514';
 END IF;
 IF p_action='award-item' THEN
  IF jsonb_typeof(p_payload->'quotationItemId') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_payload->'quotationProviderId') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Selecione o material e o fornecedor aprovado.' USING ERRCODE='22023';
  END IF;
  v_item_id=nullif(p_payload->>'quotationItemId','')::uuid;
  v_quote_provider_id=nullif(p_payload->>'quotationProviderId','')::uuid;
  IF v_item_id IS NULL OR v_quote_provider_id IS NULL THEN
   RAISE EXCEPTION 'Selecione o material e o fornecedor aprovado.' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.billing_quotation_provider_values qv
  WHERE qv.owner_id=v_owner AND qv.quotation_id=v_id
   AND qv.quotation_provider_id=v_quote_provider_id
   AND qv.quotation_item_id=v_item_id FOR SHARE;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Informe o preço deste fornecedor antes de aprovar o material.'
    USING ERRCODE='23514';
  END IF;
  INSERT INTO public.billing_quotation_item_awards(
   owner_id,quotation_id,quotation_item_id,quotation_provider_id
  ) VALUES(v_owner,v_id,v_item_id,v_quote_provider_id)
  ON CONFLICT(owner_id,quotation_id,quotation_item_id) DO UPDATE SET
   quotation_provider_id=excluded.quotation_provider_id,
   updated_at=now()
  WHERE billing_quotation_item_awards.quotation_provider_id
   IS DISTINCT FROM excluded.quotation_provider_id;
  GET DIAGNOSTICS v_affected=ROW_COUNT;
  IF v_affected>0 THEN
   UPDATE public.billing_quotations SET updated_at=now()
   WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_quote;
  END IF;
  RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote));
 END IF;

 IF p_action='add-items' THEN
  IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array'
   OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 100 THEN
   RAISE EXCEPTION 'Adicione de um a cem materiais por vez.' USING ERRCODE='22023';
  END IF;
  FOR v_item_json IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
   IF jsonb_typeof(v_item_json)<>'object' THEN
    RAISE EXCEPTION 'Confira os materiais adicionados.' USING ERRCODE='22023';
   END IF;
   PERFORM billing_private.request_payload(v_item_json,
    ARRAY['id','materialId','quantity','notes']);
   IF jsonb_typeof(v_item_json->'id') IS DISTINCT FROM 'string'
    OR jsonb_typeof(v_item_json->'materialId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(v_item_json->'quantity') IS DISTINCT FROM 'string'
    OR jsonb_typeof(v_item_json->'notes') IS DISTINCT FROM 'string'
    OR length(v_item_json->>'notes')>1000 THEN
    RAISE EXCEPTION 'Confira o material, a quantidade e a observação.' USING ERRCODE='22023';
   END IF;
   v_item_id=nullif(v_item_json->>'id','')::uuid;
   IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'O novo item precisa de um identificador.' USING ERRCODE='22023';
   END IF;
   v_quantity=replace(btrim(v_item_json->>'quantity'),',','.')::numeric;
   IF v_quantity<=0 OR v_quantity>=1000000000000
    OR v_quantity<>round(v_quantity,3) THEN
    RAISE EXCEPTION 'Informe uma quantidade com até três casas decimais.' USING ERRCODE='22023';
   END IF;
   v_notes=btrim(v_item_json->>'notes');
   SELECT * INTO v_existing_item FROM public.billing_quotation_items
   WHERE owner_id=v_owner AND quotation_id=v_id AND id=v_item_id FOR UPDATE;
   IF FOUND THEN
    IF v_existing_item.owner_id IS DISTINCT FROM v_owner
     OR v_existing_item.quotation_id IS DISTINCT FROM v_id
     OR v_existing_item.material_id IS DISTINCT FROM
      nullif(v_item_json->>'materialId','')::uuid
     OR v_existing_item.quantity IS DISTINCT FROM v_quantity
     OR v_existing_item.notes IS DISTINCT FROM v_notes THEN
     RAISE EXCEPTION 'O identificador do item já está em uso.' USING ERRCODE='23505';
    END IF;
    CONTINUE;
   END IF;
   IF (SELECT count(*) FROM public.billing_quotation_items i
    WHERE i.owner_id=v_owner AND i.quotation_id=v_id)>=100 THEN
    RAISE EXCEPTION 'A cotação aceita até cem materiais.' USING ERRCODE='23514';
   END IF;
   SELECT * INTO v_material FROM public.billing_materials
   WHERE owner_id=v_owner AND id=nullif(v_item_json->>'materialId','')::uuid
   FOR SHARE;
   IF NOT FOUND THEN
    RAISE EXCEPTION 'Selecione materiais cadastrados neste espaço.' USING ERRCODE='23514';
   END IF;
   SELECT mv.id INTO v_variant_id FROM public.billing_material_variants mv
   WHERE mv.owner_id=v_owner AND mv.material_id=v_material.id
   ORDER BY mv.created_at,mv.id LIMIT 1;
   SELECT coalesce(jsonb_agg(jsonb_build_object(
    'brand',mv.brand,'code',mv.code) ORDER BY lower(mv.brand),lower(mv.code),mv.id),
    '[]'::jsonb) INTO v_references
   FROM public.billing_material_variants mv
   WHERE mv.owner_id=v_owner AND mv.material_id=v_material.id;
    BEGIN
     INSERT INTO public.billing_quotation_items(
      id,owner_id,quotation_id,material_id,material_variant_id,
      material_name,material_code,material_application,material_references,
      quantity,unit,unit_price,supplier,notes
     ) VALUES(
      v_item_id,v_owner,v_id,v_material.id,v_variant_id,
      v_material.name,coalesce(v_material.code,''),coalesce(v_material.application,''),
      v_references,v_quantity,v_material.unit,NULL,'',v_notes
     );
    EXCEPTION WHEN unique_violation THEN
     -- UUIDs are globally unique primary keys. Do not expose whether a client
     -- supplied id belongs to another workspace through constraint details.
     RAISE EXCEPTION 'Não foi possível adicionar o item com este identificador.'
      USING ERRCODE='23505';
    END;
   v_changed=true;
  END LOOP;
  IF v_changed THEN
   UPDATE public.billing_quotations SET updated_at=now()
   WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_quote;
  END IF;
  RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote));
 END IF;

 IF jsonb_typeof(p_payload->'providers') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_payload->'providers') NOT BETWEEN 1 AND 50 THEN
  RAISE EXCEPTION 'Adicione de um a cinquenta fornecedores por vez.' USING ERRCODE='22023';
 END IF;
 FOR v_provider_json IN SELECT value FROM jsonb_array_elements(p_payload->'providers') LOOP
  IF jsonb_typeof(v_provider_json)<>'object' THEN
   RAISE EXCEPTION 'Confira os fornecedores adicionados.' USING ERRCODE='22023';
  END IF;
  PERFORM billing_private.request_payload(v_provider_json,
   ARRAY['id','providerId','notes','sentAt']);
  IF jsonb_typeof(v_provider_json->'id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(v_provider_json->'providerId') IS DISTINCT FROM 'string'
   OR jsonb_typeof(v_provider_json->'notes') IS DISTINCT FROM 'string'
   OR (v_provider_json ? 'sentAt'
    AND jsonb_typeof(v_provider_json->'sentAt') NOT IN ('string','null'))
   OR length(v_provider_json->>'notes')>2000 THEN
   RAISE EXCEPTION 'Confira o fornecedor e a observação.' USING ERRCODE='22023';
  END IF;
  v_quote_provider_id=nullif(v_provider_json->>'id','')::uuid;
  v_registry_provider_id=nullif(v_provider_json->>'providerId','')::uuid;
  v_notes=btrim(v_provider_json->>'notes');
  v_sent_at=CASE WHEN jsonb_typeof(v_provider_json->'sentAt')='string'
    AND nullif(btrim(v_provider_json->>'sentAt'),'') IS NOT NULL
   THEN (v_provider_json->>'sentAt')::timestamptz ELSE NULL END;
  IF v_quote_provider_id IS NULL OR v_registry_provider_id IS NULL THEN
   RAISE EXCEPTION 'O novo fornecedor precisa de identificadores válidos.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_existing_provider FROM public.billing_quotation_providers
  WHERE owner_id=v_owner AND quotation_id=v_id AND id=v_quote_provider_id FOR UPDATE;
  IF FOUND THEN
   IF v_existing_provider.owner_id IS DISTINCT FROM v_owner
    OR v_existing_provider.quotation_id IS DISTINCT FROM v_id
    OR v_existing_provider.provider_id IS DISTINCT FROM v_registry_provider_id
    OR v_existing_provider.notes IS DISTINCT FROM v_notes
    OR v_existing_provider.sent_at IS DISTINCT FROM v_sent_at THEN
    RAISE EXCEPTION 'O identificador do fornecedor já está em uso.' USING ERRCODE='23505';
   END IF;
   CONTINUE;
  END IF;
  IF EXISTS(SELECT 1 FROM public.billing_quotation_providers qp
   WHERE qp.owner_id=v_owner AND qp.quotation_id=v_id
    AND qp.provider_id=v_registry_provider_id) THEN
   RAISE EXCEPTION 'Este fornecedor já participa da cotação.' USING ERRCODE='23505';
  END IF;
  IF (SELECT count(*) FROM public.billing_quotation_providers qp
   WHERE qp.owner_id=v_owner AND qp.quotation_id=v_id)>=50 THEN
   RAISE EXCEPTION 'A cotação aceita até cinquenta fornecedores.' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_registry_provider FROM public.billing_service_providers
  WHERE owner_id=v_owner AND id=v_registry_provider_id FOR SHARE;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Selecione fornecedores cadastrados neste espaço.' USING ERRCODE='23514';
  END IF;
   BEGIN
    INSERT INTO public.billing_quotation_providers(
     id,owner_id,quotation_id,provider_id,provider_snapshot,notes,sent_at
    ) VALUES(
     v_quote_provider_id,v_owner,v_id,v_registry_provider_id,
     billing_private.provider_json(v_registry_provider),v_notes,v_sent_at
    );
   EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Não foi possível adicionar o fornecedor com este identificador.'
     USING ERRCODE='23505';
   END;
  v_changed=true;
 END LOOP;
 IF v_changed THEN
  UPDATE public.billing_quotations SET updated_at=now()
  WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_quote;
 END IF;
 RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote));
EXCEPTION
 WHEN invalid_text_representation OR numeric_value_out_of_range
  OR invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Informe identificadores, quantidades e datas válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 TO authenticated;

DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
  AND NOT EXISTS(
   SELECT 1 FROM pg_publication_tables
   WHERE pubname='supabase_realtime' AND schemaname='public'
    AND tablename='billing_quotation_item_awards'
  ) THEN
  ALTER PUBLICATION supabase_realtime
   ADD TABLE public.billing_quotation_item_awards;
 END IF;
END $$;

COMMENT ON TABLE public.billing_quotation_item_awards IS
 'One approved quotation provider per requested item; recording another price for the approved provider/item invalidates the decision until explicit reapproval.';
COMMENT ON COLUMN public.billing_quotation_negotiations.request_id IS
 'Client operation UUID: an exact retry returns the existing revision; reuse with another payload is rejected.';
COMMENT ON FUNCTION billing_private.create_purchase_orders_from_awards(uuid,uuid) IS
 'Atomically creates one immutable purchase order per awarded provider with only that provider selected items.';
COMMENT ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb) IS
 'Owner-scoped quotation aggregate with idempotent scope additions, per-item awards, negotiation history and split purchase-order finalization.';
