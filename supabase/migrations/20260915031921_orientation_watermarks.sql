-- Portrait and landscape documents use independent private watermark images.
ALTER TABLE public.billing_watermarks
 ADD COLUMN portrait_image_key text,
 ADD COLUMN portrait_image_name text NOT NULL DEFAULT '',
 ADD COLUMN landscape_image_key text,
 ADD COLUMN landscape_image_name text NOT NULL DEFAULT '';

UPDATE public.billing_watermarks SET
 portrait_image_key=CASE WHEN orientation='portrait' THEN image_key END,
 portrait_image_name=CASE WHEN orientation='portrait' THEN image_name ELSE '' END,
 landscape_image_key=CASE WHEN orientation='landscape' THEN image_key END,
 landscape_image_name=CASE WHEN orientation='landscape' THEN image_name ELSE '' END;

ALTER TABLE public.billing_watermarks
 ADD CONSTRAINT billing_watermark_portrait_name_length CHECK(length(portrait_image_name)<=255),
 ADD CONSTRAINT billing_watermark_landscape_name_length CHECK(length(landscape_image_name)<=255),
 ADD CONSTRAINT billing_watermark_portrait_owner CHECK(portrait_image_key IS NULL OR (length(portrait_image_key)<=500 AND portrait_image_key LIKE owner_id::text || '/%')),
 ADD CONSTRAINT billing_watermark_landscape_owner CHECK(landscape_image_key IS NULL OR (length(landscape_image_key)<=500 AND landscape_image_key LIKE owner_id::text || '/%'));

CREATE OR REPLACE FUNCTION billing_private.present(value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT coalesce(jsonb_object_agg(
 CASE key WHEN 'legal_name' THEN 'legalName' WHEN 'trade_name' THEN 'tradeName'
 WHEN 'zip_code' THEN 'zipCode' WHEN 'is_primary' THEN 'isPrimary'
 WHEN 'created_at' THEN 'createdAt' WHEN 'updated_at' THEN 'updatedAt'
 WHEN 'client_id' THEN 'clientId' WHEN 'type_id' THEN 'typeId' WHEN 'type_name' THEN 'typeName' WHEN 'start_date' THEN 'startDate' WHEN 'end_date' THEN 'endDate' WHEN 'farm_id' THEN 'farmId' WHEN 'culture_id' THEN 'cultureId'
 WHEN 'area_ha' THEN 'areaHa' WHEN 'image_key' THEN 'imageKey' WHEN 'image_name' THEN 'imageName'
 WHEN 'logo_key' THEN 'logoKey' WHEN 'logo_name' THEN 'logoName'
 WHEN 'portrait_image_key' THEN 'portraitImageKey' WHEN 'portrait_image_name' THEN 'portraitImageName'
 WHEN 'landscape_image_key' THEN 'landscapeImageKey' WHEN 'landscape_image_name' THEN 'landscapeImageName' ELSE key END,
 CASE WHEN key IN ('area_ha','value') THEN to_jsonb(billing_private.decimal_text((v #>> '{}')::numeric)) ELSE v END),'{}')
 FROM jsonb_each(value) AS e(key,v) WHERE key NOT IN ('owner_id','name_key')
$$;
REVOKE ALL ON FUNCTION billing_private.present(jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.watermark_variants(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid := auth.uid(); v_existing jsonb; v_row jsonb; v_orientation text;
 v_portrait_key text; v_portrait_name text; v_landscape_key text; v_landscape_name text;
 v_opacity integer; v_size integer; v_legacy_key text; v_legacy_name text; v_remove boolean := false;
BEGIN
 IF v_owner IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=v_owner) THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_action NOT IN ('get','list','save','delete') THEN
  RAISE EXCEPTION 'Dados inválidos.' USING ERRCODE='22023';
 END IF;
 IF p_action IN ('save','delete') THEN PERFORM pg_advisory_xact_lock(hashtextextended('billing:'||v_owner::text,0)); END IF;
 SELECT to_jsonb(t) INTO v_existing FROM public.billing_watermarks t WHERE owner_id=v_owner FOR UPDATE;
 IF p_action='delete' THEN DELETE FROM public.billing_watermarks WHERE owner_id=v_owner;v_existing=null;END IF;
 IF p_action='save' THEN
  IF jsonb_typeof(p_payload->'orientation') IS DISTINCT FROM 'string' OR p_payload->>'orientation' NOT IN ('portrait','landscape') OR
   jsonb_typeof(p_payload->'opacity') IS DISTINCT FROM 'number' OR jsonb_typeof(p_payload->'size') IS DISTINCT FROM 'number' THEN
   RAISE EXCEPTION 'Confira orientação, opacidade e tamanho.' USING ERRCODE='22023';
  END IF;
  v_orientation=p_payload->>'orientation';v_opacity=(p_payload->>'opacity')::integer;v_size=(p_payload->>'size')::integer;
  IF v_opacity NOT BETWEEN 0 AND 100 OR v_size NOT BETWEEN 10 AND 100 THEN
   RAISE EXCEPTION 'Confira orientação, opacidade e tamanho.' USING ERRCODE='22023';
  END IF;
  IF p_payload ? 'removeImage' THEN
   IF jsonb_typeof(p_payload->'removeImage') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'A opção de remover imagem é inválida.' USING ERRCODE='22023'; END IF;
   v_remove=(p_payload->>'removeImage')::boolean;
  END IF;
  v_portrait_key=CASE
   WHEN p_payload ? 'portraitImageKey' THEN nullif(btrim(p_payload->>'portraitImageKey'),'')
   WHEN v_orientation='portrait' AND v_remove THEN null
   WHEN v_orientation='portrait' AND p_payload ? 'imageKey' THEN nullif(btrim(p_payload->>'imageKey'),'')
   ELSE v_existing->>'portrait_image_key' END;
  v_portrait_name=CASE
   WHEN v_portrait_key IS NULL THEN ''
   WHEN p_payload ? 'portraitImageName' THEN btrim(coalesce(p_payload->>'portraitImageName',''))
   WHEN v_orientation='portrait' AND p_payload ? 'imageName' THEN btrim(coalesce(p_payload->>'imageName',''))
   ELSE coalesce(v_existing->>'portrait_image_name','') END;
  v_landscape_key=CASE
   WHEN p_payload ? 'landscapeImageKey' THEN nullif(btrim(p_payload->>'landscapeImageKey'),'')
   WHEN v_orientation='landscape' AND v_remove THEN null
   WHEN v_orientation='landscape' AND p_payload ? 'imageKey' THEN nullif(btrim(p_payload->>'imageKey'),'')
   ELSE v_existing->>'landscape_image_key' END;
  v_landscape_name=CASE
   WHEN v_landscape_key IS NULL THEN ''
   WHEN p_payload ? 'landscapeImageName' THEN btrim(coalesce(p_payload->>'landscapeImageName',''))
   WHEN v_orientation='landscape' AND p_payload ? 'imageName' THEN btrim(coalesce(p_payload->>'imageName',''))
   ELSE coalesce(v_existing->>'landscape_image_name','') END;
  IF v_portrait_key IS NOT NULL AND (length(v_portrait_name) NOT BETWEEN 1 AND 255 OR split_part(v_portrait_key,'/',1)<>v_owner::text OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='billing-watermarks' AND name=v_portrait_key)) THEN
   RAISE EXCEPTION 'Envie uma imagem de retrato válida para sua conta.' USING ERRCODE='22023';
  END IF;
  IF v_landscape_key IS NOT NULL AND (length(v_landscape_name) NOT BETWEEN 1 AND 255 OR split_part(v_landscape_key,'/',1)<>v_owner::text OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='billing-watermarks' AND name=v_landscape_key)) THEN
   RAISE EXCEPTION 'Envie uma imagem de paisagem válida para sua conta.' USING ERRCODE='22023';
  END IF;
  v_legacy_key=CASE v_orientation WHEN 'portrait' THEN v_portrait_key ELSE v_landscape_key END;
  v_legacy_name=CASE v_orientation WHEN 'portrait' THEN v_portrait_name ELSE v_landscape_name END;
  INSERT INTO public.billing_watermarks(owner_id,orientation,opacity,size,image_key,image_name,portrait_image_key,portrait_image_name,landscape_image_key,landscape_image_name)
  VALUES(v_owner,v_orientation,v_opacity,v_size,v_legacy_key,v_legacy_name,v_portrait_key,v_portrait_name,v_landscape_key,v_landscape_name)
  ON CONFLICT(owner_id) DO UPDATE SET orientation=excluded.orientation,opacity=excluded.opacity,size=excluded.size,image_key=excluded.image_key,image_name=excluded.image_name,portrait_image_key=excluded.portrait_image_key,portrait_image_name=excluded.portrait_image_name,landscape_image_key=excluded.landscape_image_key,landscape_image_name=excluded.landscape_image_name;
  SELECT to_jsonb(t) INTO v_existing FROM public.billing_watermarks t WHERE owner_id=v_owner;
 END IF;
 v_row=coalesce(billing_private.present(v_existing),jsonb_build_object('orientation','portrait','opacity',15,'size',60,'imageKey',null,'imageName','','portraitImageKey',null,'portraitImageName','','landscapeImageKey',null,'landscapeImageName','','updatedAt',null));
 RETURN jsonb_build_object('settings',v_row||jsonb_build_object('imageUrl',null,'portraitImageUrl',null,'landscapeImageUrl',null));
EXCEPTION
 WHEN not_null_violation OR check_violation OR invalid_text_representation THEN
  RAISE EXCEPTION 'Confira orientação, opacidade, tamanho e imagens.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.watermark_variants(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.watermark_variants(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.billing_rpc(p_resource text,p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 IF p_resource='companies' AND p_action='save' THEN RETURN billing_private.save_company(p_payload); END IF;
 IF p_resource IN ('watermark','watermarks') THEN RETURN billing_private.watermark_variants(p_action,p_payload); END IF;
 RETURN billing_private.dispatch(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION public.billing_rpc(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_rpc(text,text,jsonb) TO authenticated;
COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS 'Authenticated Configurações/Cadastros RPC. Company logos and orientation-specific watermarks are validated in private owner-isolated functions.';
