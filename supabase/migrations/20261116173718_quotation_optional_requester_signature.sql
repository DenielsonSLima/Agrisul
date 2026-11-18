-- A requester name is required, but a signature registration is optional.
-- Preserve the existing save chain, including item snapshots, files and prices.
DO $migration$
DECLARE
 definition text;
 required_signature text := E'  IF v_signature_id IS NULL AND v_quote_id IS NULL THEN\n   RAISE EXCEPTION ''Selecione o solicitante cadastrado em Assinaturas.'' USING ERRCODE=''22023'';\n  END IF;\n';
BEGIN
 SELECT pg_get_functiondef('billing_private.quotations_dispatch_before_material_images(text,text,jsonb)'::regprocedure) INTO definition;
 IF strpos(definition,required_signature)=0 THEN
  RAISE EXCEPTION 'Unexpected quotation requester signature contract';
 END IF;
 definition:=replace(definition,required_signature,'');
 definition:=replace(definition,
  'IF p_resource=''quotations'' AND p_action=''save'' AND v_signature_id IS NOT NULL THEN',
  'IF p_resource=''quotations'' AND p_action=''save'' AND (p_payload ? ''requesterSignatureId'') THEN');
 definition:=replace(definition,'to_jsonb(v_signature_id),true)',
  'coalesce(to_jsonb(v_signature_id),''null''::jsonb),true)');
 EXECUTE definition;
END $migration$;

CREATE OR REPLACE FUNCTION billing_private.quotations_dispatch_before_item_discounts(
 p_resource text,p_action text,p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_quote_id uuid;
 v_signature_id uuid;
 v_request_date date;
 v_title text;
 v_notes text;
 v_requester text;
 v_quote public.billing_quotations;
 v_signature public.billing_signatures;
BEGIN
 IF p_resource<>'quotations' OR p_action<>'update-details' THEN
  RETURN billing_private.quotations_dispatch_before_details_update(p_resource,p_action,p_payload);
 END IF;
 IF v_owner IS NULL OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
  RAISE EXCEPTION 'Dados da cotação inválidos.' USING ERRCODE='22023';
 END IF;
 PERFORM billing_private.lock_request_actor();
 v_owner:=billing_private.current_owner_id();
 PERFORM billing_private.authorize('quotations.write');
 PERFORM billing_private.request_payload(p_payload,
  ARRAY['id','title','requestDate','requester','requesterSignatureId','notes']);
 IF jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'title') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'requestDate') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'notes') IS DISTINCT FROM 'string'
  OR (p_payload ? 'requester' AND jsonb_typeof(p_payload->'requester') IS DISTINCT FROM 'string')
  OR (p_payload ? 'requesterSignatureId' AND jsonb_typeof(p_payload->'requesterSignatureId') NOT IN ('string','null')) THEN
  RAISE EXCEPTION 'Informe título, data, solicitante e observações válidos.' USING ERRCODE='22023';
 END IF;
 v_quote_id:=nullif(btrim(p_payload->>'id'),'')::uuid;
 v_signature_id:=nullif(btrim(p_payload->>'requesterSignatureId'),'')::uuid;
 v_title:=btrim(p_payload->>'title');
 v_notes:=btrim(p_payload->>'notes');
 v_request_date:=(p_payload->>'requestDate')::date;
 IF v_quote_id IS NULL OR length(v_title) NOT BETWEEN 2 AND 150 OR length(v_notes)>4000 THEN
  RAISE EXCEPTION 'Informe título, data, solicitante e observações válidos.' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_quote FROM public.billing_quotations
 WHERE owner_id=v_owner AND id=v_quote_id FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE='P0002';
 END IF;
 IF v_quote.status<>'open' THEN
  RAISE EXCEPTION 'Apenas cotações em aberto podem ter os dados alterados.' USING ERRCODE='23514';
 END IF;
 IF v_signature_id IS NOT NULL THEN
  SELECT * INTO v_signature FROM public.billing_signatures
  WHERE owner_id=v_owner AND id=v_signature_id AND role='requester' AND active FOR SHARE;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Selecione um solicitante ativo cadastrado neste espaço.' USING ERRCODE='23514';
  END IF;
  v_requester:=v_signature.name;
 ELSE
  v_requester:=btrim(p_payload->>'requester');
 END IF;
 IF v_requester IS NULL OR length(v_requester) NOT BETWEEN 2 AND 150 THEN
  RAISE EXCEPTION 'Informe o nome do solicitante.' USING ERRCODE='22023';
 END IF;
 UPDATE public.billing_quotations SET title=v_title,request_date=v_request_date,
  requester=v_requester,requester_signature_id=v_signature_id,notes=v_notes
 WHERE owner_id=v_owner AND id=v_quote_id RETURNING * INTO v_quote;
 RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote));
EXCEPTION
 WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Informe cotação, data e solicitante válidos.' USING ERRCODE='22023';
END $$;

REVOKE ALL ON FUNCTION billing_private.quotations_dispatch_before_material_images(text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch_before_item_discounts(text,text,jsonb) FROM PUBLIC,anon,authenticated;
