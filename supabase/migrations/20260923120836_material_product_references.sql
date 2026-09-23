-- A material is one physical product with one image. The child rows are only
-- equivalent manufacturer references (brand + code), not image variants.
ALTER TABLE public.billing_material_variants
 ADD COLUMN brand text NOT NULL DEFAULT '' CHECK(length(brand)<=100);

-- If a photo was added while codes were treated as variants, promote the
-- oldest available image to the product without deleting any storage object.
UPDATE public.billing_materials m SET image_key=source.image_key,image_name=source.image_name
FROM (
 SELECT DISTINCT ON (owner_id,material_id) owner_id,material_id,image_key,image_name
 FROM public.billing_material_variants
 WHERE image_key IS NOT NULL
 ORDER BY owner_id,material_id,created_at,id
) source
WHERE m.owner_id=source.owner_id AND m.id=source.material_id AND m.image_key IS NULL;

ALTER TABLE public.billing_material_variants
 DROP CONSTRAINT IF EXISTS billing_material_variants_owner_id_code_key;
CREATE UNIQUE INDEX billing_material_references_owner_brand_code
 ON public.billing_material_variants(owner_id,lower(brand),lower(code));

ALTER TABLE public.billing_quotation_items
 ADD COLUMN material_references jsonb NOT NULL DEFAULT '[]'::jsonb,
 ADD CONSTRAINT billing_quotation_items_material_references_check
 CHECK(jsonb_typeof(material_references)='array');

UPDATE public.billing_quotation_items i SET material_references=coalesce((
 SELECT jsonb_agg(jsonb_build_object('brand',v.brand,'code',v.code)
  ORDER BY lower(v.brand),lower(v.code),v.id)
 FROM public.billing_material_variants v
 WHERE v.owner_id=i.owner_id AND v.material_id=i.material_id
),'[]'::jsonb);

CREATE OR REPLACE FUNCTION billing_private.material_variant_json(p_variant public.billing_material_variants)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p_variant.id,'materialId',p_variant.material_id,'brand',p_variant.brand,
  'code',p_variant.code,'createdAt',p_variant.created_at,'updatedAt',p_variant.updated_at
 )
$$;

CREATE OR REPLACE FUNCTION billing_private.material_catalog_json(p_material public.billing_materials)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 WITH material_refs AS (
  SELECT coalesce(jsonb_agg(billing_private.material_variant_json(v)
   ORDER BY lower(v.brand),lower(v.code),v.id),'[]'::jsonb) AS value
  FROM public.billing_material_variants v
  WHERE v.owner_id=p_material.owner_id AND v.material_id=p_material.id
 )
 SELECT jsonb_build_object(
  'id',p_material.id,'name',p_material.name,'unit',p_material.unit,
  'application',p_material.application,'imageKey',p_material.image_key,
  'imageName',p_material.image_name,'createdAt',p_material.created_at,
  'updatedAt',p_material.updated_at,'references',material_refs.value,
  -- Temporary alias keeps a cached client from crashing during deployment.
  'variants',material_refs.value
 ) FROM material_refs
$$;

CREATE OR REPLACE FUNCTION billing_private.material_catalog_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;
 v_material public.billing_materials;
 v_result jsonb;
 v_image_key text;
 v_image_name text;
 v_previous_image_key text;
 v_remove_image boolean:=false;
 v_image_keys jsonb:='[]'::jsonb;
BEGIN
 IF v_owner IS NULL OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR p_action NOT IN ('list','get','save','delete') THEN
  RAISE EXCEPTION 'Operação de material inválida.' USING ERRCODE='22023';
 END IF;
 IF p_action IN ('list','get') THEN PERFORM billing_private.authorize('registrations.read');
 ELSE PERFORM billing_private.lock_request_actor();PERFORM billing_private.authorize('registrations.write'); END IF;

 IF p_action='list' THEN
  PERFORM billing_private.request_payload(p_payload,ARRAY[]::text[]);
  SELECT coalesce(jsonb_agg(billing_private.material_catalog_json(m)
   ORDER BY lower(m.name),m.id),'[]'::jsonb) INTO v_result
  FROM public.billing_materials m WHERE m.owner_id=v_owner;
  RETURN jsonb_build_object('materials',v_result);
 END IF;

 PERFORM billing_private.request_payload(p_payload,
  CASE WHEN p_action='save' THEN
   ARRAY['id','name','unit','application','imageKey','imageName','removeImage']
  ELSE ARRAY['id'] END);
 v_id=nullif(p_payload->>'id','')::uuid;
 IF v_id IS NULL AND p_action<>'save' THEN
  RAISE EXCEPTION 'Informe o material.' USING ERRCODE='22023';
 END IF;
 IF p_action='get' THEN
  SELECT * INTO v_material FROM public.billing_materials WHERE owner_id=v_owner AND id=v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material não encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('material',billing_private.material_catalog_json(v_material));
 END IF;
 IF p_action='delete' THEN
  SELECT coalesce(jsonb_agg(key),'[]'::jsonb) INTO v_image_keys FROM (
   SELECT image_key AS key FROM public.billing_materials
    WHERE owner_id=v_owner AND id=v_id AND image_key IS NOT NULL
   UNION
   SELECT image_key FROM public.billing_material_variants
    WHERE owner_id=v_owner AND material_id=v_id AND image_key IS NOT NULL
  ) images;
  DELETE FROM public.billing_materials WHERE owner_id=v_owner AND id=v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material não encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('id',v_id,'deleted',true,'imageKeys',v_image_keys);
 END IF;

 IF jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'unit') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'application') IS DISTINCT FROM 'string'
  OR length(btrim(p_payload->>'name')) NOT BETWEEN 2 AND 150
  OR length(btrim(p_payload->>'unit')) NOT BETWEEN 1 AND 30
  OR length(p_payload->>'application')>1000 THEN
  RAISE EXCEPTION 'Preencha nome e unidade do material corretamente.' USING ERRCODE='22023';
 END IF;
 IF v_id IS NOT NULL THEN
  SELECT * INTO v_material FROM public.billing_materials
   WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material não encontrado.' USING ERRCODE='P0002'; END IF;
  v_previous_image_key=v_material.image_key;
 END IF;
 IF p_payload ? 'removeImage' THEN
  IF jsonb_typeof(p_payload->'removeImage') IS DISTINCT FROM 'boolean' THEN
   RAISE EXCEPTION 'A opção de remover a foto é inválida.' USING ERRCODE='22023';
  END IF;
  v_remove_image=(p_payload->>'removeImage')::boolean;
 END IF;
 IF v_remove_image THEN
  v_image_key=NULL;v_image_name='';
 ELSIF p_payload ? 'imageKey' THEN
  IF jsonb_typeof(p_payload->'imageKey') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_payload->'imageName') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Envie uma foto válida.' USING ERRCODE='22023';
  END IF;
  v_image_key=nullif(btrim(p_payload->>'imageKey'),'');v_image_name=btrim(p_payload->>'imageName');
  IF v_image_key IS NULL OR length(v_image_key)>500
   OR length(v_image_name) NOT BETWEEN 1 AND 255
   OR v_image_key NOT LIKE v_owner::text || '/materials/%'
   OR NOT EXISTS(SELECT 1 FROM storage.objects
    WHERE bucket_id='billing-material-images' AND name=v_image_key) THEN
   RAISE EXCEPTION 'Envie uma foto válida para este espaço antes de salvar.' USING ERRCODE='23514';
  END IF;
 ELSE
  v_image_key=v_material.image_key;v_image_name=coalesce(v_material.image_name,'');
 END IF;
 IF v_id IS NULL THEN
  INSERT INTO public.billing_materials(owner_id,name,code,unit,application,image_key,image_name)
  VALUES(v_owner,btrim(p_payload->>'name'),NULL,btrim(p_payload->>'unit'),
   btrim(p_payload->>'application'),v_image_key,v_image_name) RETURNING * INTO v_material;
 ELSE
  UPDATE public.billing_materials SET name=btrim(p_payload->>'name'),
   unit=btrim(p_payload->>'unit'),application=btrim(p_payload->>'application'),
   image_key=v_image_key,image_name=v_image_name
  WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_material;
 END IF;
 RETURN jsonb_build_object('material',billing_private.material_catalog_json(v_material),
  'previousImageKey',v_previous_image_key);
EXCEPTION
 WHEN foreign_key_violation THEN
  RAISE EXCEPTION 'Este material possui vínculos ou pertence a outro espaço.' USING ERRCODE='23503';
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Informe um material válido.' USING ERRCODE='22023';
END $$;

CREATE OR REPLACE FUNCTION billing_private.material_variants_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;
 v_material_id uuid;
 v_reference public.billing_material_variants;
BEGIN
 IF v_owner IS NULL OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR p_action NOT IN ('get','save','delete') THEN
  RAISE EXCEPTION 'Operação de referência inválida.' USING ERRCODE='22023';
 END IF;
 IF p_action='get' THEN PERFORM billing_private.authorize('registrations.read');
 ELSE PERFORM billing_private.lock_request_actor();PERFORM billing_private.authorize('registrations.write'); END IF;
 PERFORM billing_private.request_payload(p_payload,
  CASE WHEN p_action='save' THEN ARRAY['id','materialId','brand','code'] ELSE ARRAY['id'] END);
 v_id=nullif(p_payload->>'id','')::uuid;
 IF v_id IS NULL AND p_action<>'save' THEN
  RAISE EXCEPTION 'Informe a referência.' USING ERRCODE='22023';
 END IF;
 IF p_action='get' THEN
  SELECT * INTO v_reference FROM public.billing_material_variants WHERE owner_id=v_owner AND id=v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Referência não encontrada.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('reference',billing_private.material_variant_json(v_reference));
 END IF;
 IF p_action='delete' THEN
  DELETE FROM public.billing_material_variants WHERE owner_id=v_owner AND id=v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Referência não encontrada.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('id',v_id,'deleted',true);
 END IF;
 IF jsonb_typeof(p_payload->'materialId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'brand') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'code') IS DISTINCT FROM 'string'
  OR length(btrim(p_payload->>'brand'))>100
  OR length(btrim(p_payload->>'code')) NOT BETWEEN 1 AND 60 THEN
  RAISE EXCEPTION 'Preencha a marca e o código da referência corretamente.' USING ERRCODE='22023';
 END IF;
 v_material_id=nullif(p_payload->>'materialId','')::uuid;
 PERFORM 1 FROM public.billing_materials WHERE owner_id=v_owner AND id=v_material_id FOR SHARE;
 IF v_material_id IS NULL OR NOT FOUND THEN
  RAISE EXCEPTION 'Selecione um material deste espaço.' USING ERRCODE='23514';
 END IF;
 IF v_id IS NULL THEN
  INSERT INTO public.billing_material_variants(owner_id,material_id,brand,code,application)
  VALUES(v_owner,v_material_id,btrim(p_payload->>'brand'),btrim(p_payload->>'code'),'')
  RETURNING * INTO v_reference;
 ELSE
  UPDATE public.billing_material_variants SET brand=btrim(p_payload->>'brand'),code=btrim(p_payload->>'code')
  WHERE owner_id=v_owner AND id=v_id AND material_id=v_material_id RETURNING * INTO v_reference;
  IF NOT FOUND THEN RAISE EXCEPTION 'Referência não encontrada neste material.' USING ERRCODE='P0002'; END IF;
 END IF;
 RETURN jsonb_build_object('reference',billing_private.material_variant_json(v_reference));
EXCEPTION
 WHEN unique_violation THEN
  RAISE EXCEPTION 'Esta marca e este código já estão cadastrados.' USING ERRCODE='23505';
 WHEN foreign_key_violation THEN
  RAISE EXCEPTION 'Esta referência possui vínculos ou pertence a outro espaço.' USING ERRCODE='23503';
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Informe uma referência válida.' USING ERRCODE='22023';
END $$;

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
  'requestDate',p_quote.request_date,'requester',p_quote.requester,'notes',p_quote.notes,
  'status',p_quote.status,'createdAt',p_quote.created_at,'updatedAt',p_quote.updated_at,
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

ALTER FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 RENAME TO quotations_dispatch_before_product_references;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch_before_product_references(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotations_dispatch(p_resource text,p_action text,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_payload jsonb:=p_payload;
 v_items jsonb:='[]'::jsonb;
 v_item jsonb;
 v_quote public.billing_quotations;
 v_quote_id uuid;
 v_material_id uuid;
 v_result jsonb;
BEGIN
 IF p_resource='quotations' AND p_action='save' THEN
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
   OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Confira os materiais da cotação.' USING ERRCODE='22023';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
   v_items=v_items||jsonb_build_array(v_item-'materialReferences');
  END LOOP;
  v_payload=jsonb_set(p_payload,'{items}',v_items,false);
 END IF;
 v_result=billing_private.quotations_dispatch_before_product_references(p_resource,p_action,v_payload);
 IF p_resource='quotations' AND p_action='save' THEN
  v_quote_id=(v_result->'quote'->>'id')::uuid;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
   v_material_id=nullif(v_item->>'materialId','')::uuid;
   UPDATE public.billing_quotation_items i SET material_references=coalesce((
    SELECT jsonb_agg(jsonb_build_object('brand',r.brand,'code',r.code)
     ORDER BY lower(r.brand),lower(r.code),r.id)
    FROM public.billing_material_variants r
    WHERE r.owner_id=v_owner AND r.material_id=v_material_id
   ),'[]'::jsonb)
   WHERE i.owner_id=v_owner AND i.quotation_id=v_quote_id
    AND i.id=nullif(v_item->>'id','')::uuid;
  END LOOP;
  SELECT * INTO v_quote FROM public.billing_quotations WHERE owner_id=v_owner AND id=v_quote_id;
  v_result=jsonb_set(v_result,'{quote}',billing_private.quotation_json(v_quote),false);
 END IF;
 RETURN v_result;
EXCEPTION WHEN invalid_text_representation THEN
 RAISE EXCEPTION 'Selecione materiais válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb) TO authenticated;

COMMENT ON COLUMN public.billing_material_variants.brand IS
 'Optional manufacturer/brand for an equivalent material reference code.';
COMMENT ON COLUMN public.billing_quotation_items.material_references IS
 'Immutable array of equivalent brand/code references available when the quotation was saved.';
