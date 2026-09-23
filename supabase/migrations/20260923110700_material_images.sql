-- Material photos are private, owner-scoped assets. The browser optimizes the
-- selected image before upload; the database only accepts an existing object
-- in the current workspace folder.
ALTER TABLE public.billing_materials
 ADD COLUMN image_key text,
 ADD COLUMN image_name text NOT NULL DEFAULT '';

ALTER TABLE public.billing_materials
 ADD CONSTRAINT billing_materials_image_key_owner CHECK(
  image_key IS NULL OR (
   length(image_key)<=500
   AND image_key LIKE owner_id::text || '/materials/%'
  )
 ),
 ADD CONSTRAINT billing_materials_image_name CHECK(
  (image_key IS NULL AND image_name='')
  OR (image_key IS NOT NULL AND length(btrim(image_name)) BETWEEN 1 AND 255)
 );

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('billing-material-images','billing-material-images',false,3145728,ARRAY['image/webp'])
ON CONFLICT(id) DO UPDATE SET
 public=false,
 file_size_limit=excluded.file_size_limit,
 allowed_mime_types=excluded.allowed_mime_types;

CREATE POLICY billing_material_images_read ON storage.objects
 FOR SELECT TO authenticated USING(
  bucket_id='billing-material-images'
  AND billing_private.can_access_storage_owner((storage.foldername(name))[1],'registrations.read')
 );
CREATE POLICY billing_material_images_insert ON storage.objects
 FOR INSERT TO authenticated WITH CHECK(
  bucket_id='billing-material-images'
  AND billing_private.can_access_storage_owner((storage.foldername(name))[1],'registrations.write')
 );
CREATE POLICY billing_material_images_update ON storage.objects
 FOR UPDATE TO authenticated USING(
  bucket_id='billing-material-images'
  AND billing_private.can_access_storage_owner((storage.foldername(name))[1],'registrations.write')
 ) WITH CHECK(
  bucket_id='billing-material-images'
  AND billing_private.can_access_storage_owner((storage.foldername(name))[1],'registrations.write')
 );
CREATE POLICY billing_material_images_delete ON storage.objects
 FOR DELETE TO authenticated USING(
  bucket_id='billing-material-images'
  AND billing_private.can_access_storage_owner((storage.foldername(name))[1],'registrations.write')
 );

CREATE FUNCTION billing_private.material_images_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;
 v_material public.billing_materials;
 v_existing public.billing_materials;
 v_result jsonb;
 v_image_key text;
 v_image_name text;
 v_previous_image_key text;
 v_remove_image boolean:=false;
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
  SELECT coalesce(
   jsonb_agg(billing_private.present(to_jsonb(m)) ORDER BY lower(m.name),m.id),
   '[]'::jsonb
  ) INTO v_result
  FROM public.billing_materials m WHERE m.owner_id=v_owner;
  RETURN jsonb_build_object('materials',v_result);
 END IF;

 PERFORM billing_private.request_payload(
  p_payload,
  CASE WHEN p_action='save'
   THEN ARRAY['id','name','code','unit','application','imageKey','imageName','removeImage']
   ELSE ARRAY['id'] END
 );
 v_id=nullif(p_payload->>'id','')::uuid;
 IF v_id IS NULL AND p_action<>'save' THEN
  RAISE EXCEPTION 'Informe o material.' USING ERRCODE='22023';
 END IF;

 IF p_action='get' THEN
  SELECT * INTO v_material FROM public.billing_materials
   WHERE owner_id=v_owner AND id=v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material não encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('material',billing_private.present(to_jsonb(v_material)));
 END IF;

 IF p_action='delete' THEN
  DELETE FROM public.billing_materials
   WHERE owner_id=v_owner AND id=v_id
   RETURNING image_key INTO v_previous_image_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material não encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('id',v_id,'deleted',true,'imageKey',v_previous_image_key);
 END IF;

 IF jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'code') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'unit') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'application') IS DISTINCT FROM 'string'
  OR length(btrim(p_payload->>'name')) NOT BETWEEN 2 AND 150
  OR length(btrim(p_payload->>'code')) NOT BETWEEN 1 AND 60
  OR length(btrim(p_payload->>'unit')) NOT BETWEEN 1 AND 30
  OR length(p_payload->>'application')>1000 THEN
  RAISE EXCEPTION 'Preencha corretamente os campos do material.' USING ERRCODE='22023';
 END IF;

 IF v_id IS NOT NULL THEN
  SELECT * INTO v_existing FROM public.billing_materials
   WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material não encontrado.' USING ERRCODE='P0002'; END IF;
  v_previous_image_key=v_existing.image_key;
 END IF;

 IF p_payload ? 'removeImage' THEN
  IF jsonb_typeof(p_payload->'removeImage') IS DISTINCT FROM 'boolean' THEN
   RAISE EXCEPTION 'A opção de remover a foto é inválida.' USING ERRCODE='22023';
  END IF;
  v_remove_image=(p_payload->>'removeImage')::boolean;
 END IF;

 IF v_remove_image THEN
  v_image_key=NULL;
  v_image_name='';
 ELSIF p_payload ? 'imageKey' THEN
  IF jsonb_typeof(p_payload->'imageKey') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_payload->'imageName') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Envie uma foto válida.' USING ERRCODE='22023';
  END IF;
  v_image_key=nullif(btrim(p_payload->>'imageKey'),'');
  v_image_name=btrim(p_payload->>'imageName');
  IF v_image_key IS NULL
   OR length(v_image_key)>500
   OR length(v_image_name) NOT BETWEEN 1 AND 255
   OR v_image_key NOT LIKE v_owner::text || '/materials/%'
   OR NOT EXISTS(
    SELECT 1 FROM storage.objects
     WHERE bucket_id='billing-material-images' AND name=v_image_key
   ) THEN
   RAISE EXCEPTION 'Envie uma foto válida para este espaço antes de salvar.' USING ERRCODE='23514';
  END IF;
 ELSE
  v_image_key=v_existing.image_key;
  v_image_name=coalesce(v_existing.image_name,'');
 END IF;

 IF v_id IS NULL THEN
  INSERT INTO public.billing_materials(owner_id,name,code,unit,application,image_key,image_name)
  VALUES(
   v_owner,btrim(p_payload->>'name'),btrim(p_payload->>'code'),
   btrim(p_payload->>'unit'),btrim(p_payload->>'application'),v_image_key,v_image_name
  ) RETURNING * INTO v_material;
 ELSE
  UPDATE public.billing_materials SET
   name=btrim(p_payload->>'name'),code=btrim(p_payload->>'code'),
   unit=btrim(p_payload->>'unit'),application=btrim(p_payload->>'application'),
   image_key=v_image_key,image_name=v_image_name
  WHERE owner_id=v_owner AND id=v_id
  RETURNING * INTO v_material;
 END IF;

 RETURN jsonb_build_object(
  'material',billing_private.present(to_jsonb(v_material)),
  'previousImageKey',v_previous_image_key
 );
EXCEPTION
 WHEN unique_violation THEN
  RAISE EXCEPTION 'Já existe um material com este código.' USING ERRCODE='23505';
 WHEN foreign_key_violation THEN
  RAISE EXCEPTION 'Este material possui vínculos ou pertence a outro espaço.' USING ERRCODE='23503';
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Informe um material válido.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.material_images_dispatch(text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.material_images_dispatch(text,jsonb) TO authenticated;

ALTER FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 RENAME TO quotations_dispatch_before_material_images;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch_before_material_images(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotations_dispatch(p_resource text,p_action text,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_resource='materials' THEN
  RETURN billing_private.material_images_dispatch(p_action,p_payload);
 END IF;
 RETURN billing_private.quotations_dispatch_before_material_images(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb) TO authenticated;

COMMENT ON COLUMN public.billing_materials.image_key IS
 'Private billing-material-images object path, always prefixed by the workspace owner UUID.';
