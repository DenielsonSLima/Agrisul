-- Owner-scoped material categories. Products may remain uncategorized, while
-- a category that is already in use cannot be removed silently.
CREATE TABLE public.billing_material_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 name text NOT NULL CHECK(
  length(name) BETWEEN 2 AND 100
  AND name=regexp_replace(btrim(name),'[[:space:]]+',' ','g')
 ),
 UNIQUE(owner_id,id)
);
CREATE UNIQUE INDEX billing_material_categories_owner_name
 ON public.billing_material_categories(owner_id,lower(name));
ALTER TABLE public.billing_material_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_material_categories FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_material_categories TO authenticated;
CREATE POLICY billing_material_categories_read ON public.billing_material_categories
 FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'registrations.read'));
CREATE TRIGGER billing_touch_updated_at
 BEFORE UPDATE ON public.billing_material_categories
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();

ALTER TABLE public.billing_materials ADD COLUMN category_id uuid;
ALTER TABLE public.billing_materials
 ADD CONSTRAINT billing_materials_category_fk
 FOREIGN KEY(owner_id,category_id)
 REFERENCES public.billing_material_categories(owner_id,id);
CREATE INDEX billing_materials_owner_category
 ON public.billing_materials(owner_id,category_id);

CREATE FUNCTION billing_private.material_category_json(
 p_category public.billing_material_categories
)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p_category.id,'name',p_category.name,
  'createdAt',p_category.created_at,'updatedAt',p_category.updated_at
 )
$$;
REVOKE ALL ON FUNCTION billing_private.material_category_json(public.billing_material_categories)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.material_category_json(public.billing_material_categories)
 TO authenticated;

CREATE FUNCTION billing_private.material_categories_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;
 v_name text;
 v_category public.billing_material_categories;
 v_result jsonb;
BEGIN
 IF v_owner IS NULL OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR p_action NOT IN ('list','save','delete') THEN
  RAISE EXCEPTION 'Operação de categoria inválida.' USING ERRCODE='22023';
 END IF;
 IF p_action='list' THEN
  PERFORM billing_private.authorize('registrations.read');
  PERFORM billing_private.request_payload(p_payload,ARRAY[]::text[]);
  SELECT coalesce(jsonb_agg(billing_private.material_category_json(c)
   ORDER BY lower(c.name),c.id),'[]'::jsonb) INTO v_result
  FROM public.billing_material_categories c WHERE c.owner_id=v_owner;
  RETURN jsonb_build_object('categories',v_result);
 END IF;

 PERFORM billing_private.lock_request_actor();
 PERFORM billing_private.authorize('registrations.write');
 PERFORM billing_private.request_payload(p_payload,
  CASE WHEN p_action='save' THEN ARRAY['id','name'] ELSE ARRAY['id'] END);
 v_id=nullif(p_payload->>'id','')::uuid;
 IF p_action='delete' THEN
  IF v_id IS NULL THEN
   RAISE EXCEPTION 'Informe a categoria.' USING ERRCODE='22023';
  END IF;
  DELETE FROM public.billing_material_categories
   WHERE owner_id=v_owner AND id=v_id;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Categoria não encontrada.' USING ERRCODE='P0002';
  END IF;
  RETURN jsonb_build_object('id',v_id,'deleted',true);
 END IF;

 IF jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Informe o nome da categoria.' USING ERRCODE='22023';
 END IF;
 v_name=regexp_replace(btrim(p_payload->>'name'),'[[:space:]]+',' ','g');
 IF length(v_name) NOT BETWEEN 2 AND 100 THEN
  RAISE EXCEPTION 'Informe o nome da categoria com 2 a 100 caracteres.' USING ERRCODE='22023';
 END IF;
 IF v_id IS NULL THEN
  INSERT INTO public.billing_material_categories(owner_id,name)
  VALUES(v_owner,v_name) RETURNING * INTO v_category;
 ELSE
  UPDATE public.billing_material_categories SET name=v_name
  WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_category;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Categoria não encontrada.' USING ERRCODE='P0002';
  END IF;
 END IF;
 RETURN jsonb_build_object('category',billing_private.material_category_json(v_category));
EXCEPTION
 WHEN unique_violation THEN
  RAISE EXCEPTION 'Já existe uma categoria com este nome.' USING ERRCODE='23505';
 WHEN foreign_key_violation THEN
  RAISE EXCEPTION 'Esta categoria não pode ser excluída porque está vinculada a materiais.'
   USING ERRCODE='23503';
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Informe uma categoria válida.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.material_categories_dispatch(text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.material_categories_dispatch(text,jsonb)
 TO authenticated;

-- Extend the current product projection with its optional category.
CREATE OR REPLACE FUNCTION billing_private.material_catalog_json(p_material public.billing_materials)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 WITH material_refs AS (
  SELECT coalesce(jsonb_agg(billing_private.material_variant_json(v)
   ORDER BY lower(v.brand),lower(v.code),v.id),'[]'::jsonb) AS value
  FROM public.billing_material_variants v
  WHERE v.owner_id=p_material.owner_id AND v.material_id=p_material.id
 ), material_category AS (
  SELECT c.name FROM public.billing_material_categories c
  WHERE c.owner_id=p_material.owner_id AND c.id=p_material.category_id
 )
 SELECT jsonb_build_object(
  'id',p_material.id,'name',p_material.name,
  'internalCode',coalesce(p_material.code,''),'unit',p_material.unit,
  'application',p_material.application,'imageKey',p_material.image_key,
  'imageName',p_material.image_name,'categoryId',p_material.category_id,
  'categoryName',(SELECT name FROM material_category),
  'createdAt',p_material.created_at,'updatedAt',p_material.updated_at,
  'references',material_refs.value,
  -- Temporary alias keeps a cached client from crashing during deployment.
  'variants',material_refs.value
 ) FROM material_refs
$$;

-- Preserve the complete latest material contract (internal code, image and
-- references) and add only the optional category field.
CREATE OR REPLACE FUNCTION billing_private.material_catalog_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;
 v_material public.billing_materials;
 v_result jsonb;
 v_internal_code text;
 v_category_id uuid;
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
   ORDER BY (m.category_id IS NULL),lower(coalesce((SELECT c.name FROM public.billing_material_categories c
    WHERE c.owner_id=m.owner_id AND c.id=m.category_id),'')),lower(m.name),m.id),'[]'::jsonb)
  INTO v_result
  FROM public.billing_materials m WHERE m.owner_id=v_owner;
  RETURN jsonb_build_object('materials',v_result);
 END IF;

 PERFORM billing_private.request_payload(p_payload,
  CASE WHEN p_action='save' THEN
   ARRAY['id','name','internalCode','unit','application','categoryId','imageKey','imageName','removeImage']
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
  OR (p_payload ? 'categoryId' AND jsonb_typeof(p_payload->'categoryId') NOT IN ('string','null'))
  OR length(btrim(p_payload->>'name')) NOT BETWEEN 2 AND 150
  OR length(btrim(p_payload->>'unit')) NOT BETWEEN 1 AND 30
  OR length(p_payload->>'application')>1000
  OR length(btrim(coalesce(p_payload->>'internalCode','')))>60 THEN
  RAISE EXCEPTION 'Preencha o nome e a unidade do material corretamente.' USING ERRCODE='22023';
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
 IF p_payload ? 'categoryId' THEN
  v_category_id=nullif(btrim(coalesce(p_payload->>'categoryId','')),'')::uuid;
 ELSE
  v_category_id=v_material.category_id;
 END IF;
 IF v_category_id IS NOT NULL THEN
  SELECT c.id INTO v_category_id FROM public.billing_material_categories c
   WHERE c.owner_id=v_owner AND c.id=v_category_id FOR SHARE;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Selecione uma categoria deste espaço.' USING ERRCODE='23514';
  END IF;
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
  INSERT INTO public.billing_materials(
   owner_id,name,code,unit,application,category_id,image_key,image_name
  ) VALUES(
   v_owner,btrim(p_payload->>'name'),v_internal_code,btrim(p_payload->>'unit'),
   btrim(p_payload->>'application'),v_category_id,v_image_key,v_image_name
  ) RETURNING * INTO v_material;
 ELSE
  UPDATE public.billing_materials SET name=btrim(p_payload->>'name'),code=v_internal_code,
   unit=btrim(p_payload->>'unit'),application=btrim(p_payload->>'application'),
   category_id=v_category_id,image_key=v_image_key,image_name=v_image_name
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
  RAISE EXCEPTION 'Informe um material ou categoria válidos.' USING ERRCODE='22023';
END $$;

-- Add the new category route without replacing any existing generic route.
ALTER FUNCTION billing_private.dispatch(text,text,jsonb)
 RENAME TO dispatch_before_material_categories;
REVOKE ALL ON FUNCTION billing_private.dispatch_before_material_categories(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.dispatch(p_resource text,p_action text,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_resource='material-categories' THEN
  RETURN billing_private.material_categories_dispatch(p_action,p_payload);
 END IF;
 RETURN billing_private.dispatch_before_material_categories(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION billing_private.dispatch(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.dispatch(text,text,jsonb) TO authenticated;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
  AND NOT EXISTS(SELECT 1 FROM pg_publication_tables
   WHERE pubname='supabase_realtime' AND schemaname='public'
    AND tablename='billing_material_categories') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_material_categories;
 END IF;
END $$;

COMMENT ON TABLE public.billing_material_categories IS
 'Owner-scoped categories used to group and filter material products.';
COMMENT ON COLUMN public.billing_materials.category_id IS
 'Optional owner-scoped category; linked categories cannot be deleted while in use.';
COMMENT ON FUNCTION billing_private.material_categories_dispatch(text,jsonb) IS
 'Validated owner-isolated category list/save/delete contract for billing_rpc.';
