-- Expose the server-calculated quotation comparison. Only providers with a
-- value for every material compete; every equal lowest total is a winner.
CREATE OR REPLACE FUNCTION billing_private.quotation_json(p_quote public.billing_quotations) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH item_count AS (
  SELECT count(*)::integer AS total
  FROM public.billing_quotation_items i
  WHERE i.owner_id=p_quote.owner_id AND i.quotation_id=p_quote.id
 ), provider_stats AS (
  SELECT qp.*,
   (SELECT count(*)::integer
    FROM public.billing_quotation_provider_values qv
    WHERE qv.owner_id=qp.owner_id AND qv.quotation_id=qp.quotation_id
     AND qv.quotation_provider_id=qp.id) AS quoted_item_count,
   coalesce((SELECT sum(i.quantity*qv.unit_price)
    FROM public.billing_quotation_provider_values qv
    JOIN public.billing_quotation_items i
     ON i.owner_id=qv.owner_id AND i.quotation_id=qv.quotation_id AND i.id=qv.quotation_item_id
    WHERE qv.owner_id=qp.owner_id AND qv.quotation_id=qp.quotation_id
     AND qv.quotation_provider_id=qp.id),0::numeric) AS total
  FROM public.billing_quotation_providers qp
  WHERE qp.owner_id=p_quote.owner_id AND qp.quotation_id=p_quote.id
 ), complete_minimum AS (
  SELECT min(ps.total) AS total
  FROM provider_stats ps CROSS JOIN item_count ic
  WHERE ic.total>0 AND ps.quoted_item_count=ic.total
 )
 SELECT jsonb_build_object(
  'id',p_quote.id,'title',p_quote.title,'number',p_quote.quotation_number,
  'requestDate',p_quote.request_date,'requester',p_quote.requester,'notes',p_quote.notes,
  'status',p_quote.status,'createdAt',p_quote.created_at,'updatedAt',p_quote.updated_at,
  'items',coalesce((
   SELECT jsonb_agg(jsonb_build_object(
    'id',i.id,'materialId',i.material_id,'materialName',i.material_name,
    'quantity',billing_private.decimal_text(i.quantity),'unit',i.unit,'notes',i.notes
   ) ORDER BY i.created_at,i.id)
   FROM public.billing_quotation_items i
   WHERE i.owner_id=p_quote.owner_id AND i.quotation_id=p_quote.id
  ),'[]'::jsonb),
  'providers',coalesce((
   SELECT jsonb_agg(jsonb_build_object(
    'id',qp.id,'providerId',qp.provider_id,
    'providerName',qp.provider_snapshot->>'legalName',
    'providerEmail',coalesce(qp.provider_snapshot->>'email',''),
    'providerPhone',coalesce(qp.provider_snapshot->>'phone',''),
    'provider',qp.provider_snapshot,'notes',qp.notes,'sentAt',qp.sent_at,
    'values',coalesce((
     SELECT jsonb_object_agg(i.id::text,coalesce(billing_private.decimal_text(qv.unit_price),'') ORDER BY i.created_at,i.id)
     FROM public.billing_quotation_items i
     LEFT JOIN public.billing_quotation_provider_values qv
      ON qv.owner_id=i.owner_id AND qv.quotation_id=i.quotation_id
      AND qv.quotation_provider_id=qp.id AND qv.quotation_item_id=i.id
     WHERE i.owner_id=p_quote.owner_id AND i.quotation_id=p_quote.id
    ),'{}'::jsonb),
    'quotedItemCount',qp.quoted_item_count,
    'isComplete',ic.total>0 AND qp.quoted_item_count=ic.total,
    'total',billing_private.decimal_text(qp.total)
   ) ORDER BY lower(coalesce(qp.provider_snapshot->>'legalName','')),qp.id)
   FROM provider_stats qp CROSS JOIN item_count ic
  ),'[]'::jsonb),
  'winningProviderIds',coalesce((
   SELECT jsonb_agg(qp.id ORDER BY lower(coalesce(qp.provider_snapshot->>'legalName','')),qp.id)
   FROM provider_stats qp CROSS JOIN item_count ic CROSS JOIN complete_minimum cm
   WHERE ic.total>0 AND qp.quoted_item_count=ic.total AND qp.total=cm.total
  ),'[]'::jsonb)
 )
$$;
REVOKE ALL ON FUNCTION billing_private.quotation_json(public.billing_quotations) FROM PUBLIC,anon,authenticated;
COMMENT ON FUNCTION billing_private.quotation_json(public.billing_quotations) IS
 'Immutable quotation projection with database totals, complete-proposal status and all tied lowest-total winners.';
