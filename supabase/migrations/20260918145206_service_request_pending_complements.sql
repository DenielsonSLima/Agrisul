-- Complements are available from submission onwards. Preserve the original
-- signed request and record whether each addition preceded the decision.
ALTER TABLE public.billing_service_request_complements ADD COLUMN recorded_status text NOT NULL DEFAULT 'approved'
 CHECK (recorded_status IN ('pending','approved'));
ALTER TABLE public.billing_service_requests ADD COLUMN decision_complement_hash text
 CHECK (decision_complement_hash IS NULL OR decision_complement_hash ~ '^[a-f0-9]{64}$');

CREATE OR REPLACE FUNCTION billing_private.request_details_json(p_request public.billing_service_requests) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH entries AS (
  SELECT c.*,jsonb_build_object('id',c.id,'version',c.version,'serviceValue',billing_private.decimal_text(c.service_value),
   'returnDate',c.return_date,'attachmentIds',c.attachment_ids,'actorId',c.actor_id,'actorName',c.actor_name,
   'at',c.created_at,'hash',c.record_hash,'recordedStatus',c.recorded_status) AS value
  FROM public.billing_service_request_complements c WHERE c.owner_id=p_request.owner_id AND c.request_id=p_request.id
 ), latest AS (SELECT * FROM entries ORDER BY version DESC LIMIT 1)
 SELECT jsonb_build_object('canComplement',p_request.status IN ('pending','approved') AND billing_private.has_permission('requests.write'),
  'decisionComplementHash',p_request.decision_complement_hash,
  'complements',coalesce((SELECT jsonb_agg(value ORDER BY version) FROM entries),'[]'::jsonb),
  'currentDetails',coalesce((SELECT jsonb_build_object('serviceValue',value->'serviceValue','returnDate',value->'returnDate') FROM latest),
   jsonb_build_object('serviceValue',billing_private.decimal_text(p_request.service_value),'returnDate',p_request.return_date)))
$$;

DO $$
DECLARE v_definition text;v_old text;
BEGIN
 SELECT pg_get_functiondef('billing_private.complement_service_request(jsonb)'::regprocedure) INTO v_definition;
 v_old=$old$IF v_request.status<>'approved' THEN RAISE EXCEPTION 'Aguarde a aprovação do diretor para complementar os dados.' USING ERRCODE='23514'; END IF;$old$;
 IF strpos(v_definition,v_old)=0 THEN RAISE EXCEPTION 'Validação de complementação inesperada'; END IF;
 v_definition=replace(v_definition,v_old,$new$IF v_request.status NOT IN ('pending','approved') THEN RAISE EXCEPTION 'Solicitações recusadas não recebem novos dados ou anexos.' USING ERRCODE='23514'; END IF;$new$);
 v_old='created_at,input_payload,record_hash)';
 IF strpos(v_definition,v_old)=0 THEN RAISE EXCEPTION 'Registro de complementação inesperado'; END IF;
 v_definition=replace(v_definition,v_old,'created_at,input_payload,record_hash,recorded_status)');
 v_definition=replace(v_definition,'v_name,v_at,v_input,v_hash);','v_name,v_at,v_input,v_hash,v_request.status);');
 v_definition=replace(v_definition,'''operationId'',v_operation,''input'',v_input,','''operationId'',v_operation,''input'',v_input,''recordedStatus'',v_request.status,');
 EXECUTE v_definition;

 SELECT pg_get_functiondef('billing_private.prepare_request_file(text,jsonb)'::regprocedure) INTO v_definition;
 v_old=$old$status<>'approved'$old$;
 IF strpos(v_definition,v_old)=0 THEN RAISE EXCEPTION 'Preparo de anexos inesperado'; END IF;
 v_definition=replace(v_definition,v_old,$new$status NOT IN ('pending','approved')$new$);
 v_definition=replace(v_definition,'Novos anexos podem ser incluídos após a aprovação da solicitação.','Anexos podem ser incluídos em solicitações pendentes ou aprovadas.');
 EXECUTE v_definition;
 SELECT pg_get_functiondef('billing_private.can_upload_request_file(text,text)'::regprocedure) INTO v_definition;
 IF strpos(v_definition,v_old)=0 THEN RAISE EXCEPTION 'Política de anexos inesperada'; END IF;
 EXECUTE replace(v_definition,v_old,$new$status NOT IN ('pending','approved')$new$);

 -- An approval must use the revision the director reviewed. The request row
 -- lock also serializes this check with the complement operation.
 SELECT pg_get_functiondef('billing_private.service_requests_dispatch(text,jsonb)'::regprocedure) INTO v_definition;
 v_old=$old$ARRAY['id','decision','reason','managerSigningMode']$old$;
 IF strpos(v_definition,v_old)=0 THEN RAISE EXCEPTION 'Payload de decisão inesperado'; END IF;
 v_definition=replace(v_definition,v_old,$new$ARRAY['id','decision','reason','managerSigningMode','expectedComplementId']$new$);
 v_old=$old$SELECT * INTO v_signature FROM public.billing_signatures
   WHERE owner_id=v_owner AND user_id=v_actor AND role='manager' AND active FOR SHARE;$old$;
 IF strpos(v_definition,v_old)=0 THEN RAISE EXCEPTION 'Fluxo de decisão inesperado'; END IF;
 v_definition=replace(v_definition,v_old,$new$IF (SELECT id FROM public.billing_service_request_complements WHERE owner_id=v_owner AND request_id=v_id ORDER BY version DESC LIMIT 1)
   IS DISTINCT FROM (p_payload->>'expectedComplementId')::uuid THEN
   RAISE EXCEPTION 'Os dados da solicitação foram atualizados. Confira o valor e os anexos antes de decidir.' USING ERRCODE='23505'; END IF;
  $new$||v_old);
 EXECUTE v_definition;

 SELECT pg_get_functiondef('billing_private.snapshot_request_document()'::regprocedure) INTO v_definition;
 v_old=$old$NEW.decision_signature_hash=billing_private.request_signer_hash(NEW,'manager');$old$;
 IF strpos(v_definition,v_old)=0 THEN RAISE EXCEPTION 'Snapshot de decisão inesperado'; END IF;
 v_definition=replace(v_definition,v_old,$new$IF TG_OP='UPDATE' THEN
  IF OLD.status='pending' AND NEW.status<>'pending' THEN
   SELECT record_hash INTO NEW.decision_complement_hash FROM public.billing_service_request_complements
    WHERE owner_id=NEW.owner_id AND request_id=NEW.id ORDER BY version DESC LIMIT 1;
  ELSIF NEW.decision_complement_hash IS DISTINCT FROM OLD.decision_complement_hash THEN
   RAISE EXCEPTION 'Os dados vinculados à decisão são imutáveis.' USING ERRCODE='23514'; END IF;
 ELSE NEW.decision_complement_hash=NULL;
 END IF;
 $new$||v_old);
 EXECUTE v_definition;

 -- Empty JSON preserves the exact existing hashes. Only new decisions with
 -- prior complements bind that additional evidence to the manager signature.
 SELECT pg_get_functiondef('billing_private.request_signer_hash(public.billing_service_requests,text)'::regprocedure) INTO v_definition;
 v_old=$old$THEN encode(sha256(convert_to(jsonb_build_object($old$;
 IF strpos(v_definition,v_old)=0 THEN RAISE EXCEPTION 'Hash de assinatura inesperado'; END IF;
 v_definition=replace(v_definition,v_old,$new$THEN encode(sha256(convert_to((jsonb_build_object($new$);
 v_old=$old$'reason',CASE WHEN p_kind='manager' THEN p_request.decision_reason END)::text$old$;
 IF strpos(v_definition,v_old)=0 THEN RAISE EXCEPTION 'Conteúdo do hash inesperado'; END IF;
 v_definition=replace(v_definition,v_old,$new$'reason',CASE WHEN p_kind='manager' THEN p_request.decision_reason END)
  || CASE WHEN p_kind='manager' AND p_request.decision_complement_hash IS NOT NULL
     THEN jsonb_build_object('complementHash',p_request.decision_complement_hash) ELSE '{}'::jsonb END)::text$new$);
 EXECUTE v_definition;
END $$;

REVOKE ALL ON FUNCTION billing_private.request_details_json(public.billing_service_requests) FROM PUBLIC,anon,authenticated;
COMMENT ON COLUMN public.billing_service_requests.decision_complement_hash IS 'Latest complement reviewed when deciding, captured under the request lock; bound to registered manager signature, immutable after decision. Legacy decisions remain unchanged.';
