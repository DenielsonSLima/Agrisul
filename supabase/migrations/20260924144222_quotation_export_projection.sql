-- Enrich the owner-scoped quotation projection with operational flags and only
-- the image keys that belong to the quotation items. Business decisions stay
-- in Postgres; the browser only signs these private Storage paths and renders.
ALTER FUNCTION billing_private.quotation_json(public.billing_quotations)
 RENAME TO quotation_json_before_export_projection;

REVOKE ALL ON FUNCTION billing_private.quotation_json_before_export_projection(
 public.billing_quotations
) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotation_json(
 p_quote public.billing_quotations
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE
 v_result jsonb:=billing_private.quotation_json_before_export_projection(p_quote);
 v_items jsonb;
 v_providers jsonb;
 v_item_count integer;
 v_award_count integer;
 v_complete_provider_count integer;
BEGIN
 SELECT count(*)::integer INTO v_item_count
 FROM public.billing_quotation_items i
 WHERE i.owner_id=p_quote.owner_id AND i.quotation_id=p_quote.id;

 SELECT count(*)::integer INTO v_award_count
 FROM public.billing_quotation_item_awards a
 WHERE a.owner_id=p_quote.owner_id AND a.quotation_id=p_quote.id;

 SELECT count(*)::integer INTO v_complete_provider_count
 FROM public.billing_quotation_providers qp
 WHERE qp.owner_id=p_quote.owner_id AND qp.quotation_id=p_quote.id
  AND v_item_count>0
  AND (SELECT count(*) FROM public.billing_quotation_provider_values qv
   WHERE qv.owner_id=qp.owner_id AND qv.quotation_id=qp.quotation_id
    AND qv.quotation_provider_id=qp.id)=v_item_count;

 SELECT coalesce(jsonb_agg(
  entry.value || jsonb_build_object(
   'materialImageKey',coalesce(variant.image_key,material.image_key),
   'materialImageName',coalesce(variant.image_name,material.image_name,''),
   'canRemove',p_quote.status='open' AND v_item_count>1
    AND NOT EXISTS(SELECT 1 FROM public.billing_quotation_provider_values qv
     WHERE qv.owner_id=item.owner_id AND qv.quotation_id=item.quotation_id
      AND qv.quotation_item_id=item.id)
    AND NOT EXISTS(SELECT 1 FROM public.billing_quotation_negotiations n
     WHERE n.owner_id=item.owner_id AND n.quotation_id=item.quotation_id
      AND n.quotation_item_id=item.id)
    AND NOT EXISTS(SELECT 1 FROM public.billing_quotation_item_awards a
     WHERE a.owner_id=item.owner_id AND a.quotation_id=item.quotation_id
      AND a.quotation_item_id=item.id),
   'removeBlockedReason',CASE
    WHEN p_quote.status<>'open' THEN 'Apenas cotações em aberto podem ter o escopo alterado.'
    WHEN v_item_count<=1 THEN 'A cotação precisa manter ao menos um material.'
    WHEN EXISTS(SELECT 1 FROM public.billing_quotation_provider_values qv
       WHERE qv.owner_id=item.owner_id AND qv.quotation_id=item.quotation_id
        AND qv.quotation_item_id=item.id)
     OR EXISTS(SELECT 1 FROM public.billing_quotation_negotiations n
       WHERE n.owner_id=item.owner_id AND n.quotation_id=item.quotation_id
        AND n.quotation_item_id=item.id)
     OR EXISTS(SELECT 1 FROM public.billing_quotation_item_awards a
       WHERE a.owner_id=item.owner_id AND a.quotation_id=item.quotation_id
        AND a.quotation_item_id=item.id)
     THEN 'Materiais com preço, histórico ou aprovação não podem ser removidos.'
    ELSE '' END
  ) ORDER BY entry.position
 ),'[]'::jsonb) INTO v_items
 FROM jsonb_array_elements(v_result->'items') WITH ORDINALITY entry(value,position)
 JOIN public.billing_quotation_items item
  ON item.owner_id=p_quote.owner_id AND item.quotation_id=p_quote.id
  AND item.id=(entry.value->>'id')::uuid
 LEFT JOIN public.billing_material_variants variant
  ON variant.owner_id=item.owner_id AND variant.material_id=item.material_id
  AND variant.id=item.material_variant_id
 LEFT JOIN public.billing_materials material
  ON material.owner_id=item.owner_id AND material.id=item.material_id;

 SELECT coalesce(jsonb_agg(
  entry.value || jsonb_build_object(
   'canRemove',p_quote.status='open'
    AND NOT EXISTS(SELECT 1 FROM public.billing_quotation_provider_values qv
     WHERE qv.owner_id=provider.owner_id AND qv.quotation_id=provider.quotation_id
      AND qv.quotation_provider_id=provider.id)
    AND NOT EXISTS(SELECT 1 FROM public.billing_quotation_negotiations n
     WHERE n.owner_id=provider.owner_id AND n.quotation_id=provider.quotation_id
      AND n.quotation_provider_id=provider.id)
    AND NOT EXISTS(SELECT 1 FROM public.billing_quotation_item_awards a
     WHERE a.owner_id=provider.owner_id AND a.quotation_id=provider.quotation_id
      AND a.quotation_provider_id=provider.id),
   'removeBlockedReason',CASE
    WHEN p_quote.status<>'open' THEN 'Apenas cotações em aberto podem ter o escopo alterado.'
    WHEN EXISTS(SELECT 1 FROM public.billing_quotation_provider_values qv
       WHERE qv.owner_id=provider.owner_id AND qv.quotation_id=provider.quotation_id
        AND qv.quotation_provider_id=provider.id)
     OR EXISTS(SELECT 1 FROM public.billing_quotation_negotiations n
       WHERE n.owner_id=provider.owner_id AND n.quotation_id=provider.quotation_id
        AND n.quotation_provider_id=provider.id)
     OR EXISTS(SELECT 1 FROM public.billing_quotation_item_awards a
       WHERE a.owner_id=provider.owner_id AND a.quotation_id=provider.quotation_id
        AND a.quotation_provider_id=provider.id)
     THEN 'Fornecedores com preço, histórico ou aprovação não podem ser removidos.'
    ELSE '' END
  ) ORDER BY entry.position
 ),'[]'::jsonb) INTO v_providers
 FROM jsonb_array_elements(v_result->'providers') WITH ORDINALITY entry(value,position)
 JOIN public.billing_quotation_providers provider
  ON provider.owner_id=p_quote.owner_id AND provider.quotation_id=p_quote.id
  AND provider.id=(entry.value->>'id')::uuid;

 RETURN v_result || jsonb_build_object(
  'items',v_items,
  'providers',v_providers,
  'completeProviderCount',v_complete_provider_count,
  'pendingAwardCount',greatest(v_item_count-v_award_count,0)
 );
END $$;

REVOKE ALL ON FUNCTION billing_private.quotation_json(public.billing_quotations)
 FROM PUBLIC,anon,authenticated;

COMMENT ON FUNCTION billing_private.quotation_json(public.billing_quotations) IS
 'Owner-scoped quotation projection. Totals, completion, removal rules, awards and export image scope are calculated in Postgres.';
