BEGIN;

-- Filter existing authorized projections instead of recalculating financials.
-- Farms are workspace records: the company catalog contains every historical
-- origin of its contracts, with every registered child plot, without a date cap.
CREATE OR REPLACE FUNCTION billing_private.summary_validate_selection(p_company uuid,p_payload jsonb)
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_contract uuid;v_partner uuid;
 v_farm uuid;v_plot uuid;v_status text;v_key text;
BEGIN
 FOREACH v_key IN ARRAY ARRAY['contractId','status','partnerId','farmId','plotId'] LOOP
  IF p_payload ? v_key AND jsonb_typeof(p_payload->v_key) IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Seleção de filtros inválida.' USING ERRCODE='22023';
  END IF;
 END LOOP;
 v_status=coalesce(p_payload->>'status','');
 IF v_status NOT IN ('','Rascunho','Ativo','Concluído','Cancelado') THEN
  RAISE EXCEPTION 'Status do contrato inválido.' USING ERRCODE='22023';
 END IF;
 v_contract=nullif(p_payload->>'contractId','')::uuid;
 v_partner=nullif(p_payload->>'partnerId','')::uuid;
 v_farm=nullif(p_payload->>'farmId','')::uuid;
 v_plot=nullif(p_payload->>'plotId','')::uuid;
 IF v_contract IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.billing_contracts
  WHERE owner_id=v_owner AND company_id=p_company AND id=v_contract) THEN
  RAISE EXCEPTION 'Contrato não encontrado na empresa selecionada.' USING ERRCODE='42501';
 END IF;
 IF v_partner IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.billing_contracts c
  JOIN public.billing_clients partner ON partner.owner_id=c.owner_id AND partner.id=c.client_id
  WHERE c.owner_id=v_owner AND c.company_id=p_company AND c.client_id=v_partner) THEN
  RAISE EXCEPTION 'Cliente não encontrado na empresa selecionada.' USING ERRCODE='42501';
 END IF;
 IF v_farm IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.billing_contract_loads l
  JOIN public.billing_contracts c ON c.owner_id=l.owner_id AND c.id=l.contract_id
  JOIN public.billing_farms f ON f.owner_id=l.owner_id AND f.id=l.farm_id
  WHERE l.owner_id=v_owner AND c.company_id=p_company AND l.farm_id=v_farm) THEN
  RAISE EXCEPTION 'Fazenda não encontrada nas origens da empresa selecionada.' USING ERRCODE='42501';
 END IF;
 IF v_plot IS NOT NULL THEN
  IF v_farm IS NULL THEN
   RAISE EXCEPTION 'Selecione a fazenda do talhão.' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.billing_farm_plots
   WHERE owner_id=v_owner AND farm_id=v_farm AND id=v_plot) THEN
   RAISE EXCEPTION 'Talhão não encontrado na fazenda selecionada.' USING ERRCODE='42501';
  END IF;
 END IF;
EXCEPTION WHEN invalid_text_representation THEN
 RAISE EXCEPTION 'Seleção de filtros inválida.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.summary_validate_selection(uuid,jsonb) FROM PUBLIC,anon,authenticated;

DO $migration$
DECLARE
 definition text;before_definition text;projection text;signature text;
 allowed_before text:='ARRAY[''companyId'',''from'',''to'',''contractId'',''status'']';
 allowed_after text:='ARRAY[''companyId'',''from'',''to'',''contractId'',''status'',''partnerId'',''farmId'',''plotId'']';
 contract_anchor text:='WHERE c.owner_id=v_owner AND c.company_id=v_company';
 contract_selection text:=$selection$WHERE c.owner_id=v_owner AND c.company_id=v_company
    AND (nullif(p_payload->>'partnerId','') IS NULL OR c.client_id=nullif(p_payload->>'partnerId','')::uuid)
    AND ((nullif(p_payload->>'farmId','') IS NULL AND nullif(p_payload->>'plotId','') IS NULL)
     OR EXISTS(SELECT 1 FROM public.billing_contract_loads origin
      WHERE origin.owner_id=c.owner_id AND origin.contract_id=c.id
       AND (nullif(p_payload->>'farmId','') IS NULL OR origin.farm_id=nullif(p_payload->>'farmId','')::uuid)
       AND (nullif(p_payload->>'plotId','') IS NULL OR origin.plot_id=nullif(p_payload->>'plotId','')::uuid)))$selection$;
 origin_selection text:=$selection$
    AND (nullif(p_payload->>'farmId','') IS NULL OR l.farm_id=nullif(p_payload->>'farmId','')::uuid)
    AND (nullif(p_payload->>'plotId','') IS NULL OR l.plot_id=nullif(p_payload->>'plotId','')::uuid)$selection$;
 load_anchor text;
BEGIN
 FOREACH projection IN ARRAY ARRAY['summary_dashboard','summary_operational_intelligence','summary_harvest_methods','summary_dimensions'] LOOP
  signature=format('billing_private.%I(%s)',projection,CASE WHEN projection='summary_dimensions' THEN 'jsonb,jsonb' ELSE 'jsonb' END);
  definition=pg_get_functiondef(signature::regprocedure);before_definition=definition;
  IF strpos(definition,allowed_before)=0 OR strpos(definition,'summary_validate_selection(v_company,p_payload)')=0
   OR strpos(definition,'partnerId')>0 THEN
   RAISE EXCEPTION 'Unexpected Dashboard projection; review origin filters: %',projection;
  END IF;
  definition=replace(definition,allowed_before,allowed_after);
  IF projection='summary_harvest_methods' THEN
   load_anchor='WHERE l.owner_id=v_owner AND c.company_id=v_company AND l.loaded_at BETWEEN v_from AND v_to';
   IF strpos(definition,load_anchor)=0 THEN RAISE EXCEPTION 'Unexpected harvest origin selection'; END IF;
   definition=replace(definition,load_anchor,load_anchor||origin_selection||
    E'\n    AND (nullif(p_payload->>''partnerId'','''') IS NULL OR c.client_id=nullif(p_payload->>''partnerId'','''')::uuid)');
  ELSE
   IF strpos(definition,contract_anchor)=0 THEN RAISE EXCEPTION 'Unexpected contract selection: %',projection; END IF;
   definition=replace(definition,contract_anchor,contract_selection);
   load_anchor=CASE WHEN projection='summary_dashboard'
    THEN 'AND l.loaded_at BETWEEN v_previous_from AND v_to'
    ELSE 'WHERE l.owner_id=v_owner AND l.loaded_at BETWEEN v_from AND v_to' END;
   IF strpos(definition,load_anchor)=0 THEN RAISE EXCEPTION 'Unexpected load selection: %',projection; END IF;
   -- This WHERE executes after contract_load_financials(c): allocation and cent
   -- rounding are still calculated over the complete original contract.
   definition=replace(definition,load_anchor,load_anchor||origin_selection);
  END IF;
  IF definition=before_definition OR strpos(definition,origin_selection)=0 THEN
   RAISE EXCEPTION 'Dashboard origin selection not installed: %',projection;
  END IF;
  EXECUTE definition;
 END LOOP;
END $migration$;

CREATE OR REPLACE FUNCTION billing_private.summary_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_result jsonb;v_owner uuid;v_company uuid;v_options jsonb;v_label text;
 v_partners jsonb;v_farms jsonb;v_partner_label text;v_farm_label text;v_plot_label text;
BEGIN
 IF p_action<>'dashboard' THEN RETURN billing_private.summary_monthly_dispatch(p_action,p_payload); END IF;
 -- Every projection authorizes the account/company, validates the same fields
 -- and applies the same client/origin selection to current and prior loads.
 v_result=billing_private.summary_dashboard(p_payload)||billing_private.summary_operational_intelligence(p_payload)
  ||jsonb_build_object('harvestMethods',billing_private.summary_harvest_methods(p_payload));
 v_result=v_result||jsonb_build_object('dimensions',billing_private.summary_dimensions(p_payload,v_result));
 v_owner=billing_private.current_owner_id();v_company=(p_payload->>'companyId')::uuid;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'clientId',c.client_id,'clientName',cl.legal_name,
  'contractNumber',c.contract_number,'title',c.title,'status',c.status)
  ORDER BY lower(cl.legal_name),c.contract_number,c.id),'[]'::jsonb) INTO v_options
 FROM public.billing_contracts c JOIN public.billing_clients cl ON cl.owner_id=c.owner_id AND cl.id=c.client_id
 WHERE c.owner_id=v_owner AND c.company_id=v_company;
 SELECT concat_ws(' · ',cl.legal_name,nullif(c.contract_number,''),c.title) INTO v_label
 FROM public.billing_contracts c JOIN public.billing_clients cl ON cl.owner_id=c.owner_id AND cl.id=c.client_id
 WHERE c.owner_id=v_owner AND c.company_id=v_company AND c.id=nullif(p_payload->>'contractId','')::uuid;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',partner.id,'name',partner.legal_name)
  ORDER BY lower(partner.legal_name),partner.id),'[]'::jsonb) INTO v_partners
 FROM public.billing_clients partner WHERE partner.owner_id=v_owner
  AND EXISTS(SELECT 1 FROM public.billing_contracts c
   WHERE c.owner_id=v_owner AND c.company_id=v_company AND c.client_id=partner.id);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',farm.id,'name',farm.name,'plots',
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',plot.id,'name',plot.name) ORDER BY lower(plot.name),plot.id)
   FROM public.billing_farm_plots plot WHERE plot.owner_id=v_owner AND plot.farm_id=farm.id),'[]'::jsonb))
  ORDER BY lower(farm.name),farm.id),'[]'::jsonb) INTO v_farms
 FROM public.billing_farms farm WHERE farm.owner_id=v_owner
  AND EXISTS(SELECT 1 FROM public.billing_contract_loads l
   JOIN public.billing_contracts c ON c.owner_id=l.owner_id AND c.id=l.contract_id
   WHERE l.owner_id=v_owner AND c.company_id=v_company AND l.farm_id=farm.id);
 SELECT legal_name INTO v_partner_label FROM public.billing_clients
  WHERE owner_id=v_owner AND id=nullif(p_payload->>'partnerId','')::uuid;
 SELECT name INTO v_farm_label FROM public.billing_farms
  WHERE owner_id=v_owner AND id=nullif(p_payload->>'farmId','')::uuid;
 SELECT name INTO v_plot_label FROM public.billing_farm_plots
  WHERE owner_id=v_owner AND farm_id=nullif(p_payload->>'farmId','')::uuid AND id=nullif(p_payload->>'plotId','')::uuid;
 RETURN v_result||jsonb_build_object(
  'filters',jsonb_build_object('companyId',v_company,'contractId',coalesce(p_payload->>'contractId',''),
   'contractLabel',coalesce(v_label,''),'status',coalesce(p_payload->>'status',''),
   'partnerId',coalesce(p_payload->>'partnerId',''),'partnerLabel',coalesce(v_partner_label,''),
   'farmId',coalesce(p_payload->>'farmId',''),'farmLabel',coalesce(v_farm_label,''),
   'plotId',coalesce(p_payload->>'plotId',''),'plotLabel',coalesce(v_plot_label,''),'cashScope','contract'),
  'filterOptions',jsonb_build_object('contracts',v_options,'partners',v_partners,'farms',v_farms,
   'statuses',coalesce((SELECT jsonb_agg(status ORDER BY status) FROM
    (SELECT DISTINCT status FROM public.billing_contracts WHERE owner_id=v_owner AND company_id=v_company) statuses),'[]'::jsonb)));
END $$;
REVOKE ALL ON FUNCTION billing_private.summary_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.summary_dispatch(text,jsonb) TO authenticated;
COMMENT ON FUNCTION billing_private.summary_dispatch(text,jsonb) IS
 'Company/date/contract/status/partner/origin dashboard; complete company origin catalog. Load financials retain full-contract allocation before slicing. Payments remain whole contract entries for contracts matching the historical origin, without an invented farm/plot allocation. Workspace planning stays explicitly unfiltered.';

COMMIT;
