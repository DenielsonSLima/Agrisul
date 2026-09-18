-- The director's immutable decision remains separate from service execution.
ALTER TABLE public.billing_service_requests
 ADD COLUMN completed_at timestamptz,
 ADD COLUMN completed_by uuid,
 ADD COLUMN completed_by_name text,
 ADD CONSTRAINT billing_request_completion_consistent CHECK (
  (completed_at IS NULL AND completed_by IS NULL AND completed_by_name IS NULL)
  OR (status='approved' AND completed_at IS NOT NULL AND completed_by IS NOT NULL AND length(btrim(completed_by_name))>0)
 );
ALTER TABLE public.billing_service_request_events DROP CONSTRAINT billing_service_request_events_action_check;
ALTER TABLE public.billing_service_request_events ADD CONSTRAINT billing_service_request_events_action_check
 CHECK(action IN ('created','approved','rejected','completed'));

CREATE OR REPLACE FUNCTION billing_private.request_details_json(p_request public.billing_service_requests) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH entries AS (
  SELECT c.*,jsonb_build_object('id',c.id,'version',c.version,'serviceValue',billing_private.decimal_text(c.service_value),
   'returnDate',c.return_date,'attachmentIds',c.attachment_ids,'actorId',c.actor_id,'actorName',c.actor_name,
   'at',c.created_at,'hash',c.record_hash,'recordedStatus',c.recorded_status) AS value
  FROM public.billing_service_request_complements c WHERE c.owner_id=p_request.owner_id AND c.request_id=p_request.id
 ), latest AS (SELECT * FROM entries ORDER BY version DESC LIMIT 1)
 SELECT jsonb_build_object('canComplement',p_request.status IN ('pending','approved') AND billing_private.has_permission('requests.write'),
  'workflowStatus',CASE WHEN p_request.status='rejected' THEN 'rejected' WHEN p_request.completed_at IS NOT NULL THEN 'finished' WHEN p_request.status='approved' THEN 'in_progress' ELSE 'open' END,
  'canComplete',p_request.status='approved' AND p_request.completed_at IS NULL AND billing_private.has_permission('requests.write'),
  'completion',CASE WHEN p_request.completed_at IS NOT NULL THEN jsonb_build_object('at',p_request.completed_at,'userId',p_request.completed_by,'name',p_request.completed_by_name) END,
  'decisionComplementHash',p_request.decision_complement_hash,
  'complements',coalesce((SELECT jsonb_agg(value ORDER BY version) FROM entries),'[]'::jsonb),
  'currentDetails',coalesce((SELECT jsonb_build_object('serviceValue',value->'serviceValue','returnDate',value->'returnDate') FROM latest),
   jsonb_build_object('serviceValue',billing_private.decimal_text(p_request.service_value),'returnDate',p_request.return_date)))
$$;

CREATE FUNCTION billing_private.list_service_requests(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();v_search text;v_tab text;v_from date;v_to date;v_requester uuid;
 v_page integer;v_size integer;v_total bigint;v_open bigint;v_progress bigint;v_finished bigint;v_rows jsonb;
BEGIN
 PERFORM billing_private.authorize('requests.read');
 PERFORM billing_private.request_payload(p_payload,ARRAY['search','dateFrom','dateTo','requesterId','tab','page','pageSize']);
 v_search=coalesce(btrim(p_payload->>'search'),'');v_tab=coalesce(nullif(p_payload->>'tab',''),'pending');
 v_from=nullif(p_payload->>'dateFrom','')::date;v_to=nullif(p_payload->>'dateTo','')::date;
 v_requester=nullif(p_payload->>'requesterId','')::uuid;
 v_page=coalesce((p_payload->>'page')::integer,1);v_size=coalesce((p_payload->>'pageSize')::integer,20);
 IF v_page NOT BETWEEN 1 AND 1000000 OR v_size NOT BETWEEN 1 AND 100 OR length(v_search)>200 OR v_tab NOT IN ('pending','in_progress','finished') OR v_from>v_to THEN
  RAISE EXCEPTION 'Filtros da solicitação inválidos.' USING ERRCODE='22023'; END IF;
 WITH filtered AS (
  SELECT r.* FROM public.billing_service_requests r WHERE r.owner_id=v_owner
   AND (v_from IS NULL OR r.created_at >= (v_from::timestamp AT TIME ZONE 'America/Sao_Paulo'))
   AND (v_to IS NULL OR r.created_at < ((v_to+1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
   AND (v_requester IS NULL OR r.requester_signature_id=v_requester)
   AND (v_search='' OR r.number::text ILIKE '%'||v_search||'%' OR r.company_name ILIKE '%'||v_search||'%'
    OR r.requester_name ILIKE '%'||v_search||'%' OR r.items::text ILIKE '%'||v_search||'%')
 ), totals AS (
  SELECT count(*) FILTER(WHERE status='pending') AS opened,
   count(*) FILTER(WHERE status='approved' AND completed_at IS NULL) AS progress,
   count(*) FILTER(WHERE status='rejected' OR completed_at IS NOT NULL) AS finished FROM filtered
 ), pagination AS (
  SELECT least(v_page,greatest(1,ceil((CASE v_tab WHEN 'pending' THEN opened WHEN 'in_progress' THEN progress ELSE finished END)::numeric/v_size)::integer)) AS page FROM totals
 ), paginated AS (
  SELECT * FROM filtered r WHERE (v_tab='pending' AND r.status='pending')
   OR (v_tab='in_progress' AND r.status='approved' AND r.completed_at IS NULL)
   OR (v_tab='finished' AND (r.status='rejected' OR r.completed_at IS NOT NULL))
  ORDER BY r.created_at DESC,r.number DESC LIMIT v_size OFFSET (SELECT (page-1)*v_size FROM pagination)
 )
 SELECT (SELECT opened FROM totals),(SELECT progress FROM totals),(SELECT finished FROM totals),(SELECT page FROM pagination),
  coalesce((SELECT jsonb_agg(billing_private.request_json(r::public.billing_service_requests) ORDER BY r.created_at DESC,r.number DESC) FROM paginated r),'[]')
  INTO v_open,v_progress,v_finished,v_page,v_rows;
 v_total=CASE v_tab WHEN 'pending' THEN v_open WHEN 'in_progress' THEN v_progress ELSE v_finished END;
 RETURN jsonb_build_object('items',v_rows,'total',v_total,'page',v_page,'pageSize',v_size,'counts',jsonb_build_object('pending',v_open,'inProgress',v_progress,'finished',v_finished));
END $$;

CREATE FUNCTION billing_private.complete_service_request(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid;v_actor uuid:=auth.uid();v_request public.billing_service_requests;v_id uuid;v_at timestamptz;v_name text;
BEGIN
 PERFORM billing_private.lock_request_actor();v_owner=billing_private.current_owner_id();
 PERFORM billing_private.authorize('requests.read');PERFORM billing_private.authorize('requests.write');
 PERFORM billing_private.request_payload(p_payload,ARRAY['id']);v_id=(p_payload->>'id')::uuid;
 IF v_id IS NULL THEN RAISE EXCEPTION 'Informe a solicitação.' USING ERRCODE='22023';END IF;
 SELECT * INTO v_request FROM public.billing_service_requests WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.' USING ERRCODE='P0002';END IF;
 IF v_request.status<>'approved' THEN RAISE EXCEPTION 'Somente serviços aprovados e em andamento podem ser finalizados.' USING ERRCODE='23514';END IF;
 IF v_request.completed_at IS NOT NULL THEN RETURN jsonb_build_object('request',billing_private.request_json(v_request));END IF;
 SELECT coalesce(nullif(btrim(s.name),''),nullif(u.email,''),'Operador') INTO v_name FROM auth.users u
  LEFT JOIN public.billing_user_settings s ON s.user_id=u.id AND s.owner_id=v_owner WHERE u.id=v_actor;
 v_at=date_trunc('second',clock_timestamp());
 UPDATE public.billing_service_requests SET completed_at=v_at,completed_by=v_actor,completed_by_name=v_name WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_request;
 INSERT INTO public.billing_service_request_events(owner_id,request_id,action,actor_id,actor_name,signature_path,reason,created_at)
  VALUES(v_owner,v_id,'completed',v_actor,v_name,NULL,'Conclusão do serviço registrada.',v_at);
 RETURN jsonb_build_object('request',billing_private.request_json(v_request));
END $$;

DO $$ DECLARE v_definition text;v_old text;v_start integer;v_end integer;
BEGIN
 SELECT pg_get_functiondef('billing_private.service_requests_dispatch(text,jsonb)'::regprocedure) INTO v_definition;
 v_old=$old$'decide','complement'$old$;
 IF strpos(v_definition,v_old)=0 THEN RAISE EXCEPTION 'Dispatcher de solicitações inesperado';END IF;
 v_definition=replace(v_definition,v_old,$new$'decide','complement','complete'$new$);
 -- Insert the new action next to the existing complement dispatch.
 v_old='IF p_action=''complement'' THEN';
 IF strpos(v_definition,v_old)=0 THEN RAISE EXCEPTION 'Ação de complementação não encontrada';END IF;
 v_definition=replace(v_definition,v_old,'IF p_action=''complete'' THEN RETURN billing_private.complete_service_request(p_payload); END IF; '||v_old);
 v_start=strpos(v_definition,' IF p_action=''list'' THEN');v_end=strpos(v_definition,' IF p_action=''get'' THEN');
 IF v_start=0 OR v_end<=v_start THEN RAISE EXCEPTION 'Consulta de solicitações inesperada';END IF;
 v_definition=substr(v_definition,1,v_start-1)||' IF p_action=''list'' THEN RETURN billing_private.list_service_requests(p_payload); END IF;'||chr(10)||substr(v_definition,v_end);
 EXECUTE v_definition;

 SELECT pg_get_functiondef('billing_private.snapshot_request_document()'::regprocedure) INTO v_definition;
 v_old='NEW.decision_signature_hash=billing_private.request_signer_hash(NEW,''manager'');';
 IF strpos(v_definition,v_old)=0 THEN RAISE EXCEPTION 'Snapshot inesperado';END IF;
 v_definition=replace(v_definition,v_old,$new$IF TG_OP='UPDATE' AND OLD.completed_at IS NOT NULL AND
  ROW(NEW.completed_at,NEW.completed_by,NEW.completed_by_name) IS DISTINCT FROM ROW(OLD.completed_at,OLD.completed_by,OLD.completed_by_name) THEN
  RAISE EXCEPTION 'O registro da conclusão é imutável.' USING ERRCODE='23514';END IF;
 $new$||v_old);
 EXECUTE v_definition;
END $$;
REVOKE ALL ON FUNCTION billing_private.list_service_requests(jsonb),billing_private.complete_service_request(jsonb),billing_private.request_details_json(public.billing_service_requests) FROM PUBLIC,anon,authenticated;
COMMENT ON COLUMN public.billing_service_requests.completed_at IS 'Operational service completion, separate from the original document and director decision; actor and timestamp are server-derived.';
