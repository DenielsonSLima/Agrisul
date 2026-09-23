-- Keep every negotiated quotation price as an immutable, owner-scoped version.
-- The existing provider-value table remains the current-value projection used
-- by comparison and purchase-order finalization.
CREATE TABLE public.billing_quotation_negotiations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 quotation_id uuid NOT NULL,
 quotation_provider_id uuid NOT NULL,
 quotation_item_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 unit_price numeric(15,2) NOT NULL CHECK(unit_price>=0 AND unit_price<1000000000000),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id),
 UNIQUE(owner_id,quotation_id,quotation_provider_id,quotation_item_id,revision),
 FOREIGN KEY(owner_id,quotation_id)
  REFERENCES public.billing_quotations(owner_id,id),
 FOREIGN KEY(owner_id,quotation_id,quotation_provider_id)
  REFERENCES public.billing_quotation_providers(owner_id,quotation_id,id),
 FOREIGN KEY(owner_id,quotation_id,quotation_item_id)
  REFERENCES public.billing_quotation_items(owner_id,quotation_id,id)
);
CREATE INDEX billing_quotation_negotiations_quote
 ON public.billing_quotation_negotiations(owner_id,quotation_id,created_at,id);
CREATE INDEX billing_quotation_negotiations_item
 ON public.billing_quotation_negotiations(
  owner_id,quotation_id,quotation_item_id
 );

-- Existing current prices become the first known version. Earlier revisions
-- cannot be reconstructed, so their original last-update timestamp is kept.
INSERT INTO public.billing_quotation_negotiations(
 owner_id,quotation_id,quotation_provider_id,quotation_item_id,
 revision,unit_price,notes,created_at
)
SELECT v.owner_id,v.quotation_id,v.quotation_provider_id,v.quotation_item_id,
 1,v.unit_price,'',v.updated_at
FROM public.billing_quotation_provider_values v;

ALTER TABLE public.billing_quotation_negotiations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_quotation_negotiations REPLICA IDENTITY FULL;
REVOKE ALL ON public.billing_quotation_negotiations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_quotation_negotiations TO authenticated;
CREATE POLICY billing_quotation_negotiations_read
 ON public.billing_quotation_negotiations FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'registrations.read'));

-- Extend the immutable aggregate projection with the selected provider's
-- frozen identity, the actual finalized winner and the complete price history.
CREATE OR REPLACE FUNCTION billing_private.quotation_json(
 p_quote public.billing_quotations
) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
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
 ), generated_order AS (
  SELECT o.id,o.quotation_provider_id
  FROM public.billing_purchase_orders o
  WHERE o.owner_id=p_quote.owner_id AND o.quotation_id=p_quote.id
 )
 SELECT jsonb_build_object(
  'id',p_quote.id,'title',p_quote.title,'number',p_quote.quotation_number,
  'requestDate',p_quote.request_date,'requester',p_quote.requester,
  'requesterSignatureId',p_quote.requester_signature_id,'notes',p_quote.notes,
  'status',p_quote.status,
  'purchaseOrderId',(SELECT o.id FROM generated_order o),
  'winnerProviderId',(SELECT o.quotation_provider_id FROM generated_order o),
  'createdAt',p_quote.created_at,'updatedAt',p_quote.updated_at,
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',i.id,'materialId',i.material_id,'materialVariantId',i.material_variant_id,
   'materialName',i.material_name,'materialCode',i.material_code,
   'materialApplication',i.material_application,'materialReferences',i.material_references,
   'quantity',billing_private.decimal_text(i.quantity),'unit',i.unit,'notes',i.notes
  ) ORDER BY i.created_at,i.id) FROM public.billing_quotation_items i
   WHERE i.owner_id=p_quote.owner_id AND i.quotation_id=p_quote.id),'[]'::jsonb),
  'providers',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',qp.id,'providerId',qp.provider_id,
   'providerName',qp.provider_snapshot->>'legalName',
   'providerDocumentType',coalesce(qp.provider_snapshot->>'documentType',''),
   'providerDocument',coalesce(qp.provider_snapshot->>'document',''),
   'providerTradeName',coalesce(qp.provider_snapshot->>'tradeName',''),
   'providerEmail',coalesce(qp.provider_snapshot->>'email',''),
   'providerPhone',coalesce(qp.provider_snapshot->>'phone',''),
   'provider',qp.provider_snapshot,
   'notes',qp.notes,'sentAt',qp.sent_at,'values',coalesce((SELECT jsonb_object_agg(
    i.id::text,coalesce(billing_private.decimal_text(qv.unit_price),'') ORDER BY i.created_at,i.id)
    FROM public.billing_quotation_items i LEFT JOIN public.billing_quotation_provider_values qv
     ON qv.owner_id=i.owner_id AND qv.quotation_id=i.quotation_id
     AND qv.quotation_provider_id=qp.id AND qv.quotation_item_id=i.id
    WHERE i.owner_id=p_quote.owner_id AND i.quotation_id=p_quote.id),'{}'::jsonb),
   'quotedItemCount',qp.quoted_item_count,
   'isComplete',ic.total>0 AND qp.quoted_item_count=ic.total,
   'total',billing_private.decimal_text(qp.total)
  ) ORDER BY lower(coalesce(qp.provider_snapshot->>'legalName','')),qp.id)
   FROM provider_stats qp CROSS JOIN item_count ic),'[]'::jsonb),
  'negotiations',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',n.id,'providerId',n.quotation_provider_id,
   'itemId',n.quotation_item_id,'version',n.revision,
   'unitPrice',billing_private.decimal_text(n.unit_price),
   'notes',n.notes,'createdAt',n.created_at
  ) ORDER BY n.created_at,n.quotation_provider_id,n.quotation_item_id,n.revision,n.id)
   FROM public.billing_quotation_negotiations n
   WHERE n.owner_id=p_quote.owner_id AND n.quotation_id=p_quote.id),'[]'::jsonb),
  'winningProviderIds',coalesce((SELECT jsonb_agg(qp.id ORDER BY lower(
   coalesce(qp.provider_snapshot->>'legalName','')),qp.id)
   FROM provider_stats qp CROSS JOIN item_count ic CROSS JOIN complete_minimum cm
   WHERE ic.total>0 AND qp.quoted_item_count=ic.total AND qp.total=cm.total),'[]'::jsonb)
 )
$$;
REVOKE ALL ON FUNCTION billing_private.quotation_json(public.billing_quotations)
 FROM PUBLIC,anon,authenticated;

-- Wrap the current quotation dispatcher so all older routes and finalization
-- behavior stay intact. Only price recording and the post-history save guard
-- are added here.
ALTER FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 RENAME TO quotations_dispatch_before_negotiations;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch_before_negotiations(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotations_dispatch(
 p_resource text,p_action text,p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;
 v_quote_provider_id uuid;
 v_item_id uuid;
 v_quote public.billing_quotations;
 v_price numeric;
 v_revision integer;
 v_notes text;
BEGIN
 IF p_resource<>'quotations' OR p_action NOT IN ('record-negotiation','save') THEN
  RETURN billing_private.quotations_dispatch_before_negotiations(
   p_resource,p_action,p_payload);
 END IF;

 IF v_owner IS NULL OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 PERFORM billing_private.lock_request_actor();
 v_owner=billing_private.current_owner_id();
 PERFORM billing_private.authorize('registrations.write');

 -- The legacy save replaces all item/provider rows and can write prices directly.
 -- Keep it only for structure without prices, then freeze it after history begins.
 IF p_action='save' THEN
  IF jsonb_typeof(p_payload->'providers')='array' AND EXISTS(
   SELECT 1
   FROM jsonb_array_elements(p_payload->'providers') AS provider(entry)
   CROSS JOIN LATERAL jsonb_each_text(
    CASE WHEN jsonb_typeof(provider.entry->'values')='object'
     THEN provider.entry->'values' ELSE '{}'::jsonb END
   ) AS price(item_id,value)
   WHERE nullif(btrim(price.value),'') IS NOT NULL
  ) THEN
   RAISE EXCEPTION 'Registre os preços pela negociação da cotação.'
    USING ERRCODE='23514';
  END IF;
  IF p_payload IS NOT NULL AND jsonb_typeof(p_payload)='object'
   AND jsonb_typeof(p_payload->'id')='string'
   AND nullif(p_payload->>'id','') IS NOT NULL THEN
   BEGIN
    v_id=(p_payload->>'id')::uuid;
   EXCEPTION WHEN invalid_text_representation THEN
    RETURN billing_private.quotations_dispatch_before_negotiations(
     p_resource,p_action,p_payload);
   END;
   SELECT * INTO v_quote FROM public.billing_quotations
   WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
   IF FOUND AND EXISTS(
    SELECT 1 FROM public.billing_quotation_negotiations n
    WHERE n.owner_id=v_owner AND n.quotation_id=v_id
   ) THEN
    RAISE EXCEPTION 'A cotação com histórico de negociação não pode ser regravada.'
     USING ERRCODE='23514';
   END IF;
  END IF;
  RETURN billing_private.quotations_dispatch_before_negotiations(
   p_resource,p_action,p_payload);
 END IF;

 PERFORM billing_private.request_payload(p_payload,
  ARRAY['id','quotationProviderId','quotationItemId','unitPrice','notes']);
 IF jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'quotationProviderId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'quotationItemId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'unitPrice') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'notes') IS DISTINCT FROM 'string'
  OR length(p_payload->>'notes')>2000 THEN
  RAISE EXCEPTION 'Confira o prestador, o material, o valor e a observação.'
   USING ERRCODE='22023';
 END IF;
 v_id=nullif(p_payload->>'id','')::uuid;
 v_quote_provider_id=nullif(p_payload->>'quotationProviderId','')::uuid;
 v_item_id=nullif(p_payload->>'quotationItemId','')::uuid;
 IF v_id IS NULL OR v_quote_provider_id IS NULL OR v_item_id IS NULL
  OR nullif(btrim(p_payload->>'unitPrice'),'') IS NULL THEN
  RAISE EXCEPTION 'Informe a cotação, o prestador, o material e o valor.'
   USING ERRCODE='22023';
 END IF;
 v_price=replace(btrim(p_payload->>'unitPrice'),',','.')::numeric;
 IF v_price<0 OR v_price>=1000000000000 OR v_price<>round(v_price,2) THEN
  RAISE EXCEPTION 'Informe um valor com até duas casas decimais.'
   USING ERRCODE='22023';
 END IF;
 v_notes=btrim(p_payload->>'notes');

 -- SHARE coordinates recording with save/finalize/delete, while the narrow
 -- advisory lock serializes revisions only for the same provider/item pair.
 SELECT * INTO v_quote FROM public.billing_quotations
 WHERE owner_id=v_owner AND id=v_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE='P0002'; END IF;
 IF v_quote.status<>'open' THEN
  RAISE EXCEPTION 'Reabra a cotação antes de negociar valores.' USING ERRCODE='23514';
 END IF;
 PERFORM 1 FROM public.billing_quotation_providers qp
 WHERE qp.owner_id=v_owner AND qp.quotation_id=v_id AND qp.id=v_quote_provider_id
 FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Selecione um prestador desta cotação.' USING ERRCODE='23514';
 END IF;
 PERFORM 1 FROM public.billing_quotation_items i
 WHERE i.owner_id=v_owner AND i.quotation_id=v_id AND i.id=v_item_id
 FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Selecione um material desta cotação.' USING ERRCODE='23514';
 END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(
  'billing-quotation-negotiation:'||v_owner::text||':'||v_id::text||':'
   ||v_quote_provider_id::text||':'||v_item_id::text,0));
 SELECT coalesce(max(n.revision),0)+1 INTO v_revision
 FROM public.billing_quotation_negotiations n
 WHERE n.owner_id=v_owner AND n.quotation_id=v_id
  AND n.quotation_provider_id=v_quote_provider_id
  AND n.quotation_item_id=v_item_id;

 INSERT INTO public.billing_quotation_negotiations(
  owner_id,quotation_id,quotation_provider_id,quotation_item_id,
  revision,unit_price,notes
 ) VALUES(
  v_owner,v_id,v_quote_provider_id,v_item_id,v_revision,v_price,v_notes
 );
 INSERT INTO public.billing_quotation_provider_values(
  owner_id,quotation_id,quotation_provider_id,quotation_item_id,unit_price
 ) VALUES(v_owner,v_id,v_quote_provider_id,v_item_id,v_price)
 ON CONFLICT(owner_id,quotation_id,quotation_provider_id,quotation_item_id)
 DO UPDATE SET unit_price=excluded.unit_price,updated_at=now();

 RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote));
EXCEPTION
 WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Informe identificadores e valor válidos.' USING ERRCODE='22023';
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
    AND tablename='billing_quotation_negotiations'
  ) THEN
  ALTER PUBLICATION supabase_realtime
   ADD TABLE public.billing_quotation_negotiations;
 END IF;
END $$;

COMMENT ON TABLE public.billing_quotation_negotiations IS
 'Append-only price revisions for each quotation provider and item; current values remain in billing_quotation_provider_values.';
COMMENT ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb) IS
 'Owner-scoped quotation aggregate with append-only record-negotiation, immutable history after the first price and atomic current-value projection.';
