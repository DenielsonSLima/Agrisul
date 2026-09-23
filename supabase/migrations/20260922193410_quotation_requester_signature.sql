ALTER TABLE public.billing_quotations
 ADD COLUMN requester_signature_id uuid,
 ADD CONSTRAINT billing_quotations_requester_signature_fk
  FOREIGN KEY(owner_id,requester_signature_id)
  REFERENCES public.billing_signatures(owner_id,id);

CREATE INDEX billing_quotations_requester_signature
 ON public.billing_quotations(owner_id,requester_signature_id);

ALTER FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 RENAME TO quotations_dispatch_before_requester_signature;

REVOKE ALL ON FUNCTION billing_private.quotations_dispatch_before_requester_signature(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotations_dispatch(p_resource text,p_action text,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_quote_id uuid;
 v_signature_id uuid;
 v_signature public.billing_signatures;
 v_result jsonb;
 v_payload jsonb:=p_payload;
BEGIN
 IF v_owner IS NULL OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;

 IF p_resource='quotations' AND p_action='save' THEN
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
   RAISE EXCEPTION 'Dados inválidos.' USING ERRCODE='22023';
  END IF;
  PERFORM billing_private.request_payload(p_payload,ARRAY['id','title','number','requestDate','requester','requesterSignatureId','notes','items','providers']);
  PERFORM billing_private.authorize('registrations.write');
  v_quote_id=nullif(p_payload->>'id','')::uuid;
  v_signature_id=nullif(p_payload->>'requesterSignatureId','')::uuid;

  IF v_signature_id IS NULL AND v_quote_id IS NULL THEN
   RAISE EXCEPTION 'Selecione o solicitante cadastrado em Assinaturas.' USING ERRCODE='22023';
  END IF;
  IF v_signature_id IS NOT NULL THEN
   SELECT * INTO v_signature
    FROM public.billing_signatures
    WHERE owner_id=v_owner AND id=v_signature_id AND role='requester' AND active
    FOR SHARE;
   IF NOT FOUND THEN
    RAISE EXCEPTION 'Selecione um solicitante ativo cadastrado neste espaço.' USING ERRCODE='23514';
   END IF;
   v_payload=(p_payload-'requesterSignatureId')||jsonb_build_object('requester',v_signature.name);
  ELSE
   v_payload=p_payload-'requesterSignatureId';
  END IF;
 END IF;

 v_result=billing_private.quotations_dispatch_before_requester_signature(p_resource,p_action,v_payload);

 IF p_resource='quotations' AND p_action='save' AND v_signature_id IS NOT NULL THEN
  v_quote_id=(v_result->'quote'->>'id')::uuid;
  UPDATE public.billing_quotations
   SET requester_signature_id=v_signature_id
   WHERE owner_id=v_owner AND id=v_quote_id;
  v_result=jsonb_set(v_result,'{quote,requesterSignatureId}',to_jsonb(v_signature_id),true);
 END IF;
 RETURN v_result;
EXCEPTION
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Selecione um solicitante válido.' USING ERRCODE='22023';
END $$;

REVOKE ALL ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb) TO authenticated;

COMMENT ON COLUMN public.billing_quotations.requester_signature_id IS
 'Requester selected from the workspace signature registry; requester keeps the saved name snapshot.';
