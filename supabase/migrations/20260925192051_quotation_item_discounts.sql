-- Keep the supplier's gross unit price while recording a versioned discount
-- for each quotation item. All monetary results are calculated in Postgres and
-- the immutable purchase-order snapshot keeps the exact commercial decision.
ALTER TABLE public.billing_quotation_provider_values
 ADD COLUMN discount_type text NOT NULL DEFAULT 'none',
 ADD COLUMN discount_value numeric(15,4) NOT NULL DEFAULT 0,
 ADD CONSTRAINT billing_quotation_provider_values_discount_check CHECK(
  discount_type IN ('none','percentage','amount')
  AND discount_value>=0 AND discount_value<100000000000
  AND (
   (discount_type='none' AND discount_value=0)
   OR (discount_type='percentage' AND discount_value<=100)
   OR (discount_type='amount' AND discount_value=round(discount_value,2))
  )
 );

ALTER TABLE public.billing_quotation_negotiations
 ADD COLUMN discount_type text NOT NULL DEFAULT 'none',
 ADD COLUMN discount_value numeric(15,4) NOT NULL DEFAULT 0,
 ADD CONSTRAINT billing_quotation_negotiations_discount_check CHECK(
  discount_type IN ('none','percentage','amount')
  AND discount_value>=0 AND discount_value<100000000000
  AND (
   (discount_type='none' AND discount_value=0)
   OR (discount_type='percentage' AND discount_value<=100)
   OR (discount_type='amount' AND discount_value=round(discount_value,2))
  )
 );

CREATE FUNCTION billing_private.quotation_discount_amount(
 p_quantity numeric,p_unit_price numeric,p_discount_type text,p_discount_value numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path='' AS $$
 SELECT CASE p_discount_type
  WHEN 'percentage' THEN round((p_quantity*p_unit_price)*p_discount_value/100,2)
  WHEN 'amount' THEN p_discount_value
  ELSE 0::numeric
 END
$$;
REVOKE ALL ON FUNCTION billing_private.quotation_discount_amount(
 numeric,numeric,text,numeric
) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotation_line_total(
 p_quantity numeric,p_unit_price numeric,p_discount_type text,p_discount_value numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path='' AS $$
 SELECT p_quantity*p_unit_price-billing_private.quotation_discount_amount(
  p_quantity,p_unit_price,p_discount_type,p_discount_value
 )
$$;
REVOKE ALL ON FUNCTION billing_private.quotation_line_total(
 numeric,numeric,text,numeric
) FROM PUBLIC,anon,authenticated;

ALTER TABLE public.billing_purchase_order_items
 ADD COLUMN discount_type text NOT NULL DEFAULT 'none',
 ADD COLUMN discount_value numeric(15,4) NOT NULL DEFAULT 0,
 ADD COLUMN discount_amount numeric NOT NULL DEFAULT 0;

-- The former inline constraint had an automatically generated name. Remove
-- only the check that owns line_total, regardless of the target's local name.
DO $$
DECLARE v_constraint text;
BEGIN
 FOR v_constraint IN
  SELECT c.conname
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid='public.billing_purchase_order_items'::regclass
   AND c.contype='c'
   AND pg_catalog.pg_get_constraintdef(c.oid) ILIKE '%line_total%'
 LOOP
  EXECUTE format(
   'ALTER TABLE public.billing_purchase_order_items DROP CONSTRAINT %I',
   v_constraint
  );
 END LOOP;
END $$;

ALTER TABLE public.billing_purchase_order_items
 ADD CONSTRAINT billing_purchase_order_items_discount_check CHECK(
  discount_type IN ('none','percentage','amount')
  AND discount_value>=0 AND discount_value<100000000000
  AND discount_amount>=0
  AND discount_amount<=quantity*unit_price
  AND (
   (discount_type='none' AND discount_value=0 AND discount_amount=0)
   OR (discount_type='percentage' AND discount_value<=100
    AND discount_amount=round((quantity*unit_price)*discount_value/100,2))
   OR (discount_type='amount' AND discount_value=round(discount_value,2)
    AND discount_amount=discount_value)
  )
 ),
 ADD CONSTRAINT billing_purchase_order_items_line_total_check CHECK(
  line_total>=0 AND line_total=quantity*unit_price-discount_amount
 );

ALTER FUNCTION billing_private.quotation_json(public.billing_quotations)
 RENAME TO quotation_json_before_item_discounts;
REVOKE ALL ON FUNCTION billing_private.quotation_json_before_item_discounts(
 public.billing_quotations
) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotation_json(
 p_quote public.billing_quotations
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE
 v_result jsonb:=billing_private.quotation_json_before_item_discounts(p_quote);
 v_providers jsonb;
 v_negotiations jsonb;
 v_awards jsonb;
 v_winners jsonb;
BEGIN
 WITH provider_totals AS (
  SELECT qp.id,
   count(qv.quotation_item_id)::integer AS quoted_item_count,
   coalesce(sum(billing_private.quotation_line_total(
    i.quantity,qv.unit_price,qv.discount_type,qv.discount_value
   )),0::numeric) AS total,
   coalesce(sum(billing_private.quotation_line_total(
    i.quantity,qv.unit_price,qv.discount_type,qv.discount_value
   )) FILTER(WHERE a.quotation_item_id IS NOT NULL),0::numeric) AS awarded_total
  FROM public.billing_quotation_providers qp
  LEFT JOIN public.billing_quotation_provider_values qv
   ON qv.owner_id=qp.owner_id AND qv.quotation_id=qp.quotation_id
   AND qv.quotation_provider_id=qp.id
  LEFT JOIN public.billing_quotation_items i
   ON i.owner_id=qv.owner_id AND i.quotation_id=qv.quotation_id
   AND i.id=qv.quotation_item_id
  LEFT JOIN public.billing_quotation_item_awards a
   ON a.owner_id=qv.owner_id AND a.quotation_id=qv.quotation_id
   AND a.quotation_provider_id=qv.quotation_provider_id
   AND a.quotation_item_id=qv.quotation_item_id
  WHERE qp.owner_id=p_quote.owner_id AND qp.quotation_id=p_quote.id
  GROUP BY qp.id
 )
 SELECT coalesce(jsonb_agg(
  entry.value || jsonb_build_object(
   'offers',coalesce((SELECT jsonb_object_agg(
    qv.quotation_item_id::text,
    jsonb_build_object(
     'unitPrice',billing_private.decimal_text(qv.unit_price),
     'discountType',qv.discount_type,
     'discountValue',billing_private.decimal_text(qv.discount_value),
     'lineSubtotal',billing_private.decimal_text(i.quantity*qv.unit_price),
     'discountAmount',billing_private.decimal_text(
      billing_private.quotation_discount_amount(
       i.quantity,qv.unit_price,qv.discount_type,qv.discount_value)),
     'lineTotal',billing_private.decimal_text(
      billing_private.quotation_line_total(
       i.quantity,qv.unit_price,qv.discount_type,qv.discount_value)),
     'netUnitPrice',billing_private.decimal_text(
      billing_private.quotation_line_total(
       i.quantity,qv.unit_price,qv.discount_type,qv.discount_value)/i.quantity)
    ) ORDER BY i.created_at,i.id)
    FROM public.billing_quotation_provider_values qv
    JOIN public.billing_quotation_items i
     ON i.owner_id=qv.owner_id AND i.quotation_id=qv.quotation_id
     AND i.id=qv.quotation_item_id
    WHERE qv.owner_id=p_quote.owner_id AND qv.quotation_id=p_quote.id
     AND qv.quotation_provider_id=provider.id),'{}'::jsonb),
   'total',billing_private.decimal_text(totals.total),
   'awardedTotal',billing_private.decimal_text(totals.awarded_total)
  ) ORDER BY entry.position
 ),'[]'::jsonb) INTO v_providers
 FROM jsonb_array_elements(v_result->'providers') WITH ORDINALITY entry(value,position)
 JOIN public.billing_quotation_providers provider
  ON provider.owner_id=p_quote.owner_id AND provider.quotation_id=p_quote.id
  AND provider.id=(entry.value->>'id')::uuid
 JOIN provider_totals totals ON totals.id=provider.id;

 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',n.id,'requestId',n.request_id,'providerId',n.quotation_provider_id,
  'itemId',n.quotation_item_id,'version',n.revision,
  'unitPrice',billing_private.decimal_text(n.unit_price),
  'discountType',n.discount_type,
  'discountValue',billing_private.decimal_text(n.discount_value),
  'lineSubtotal',billing_private.decimal_text(i.quantity*n.unit_price),
  'discountAmount',billing_private.decimal_text(
   billing_private.quotation_discount_amount(
    i.quantity,n.unit_price,n.discount_type,n.discount_value)),
  'lineTotal',billing_private.decimal_text(
   billing_private.quotation_line_total(
    i.quantity,n.unit_price,n.discount_type,n.discount_value)),
  'netUnitPrice',billing_private.decimal_text(
   billing_private.quotation_line_total(
    i.quantity,n.unit_price,n.discount_type,n.discount_value)/i.quantity),
  'notes',n.notes,'createdAt',n.created_at
 ) ORDER BY n.created_at,n.quotation_provider_id,n.quotation_item_id,
  n.revision,n.id),'[]'::jsonb) INTO v_negotiations
 FROM public.billing_quotation_negotiations n
 JOIN public.billing_quotation_items i
  ON i.owner_id=n.owner_id AND i.quotation_id=n.quotation_id
  AND i.id=n.quotation_item_id
 WHERE n.owner_id=p_quote.owner_id AND n.quotation_id=p_quote.id;

 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'itemId',a.quotation_item_id,'providerId',a.quotation_provider_id,
  'unitPrice',billing_private.decimal_text(qv.unit_price),
  'discountType',qv.discount_type,
  'discountValue',billing_private.decimal_text(qv.discount_value),
  'lineSubtotal',billing_private.decimal_text(i.quantity*qv.unit_price),
  'discountAmount',billing_private.decimal_text(
   billing_private.quotation_discount_amount(
    i.quantity,qv.unit_price,qv.discount_type,qv.discount_value)),
  'lineTotal',billing_private.decimal_text(
   billing_private.quotation_line_total(
    i.quantity,qv.unit_price,qv.discount_type,qv.discount_value)),
  'awardedAt',a.created_at,'updatedAt',a.updated_at
 ) ORDER BY i.created_at,i.id),'[]'::jsonb) INTO v_awards
 FROM public.billing_quotation_item_awards a
 JOIN public.billing_quotation_items i
  ON i.owner_id=a.owner_id AND i.quotation_id=a.quotation_id
  AND i.id=a.quotation_item_id
 JOIN public.billing_quotation_provider_values qv
  ON qv.owner_id=a.owner_id AND qv.quotation_id=a.quotation_id
  AND qv.quotation_provider_id=a.quotation_provider_id
  AND qv.quotation_item_id=a.quotation_item_id
 WHERE a.owner_id=p_quote.owner_id AND a.quotation_id=p_quote.id;

 WITH item_count AS (
  SELECT count(*)::integer AS total
  FROM public.billing_quotation_items i
  WHERE i.owner_id=p_quote.owner_id AND i.quotation_id=p_quote.id
 ), provider_totals AS (
  SELECT qp.id,qp.provider_snapshot,
   count(qv.quotation_item_id)::integer AS quoted_item_count,
   coalesce(sum(billing_private.quotation_line_total(
    i.quantity,qv.unit_price,qv.discount_type,qv.discount_value
   )),0::numeric) AS total
  FROM public.billing_quotation_providers qp
  LEFT JOIN public.billing_quotation_provider_values qv
   ON qv.owner_id=qp.owner_id AND qv.quotation_id=qp.quotation_id
   AND qv.quotation_provider_id=qp.id
  LEFT JOIN public.billing_quotation_items i
   ON i.owner_id=qv.owner_id AND i.quotation_id=qv.quotation_id
   AND i.id=qv.quotation_item_id
  WHERE qp.owner_id=p_quote.owner_id AND qp.quotation_id=p_quote.id
  GROUP BY qp.id,qp.provider_snapshot
 ), complete AS (
  SELECT pt.* FROM provider_totals pt CROSS JOIN item_count ic
  WHERE ic.total>0 AND pt.quoted_item_count=ic.total
 ), minimum AS (SELECT min(total) AS total FROM complete)
 SELECT coalesce(jsonb_agg(c.id ORDER BY lower(
  coalesce(c.provider_snapshot->>'legalName','')),c.id),'[]'::jsonb)
 INTO v_winners FROM complete c CROSS JOIN minimum m WHERE c.total=m.total;

 RETURN v_result || jsonb_build_object(
  'providers',v_providers,
  'negotiations',v_negotiations,
  'itemAwards',v_awards,
  'winningProviderIds',v_winners
 );
END $$;
REVOKE ALL ON FUNCTION billing_private.quotation_json(public.billing_quotations)
 FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 RENAME TO quotations_dispatch_before_item_discounts;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch_before_item_discounts(
 text,text,jsonb
) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotations_dispatch(
 p_resource text,p_action text,p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_quote_id uuid;
 v_quote_provider_id uuid;
 v_item_id uuid;
 v_request_id uuid;
 v_price numeric;
 v_quantity numeric;
 v_discount_type text;
 v_discount_value numeric;
 v_discount_amount numeric;
 v_notes text;
 v_quote public.billing_quotations;
 v_negotiation public.billing_quotation_negotiations;
BEGIN
 IF p_resource<>'quotations' OR p_action<>'record-negotiation' THEN
  RETURN billing_private.quotations_dispatch_before_item_discounts(
   p_resource,p_action,p_payload);
 END IF;
 IF v_owner IS NULL OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
  RAISE EXCEPTION 'Dados da negociação inválidos.' USING ERRCODE='22023';
 END IF;
 PERFORM billing_private.lock_request_actor();
 v_owner=billing_private.current_owner_id();
 PERFORM billing_private.authorize('registrations.write');
 PERFORM billing_private.request_payload(p_payload,ARRAY[
  'id','quotationProviderId','quotationItemId','unitPrice','notes','requestId',
  'discountType','discountValue'
 ]);
 IF jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'quotationProviderId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'quotationItemId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'unitPrice') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'notes') IS DISTINCT FROM 'string'
  OR (p_payload ? 'requestId'
   AND jsonb_typeof(p_payload->'requestId') IS DISTINCT FROM 'string')
  OR (p_payload ? 'discountType'
   AND jsonb_typeof(p_payload->'discountType') IS DISTINCT FROM 'string')
  OR (p_payload ? 'discountValue'
   AND jsonb_typeof(p_payload->'discountValue') IS DISTINCT FROM 'string')
  OR length(p_payload->>'notes')>2000 THEN
  RAISE EXCEPTION 'Confira o fornecedor, o material, o valor e o desconto.'
   USING ERRCODE='22023';
 END IF;

 v_quote_id=nullif(btrim(p_payload->>'id'),'')::uuid;
 v_quote_provider_id=nullif(btrim(p_payload->>'quotationProviderId'),'')::uuid;
 v_item_id=nullif(btrim(p_payload->>'quotationItemId'),'')::uuid;
 v_request_id=CASE WHEN p_payload ? 'requestId'
  THEN nullif(btrim(p_payload->>'requestId'),'')::uuid ELSE NULL END;
 v_price=replace(btrim(p_payload->>'unitPrice'),',','.')::numeric;
 v_discount_type=coalesce(nullif(btrim(p_payload->>'discountType'),''),'none');
 v_discount_value=replace(
  coalesce(nullif(btrim(p_payload->>'discountValue'),''),'0'),',','.'
 )::numeric;
 v_notes=btrim(p_payload->>'notes');
 IF v_quote_id IS NULL OR v_quote_provider_id IS NULL OR v_item_id IS NULL
  OR (p_payload ? 'requestId' AND v_request_id IS NULL)
  OR v_price<0 OR v_price>=1000000000000 OR v_price<>round(v_price,2)
  OR v_discount_type NOT IN ('none','percentage','amount')
  OR v_discount_value<0 OR v_discount_value>=100000000000
  OR (v_discount_type='none' AND v_discount_value<>0)
  OR (v_discount_type='percentage' AND (
   v_discount_value>100 OR v_discount_value<>round(v_discount_value,4)))
  OR (v_discount_type='amount'
   AND v_discount_value<>round(v_discount_value,2)) THEN
  RAISE EXCEPTION 'Informe preço e desconto válidos.' USING ERRCODE='22023';
 END IF;

 SELECT * INTO v_quote FROM public.billing_quotations
 WHERE owner_id=v_owner AND id=v_quote_id FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE='P0002';
 END IF;
 IF v_quote.status<>'open' THEN
  RAISE EXCEPTION 'Reabra a cotação antes de negociar valores.' USING ERRCODE='23514';
 END IF;
 SELECT i.quantity INTO v_quantity
 FROM public.billing_quotation_items i
 WHERE i.owner_id=v_owner AND i.quotation_id=v_quote_id AND i.id=v_item_id
 FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Selecione um material desta cotação.' USING ERRCODE='23514';
 END IF;
 PERFORM 1 FROM public.billing_quotation_providers qp
 WHERE qp.owner_id=v_owner AND qp.quotation_id=v_quote_id
  AND qp.id=v_quote_provider_id FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Selecione um fornecedor desta cotação.' USING ERRCODE='23514';
 END IF;
 v_discount_amount=billing_private.quotation_discount_amount(
  v_quantity,v_price,v_discount_type,v_discount_value);
 IF v_discount_amount>v_quantity*v_price THEN
  RAISE EXCEPTION 'O desconto não pode superar o subtotal do item.'
   USING ERRCODE='23514';
 END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(
  'billing-quotation-negotiation:'||v_owner::text||':'||v_quote_id::text||':'
   ||v_quote_provider_id::text||':'||v_item_id::text,0));
 IF v_request_id IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(
   'billing-quotation-negotiation-request:'||v_owner::text||':'
    ||v_request_id::text,0));
  SELECT * INTO v_negotiation
  FROM public.billing_quotation_negotiations n
  WHERE n.owner_id=v_owner AND n.request_id=v_request_id FOR UPDATE;
  IF FOUND THEN
   IF v_negotiation.quotation_id IS DISTINCT FROM v_quote_id
    OR v_negotiation.quotation_provider_id IS DISTINCT FROM v_quote_provider_id
    OR v_negotiation.quotation_item_id IS DISTINCT FROM v_item_id
    OR v_negotiation.unit_price IS DISTINCT FROM v_price
    OR v_negotiation.discount_type IS DISTINCT FROM v_discount_type
    OR v_negotiation.discount_value IS DISTINCT FROM v_discount_value
    OR v_negotiation.notes IS DISTINCT FROM v_notes THEN
    RAISE EXCEPTION 'A requisição da negociação já foi usada com outros dados.'
     USING ERRCODE='23505';
   END IF;
   RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote));
  END IF;
 END IF;

 PERFORM billing_private.quotations_dispatch_before_item_discounts(
  p_resource,p_action,p_payload-'discountType'-'discountValue');
 IF v_request_id IS NOT NULL THEN
  SELECT * INTO v_negotiation
  FROM public.billing_quotation_negotiations n
  WHERE n.owner_id=v_owner AND n.request_id=v_request_id FOR UPDATE;
 ELSE
  SELECT * INTO v_negotiation
  FROM public.billing_quotation_negotiations n
  WHERE n.owner_id=v_owner AND n.quotation_id=v_quote_id
   AND n.quotation_provider_id=v_quote_provider_id
   AND n.quotation_item_id=v_item_id
  ORDER BY n.revision DESC,n.id DESC LIMIT 1 FOR UPDATE;
 END IF;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'A negociação não foi registrada.' USING ERRCODE='P0001';
 END IF;
 UPDATE public.billing_quotation_negotiations
 SET discount_type=v_discount_type,discount_value=v_discount_value
 WHERE owner_id=v_owner AND id=v_negotiation.id;
 UPDATE public.billing_quotation_provider_values
 SET discount_type=v_discount_type,discount_value=v_discount_value,
  updated_at=now()
 WHERE owner_id=v_owner AND quotation_id=v_quote_id
  AND quotation_provider_id=v_quote_provider_id
  AND quotation_item_id=v_item_id;
 SELECT * INTO v_quote FROM public.billing_quotations
 WHERE owner_id=v_owner AND id=v_quote_id;
 RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote));
EXCEPTION
 WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Informe identificadores, preço e desconto válidos.'
   USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 TO authenticated;

CREATE OR REPLACE FUNCTION billing_private.create_purchase_orders_from_awards(
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
 IF EXISTS(
  SELECT 1
  FROM public.billing_quotation_item_awards a
  JOIN public.billing_quotation_items i
   ON i.owner_id=a.owner_id AND i.quotation_id=a.quotation_id
   AND i.id=a.quotation_item_id
  JOIN public.billing_quotation_provider_values qv
   ON qv.owner_id=a.owner_id AND qv.quotation_id=a.quotation_id
   AND qv.quotation_provider_id=a.quotation_provider_id
   AND qv.quotation_item_id=a.quotation_item_id
  WHERE a.owner_id=p_owner AND a.quotation_id=p_quotation_id
   AND billing_private.quotation_discount_amount(
    i.quantity,qv.unit_price,qv.discount_type,qv.discount_value
   )>i.quantity*qv.unit_price
 ) THEN
  RAISE EXCEPTION 'Existe desconto maior que o subtotal de um material.'
   USING ERRCODE='23514';
 END IF;

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
  SELECT coalesce(sum(billing_private.quotation_line_total(
   i.quantity,qv.unit_price,qv.discount_type,qv.discount_value
  )),0::numeric) INTO v_total
  FROM public.billing_quotation_item_awards a
  JOIN public.billing_quotation_items i
   ON i.owner_id=a.owner_id AND i.quotation_id=a.quotation_id
   AND i.id=a.quotation_item_id
  JOIN public.billing_quotation_provider_values qv
   ON qv.owner_id=a.owner_id AND qv.quotation_id=a.quotation_id
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
   material_references,quantity,unit,unit_price,
   discount_type,discount_value,discount_amount,line_total,notes
  )
  SELECT i.owner_id,v_order.id,i.quotation_id,i.id,
   i.material_id,i.material_name,i.material_code,i.material_application,
   i.material_references,i.quantity,i.unit,qv.unit_price,
   qv.discount_type,qv.discount_value,
   billing_private.quotation_discount_amount(
    i.quantity,qv.unit_price,qv.discount_type,qv.discount_value),
   billing_private.quotation_line_total(
    i.quantity,qv.unit_price,qv.discount_type,qv.discount_value),i.notes
  FROM public.billing_quotation_item_awards a
  JOIN public.billing_quotation_items i
   ON i.owner_id=a.owner_id AND i.quotation_id=a.quotation_id
   AND i.id=a.quotation_item_id
  JOIN public.billing_quotation_provider_values qv
   ON qv.owner_id=a.owner_id AND qv.quotation_id=a.quotation_id
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
    'discountType',i.discount_type,
    'discountValue',billing_private.decimal_text(i.discount_value),
    'lineSubtotal',billing_private.decimal_text(i.quantity*i.unit_price),
    'discountAmount',billing_private.decimal_text(i.discount_amount),
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
REVOKE ALL ON FUNCTION billing_private.purchase_order_json(public.billing_purchase_orders)
 FROM PUBLIC,anon,authenticated;

COMMENT ON FUNCTION billing_private.quotation_json(public.billing_quotations) IS
 'Owner-scoped quotation projection. Gross prices, versioned item discounts, net totals, awards and winners are calculated in Postgres.';
COMMENT ON COLUMN public.billing_quotation_provider_values.discount_value IS
 'Percentage with up to four decimals or a fixed discount for the complete item line.';
COMMENT ON COLUMN public.billing_purchase_order_items.discount_amount IS
 'Immutable monetary discount snapshot for the complete purchase-order item line.';
