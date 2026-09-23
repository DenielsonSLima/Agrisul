-- Materials are catalog products. Each product can have many purchasable
-- codes/variants, and every variant owns its application and private photo.
CREATE TABLE public.billing_material_variants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
 material_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 code text NOT NULL CHECK(length(btrim(code)) BETWEEN 1 AND 60),
 application text NOT NULL DEFAULT '' CHECK(length(application)<=1000),
 image_key text,
 image_name text NOT NULL DEFAULT '',
 UNIQUE(owner_id,id),
 UNIQUE(owner_id,code),
 FOREIGN KEY(owner_id,material_id)
  REFERENCES public.billing_materials(owner_id,id) ON DELETE CASCADE,
 CONSTRAINT billing_material_variants_image_key_owner CHECK(
  image_key IS NULL OR (length(image_key)<=500 AND image_key LIKE owner_id::text || '/materials/%')
 ),
 CONSTRAINT billing_material_variants_image_name CHECK(
  (image_key IS NULL AND image_name='')
  OR (image_key IS NOT NULL AND length(btrim(image_name)) BETWEEN 1 AND 255)
 )
);
CREATE INDEX billing_material_variants_material
 ON public.billing_material_variants(owner_id,material_id,lower(code),id);
ALTER TABLE public.billing_material_variants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_material_variants FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_material_variants TO authenticated;
CREATE POLICY billing_material_variants_read ON public.billing_material_variants
 FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'registrations.read'));
CREATE TRIGGER billing_touch_updated_at
 BEFORE UPDATE ON public.billing_material_variants
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();

-- Every old material becomes a product with one initial code. Nothing already
-- registered is discarded, including its image reference.
INSERT INTO public.billing_material_variants(
 owner_id,material_id,created_at,updated_at,code,application,image_key,image_name
)
SELECT owner_id,id,created_at,updated_at,code,application,image_key,image_name
FROM public.billing_materials;

ALTER TABLE public.billing_materials
 DROP CONSTRAINT IF EXISTS billing_materials_owner_id_code_key,
 DROP CONSTRAINT IF EXISTS billing_materials_code_check;
ALTER TABLE public.billing_materials ALTER COLUMN code DROP NOT NULL;
ALTER TABLE public.billing_materials
 ADD CONSTRAINT billing_materials_legacy_code_check
 CHECK(code IS NULL OR length(btrim(code)) BETWEEN 1 AND 60);

ALTER TABLE public.billing_quotation_items
 ADD COLUMN material_variant_id uuid,
 ADD COLUMN material_code text NOT NULL DEFAULT '',
 ADD COLUMN material_application text NOT NULL DEFAULT '';

WITH first_variants AS (
 SELECT DISTINCT ON (mv.owner_id,mv.material_id)
  mv.owner_id,mv.material_id,mv.id,mv.code,mv.application
 FROM public.billing_material_variants mv
 ORDER BY mv.owner_id,mv.material_id,mv.created_at,mv.id
)
UPDATE public.billing_quotation_items i SET
 material_variant_id=v.id,
 material_code=v.code,
 material_application=v.application
FROM first_variants v
WHERE v.owner_id=i.owner_id AND v.material_id=i.material_id;

ALTER TABLE public.billing_quotation_items
 ADD CONSTRAINT billing_quotation_items_material_variant_fk
 FOREIGN KEY(owner_id,material_variant_id)
 REFERENCES public.billing_material_variants(owner_id,id),
 ADD CONSTRAINT billing_quotation_items_material_code_check
 CHECK(length(material_code)<=60),
 ADD CONSTRAINT billing_quotation_items_material_application_check
 CHECK(length(material_application)<=1000);
CREATE INDEX billing_quotation_items_material_variant
 ON public.billing_quotation_items(owner_id,material_variant_id);

CREATE FUNCTION billing_private.material_variant_json(p_variant public.billing_material_variants)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p_variant.id,'materialId',p_variant.material_id,'code',p_variant.code,
  'application',p_variant.application,'imageKey',p_variant.image_key,
  'imageName',p_variant.image_name,'createdAt',p_variant.created_at,
  'updatedAt',p_variant.updated_at
 )
$$;
REVOKE ALL ON FUNCTION billing_private.material_variant_json(public.billing_material_variants)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.material_variant_json(public.billing_material_variants)
 TO authenticated;

CREATE FUNCTION billing_private.material_catalog_json(p_material public.billing_materials)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 WITH variants AS (
  SELECT coalesce(jsonb_agg(billing_private.material_variant_json(v)
   ORDER BY lower(v.code),v.id),'[]'::jsonb) AS value
  FROM public.billing_material_variants v
  WHERE v.owner_id=p_material.owner_id AND v.material_id=p_material.id
 ), first_variant AS (
  SELECT v.* FROM public.billing_material_variants v
  WHERE v.owner_id=p_material.owner_id AND v.material_id=p_material.id
  ORDER BY v.created_at,v.id LIMIT 1
 )
 SELECT jsonb_build_object(
  'id',p_material.id,'name',p_material.name,'unit',p_material.unit,
  'application',p_material.application,'createdAt',p_material.created_at,
  'updatedAt',p_material.updated_at,'variants',variants.value,
  'code',coalesce(first_variant.code,''),'imageKey',first_variant.image_key,
  'imageName',coalesce(first_variant.image_name,'')
 ) FROM variants LEFT JOIN first_variant ON true
$$;
REVOKE ALL ON FUNCTION billing_private.material_catalog_json(public.billing_materials)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.material_catalog_json(public.billing_materials)
 TO authenticated;

CREATE FUNCTION billing_private.material_catalog_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;
 v_material public.billing_materials;
 v_variant public.billing_material_variants;
 v_result jsonb;
 v_code text;
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
 IF p_action IN ('list','get') THEN
  PERFORM billing_private.authorize('registrations.read');
 ELSE
  PERFORM billing_private.lock_request_actor();
  PERFORM billing_private.authorize('registrations.write');
 END IF;

 IF p_action='list' THEN
  PERFORM billing_private.request_payload(p_payload,ARRAY[]::text[]);
  SELECT coalesce(jsonb_agg(billing_private.material_catalog_json(m)
   ORDER BY lower(m.name),m.id),'[]'::jsonb) INTO v_result
  FROM public.billing_materials m WHERE m.owner_id=v_owner;
  RETURN jsonb_build_object('materials',v_result);
 END IF;

 PERFORM billing_private.request_payload(p_payload,
  CASE WHEN p_action='save' THEN
   ARRAY['id','name','unit','application','code','imageKey','imageName','removeImage']
  ELSE ARRAY['id'] END);
 v_id=nullif(p_payload->>'id','')::uuid;
 IF v_id IS NULL AND p_action<>'save' THEN
  RAISE EXCEPTION 'Informe o material.' USING ERRCODE='22023';
 END IF;

 IF p_action='get' THEN
  SELECT * INTO v_material FROM public.billing_materials
   WHERE owner_id=v_owner AND id=v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material não encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('material',billing_private.material_catalog_json(v_material));
 END IF;

 IF p_action='delete' THEN
  SELECT coalesce(jsonb_agg(image_key) FILTER(WHERE image_key IS NOT NULL),'[]'::jsonb)
   INTO v_image_keys FROM public.billing_material_variants
   WHERE owner_id=v_owner AND material_id=v_id;
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

 IF v_id IS NULL THEN
  INSERT INTO public.billing_materials(owner_id,name,code,unit,application,image_key,image_name)
  VALUES(v_owner,btrim(p_payload->>'name'),NULL,btrim(p_payload->>'unit'),
   btrim(p_payload->>'application'),NULL,'') RETURNING * INTO v_material;
  v_id=v_material.id;
 ELSE
  UPDATE public.billing_materials SET name=btrim(p_payload->>'name'),unit=btrim(p_payload->>'unit'),
   application=btrim(p_payload->>'application')
  WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_material;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material não encontrado.' USING ERRCODE='P0002'; END IF;
 END IF;

 -- Compatibility for clients from before the product/variant split.
 IF p_payload ? 'code' THEN
  IF jsonb_typeof(p_payload->'code') IS DISTINCT FROM 'string'
   OR length(btrim(p_payload->>'code')) NOT BETWEEN 1 AND 60 THEN
   RAISE EXCEPTION 'Informe um código válido.' USING ERRCODE='22023';
  END IF;
  v_code=btrim(p_payload->>'code');
  SELECT * INTO v_variant FROM public.billing_material_variants
   WHERE owner_id=v_owner AND material_id=v_id ORDER BY created_at,id LIMIT 1 FOR UPDATE;
  v_previous_image_key=v_variant.image_key;
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
   v_image_key=v_variant.image_key;v_image_name=coalesce(v_variant.image_name,'');
  END IF;
  IF v_variant.id IS NULL THEN
   INSERT INTO public.billing_material_variants(owner_id,material_id,code,application,image_key,image_name)
   VALUES(v_owner,v_id,v_code,btrim(p_payload->>'application'),v_image_key,v_image_name);
  ELSE
   UPDATE public.billing_material_variants SET code=v_code,
    application=btrim(p_payload->>'application'),image_key=v_image_key,image_name=v_image_name
   WHERE owner_id=v_owner AND id=v_variant.id;
  END IF;
 END IF;
 SELECT * INTO v_material FROM public.billing_materials WHERE owner_id=v_owner AND id=v_id;
 RETURN jsonb_build_object('material',billing_private.material_catalog_json(v_material),
  'previousImageKey',v_previous_image_key);
EXCEPTION
 WHEN unique_violation THEN
  RAISE EXCEPTION 'Já existe um código igual cadastrado neste espaço.' USING ERRCODE='23505';
 WHEN foreign_key_violation THEN
  RAISE EXCEPTION 'Este material possui vínculos ou pertence a outro espaço.' USING ERRCODE='23503';
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Informe um material válido.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.material_catalog_dispatch(text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.material_catalog_dispatch(text,jsonb) TO authenticated;

CREATE FUNCTION billing_private.material_variants_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;
 v_material_id uuid;
 v_variant public.billing_material_variants;
 v_image_key text;
 v_image_name text;
 v_previous_image_key text;
 v_remove_image boolean:=false;
BEGIN
 IF v_owner IS NULL OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR p_action NOT IN ('get','save','delete') THEN
  RAISE EXCEPTION 'Operação de código do material inválida.' USING ERRCODE='22023';
 END IF;
 IF p_action='get' THEN PERFORM billing_private.authorize('registrations.read');
 ELSE PERFORM billing_private.lock_request_actor();PERFORM billing_private.authorize('registrations.write'); END IF;
 PERFORM billing_private.request_payload(p_payload,
  CASE WHEN p_action='save' THEN
   ARRAY['id','materialId','code','application','imageKey','imageName','removeImage']
  ELSE ARRAY['id'] END);
 v_id=nullif(p_payload->>'id','')::uuid;
 IF v_id IS NULL AND p_action<>'save' THEN
  RAISE EXCEPTION 'Informe o código do material.' USING ERRCODE='22023';
 END IF;
 IF p_action='get' THEN
  SELECT * INTO v_variant FROM public.billing_material_variants WHERE owner_id=v_owner AND id=v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Código do material não encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('variant',billing_private.material_variant_json(v_variant));
 END IF;
 IF p_action='delete' THEN
  DELETE FROM public.billing_material_variants WHERE owner_id=v_owner AND id=v_id
   RETURNING image_key INTO v_previous_image_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'Código do material não encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('id',v_id,'deleted',true,'imageKey',v_previous_image_key);
 END IF;

 IF jsonb_typeof(p_payload->'materialId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'code') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'application') IS DISTINCT FROM 'string'
  OR length(btrim(p_payload->>'code')) NOT BETWEEN 1 AND 60
  OR length(p_payload->>'application')>1000 THEN
  RAISE EXCEPTION 'Preencha o código e a aplicação corretamente.' USING ERRCODE='22023';
 END IF;
 v_material_id=nullif(p_payload->>'materialId','')::uuid;
 PERFORM 1 FROM public.billing_materials
  WHERE owner_id=v_owner AND id=v_material_id FOR SHARE;
 IF v_material_id IS NULL OR NOT FOUND THEN
  RAISE EXCEPTION 'Selecione um material deste espaço.' USING ERRCODE='23514';
 END IF;
 IF v_id IS NOT NULL THEN
  SELECT * INTO v_variant FROM public.billing_material_variants
   WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Código do material não encontrado.' USING ERRCODE='P0002'; END IF;
  IF v_variant.material_id<>v_material_id THEN
   RAISE EXCEPTION 'O código não pertence a este material.' USING ERRCODE='23514';
  END IF;
  v_previous_image_key=v_variant.image_key;
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
  v_image_key=v_variant.image_key;v_image_name=coalesce(v_variant.image_name,'');
 END IF;
 IF v_id IS NULL THEN
  INSERT INTO public.billing_material_variants(owner_id,material_id,code,application,image_key,image_name)
  VALUES(v_owner,v_material_id,btrim(p_payload->>'code'),btrim(p_payload->>'application'),v_image_key,v_image_name)
  RETURNING * INTO v_variant;
 ELSE
  UPDATE public.billing_material_variants SET code=btrim(p_payload->>'code'),
   application=btrim(p_payload->>'application'),image_key=v_image_key,image_name=v_image_name
  WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_variant;
 END IF;
 RETURN jsonb_build_object('variant',billing_private.material_variant_json(v_variant),
  'previousImageKey',v_previous_image_key);
EXCEPTION
 WHEN unique_violation THEN
  RAISE EXCEPTION 'Já existe um código igual cadastrado neste espaço.' USING ERRCODE='23505';
 WHEN foreign_key_violation THEN
  RAISE EXCEPTION 'Este código possui vínculos ou pertence a outro espaço.' USING ERRCODE='23503';
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Informe um código válido.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.material_variants_dispatch(text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.material_variants_dispatch(text,jsonb) TO authenticated;

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
   'materialApplication',i.material_application,
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
REVOKE ALL ON FUNCTION billing_private.quotation_json(public.billing_quotations)
 FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 RENAME TO quotations_dispatch_before_material_variants;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch_before_material_variants(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotations_dispatch(p_resource text,p_action text,p_payload jsonb)
RETURNS jsonb
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
   v_variant_id=nullif(v_item->>'materialVariantId','')::uuid;
   IF v_variant_id IS NULL THEN
    SELECT * INTO v_variant FROM public.billing_material_variants
     WHERE owner_id=v_owner AND material_id=v_material_id
     ORDER BY created_at,id LIMIT 1 FOR SHARE;
   ELSE
    SELECT * INTO v_variant FROM public.billing_material_variants
     WHERE owner_id=v_owner AND id=v_variant_id AND material_id=v_material_id FOR SHARE;
   END IF;
   IF NOT FOUND THEN
    RAISE EXCEPTION 'Selecione um código cadastrado para cada material.' USING ERRCODE='23514';
   END IF;
   v_items=v_items||jsonb_build_array(v_item-'materialVariantId'-'materialCode'-'materialApplication');
  END LOOP;
  v_payload=jsonb_set(p_payload,'{items}',v_items,false);
  v_result=billing_private.quotations_dispatch_before_material_variants(p_resource,p_action,v_payload);
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
   v_item_id=nullif(v_item->>'id','')::uuid;
   v_material_id=nullif(v_item->>'materialId','')::uuid;
   v_variant_id=nullif(v_item->>'materialVariantId','')::uuid;
   IF v_variant_id IS NULL THEN
    SELECT * INTO v_variant FROM public.billing_material_variants
     WHERE owner_id=v_owner AND material_id=v_material_id ORDER BY created_at,id LIMIT 1;
   ELSE
    SELECT * INTO v_variant FROM public.billing_material_variants
     WHERE owner_id=v_owner AND id=v_variant_id AND material_id=v_material_id;
   END IF;
   UPDATE public.billing_quotation_items SET material_variant_id=v_variant.id,
    material_code=v_variant.code,material_application=v_variant.application
   WHERE owner_id=v_owner AND quotation_id=(v_result->'quote'->>'id')::uuid AND id=v_item_id;
  END LOOP;
  SELECT * INTO v_quote FROM public.billing_quotations
   WHERE owner_id=v_owner AND id=(v_result->'quote'->>'id')::uuid;
  RETURN jsonb_set(v_result,'{quote}',billing_private.quotation_json(v_quote),false);
 END IF;
 RETURN billing_private.quotations_dispatch_before_material_variants(p_resource,p_action,p_payload);
EXCEPTION
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Selecione materiais e códigos válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb) TO authenticated;

ALTER FUNCTION billing_private.dispatch(text,text,jsonb)
 RENAME TO dispatch_before_material_variants;
REVOKE ALL ON FUNCTION billing_private.dispatch_before_material_variants(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.dispatch(p_resource text,p_action text,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_resource='material-variants' THEN
  RETURN billing_private.material_variants_dispatch(p_action,p_payload);
 END IF;
 RETURN billing_private.dispatch_before_material_variants(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION billing_private.dispatch(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.dispatch(text,text,jsonb) TO authenticated;

COMMENT ON TABLE public.billing_material_variants IS
 'Purchasable codes belonging to a material product; each code has its own application and private image.';
COMMENT ON COLUMN public.billing_quotation_items.material_code IS
 'Immutable code snapshot selected when the quotation item is saved.';
