-- Record how much of each requested item a supplier can actually deliver.
-- NULL means that the supplier can fulfil the complete requested quantity;
-- zero is an explicit out-of-stock response. Monetary projections and order
-- snapshots use the effective offered quantity exclusively in Postgres.
ALTER TABLE public.billing_quotation_provider_values
 ADD COLUMN available_quantity numeric,
 ADD CONSTRAINT billing_quotation_provider_values_available_quantity_check
 CHECK(available_quantity IS NULL OR (
  available_quantity>=0 AND available_quantity<1000000000000
  AND scale(available_quantity)<=3
 ));

ALTER TABLE public.billing_quotation_negotiations
 ADD COLUMN available_quantity numeric,
 ADD CONSTRAINT billing_quotation_negotiations_available_quantity_check
 CHECK(available_quantity IS NULL OR (
  available_quantity>=0 AND available_quantity<1000000000000
  AND scale(available_quantity)<=3
 ));

CREATE FUNCTION billing_private.quotation_effective_quantity(
 p_requested_quantity numeric,p_available_quantity numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path='' AS $$
 SELECT coalesce(p_available_quantity,p_requested_quantity)
$$;
REVOKE ALL ON FUNCTION billing_private.quotation_effective_quantity(
 numeric,numeric
) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.quotation_json(public.billing_quotations)
 RENAME TO quotation_json_before_available_quantity;
REVOKE ALL ON FUNCTION billing_private.quotation_json_before_available_quantity(
 public.billing_quotations
) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotation_json(
 p_quote public.billing_quotations
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE
 v_result jsonb:=billing_private.quotation_json_before_available_quantity(p_quote);
 v_providers jsonb;
 v_negotiations jsonb;
 v_awards jsonb;
 v_winners jsonb;
 v_awarded_gross_total numeric;
 v_awarded_total numeric;
BEGIN
 WITH provider_totals AS (
  SELECT qp.id,
   coalesce(sum(billing_private.quotation_effective_quantity(
    i.quantity,qv.available_quantity
   )*qv.unit_price),0::numeric) AS gross_total,
   coalesce(sum(billing_private.quotation_line_total(
    billing_private.quotation_effective_quantity(i.quantity,qv.available_quantity),
    qv.unit_price,qv.discount_type,qv.discount_value
   )),0::numeric) AS total,
   coalesce(sum(billing_private.quotation_effective_quantity(
    i.quantity,qv.available_quantity
   )*qv.unit_price) FILTER(WHERE a.quotation_item_id IS NOT NULL),0::numeric)
    AS awarded_gross_total,
   coalesce(sum(billing_private.quotation_line_total(
    billing_private.quotation_effective_quantity(i.quantity,qv.available_quantity),
    qv.unit_price,qv.discount_type,qv.discount_value
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
     'availableQuantity',billing_private.decimal_text(qv.available_quantity),
     'discountType',qv.discount_type,
     'discountValue',billing_private.decimal_text(qv.discount_value),
     'lineSubtotal',billing_private.decimal_text(
      billing_private.quotation_effective_quantity(
       i.quantity,qv.available_quantity)*qv.unit_price),
     'discountAmount',billing_private.decimal_text(
      billing_private.quotation_discount_amount(
       billing_private.quotation_effective_quantity(i.quantity,qv.available_quantity),
       qv.unit_price,qv.discount_type,qv.discount_value)),
     'lineTotal',billing_private.decimal_text(
      billing_private.quotation_line_total(
       billing_private.quotation_effective_quantity(i.quantity,qv.available_quantity),
       qv.unit_price,qv.discount_type,qv.discount_value)),
     'netUnitPrice',billing_private.decimal_text(CASE
      WHEN billing_private.quotation_effective_quantity(
       i.quantity,qv.available_quantity)>0
      THEN billing_private.quotation_line_total(
       billing_private.quotation_effective_quantity(i.quantity,qv.available_quantity),
       qv.unit_price,qv.discount_type,qv.discount_value)
       /billing_private.quotation_effective_quantity(i.quantity,qv.available_quantity)
      ELSE qv.unit_price END)
    ) ORDER BY i.created_at,i.id)
    FROM public.billing_quotation_provider_values qv
    JOIN public.billing_quotation_items i
     ON i.owner_id=qv.owner_id AND i.quotation_id=qv.quotation_id
     AND i.id=qv.quotation_item_id
    WHERE qv.owner_id=p_quote.owner_id AND qv.quotation_id=p_quote.id
     AND qv.quotation_provider_id=provider.id),'{}'::jsonb),
   'grossTotal',billing_private.decimal_text(totals.gross_total),
   'total',billing_private.decimal_text(totals.total),
   'awardedGrossTotal',billing_private.decimal_text(totals.awarded_gross_total),
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
  'availableQuantity',billing_private.decimal_text(n.available_quantity),
  'discountType',n.discount_type,
  'discountValue',billing_private.decimal_text(n.discount_value),
  'lineSubtotal',billing_private.decimal_text(
   billing_private.quotation_effective_quantity(
    i.quantity,n.available_quantity)*n.unit_price),
  'discountAmount',billing_private.decimal_text(
   billing_private.quotation_discount_amount(
    billing_private.quotation_effective_quantity(i.quantity,n.available_quantity),
    n.unit_price,n.discount_type,n.discount_value)),
  'lineTotal',billing_private.decimal_text(
   billing_private.quotation_line_total(
    billing_private.quotation_effective_quantity(i.quantity,n.available_quantity),
    n.unit_price,n.discount_type,n.discount_value)),
  'netUnitPrice',billing_private.decimal_text(CASE
   WHEN billing_private.quotation_effective_quantity(i.quantity,n.available_quantity)>0
   THEN billing_private.quotation_line_total(
    billing_private.quotation_effective_quantity(i.quantity,n.available_quantity),
    n.unit_price,n.discount_type,n.discount_value)
    /billing_private.quotation_effective_quantity(i.quantity,n.available_quantity)
   ELSE n.unit_price END),
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
  'availableQuantity',billing_private.decimal_text(qv.available_quantity),
  'discountType',qv.discount_type,
  'discountValue',billing_private.decimal_text(qv.discount_value),
  'lineSubtotal',billing_private.decimal_text(
   billing_private.quotation_effective_quantity(
    i.quantity,qv.available_quantity)*qv.unit_price),
  'discountAmount',billing_private.decimal_text(
   billing_private.quotation_discount_amount(
    billing_private.quotation_effective_quantity(i.quantity,qv.available_quantity),
    qv.unit_price,qv.discount_type,qv.discount_value)),
  'lineTotal',billing_private.decimal_text(
   billing_private.quotation_line_total(
    billing_private.quotation_effective_quantity(i.quantity,qv.available_quantity),
    qv.unit_price,qv.discount_type,qv.discount_value)),
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
   bool_and(billing_private.quotation_effective_quantity(
    i.quantity,qv.available_quantity)>0) AS has_stock,
   coalesce(sum(billing_private.quotation_line_total(
    billing_private.quotation_effective_quantity(i.quantity,qv.available_quantity),
    qv.unit_price,qv.discount_type,qv.discount_value
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
  WHERE ic.total>0 AND pt.quoted_item_count=ic.total AND pt.has_stock
 ), minimum AS (SELECT min(total) AS total FROM complete)
 SELECT coalesce(jsonb_agg(c.id ORDER BY lower(
  coalesce(c.provider_snapshot->>'legalName','')),c.id),'[]'::jsonb)
 INTO v_winners FROM complete c CROSS JOIN minimum m WHERE c.total=m.total;

 SELECT
  coalesce(sum(billing_private.quotation_effective_quantity(
   i.quantity,qv.available_quantity)*qv.unit_price),0::numeric),
  coalesce(sum(billing_private.quotation_line_total(
   billing_private.quotation_effective_quantity(i.quantity,qv.available_quantity),
   qv.unit_price,qv.discount_type,qv.discount_value
  )),0::numeric)
 INTO v_awarded_gross_total,v_awarded_total
 FROM public.billing_quotation_item_awards a
 JOIN public.billing_quotation_items i
  ON i.owner_id=a.owner_id AND i.quotation_id=a.quotation_id
  AND i.id=a.quotation_item_id
 JOIN public.billing_quotation_provider_values qv
  ON qv.owner_id=a.owner_id AND qv.quotation_id=a.quotation_id
  AND qv.quotation_provider_id=a.quotation_provider_id
  AND qv.quotation_item_id=a.quotation_item_id
 WHERE a.owner_id=p_quote.owner_id AND a.quotation_id=p_quote.id;

 RETURN v_result || jsonb_build_object(
  'providers',v_providers,
  'negotiations',v_negotiations,
  'itemAwards',v_awards,
  'winningProviderIds',v_winners,
  'awardedGrossTotal',billing_private.decimal_text(v_awarded_gross_total),
  'awardedTotal',billing_private.decimal_text(v_awarded_total)
 );
END $$;
REVOKE ALL ON FUNCTION billing_private.quotation_json(public.billing_quotations)
 FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 RENAME TO quotations_dispatch_before_available_quantity;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch_before_available_quantity(
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
 v_item_id uuid;
 v_request_id uuid;
 v_requested_quantity numeric;
 v_available_quantity numeric;
 v_effective_quantity numeric;
 v_price numeric;
 v_discount_type text;
 v_discount_value numeric;
 v_quote public.billing_quotations;
 v_negotiation public.billing_quotation_negotiations;
 v_result jsonb;
 v_previous_available_quantity numeric;
 v_had_current_value boolean:=false;
BEGIN
 IF p_resource<>'quotations'
  OR p_action NOT IN ('record-negotiation','update-item-quantity','award-item') THEN
  RETURN billing_private.quotations_dispatch_before_available_quantity(
   p_resource,p_action,p_payload
  );
 END IF;

 -- Let the existing owner-scoped RPC validate and update these actions first.
 -- Any availability violation below raises in the same transaction and rolls
 -- the former update back atomically.
 IF p_action IN ('update-item-quantity','award-item') THEN
  v_result=billing_private.quotations_dispatch_before_available_quantity(
   p_resource,p_action,p_payload
  );
  v_owner=billing_private.current_owner_id();
  v_quote_id=nullif(btrim(p_payload->>'id'),'')::uuid;
  v_item_id=nullif(btrim(p_payload->>'quotationItemId'),'')::uuid;

  IF p_action='award-item' THEN
   v_provider_id=nullif(btrim(p_payload->>'quotationProviderId'),'')::uuid;
   IF EXISTS(
    SELECT 1 FROM public.billing_quotation_provider_values qv
    WHERE qv.owner_id=v_owner AND qv.quotation_id=v_quote_id
     AND qv.quotation_provider_id=v_provider_id
     AND qv.quotation_item_id=v_item_id
     AND qv.available_quantity=0
   ) THEN
    RAISE EXCEPTION 'Não é possível aprovar um fornecedor sem quantidade disponível.'
     USING ERRCODE='23514';
   END IF;
   RETURN v_result;
  END IF;

  SELECT i.quantity INTO v_requested_quantity
  FROM public.billing_quotation_items i
  WHERE i.owner_id=v_owner AND i.quotation_id=v_quote_id AND i.id=v_item_id;
  IF EXISTS(
   SELECT 1 FROM public.billing_quotation_provider_values qv
   WHERE qv.owner_id=v_owner AND qv.quotation_id=v_quote_id
    AND qv.quotation_item_id=v_item_id
    AND qv.available_quantity>v_requested_quantity
  ) THEN
   RAISE EXCEPTION 'A quantidade solicitada não pode ficar abaixo da quantidade disponível já informada.'
    USING ERRCODE='23514';
  END IF;
  IF EXISTS(
   SELECT 1 FROM public.billing_quotation_negotiations n
   WHERE n.owner_id=v_owner AND n.quotation_id=v_quote_id
    AND n.quotation_item_id=v_item_id
    AND n.available_quantity>v_requested_quantity
  ) THEN
   RAISE EXCEPTION 'A quantidade solicitada não pode ficar abaixo da disponibilidade registrada no histórico.'
    USING ERRCODE='23514';
  END IF;
  IF EXISTS(
   SELECT 1 FROM public.billing_quotation_provider_values qv
   WHERE qv.owner_id=v_owner AND qv.quotation_id=v_quote_id
    AND qv.quotation_item_id=v_item_id
    AND billing_private.quotation_discount_amount(
     billing_private.quotation_effective_quantity(
      v_requested_quantity,qv.available_quantity),
     qv.unit_price,qv.discount_type,qv.discount_value
    )>billing_private.quotation_effective_quantity(
     v_requested_quantity,qv.available_quantity)*qv.unit_price
  ) THEN
   RAISE EXCEPTION 'A nova quantidade torna um desconto maior que o subtotal do item.'
    USING ERRCODE='23514';
  END IF;
  IF EXISTS(
   SELECT 1 FROM public.billing_quotation_negotiations n
   WHERE n.owner_id=v_owner AND n.quotation_id=v_quote_id
    AND n.quotation_item_id=v_item_id
    AND billing_private.quotation_discount_amount(
     billing_private.quotation_effective_quantity(
      v_requested_quantity,n.available_quantity),
     n.unit_price,n.discount_type,n.discount_value
    )>billing_private.quotation_effective_quantity(
     v_requested_quantity,n.available_quantity)*n.unit_price
  ) THEN
   RAISE EXCEPTION 'A nova quantidade torna um desconto do histórico maior que o subtotal do item.'
    USING ERRCODE='23514';
  END IF;
  RETURN v_result;
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
  'discountType','discountValue','availableQuantity'
 ]);
 IF (p_payload ? 'availableQuantity'
   AND jsonb_typeof(p_payload->'availableQuantity') NOT IN ('string','null'))
  OR jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'quotationProviderId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'quotationItemId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'unitPrice') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Confira o fornecedor, o material, o preço e a quantidade disponível.'
   USING ERRCODE='22023';
 END IF;

 v_quote_id=nullif(btrim(p_payload->>'id'),'')::uuid;
 v_provider_id=nullif(btrim(p_payload->>'quotationProviderId'),'')::uuid;
 v_item_id=nullif(btrim(p_payload->>'quotationItemId'),'')::uuid;
 v_request_id=CASE WHEN p_payload ? 'requestId'
  THEN nullif(btrim(p_payload->>'requestId'),'')::uuid ELSE NULL END;
 v_available_quantity=CASE
  WHEN jsonb_typeof(p_payload->'availableQuantity')='string'
   AND nullif(btrim(p_payload->>'availableQuantity'),'') IS NOT NULL
  THEN replace(btrim(p_payload->>'availableQuantity'),',','.')::numeric
  ELSE NULL END;
 v_price=replace(btrim(p_payload->>'unitPrice'),',','.')::numeric;
 v_discount_type=coalesce(nullif(btrim(p_payload->>'discountType'),''),'none');
 v_discount_value=replace(
  coalesce(nullif(btrim(p_payload->>'discountValue'),''),'0'),',','.'
 )::numeric;

 SELECT q.* INTO v_quote
 FROM public.billing_quotations q
 WHERE q.owner_id=v_owner AND q.id=v_quote_id FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE='P0002';
 END IF;
 SELECT i.quantity INTO v_requested_quantity
 FROM public.billing_quotation_items i
 WHERE i.owner_id=v_owner AND i.quotation_id=v_quote_id AND i.id=v_item_id
 FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Selecione um material desta cotação.' USING ERRCODE='23514';
 END IF;
 IF v_available_quantity IS NOT NULL AND (
  v_available_quantity<0 OR v_available_quantity>=1000000000000
  OR scale(v_available_quantity)>3
  OR v_available_quantity>v_requested_quantity
 ) THEN
  RAISE EXCEPTION 'A quantidade disponível deve ficar entre zero e a quantidade solicitada.'
   USING ERRCODE='22023';
 END IF;
 v_effective_quantity=billing_private.quotation_effective_quantity(
  v_requested_quantity,v_available_quantity
 );
 IF billing_private.quotation_discount_amount(
  v_effective_quantity,v_price,v_discount_type,v_discount_value
 )>v_effective_quantity*v_price THEN
  RAISE EXCEPTION 'O desconto não pode superar o subtotal da quantidade disponível.'
   USING ERRCODE='23514';
 END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(
  'billing-quotation-negotiation:'||v_owner::text||':'||v_quote_id::text||':'
   ||v_provider_id::text||':'||v_item_id::text,0));
 IF v_request_id IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(
   'billing-quotation-negotiation-request:'||v_owner::text||':'
    ||v_request_id::text,0));
  SELECT * INTO v_negotiation
  FROM public.billing_quotation_negotiations n
  WHERE n.owner_id=v_owner AND n.request_id=v_request_id FOR UPDATE;
  IF FOUND AND v_negotiation.available_quantity IS DISTINCT FROM v_available_quantity THEN
   RAISE EXCEPTION 'A requisição da negociação já foi usada com outra quantidade disponível.'
    USING ERRCODE='23505';
  ELSIF FOUND THEN
   -- The former dispatcher checks the price, discount and notes of this exact
   -- request. Do not rewrite the current offer when an older request is retried.
   RETURN billing_private.quotations_dispatch_before_available_quantity(
    p_resource,p_action,p_payload-'availableQuantity'
   );
  END IF;
 END IF;

 SELECT qv.available_quantity INTO v_previous_available_quantity
 FROM public.billing_quotation_provider_values qv
 WHERE qv.owner_id=v_owner AND qv.quotation_id=v_quote_id
  AND qv.quotation_provider_id=v_provider_id
  AND qv.quotation_item_id=v_item_id
 FOR UPDATE;
 v_had_current_value=FOUND;

 v_result=billing_private.quotations_dispatch_before_available_quantity(
  p_resource,p_action,p_payload-'availableQuantity'
 );
 IF v_request_id IS NOT NULL THEN
  SELECT * INTO v_negotiation
  FROM public.billing_quotation_negotiations n
  WHERE n.owner_id=v_owner AND n.request_id=v_request_id FOR UPDATE;
 ELSE
  SELECT * INTO v_negotiation
  FROM public.billing_quotation_negotiations n
  WHERE n.owner_id=v_owner AND n.quotation_id=v_quote_id
   AND n.quotation_provider_id=v_provider_id
   AND n.quotation_item_id=v_item_id
  ORDER BY n.revision DESC,n.id DESC LIMIT 1 FOR UPDATE;
 END IF;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'A negociação não foi registrada.' USING ERRCODE='P0001';
 END IF;
 UPDATE public.billing_quotation_negotiations n
 SET available_quantity=v_available_quantity
 WHERE n.owner_id=v_owner AND n.id=v_negotiation.id;
 UPDATE public.billing_quotation_provider_values qv
 SET available_quantity=v_available_quantity,updated_at=now()
 WHERE qv.owner_id=v_owner AND qv.quotation_id=v_quote_id
  AND qv.quotation_provider_id=v_provider_id
  AND qv.quotation_item_id=v_item_id;
 IF v_had_current_value
  AND v_previous_available_quantity IS DISTINCT FROM v_available_quantity THEN
  DELETE FROM public.billing_quotation_item_awards a
  WHERE a.owner_id=v_owner AND a.quotation_id=v_quote_id
   AND a.quotation_provider_id=v_provider_id
   AND a.quotation_item_id=v_item_id;
 END IF;
 SELECT * INTO v_quote FROM public.billing_quotations q
 WHERE q.owner_id=v_owner AND q.id=v_quote_id;
 RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote));
EXCEPTION
 WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Informe identificadores, preço, desconto e quantidade disponível válidos.'
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
   AND (
    billing_private.quotation_effective_quantity(
     i.quantity,qv.available_quantity)<=0
    OR billing_private.quotation_discount_amount(
     billing_private.quotation_effective_quantity(
      i.quantity,qv.available_quantity),
     qv.unit_price,qv.discount_type,qv.discount_value
    )>billing_private.quotation_effective_quantity(
     i.quantity,qv.available_quantity)*qv.unit_price
   )
 ) THEN
  RAISE EXCEPTION 'Existe item aprovado sem estoque ou com desconto maior que o subtotal.'
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
   billing_private.quotation_effective_quantity(i.quantity,qv.available_quantity),
   qv.unit_price,qv.discount_type,qv.discount_value
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
   i.material_references,
   billing_private.quotation_effective_quantity(i.quantity,qv.available_quantity),
   i.unit,qv.unit_price,qv.discount_type,qv.discount_value,
   billing_private.quotation_discount_amount(
    billing_private.quotation_effective_quantity(i.quantity,qv.available_quantity),
    qv.unit_price,qv.discount_type,qv.discount_value),
   billing_private.quotation_line_total(
    billing_private.quotation_effective_quantity(i.quantity,qv.available_quantity),
    qv.unit_price,qv.discount_type,qv.discount_value),i.notes
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

COMMENT ON COLUMN public.billing_quotation_provider_values.available_quantity IS
 'Latest supplier availability for an item. NULL means the complete requested quantity; zero means unavailable.';
COMMENT ON COLUMN public.billing_quotation_negotiations.available_quantity IS
 'Immutable supplier availability captured with this negotiation revision. NULL means the complete requested quantity.';
COMMENT ON FUNCTION billing_private.quotation_json(public.billing_quotations) IS
 'Owner-scoped quotation projection. Supplier availability, monetary totals and awards are calculated in Postgres.';
COMMENT ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb) IS
 'Routes quotations and enforces owner-scoped supplier availability against the requested item quantity.';
