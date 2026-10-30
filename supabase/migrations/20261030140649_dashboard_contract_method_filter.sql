BEGIN;
-- One canonical contract classification for every Dashboard projection. The
-- source remains the saved contract type; load/import codes are separate facts.
CREATE OR REPLACE FUNCTION billing_private.summary_scope(p_payload jsonb)
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT billing_private.overview_scope(p_payload-ARRAY['partnerIds','contractIds','farmIds','plotIds'],
  ARRAY['companyId','from','to','contractId','status','partnerId','farmId','plotId','contractMethod']);
$$;
REVOKE ALL ON FUNCTION billing_private.summary_scope(jsonb) FROM PUBLIC,anon,authenticated;
DO $method$
DECLARE definition text;projection text;signature text;
 predicate text:='(cardinality(v_contract_ids)=0 OR c.id=ANY(v_contract_ids))';
 validation text:=$valid$IF p_payload?'contractMethod' AND (jsonb_typeof(p_payload->'contractMethod') IS DISTINCT FROM 'string' OR p_payload->>'contractMethod' NOT IN ('','1','2','unknown')) THEN
  RAISE EXCEPTION 'Modalidade inválida.' USING ERRCODE='22023'; END IF;$valid$;
BEGIN
 definition:=pg_get_functiondef('billing_private.summary_validate_selection(uuid,jsonb)'::regprocedure);
 IF strpos(definition,'Modalidade inválida.')>0 THEN RAISE EXCEPTION 'Inspect selection validation before adding method.'; END IF;
 definition:=regexp_replace(definition,E'\nBEGIN\n',E'\nBEGIN\n '||validation||E'\n');EXECUTE definition;
 FOREACH projection IN ARRAY ARRAY['summary_dashboard','summary_operational_intelligence','summary_harvest_methods','summary_dimensions','summary_contract_comparison'] LOOP
  signature:=format('billing_private.%I(%s)',projection,CASE WHEN projection IN ('summary_dimensions','summary_contract_comparison') THEN 'jsonb,jsonb' ELSE 'jsonb' END);
  definition:=pg_get_functiondef(signature::regprocedure);
  IF strpos(definition,predicate)=0 OR strpos(definition,'summary_validate_selection')=0 THEN RAISE EXCEPTION 'Inspect modality predicate in %',projection; END IF;
  definition:=replace(definition,predicate,predicate||E'\n    AND (coalesce(p_payload->>''contractMethod'','''')='''' OR coalesce(billing_private.contract_import_harvest_method(c.type_name),''unknown'')=p_payload->>''contractMethod'')');
  EXECUTE definition;
 END LOOP;
 definition:=pg_get_functiondef('billing_private.summary_dispatch(text,jsonb)'::regprocedure);
 IF strpos(definition,'''cashScope'',''contract'',')=0 THEN RAISE EXCEPTION 'Inspect Dashboard filter echo before method.'; END IF;
 EXECUTE replace(definition,'''cashScope'',''contract'',','''cashScope'',''contract'',''contractMethod'',coalesce(p_payload->>''contractMethod'',''''),');
END $method$;
COMMIT;
