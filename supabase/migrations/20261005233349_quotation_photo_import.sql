-- A photo import is committed in one database transaction. External image
-- retrieval and upload happen before this RPC; no URL is fetched by Postgres.
-- Retain a tombstone when the quotation is deleted so a requestId cannot
-- silently create a second commercial document on retry.
-- Quotation permissions in older PDF code were never added to the profile
-- catalog. Map only these two names to the existing registration permissions;
-- this preserves the intended access for quotations and their private files.
CREATE OR REPLACE FUNCTION billing_private.has_permission(p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(bool_or(m.is_owner OR
  (CASE p_permission
   WHEN 'quotations.read' THEN 'registrations.read'
   WHEN 'quotations.write' THEN 'registrations.write'
   ELSE p_permission END)=ANY(ap.permissions)),false)
 FROM public.billing_memberships m
 LEFT JOIN public.billing_access_profiles ap
  ON ap.owner_id=m.owner_id AND ap.id=m.access_profile_id
 WHERE m.user_id=auth.uid() AND m.status='active'
$$;
REVOKE ALL ON FUNCTION billing_private.has_permission(text)
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.can_access_owner(
 p_owner uuid,p_permission text DEFAULT NULL
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.billing_memberships m
  LEFT JOIN public.billing_access_profiles ap
   ON ap.owner_id=m.owner_id AND ap.id=m.access_profile_id
  WHERE m.owner_id=p_owner AND m.user_id=auth.uid() AND m.status='active'
   AND (p_permission IS NULL OR m.is_owner OR
    (CASE p_permission
     WHEN 'quotations.read' THEN 'registrations.read'
     WHEN 'quotations.write' THEN 'registrations.write'
     ELSE p_permission END)=ANY(ap.permissions))
 )
$$;
REVOKE ALL ON FUNCTION billing_private.can_access_owner(uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.can_access_owner(uuid,text)
 TO authenticated;

-- Match catalog names with the same practical Portuguese accent/whitespace
-- folding used by the import preview. Codes still require exact identity.
CREATE FUNCTION billing_private.import_fold_name(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT translate(
  lower(regexp_replace(btrim(p_value),'[[:space:]]+',' ','g')),
  'áàâãäéèêëíìîïóòôõöúùûüç',
  'aaaaaeeeeiiiiooooouuuuc')
$$;
REVOKE ALL ON FUNCTION billing_private.import_fold_name(text)
 FROM PUBLIC,anon,authenticated;

CREATE TABLE public.billing_quotation_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 quotation_id uuid,
 source jsonb NOT NULL CHECK(jsonb_typeof(source)='object'),
 request_payload jsonb NOT NULL CHECK(jsonb_typeof(request_payload)='object'),
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id),
 UNIQUE(owner_id,request_id),
 UNIQUE(owner_id,quotation_id),
 FOREIGN KEY(owner_id,quotation_id)
  REFERENCES public.billing_quotations(owner_id,id)
  ON DELETE SET NULL (quotation_id)
);
CREATE INDEX billing_quotation_imports_quotation
 ON public.billing_quotation_imports(owner_id,quotation_id);
ALTER TABLE public.billing_quotation_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_quotation_imports FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_quotation_imports TO authenticated;
CREATE POLICY billing_quotation_imports_read ON public.billing_quotation_imports
 FOR SELECT TO authenticated
 USING(actor_id=auth.uid()
  AND billing_private.can_access_owner(owner_id,'registrations.read'));

CREATE TABLE public.billing_quotation_import_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL,
 import_id uuid NOT NULL,
 line_number integer NOT NULL CHECK(line_number BETWEEN 1 AND 100),
 quotation_item_id uuid,
 material_id uuid NOT NULL,
 material_variant_id uuid,
 catalog_action text NOT NULL CHECK(catalog_action IN ('created','reused')),
 source_text text NOT NULL CHECK(length(btrim(source_text)) BETWEEN 1 AND 1000),
 image_source_url text NOT NULL DEFAULT '' CHECK(length(image_source_url)<=2048),
 image_evidence_url text NOT NULL DEFAULT '' CHECK(length(image_evidence_url)<=2048),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,import_id,line_number),
 FOREIGN KEY(owner_id,import_id)
  REFERENCES public.billing_quotation_imports(owner_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,quotation_item_id)
  REFERENCES public.billing_quotation_items(owner_id,id)
  ON DELETE SET NULL (quotation_item_id)
);
CREATE INDEX billing_quotation_import_lines_import
 ON public.billing_quotation_import_lines(owner_id,import_id,line_number);
ALTER TABLE public.billing_quotation_import_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_quotation_import_lines FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_quotation_import_lines TO authenticated;
CREATE POLICY billing_quotation_import_lines_read ON public.billing_quotation_import_lines
 FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'registrations.read')
  AND EXISTS(SELECT 1 FROM public.billing_quotation_imports im
   WHERE im.owner_id=public.billing_quotation_import_lines.owner_id
    AND im.id=public.billing_quotation_import_lines.import_id
    AND im.actor_id=auth.uid()));

CREATE FUNCTION billing_private.import_quotation_draft(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid;
 v_actor uuid:=auth.uid();
 v_request_id uuid;
 v_import_id uuid;
 v_import public.billing_quotation_imports;
 v_source jsonb;
 v_item jsonb;
 v_provider jsonb;
 v_trace jsonb;
 v_line_number bigint;
 v_name text;
 v_unit text;
 v_application text;
 v_internal_code text;
 v_brand text;
 v_code text;
 v_notes text;
 v_source_text text;
 v_image_key text;
 v_image_name text;
 v_image_source_url text;
 v_image_evidence_url text;
 v_quantity numeric;
 v_explicit_id uuid;
 v_code_id uuid;
 v_reference_material_id uuid;
 v_reference_id uuid;
 v_material_id uuid;
 v_item_id uuid;
 v_quote_id uuid;
 v_name_matches integer;
 v_material public.billing_materials;
 v_catalog_result jsonb;
 v_save_result jsonb;
 v_result jsonb;
 v_items jsonb:='[]'::jsonb;
 v_providers jsonb:='[]'::jsonb;
 v_traces jsonb:='[]'::jsonb;
 v_resolutions jsonb:='[]'::jsonb;
 v_created boolean;
BEGIN
 IF v_actor IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 PERFORM billing_private.lock_request_actor();
 v_owner=billing_private.current_owner_id();
 IF v_owner IS NULL THEN
  RAISE EXCEPTION 'Seu acesso a este espaço não está ativo.' USING ERRCODE='42501';
 END IF;
 PERFORM billing_private.authorize('registrations.write');
 PERFORM billing_private.request_payload(p_payload,
  ARRAY['requestId','source','title','requestDate','requesterSignatureId',
   'notes','items','providers']);
 IF length(p_payload::text)>250000
  OR jsonb_typeof(p_payload->'requestId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'source') IS DISTINCT FROM 'object'
  OR jsonb_typeof(p_payload->'title') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'requestDate') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'requesterSignatureId') IS DISTINCT FROM 'string'
  OR (p_payload ? 'notes' AND jsonb_typeof(p_payload->'notes') IS DISTINCT FROM 'string')
  OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array'
  OR (p_payload ? 'providers' AND jsonb_typeof(p_payload->'providers') IS DISTINCT FROM 'array')
  OR length(btrim(p_payload->>'title')) NOT BETWEEN 2 AND 150
  OR length(coalesce(p_payload->>'notes',''))>4000 THEN
  RAISE EXCEPTION 'Dados da importação inválidos.' USING ERRCODE='22023';
 END IF;
 IF jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 100
  OR jsonb_array_length(coalesce(p_payload->'providers','[]'::jsonb))>50 THEN
  RAISE EXCEPTION 'A cotação deve ter de 1 a 100 itens e até 50 fornecedores.'
   USING ERRCODE='22023';
 END IF;
 v_request_id=nullif(p_payload->>'requestId','')::uuid;
 IF v_request_id IS NULL
  OR nullif(btrim(p_payload->>'requesterSignatureId'),'') IS NULL THEN
  RAISE EXCEPTION 'Informe a solicitação e o solicitante.' USING ERRCODE='22023';
 END IF;
 v_source=p_payload->'source';
 PERFORM billing_private.request_payload(v_source,ARRAY['kind','label','sha256']);
 IF jsonb_typeof(v_source->'kind') IS DISTINCT FROM 'string'
  OR v_source->>'kind'<>'chat-image'
  OR jsonb_typeof(v_source->'label') IS DISTINCT FROM 'string'
  OR length(btrim(v_source->>'label')) NOT BETWEEN 1 AND 255
  OR (v_source ? 'sha256' AND (
   jsonb_typeof(v_source->'sha256') IS DISTINCT FROM 'string'
   OR v_source->>'sha256' !~* '^[0-9a-f]{64}$')) THEN
  RAISE EXCEPTION 'Origem da foto inválida.' USING ERRCODE='22023';
 END IF;

 -- The lock serializes imports in a workspace; uniqueness also protects
 -- retries if a caller races a non-import catalog mutation.
 PERFORM pg_advisory_xact_lock(
  hashtextextended('billing-quotation-import:'||v_owner::text,0));
 SELECT * INTO v_import FROM public.billing_quotation_imports
 WHERE owner_id=v_owner AND request_id=v_request_id FOR UPDATE;
 IF FOUND THEN
  IF v_import.actor_id<>v_actor THEN
   RAISE EXCEPTION 'Esta importação pertence a outro usuário.'
    USING ERRCODE='42501';
  END IF;
  IF v_import.request_payload<>p_payload THEN
   RAISE EXCEPTION 'Esta solicitação já foi usada com outros dados.'
    USING ERRCODE='23505';
  END IF;
  IF v_import.quotation_id IS NULL
   OR NOT EXISTS(SELECT 1 FROM public.billing_quotations q
    WHERE q.owner_id=v_owner AND q.id=v_import.quotation_id) THEN
   RAISE EXCEPTION 'A cotação original desta solicitação não existe mais.'
    USING ERRCODE='23514';
  END IF;
  RETURN v_import.result;
 END IF;
 INSERT INTO public.billing_quotation_imports(
  owner_id,request_id,actor_id,source,request_payload)
 VALUES(v_owner,v_request_id,v_actor,v_source,p_payload)
 RETURNING id INTO v_import_id;

 FOR v_provider IN SELECT value FROM jsonb_array_elements(
  coalesce(p_payload->'providers','[]'::jsonb)) LOOP
  PERFORM billing_private.request_payload(v_provider,ARRAY['providerId']);
  IF jsonb_typeof(v_provider->'providerId') IS DISTINCT FROM 'string'
   OR nullif(v_provider->>'providerId','') IS NULL THEN
   RAISE EXCEPTION 'Fornecedor inválido.' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_providers) p
   WHERE p->>'providerId'=v_provider->>'providerId') THEN
   RAISE EXCEPTION 'Fornecedor repetido.' USING ERRCODE='23505';
  END IF;
  v_providers=v_providers||jsonb_build_array(jsonb_build_object(
   'providerId',(v_provider->>'providerId')::uuid,
   'values','{}'::jsonb,'notes','','sentAt',NULL));
 END LOOP;

 FOR v_item,v_line_number IN
  SELECT value,ordinality FROM jsonb_array_elements(p_payload->'items')
   WITH ORDINALITY LOOP
  PERFORM billing_private.request_payload(v_item,
   ARRAY['materialId','name','internalCode','unit','quantity','application',
    'brand','code','notes','sourceText','imageKey','imageName',
    'imageSourceUrl','imageEvidenceUrl']);
  IF jsonb_typeof(v_item->'name') IS DISTINCT FROM 'string'
   OR jsonb_typeof(v_item->'unit') IS DISTINCT FROM 'string'
   OR jsonb_typeof(v_item->'quantity') IS DISTINCT FROM 'string'
   OR jsonb_typeof(v_item->'sourceText') IS DISTINCT FROM 'string'
   OR (v_item ? 'materialId' AND jsonb_typeof(v_item->'materialId') IS DISTINCT FROM 'string')
   OR (v_item ? 'internalCode' AND jsonb_typeof(v_item->'internalCode') IS DISTINCT FROM 'string')
   OR (v_item ? 'application' AND jsonb_typeof(v_item->'application') IS DISTINCT FROM 'string')
   OR (v_item ? 'brand' AND jsonb_typeof(v_item->'brand') IS DISTINCT FROM 'string')
   OR (v_item ? 'code' AND jsonb_typeof(v_item->'code') IS DISTINCT FROM 'string')
   OR (v_item ? 'notes' AND jsonb_typeof(v_item->'notes') IS DISTINCT FROM 'string')
   OR (v_item ? 'imageKey' AND jsonb_typeof(v_item->'imageKey') IS DISTINCT FROM 'string')
   OR (v_item ? 'imageName' AND jsonb_typeof(v_item->'imageName') IS DISTINCT FROM 'string')
   OR (v_item ? 'imageSourceUrl' AND jsonb_typeof(v_item->'imageSourceUrl') IS DISTINCT FROM 'string')
   OR (v_item ? 'imageEvidenceUrl' AND jsonb_typeof(v_item->'imageEvidenceUrl') IS DISTINCT FROM 'string') THEN
   RAISE EXCEPTION 'Item extraído inválido na linha %.',v_line_number USING ERRCODE='22023';
  END IF;
  v_name=btrim(v_item->>'name');
  v_unit=btrim(v_item->>'unit');
  v_internal_code=nullif(btrim(coalesce(v_item->>'internalCode','')),'');
  v_application=btrim(coalesce(v_item->>'application',''));
  v_brand=nullif(btrim(coalesce(v_item->>'brand','')),'');
  v_code=nullif(btrim(coalesce(v_item->>'code','')),'');
  v_notes=btrim(coalesce(v_item->>'notes',''));
  v_source_text=v_item->>'sourceText';
  v_image_key=nullif(btrim(coalesce(v_item->>'imageKey','')),'');
  v_image_name=btrim(coalesce(v_item->>'imageName',''));
  v_image_source_url=coalesce(v_item->>'imageSourceUrl','');
  v_image_evidence_url=coalesce(v_item->>'imageEvidenceUrl','');
  IF length(v_name) NOT BETWEEN 2 AND 150
   OR length(v_unit) NOT BETWEEN 1 AND 30
   OR length(v_application)>1000
   OR length(v_internal_code)>60
   OR length(v_brand)>100
   OR length(v_code)>60
   OR length(v_notes)>1000
   OR length(btrim(v_source_text)) NOT BETWEEN 1 AND 1000
   OR (v_brand IS NULL)<>(v_code IS NULL)
   OR (v_image_key IS NULL)<>(v_image_name='')
   OR (v_image_source_url='')<>(v_image_evidence_url='')
   OR length(v_image_source_url)>2048
   OR length(v_image_evidence_url)>2048 THEN
   RAISE EXCEPTION 'Item extraído incompleto na linha %.',v_line_number
    USING ERRCODE='22023';
  END IF;
  IF v_image_source_url<>'' AND (
   v_image_source_url !~ '^https://[^/?#@[:space:]]+'
   OR v_image_evidence_url !~ '^https://[^/?#@[:space:]]+'
   OR v_image_source_url ~ '[[:space:]<>]'
   OR v_image_evidence_url ~ '[[:space:]<>]') THEN
   RAISE EXCEPTION 'Origem da foto inválida na linha %.',v_line_number
    USING ERRCODE='22023';
  END IF;
  v_quantity=replace(btrim(v_item->>'quantity'),',','.')::numeric;
  IF v_quantity<=0 OR v_quantity>=1000000000000
   OR v_quantity<>round(v_quantity,3) THEN
   RAISE EXCEPTION 'Quantidade inválida na linha %.',v_line_number
    USING ERRCODE='22023';
  END IF;

  v_explicit_id=nullif(v_item->>'materialId','')::uuid;
  v_code_id=NULL;v_reference_material_id=NULL;v_reference_id=NULL;
  IF v_explicit_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public.billing_materials
   WHERE owner_id=v_owner AND id=v_explicit_id) THEN
   RAISE EXCEPTION 'Material selecionado não pertence a este espaço.'
    USING ERRCODE='23514';
  END IF;
  IF v_internal_code IS NOT NULL THEN
   SELECT id INTO v_code_id FROM public.billing_materials
   WHERE owner_id=v_owner AND lower(btrim(code))=lower(v_internal_code);
  END IF;
  IF v_code IS NOT NULL THEN
   SELECT material_id,id INTO v_reference_material_id,v_reference_id
   FROM public.billing_material_variants
   WHERE owner_id=v_owner AND lower(brand)=lower(v_brand)
    AND lower(code)=lower(v_code);
  END IF;
  IF (v_explicit_id IS NOT NULL AND (
    (v_code_id IS NOT NULL AND v_code_id<>v_explicit_id)
    OR (v_reference_material_id IS NOT NULL AND v_reference_material_id<>v_explicit_id)))
   OR (v_code_id IS NOT NULL AND v_reference_material_id IS NOT NULL
    AND v_code_id<>v_reference_material_id) THEN
   RAISE EXCEPTION 'Códigos identificam materiais diferentes na linha %.',v_line_number
    USING ERRCODE='23514';
  END IF;
  v_material_id=coalesce(v_explicit_id,v_code_id,v_reference_material_id);
  v_created=false;
  IF v_material_id IS NULL THEN
   SELECT count(*) INTO v_name_matches FROM public.billing_materials m
   WHERE m.owner_id=v_owner
    AND billing_private.import_fold_name(m.name)=billing_private.import_fold_name(v_name)
    AND lower(btrim(m.unit))=lower(v_unit);
   IF v_name_matches>0 THEN
    RAISE EXCEPTION 'Nome e unidade já existem; selecione o material na linha %.',
     v_line_number USING ERRCODE='23514';
   END IF;
   IF v_brand IS NULL OR v_code IS NULL
    OR v_image_key IS NULL OR v_image_name=''
    OR v_image_source_url='' OR v_image_evidence_url='' THEN
    RAISE EXCEPTION 'Material novo requer referência, foto e origem verificável na linha %.',
     v_line_number USING ERRCODE='23514';
   END IF;
   IF v_image_key NOT LIKE v_owner::text||'/materials/%.webp'
    OR NOT EXISTS(SELECT 1 FROM storage.objects o
     WHERE o.bucket_id='billing-material-images' AND o.name=v_image_key) THEN
    RAISE EXCEPTION 'Foto privada não encontrada na linha %.',v_line_number
     USING ERRCODE='23514';
   END IF;
   v_catalog_result=billing_private.material_catalog_dispatch('save',
    jsonb_build_object('name',v_name,'internalCode',coalesce(v_internal_code,''),
     'unit',v_unit,'application',v_application,
     'imageKey',v_image_key,'imageName',v_image_name));
   v_material_id=(v_catalog_result->'material'->>'id')::uuid;
   v_created=true;
  ELSE
   SELECT * INTO v_material FROM public.billing_materials
    WHERE owner_id=v_owner AND id=v_material_id FOR SHARE;
  IF NOT FOUND OR lower(btrim(v_material.unit))<>lower(v_unit)
    OR (v_internal_code IS NOT NULL AND v_material.code IS NOT NULL
     AND lower(btrim(v_material.code))<>lower(v_internal_code)) THEN
    RAISE EXCEPTION 'Material ou unidade divergente na linha %.',v_line_number
     USING ERRCODE='23514';
   END IF;
   -- A caller-selected material ID alone cannot establish that a newly seen
   -- manufacturer reference belongs to a product with a different name.
   IF v_explicit_id IS NOT NULL
    AND v_code_id IS DISTINCT FROM v_material_id
    AND v_reference_material_id IS DISTINCT FROM v_material_id
    AND billing_private.import_fold_name(v_material.name)
     <>billing_private.import_fold_name(v_name) THEN
    RAISE EXCEPTION 'Confirme o material antes de associar a referência na linha %.',
     v_line_number USING ERRCODE='23514';
   END IF;
   IF v_image_key IS NOT NULL OR v_image_name<>'' THEN
    RAISE EXCEPTION 'Foto pré-enviada pertence a um material já cadastrado na linha %.',
     v_line_number USING ERRCODE='23514';
   END IF;
  END IF;

  IF v_code IS NOT NULL AND v_reference_id IS NULL THEN
   v_catalog_result=billing_private.material_variants_dispatch('save',
    jsonb_build_object('materialId',v_material_id,'brand',v_brand,'code',v_code));
   v_reference_id=(v_catalog_result->'reference'->>'id')::uuid;
  END IF;
  v_item_id=gen_random_uuid();
  v_items=v_items||jsonb_build_array(jsonb_build_object(
   'id',v_item_id,'materialId',v_material_id,
   'materialVariantId',v_reference_id,
   'quantity',v_quantity::text,'notes',v_notes));
  v_traces=v_traces||jsonb_build_array(jsonb_build_object(
   'lineNumber',v_line_number,'quotationItemId',v_item_id,
   'materialId',v_material_id,'catalogAction',
    CASE WHEN v_created THEN 'created' ELSE 'reused' END,
   'sourceText',v_source_text,'imageSourceUrl',v_image_source_url,
   'imageEvidenceUrl',v_image_evidence_url));
 END LOOP;

 v_save_result=billing_private.quotations_dispatch_before_photo_import(
  'quotations','save',jsonb_build_object(
   'title',btrim(p_payload->>'title'),'number','',
   'requestDate',p_payload->>'requestDate','requester','',
   'requesterSignatureId',p_payload->>'requesterSignatureId',
   'notes',coalesce(p_payload->>'notes',''),
   'items',v_items,'providers',v_providers));
 v_quote_id=(v_save_result->'quote'->>'id')::uuid;
 IF v_quote_id IS NULL THEN
  RAISE EXCEPTION 'Cotação não foi criada.' USING ERRCODE='23514';
 END IF;
 FOR v_trace IN SELECT value FROM jsonb_array_elements(v_traces) LOOP
  SELECT material_variant_id INTO v_reference_id
  FROM public.billing_quotation_items
  WHERE owner_id=v_owner AND quotation_id=v_quote_id
   AND id=(v_trace->>'quotationItemId')::uuid;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Item não foi criado.' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.billing_quotation_import_lines(
   owner_id,import_id,line_number,quotation_item_id,material_id,
   material_variant_id,catalog_action,source_text,
   image_source_url,image_evidence_url)
  VALUES(v_owner,v_import_id,(v_trace->>'lineNumber')::integer,
   (v_trace->>'quotationItemId')::uuid,(v_trace->>'materialId')::uuid,
   v_reference_id,v_trace->>'catalogAction',v_trace->>'sourceText',
   v_trace->>'imageSourceUrl',v_trace->>'imageEvidenceUrl');
  v_resolutions=v_resolutions||jsonb_build_array(jsonb_build_object(
   'quotationItemId',v_trace->>'quotationItemId',
   'materialId',v_trace->>'materialId',
   'materialVariantId',v_reference_id,
   'createdMaterial',v_trace->>'catalogAction'='created'));
 END LOOP;
 v_result=jsonb_build_object('requestId',v_request_id,
  'quote',v_save_result->'quote','items',v_resolutions);
 UPDATE public.billing_quotation_imports SET quotation_id=v_quote_id,result=v_result
 WHERE owner_id=v_owner AND id=v_import_id;
 RETURN v_result;
EXCEPTION
 WHEN invalid_text_representation OR numeric_value_out_of_range
  OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Identificador, data ou quantidade inválidos na importação.'
   USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.import_quotation_draft(jsonb)
 FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotation_import_status(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_actor uuid:=auth.uid();
 v_owner uuid;
 v_request_id uuid;
 v_import public.billing_quotation_imports;
BEGIN
 IF v_actor IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 v_owner=billing_private.current_owner_id();
 IF v_owner IS NULL THEN
  RAISE EXCEPTION 'Seu acesso a este espaço não está ativo.' USING ERRCODE='42501';
 END IF;
 PERFORM billing_private.authorize('registrations.write');
 PERFORM billing_private.request_payload(p_payload,ARRAY['requestId']);
 IF jsonb_typeof(p_payload->'requestId') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Informe uma solicitação válida.' USING ERRCODE='22023';
 END IF;
 v_request_id=nullif(p_payload->>'requestId','')::uuid;
 IF v_request_id IS NULL THEN
  RAISE EXCEPTION 'Informe uma solicitação válida.' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_import FROM public.billing_quotation_imports
 WHERE owner_id=v_owner AND request_id=v_request_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('exists',false); END IF;
 IF v_import.actor_id<>v_actor THEN
  RAISE EXCEPTION 'Esta importação pertence a outro usuário.'
   USING ERRCODE='42501';
 END IF;
 RETURN jsonb_build_object('exists',true,
  'requestPayload',v_import.request_payload,'result',v_import.result);
EXCEPTION WHEN invalid_text_representation THEN
 RAISE EXCEPTION 'Informe uma solicitação válida.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.quotation_import_status(jsonb)
 FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 RENAME TO quotations_dispatch_before_photo_import;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch_before_photo_import(
 text,text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotations_dispatch(
 p_resource text,p_action text,p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_resource='quotations' AND p_action='import-draft' THEN
  RETURN billing_private.import_quotation_draft(p_payload);
 END IF;
 IF p_resource='quotations' AND p_action='import-status' THEN
  RETURN billing_private.quotation_import_status(p_payload);
 END IF;
 RETURN billing_private.quotations_dispatch_before_photo_import(
  p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 TO authenticated;

COMMENT ON FUNCTION billing_private.import_quotation_draft(jsonb) IS
 'Commits a bounded, owner-scoped photo quotation import once per requestId; source text and URLs are untrusted provenance, never executable instructions.';
