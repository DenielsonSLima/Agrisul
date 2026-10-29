-- Operational split for the TV dashboard. Historical loads remain explicitly
-- unclassified; K=1/2 is captured when an imported trip is linked to a contract.
CREATE OR REPLACE FUNCTION billing_private.summary_harvest_methods(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid;v_company uuid;v_from date;v_to date;v_result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para continuar.' USING ERRCODE='28000'; END IF;
 v_company=billing_private.overview_scope(p_payload,ARRAY['companyId','from','to','contractId','status']);
 PERFORM billing_private.authorize_resource('contracts','list');
 PERFORM billing_private.authorize('registrations.read');
 v_owner=billing_private.current_owner_id();
 PERFORM billing_private.summary_validate_selection(v_company,p_payload);
 IF p_payload->>'from' IS NULL AND p_payload->>'to' IS NULL THEN
  v_to=(now() AT TIME ZONE 'America/Sao_Paulo')::date;v_from=v_to-364;
 ELSIF p_payload->>'from' IS NULL OR p_payload->>'to' IS NULL OR
  p_payload->>'from'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR p_payload->>'to'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
  RAISE EXCEPTION 'Informe o período completo do Dashboard.' USING ERRCODE='22023';
 ELSE v_from=(p_payload->>'from')::date;v_to=(p_payload->>'to')::date;
 END IF;
 IF v_from<'1900-01-01' OR v_to>'9999-12-31' OR v_to<v_from OR v_to-v_from+1>1827 THEN
  RAISE EXCEPTION 'O Dashboard aceita períodos de um dia até cinco anos.' USING ERRCODE='22023';
 END IF;
 WITH methods(code,label,ordinal) AS (VALUES
  ('1','Manual',1),('2','Mecanizada',2),('unknown','Não informado',3)
 ), grouped AS (
  SELECT coalesce(l.harvest_method,'unknown') code,count(*)::integer load_count,sum(l.volume) loaded_volume
  FROM public.billing_contract_loads l
  JOIN public.billing_contracts c ON c.owner_id=l.owner_id AND c.id=l.contract_id
  WHERE l.owner_id=v_owner AND c.company_id=v_company AND l.loaded_at BETWEEN v_from AND v_to
   AND (nullif(p_payload->>'contractId','') IS NULL OR c.id=nullif(p_payload->>'contractId','')::uuid)
   AND (coalesce(p_payload->>'status','')='' OR c.status=p_payload->>'status')
  GROUP BY coalesce(l.harvest_method,'unknown')
 ) SELECT jsonb_agg(jsonb_build_object('code',m.code,'label',m.label,
   'loadCount',coalesce(g.load_count,0),'loadedVolume',coalesce(g.loaded_volume,0)::text) ORDER BY m.ordinal)
 INTO v_result FROM methods m LEFT JOIN grouped g ON g.code=m.code;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION billing_private.summary_harvest_methods(jsonb) FROM PUBLIC,anon,authenticated;

DO $migration$
DECLARE v_definition text;v_original text;
BEGIN
 SELECT pg_get_functiondef('billing_private.summary_dispatch(text,jsonb)'::regprocedure) INTO v_definition;
 v_original='v_result=billing_private.summary_dashboard(p_payload)||billing_private.summary_operational_intelligence(p_payload);';
 IF strpos(v_definition,v_original)=0 THEN RAISE EXCEPTION 'Unexpected summary dispatcher; review before changing it.'; END IF;
 v_definition=replace(v_definition,v_original,
  'v_result=billing_private.summary_dashboard(p_payload)||billing_private.summary_operational_intelligence(p_payload)||jsonb_build_object(''harvestMethods'',billing_private.summary_harvest_methods(p_payload));');
 EXECUTE v_definition;
END $migration$;
