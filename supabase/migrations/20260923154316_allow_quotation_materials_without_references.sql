-- Equivalent manufacturer references enrich a quotation item, but they are
-- optional in the material catalog. Keep the live reference pointer nullable
-- and always snapshot the product's own internal code and application.
UPDATE public.billing_quotation_items i SET
 material_code=coalesce(m.code,''),
 material_application=coalesce(m.application,'')
FROM public.billing_materials m
WHERE m.owner_id=i.owner_id AND m.id=i.material_id
 AND (i.material_code IS DISTINCT FROM coalesce(m.code,'')
  OR i.material_application IS DISTINCT FROM coalesce(m.application,''));

CREATE OR REPLACE FUNCTION billing_private.quotations_dispatch_before_product_references(
 p_resource text,p_action text,p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_payload jsonb:=p_payload;
 v_items jsonb;
 v_item jsonb;
 v_variant_id uuid;
 v_material_id uuid;
 v_item_id uuid;
 v_variant public.billing_material_variants;
 v_material public.billing_materials;
 v_has_variant boolean;
 v_quote public.billing_quotations;
 v_result jsonb;
BEGIN
 IF p_resource='materials' THEN
  RETURN billing_private.material_catalog_dispatch(p_action,p_payload);
 END IF;
 IF p_resource='quotations' AND p_action='save' THEN
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
   OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Confira os materiais da cotação.' USING ERRCODE='22023';
  END IF;
  v_items='[]'::jsonb;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
   IF jsonb_typeof(v_item)<>'object' THEN
    RAISE EXCEPTION 'Confira os materiais da cotação.' USING ERRCODE='22023';
   END IF;
   v_material_id=nullif(v_item->>'materialId','')::uuid;
   SELECT * INTO v_material FROM public.billing_materials
    WHERE owner_id=v_owner AND id=v_material_id FOR SHARE;
   IF NOT FOUND THEN
    RAISE EXCEPTION 'Selecione materiais cadastrados neste espaço.' USING ERRCODE='23514';
   END IF;

   v_variant_id=nullif(v_item->>'materialVariantId','')::uuid;
   IF v_variant_id IS NULL THEN
    SELECT * INTO v_variant FROM public.billing_material_variants
     WHERE owner_id=v_owner AND material_id=v_material_id
     ORDER BY created_at,id LIMIT 1 FOR SHARE;
    v_has_variant=FOUND;
   ELSE
    SELECT * INTO v_variant FROM public.billing_material_variants
     WHERE owner_id=v_owner AND id=v_variant_id AND material_id=v_material_id FOR SHARE;
    v_has_variant=FOUND;
    IF NOT v_has_variant THEN
     RAISE EXCEPTION 'Selecione uma referência válida para o material.' USING ERRCODE='23514';
    END IF;
   END IF;
   v_items=v_items||jsonb_build_array(
    v_item-'materialVariantId'-'materialCode'-'materialApplication');
  END LOOP;

  v_payload=jsonb_set(p_payload,'{items}',v_items,false);
  v_result=billing_private.quotations_dispatch_before_material_variants(
   p_resource,p_action,v_payload);

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
   v_item_id=nullif(v_item->>'id','')::uuid;
   v_material_id=nullif(v_item->>'materialId','')::uuid;
   SELECT * INTO v_material FROM public.billing_materials
    WHERE owner_id=v_owner AND id=v_material_id;
   v_variant_id=nullif(v_item->>'materialVariantId','')::uuid;
   IF v_variant_id IS NULL THEN
    SELECT * INTO v_variant FROM public.billing_material_variants
     WHERE owner_id=v_owner AND material_id=v_material_id
     ORDER BY created_at,id LIMIT 1;
    v_has_variant=FOUND;
   ELSE
    SELECT * INTO v_variant FROM public.billing_material_variants
     WHERE owner_id=v_owner AND id=v_variant_id AND material_id=v_material_id;
    v_has_variant=FOUND;
   END IF;
   UPDATE public.billing_quotation_items SET
    material_variant_id=CASE WHEN v_has_variant THEN v_variant.id ELSE NULL END,
    material_code=coalesce(v_material.code,''),
    material_application=coalesce(v_material.application,'')
   WHERE owner_id=v_owner
    AND quotation_id=(v_result->'quote'->>'id')::uuid
    AND id=v_item_id;
  END LOOP;

  SELECT * INTO v_quote FROM public.billing_quotations
   WHERE owner_id=v_owner AND id=(v_result->'quote'->>'id')::uuid;
  RETURN jsonb_set(v_result,'{quote}',billing_private.quotation_json(v_quote),false);
 END IF;
 RETURN billing_private.quotations_dispatch_before_material_variants(
  p_resource,p_action,p_payload);
EXCEPTION
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Selecione materiais e referências válidas.' USING ERRCODE='22023';
END $$;

REVOKE ALL ON FUNCTION billing_private.quotations_dispatch_before_product_references(
 text,text,jsonb) FROM PUBLIC,anon,authenticated;

COMMENT ON COLUMN public.billing_quotation_items.material_code IS
 'Immutable internal product code snapshot saved with the quotation item.';
COMMENT ON COLUMN public.billing_quotation_items.material_variant_id IS
 'Optional live pointer to an equivalent reference; null when the product has no references or the reference was deleted.';

COMMENT ON FUNCTION billing_private.quotations_dispatch_before_product_references(
 text,text,jsonb) IS
 'Snapshots quotation materials while allowing products without equivalent references.';
