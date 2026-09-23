-- The product's internal code is separate from its equivalent manufacturer
-- references. It is optional, but when present it is unique per workspace.
CREATE UNIQUE INDEX billing_materials_owner_internal_code
 ON public.billing_materials(owner_id,lower(btrim(code)))
 WHERE code IS NOT NULL;

CREATE OR REPLACE FUNCTION billing_private.material_catalog_json(p_material public.billing_materials)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 WITH material_refs AS (
  SELECT coalesce(jsonb_agg(billing_private.material_variant_json(v)
   ORDER BY lower(v.brand),lower(v.code),v.id),'[]'::jsonb) AS value
  FROM public.billing_material_variants v
  WHERE v.owner_id=p_material.owner_id AND v.material_id=p_material.id
 )
 SELECT jsonb_build_object(
  'id',p_material.id,'name',p_material.name,
  'internalCode',coalesce(p_material.code,''),'unit',p_material.unit,
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
 v_internal_code text;
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
   ARRAY['id','name','internalCode','unit','application','imageKey','imageName','removeImage']
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
  OR (p_payload ? 'internalCode' AND jsonb_typeof(p_payload->'internalCode') IS DISTINCT FROM 'string')
  OR length(btrim(p_payload->>'name')) NOT BETWEEN 2 AND 150
  OR length(btrim(p_payload->>'unit')) NOT BETWEEN 1 AND 30
  OR length(p_payload->>'application')>1000
  OR length(btrim(coalesce(p_payload->>'internalCode','')))>60 THEN
  RAISE EXCEPTION 'Preencha nome, código interno e unidade do material corretamente.' USING ERRCODE='22023';
 END IF;
 IF v_id IS NOT NULL THEN
  SELECT * INTO v_material FROM public.billing_materials
   WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material não encontrado.' USING ERRCODE='P0002'; END IF;
  v_previous_image_key=v_material.image_key;
 END IF;
 IF p_payload ? 'internalCode' THEN
  v_internal_code=nullif(btrim(p_payload->>'internalCode'),'');
 ELSE
  v_internal_code=v_material.code;
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
  VALUES(v_owner,btrim(p_payload->>'name'),v_internal_code,btrim(p_payload->>'unit'),
   btrim(p_payload->>'application'),v_image_key,v_image_name) RETURNING * INTO v_material;
 ELSE
  UPDATE public.billing_materials SET name=btrim(p_payload->>'name'),code=v_internal_code,
   unit=btrim(p_payload->>'unit'),application=btrim(p_payload->>'application'),
   image_key=v_image_key,image_name=v_image_name
  WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_material;
 END IF;
 RETURN jsonb_build_object('material',billing_private.material_catalog_json(v_material),
  'previousImageKey',v_previous_image_key);
EXCEPTION
 WHEN unique_violation THEN
  RAISE EXCEPTION 'Já existe um material com este código interno.' USING ERRCODE='23505';
 WHEN foreign_key_violation THEN
  RAISE EXCEPTION 'Este material possui vínculos ou pertence a outro espaço.' USING ERRCODE='23503';
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Informe um material válido.' USING ERRCODE='22023';
END $$;

COMMENT ON COLUMN public.billing_materials.code IS
 'Optional owner-scoped internal product code, separate from equivalent manufacturer references.';
