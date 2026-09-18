-- Explicitly reject null actions: SQL comparisons alone yield NULL and would
-- otherwise fall through to the final create/save branch.
DO $$
DECLARE v_definition text;v_marker text;
BEGIN
 SELECT pg_get_functiondef('billing_private.signatures_dispatch(text,jsonb)'::regprocedure) INTO v_definition;
 v_marker=' IF p_action IN (''prepare-upload'',''save'',''deactivate'') THEN';
 IF strpos(v_definition,v_marker)=0 THEN RAISE EXCEPTION 'Unexpected signatures dispatcher; review before applying.'; END IF;
 v_definition=replace(v_definition,v_marker,
  ' IF p_action IS NULL OR p_action NOT IN (''list'',''options'',''prepare-upload'',''save'',''deactivate'') THEN RAISE EXCEPTION ''Operação inválida.'' USING ERRCODE=''22023''; END IF;
'||v_marker);
 EXECUTE v_definition;
 SELECT pg_get_functiondef('billing_private.service_requests_dispatch(text,jsonb)'::regprocedure) INTO v_definition;
 v_marker=' IF p_action IN (''prepare-upload'',''create'',''decide'') THEN';
 IF strpos(v_definition,v_marker)=0 THEN RAISE EXCEPTION 'Unexpected requests dispatcher; review before applying.'; END IF;
 v_definition=replace(v_definition,v_marker,
  ' IF p_action IS NULL OR p_action NOT IN (''list'',''get'',''options'',''prepare-upload'',''create'',''decide'') THEN RAISE EXCEPTION ''Operação inválida.'' USING ERRCODE=''22023''; END IF;
'||v_marker);
 EXECUTE v_definition;
END $$;
