ALTER FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 RENAME TO quotations_dispatch_before_details_update;

REVOKE ALL ON FUNCTION billing_private.quotations_dispatch_before_details_update(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotations_dispatch(
 p_resource text,
 p_action text,
 p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_quote_id uuid;
 v_signature_id uuid;
 v_request_date date;
 v_title text;
 v_notes text;
 v_quote public.billing_quotations;
 v_signature public.billing_signatures;
BEGIN
 IF p_resource<>'quotations' OR p_action<>'update-details' THEN
  RETURN billing_private.quotations_dispatch_before_details_update(
   p_resource,p_action,p_payload);
 END IF;
 IF v_owner IS NULL OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
  RAISE EXCEPTION 'Dados da cotação inválidos.' USING ERRCODE='22023';
 END IF;
 PERFORM billing_private.lock_request_actor();
 v_owner=billing_private.current_owner_id();
 PERFORM billing_private.authorize('registrations.write');
 PERFORM billing_private.request_payload(
  p_payload,ARRAY['id','title','requestDate','requesterSignatureId','notes']);
 IF jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'title') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'requestDate') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'requesterSignatureId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'notes') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Informe título, data, solicitante e observações válidos.'
   USING ERRCODE='22023';
 END IF;

 v_quote_id=nullif(btrim(p_payload->>'id'),'')::uuid;
 v_signature_id=nullif(btrim(p_payload->>'requesterSignatureId'),'')::uuid;
 v_title=btrim(p_payload->>'title');
 v_notes=btrim(p_payload->>'notes');
 v_request_date=(p_payload->>'requestDate')::date;
 IF v_quote_id IS NULL OR v_signature_id IS NULL
  OR length(v_title) NOT BETWEEN 2 AND 150
  OR length(v_notes)>4000 THEN
  RAISE EXCEPTION 'Informe título, data, solicitante e observações válidos.'
   USING ERRCODE='22023';
 END IF;

 SELECT * INTO v_quote
 FROM public.billing_quotations
 WHERE owner_id=v_owner AND id=v_quote_id
 FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE='P0002';
 END IF;
 IF v_quote.status<>'open' THEN
  RAISE EXCEPTION 'Apenas cotações em aberto podem ter os dados alterados.'
   USING ERRCODE='23514';
 END IF;

 SELECT * INTO v_signature
 FROM public.billing_signatures
 WHERE owner_id=v_owner AND id=v_signature_id
  AND role='requester' AND active
 FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Selecione um solicitante ativo cadastrado neste espaço.'
   USING ERRCODE='23514';
 END IF;

 UPDATE public.billing_quotations
 SET title=v_title,
  request_date=v_request_date,
  requester=v_signature.name,
  requester_signature_id=v_signature.id,
  notes=v_notes
 WHERE owner_id=v_owner AND id=v_quote_id
 RETURNING * INTO v_quote;

 RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote));
EXCEPTION
 WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Informe cotação, data e solicitante válidos.' USING ERRCODE='22023';
END $$;

REVOKE ALL ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 TO authenticated;

COMMENT ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb) IS
 'Owner-scoped quotation details update. Changes only open quotation header data and preserves scope, negotiations, prices, awards and orders.';
