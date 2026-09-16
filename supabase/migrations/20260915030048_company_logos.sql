-- Company logos are private objects. Company business data continues to use
-- public.billing_rpc; the public wrapper remains SECURITY INVOKER.
ALTER TABLE public.billing_companies
 ADD COLUMN logo_key text,
 ADD COLUMN logo_name text NOT NULL DEFAULT '';

ALTER TABLE public.billing_companies
 ADD CONSTRAINT billing_companies_logo_name_length CHECK (length(logo_name)<=255),
 ADD CONSTRAINT billing_companies_logo_owner CHECK (
  logo_key IS NULL OR (length(logo_key)<=500 AND logo_key LIKE owner_id::text || '/%')
 );

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('billing-company-logos','billing-company-logos',false,3145728,ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

CREATE POLICY billing_company_logos_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='billing-company-logos' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
CREATE POLICY billing_company_logos_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='billing-company-logos' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
CREATE POLICY billing_company_logos_update ON storage.objects FOR UPDATE TO authenticated
 USING(bucket_id='billing-company-logos' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text)
 WITH CHECK(bucket_id='billing-company-logos' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
CREATE POLICY billing_company_logos_delete ON storage.objects FOR DELETE TO authenticated
 USING(bucket_id='billing-company-logos' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);

CREATE OR REPLACE FUNCTION billing_private.present(value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT coalesce(jsonb_object_agg(
 CASE key WHEN 'legal_name' THEN 'legalName' WHEN 'trade_name' THEN 'tradeName'
 WHEN 'zip_code' THEN 'zipCode' WHEN 'is_primary' THEN 'isPrimary'
 WHEN 'created_at' THEN 'createdAt' WHEN 'updated_at' THEN 'updatedAt'
 WHEN 'client_id' THEN 'clientId' WHEN 'type_id' THEN 'typeId' WHEN 'type_name' THEN 'typeName' WHEN 'start_date' THEN 'startDate' WHEN 'end_date' THEN 'endDate' WHEN 'farm_id' THEN 'farmId' WHEN 'culture_id' THEN 'cultureId'
 WHEN 'area_ha' THEN 'areaHa' WHEN 'image_key' THEN 'imageKey' WHEN 'image_name' THEN 'imageName'
 WHEN 'logo_key' THEN 'logoKey' WHEN 'logo_name' THEN 'logoName' ELSE key END,
 CASE WHEN key IN ('area_ha','value') THEN to_jsonb(billing_private.decimal_text((v #>> '{}')::numeric)) ELSE v END),'{}')
 FROM jsonb_each(value) AS e(key,v) WHERE key NOT IN ('owner_id','name_key')
$$;
REVOKE ALL ON FUNCTION billing_private.present(jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.save_company(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid := auth.uid(); v_id uuid; v_existing jsonb; v_row jsonb;
 v_data jsonb := '{}'::jsonb; v_key text; v_text text; v_logo_key text;
 v_logo_name text; v_primary boolean; v_remove_logo boolean := false;
BEGIN
 IF v_owner IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=v_owner) THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
  RAISE EXCEPTION 'Dados inválidos.' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('billing:'||v_owner::text,0));
 v_id=nullif(p_payload->>'id','')::uuid;
 IF v_id IS NOT NULL THEN
  SELECT to_jsonb(t) INTO v_existing FROM public.billing_companies t
   WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
  IF v_existing IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada.' USING ERRCODE='P0002'; END IF;
 END IF;
 FOREACH v_key IN ARRAY ARRAY['legalName','tradeName','cnpj','street','number','complement','district','city','state','zipCode','phone','email'] LOOP
  IF jsonb_typeof(p_payload->v_key) IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Preencha os campos do cadastro.' USING ERRCODE='22023';
  END IF;
  v_text=btrim(p_payload->>v_key);
  IF v_key='cnpj' THEN v_text=upper(regexp_replace(v_text,'[./[:space:]-]','','g')); END IF;
  IF v_key='state' THEN v_text=upper(v_text); END IF;
  v_data=v_data||jsonb_build_object(
   CASE v_key WHEN 'legalName' THEN 'legal_name' WHEN 'tradeName' THEN 'trade_name' WHEN 'zipCode' THEN 'zip_code' ELSE v_key END,
   v_text
  );
 END LOOP;
 IF jsonb_typeof(p_payload->'isPrimary') IS DISTINCT FROM 'boolean' THEN
  RAISE EXCEPTION 'Escolha o tipo da empresa.' USING ERRCODE='22023';
 END IF;
 IF coalesce((v_existing->>'is_primary')::boolean,false) AND NOT (p_payload->>'isPrimary')::boolean THEN
  RAISE EXCEPTION 'Defina outra empresa como principal antes de alterar esta para unidade.' USING ERRCODE='23514';
 END IF;
 v_primary=(p_payload->>'isPrimary')::boolean OR NOT EXISTS(
  SELECT 1 FROM public.billing_companies WHERE owner_id=v_owner AND is_primary
 );
 IF v_primary THEN UPDATE public.billing_companies SET is_primary=false WHERE owner_id=v_owner AND is_primary; END IF;
 v_data=v_data||jsonb_build_object(
  'name',coalesce(nullif(v_data->>'trade_name',''),v_data->>'legal_name'),
  'is_primary',v_primary
 );

 IF p_payload ? 'removeLogo' THEN
  IF jsonb_typeof(p_payload->'removeLogo') IS DISTINCT FROM 'boolean' THEN
   RAISE EXCEPTION 'A opção de remover logo é inválida.' USING ERRCODE='22023';
  END IF;
  v_remove_logo=(p_payload->>'removeLogo')::boolean;
 END IF;
 IF v_remove_logo THEN
  v_logo_key=null; v_logo_name='';
 ELSIF p_payload ? 'logoKey' THEN
  IF jsonb_typeof(p_payload->'logoKey') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'logoName') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Envie uma logo válida.' USING ERRCODE='22023';
  END IF;
  v_logo_key=nullif(btrim(p_payload->>'logoKey'),'');
  v_logo_name=btrim(p_payload->>'logoName');
  IF v_logo_key IS NULL OR length(v_logo_name) NOT BETWEEN 1 AND 255 OR
   split_part(v_logo_key,'/',1)<>v_owner::text OR NOT EXISTS(
    SELECT 1 FROM storage.objects WHERE bucket_id='billing-company-logos' AND name=v_logo_key
   ) THEN
   RAISE EXCEPTION 'Envie uma logo válida para sua conta antes de salvar.' USING ERRCODE='22023';
  END IF;
 ELSE
  v_logo_key=v_existing->>'logo_key'; v_logo_name=coalesce(v_existing->>'logo_name','');
 END IF;
 v_data=v_data||jsonb_build_object('logo_key',v_logo_key,'logo_name',v_logo_name);
 v_id=coalesce(v_id,gen_random_uuid());
 IF v_existing IS NULL THEN
  INSERT INTO public.billing_companies(id,owner_id,legal_name,trade_name,cnpj,street,number,complement,district,city,state,zip_code,phone,email,name,is_primary,logo_key,logo_name)
  SELECT v_id,v_owner,r.legal_name,r.trade_name,r.cnpj,r.street,r.number,r.complement,r.district,r.city,r.state,r.zip_code,r.phone,r.email,r.name,r.is_primary,r.logo_key,r.logo_name
   FROM jsonb_populate_record(NULL::public.billing_companies,v_data) r
  RETURNING to_jsonb(billing_companies.*) INTO v_row;
 ELSE
  UPDATE public.billing_companies SET
   legal_name=v_data->>'legal_name',trade_name=v_data->>'trade_name',cnpj=v_data->>'cnpj',street=v_data->>'street',number=v_data->>'number',
   complement=v_data->>'complement',district=v_data->>'district',city=v_data->>'city',state=v_data->>'state',zip_code=v_data->>'zip_code',
   phone=v_data->>'phone',email=v_data->>'email',name=v_data->>'name',is_primary=(v_data->>'is_primary')::boolean,
   logo_key=v_logo_key,logo_name=v_logo_name
  WHERE owner_id=v_owner AND id=v_id RETURNING to_jsonb(billing_companies.*) INTO v_row;
 END IF;
 RETURN jsonb_build_object(
  'id',v_id,'company',billing_private.present(v_row),
  'previousLogoKey',nullif(v_existing->>'logo_key','')
 );
EXCEPTION
 WHEN unique_violation THEN RAISE EXCEPTION 'Já existe uma empresa com estes dados. Verifique o CNPJ.' USING ERRCODE='23505';
 WHEN not_null_violation OR check_violation THEN
  IF SQLERRM LIKE '%violates%' THEN RAISE EXCEPTION 'Verifique os campos: tamanho, formato ou limites inválidos.' USING ERRCODE='22023'; ELSE RAISE; END IF;
 WHEN invalid_text_representation THEN RAISE EXCEPTION 'Informe valores e identificadores válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.save_company(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.save_company(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.billing_rpc(p_resource text,p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 IF p_resource='companies' AND p_action='save' THEN
  RETURN billing_private.save_company(p_payload);
 END IF;
 RETURN billing_private.dispatch(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION public.billing_rpc(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_rpc(text,text,jsonb) TO authenticated;
COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS 'Authenticated Configurações/Cadastros RPC. Company saves include private logo validation; all other resources delegate to the owner-isolated dispatcher.';
