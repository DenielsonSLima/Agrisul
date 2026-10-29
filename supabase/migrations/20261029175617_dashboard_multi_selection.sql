BEGIN;

-- Normalize each selection once per projection. The bound applies to the input
-- array before deduplication, so repeated IDs cannot create unbounded payloads.
CREATE FUNCTION billing_private.summary_selection_ids(p_payload jsonb,p_array_key text,p_single_key text)
RETURNS uuid[] LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_ids uuid[]:='{}'::uuid[];v_item jsonb;v_single text;
BEGIN
 IF p_payload ? p_array_key THEN
  IF jsonb_typeof(p_payload->p_array_key) IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Selecione uma lista válida para os filtros.' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_payload->p_array_key)>200 THEN
   RAISE EXCEPTION 'Selecione até 200 itens em cada filtro.' USING ERRCODE='22023';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->p_array_key) LOOP
   IF jsonb_typeof(v_item) IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Seleção de filtros inválida.' USING ERRCODE='22023';
   END IF;
   v_ids=array_append(v_ids,(v_item#>>'{}')::uuid);
  END LOOP;
 END IF;
 IF p_single_key IS NOT NULL AND p_payload ? p_single_key THEN
  IF jsonb_typeof(p_payload->p_single_key) IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Seleção de filtros inválida.' USING ERRCODE='22023';
  END IF;
  v_single=nullif(p_payload->>p_single_key,'');
  IF v_single IS NOT NULL THEN v_ids=array_append(v_ids,v_single::uuid); END IF;
 END IF;
 RETURN ARRAY(SELECT DISTINCT selected_id FROM unnest(v_ids) selected(selected_id) ORDER BY selected_id);
EXCEPTION WHEN invalid_text_representation THEN
 RAISE EXCEPTION 'Seleção de filtros inválida.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.summary_selection_ids(jsonb,text,text) FROM PUBLIC,anon,authenticated;

-- overview_scope is shared with unrelated modules and only accepts strings.
-- Remove only the four known array fields for that existing authorization;
-- the selection validator below checks their types, bounds and every UUID.
CREATE FUNCTION billing_private.summary_scope(p_payload jsonb)
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT billing_private.overview_scope(p_payload-ARRAY['partnerIds','contractIds','farmIds','plotIds'],
  ARRAY['companyId','from','to','contractId','status','partnerId','farmId','plotId']);
$$;
REVOKE ALL ON FUNCTION billing_private.summary_scope(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.summary_validate_selection(p_company uuid,p_payload jsonb)
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_status text;v_farm uuid;v_plot uuid;
 v_contract_ids uuid[];v_partner_ids uuid[];v_farm_ids uuid[];v_plot_ids uuid[];
BEGIN
 IF p_payload ? 'status' AND jsonb_typeof(p_payload->'status') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Seleção de filtros inválida.' USING ERRCODE='22023';
 END IF;
 v_status=coalesce(p_payload->>'status','');
 IF v_status NOT IN ('','Rascunho','Ativo','Concluído','Cancelado') THEN
  RAISE EXCEPTION 'Status do contrato inválido.' USING ERRCODE='22023';
 END IF;
 v_contract_ids=billing_private.summary_selection_ids(p_payload,'contractIds','contractId');
 v_partner_ids=billing_private.summary_selection_ids(p_payload,'partnerIds','partnerId');
 -- Validate the singular farm even when its singular plot narrows it to a
 -- single child. New plot arrays intentionally do not require farm arrays.
 v_farm_ids=billing_private.summary_selection_ids(p_payload,'farmIds','farmId');
 v_plot_ids=billing_private.summary_selection_ids(p_payload,'plotIds','plotId');
 v_farm=nullif(p_payload->>'farmId','')::uuid;v_plot=nullif(p_payload->>'plotId','')::uuid;
 IF v_plot IS NOT NULL AND v_farm IS NULL THEN
  RAISE EXCEPTION 'Selecione a fazenda do talhão.' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM unnest(v_contract_ids) selected(id) WHERE NOT EXISTS(
  SELECT 1 FROM public.billing_contracts c WHERE c.owner_id=v_owner AND c.company_id=p_company AND c.id=selected.id)) THEN
  RAISE EXCEPTION 'Contrato não encontrado na empresa selecionada.' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM unnest(v_partner_ids) selected(id) WHERE NOT EXISTS(
  SELECT 1 FROM public.billing_contracts c JOIN public.billing_clients partner ON partner.owner_id=c.owner_id AND partner.id=c.client_id
  WHERE c.owner_id=v_owner AND c.company_id=p_company AND c.client_id=selected.id)) THEN
  RAISE EXCEPTION 'Cliente não encontrado na empresa selecionada.' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM unnest(v_farm_ids) selected(id) WHERE NOT EXISTS(
  SELECT 1 FROM public.billing_contract_loads l
  JOIN public.billing_contracts c ON c.owner_id=l.owner_id AND c.id=l.contract_id
  JOIN public.billing_farms farm ON farm.owner_id=l.owner_id AND farm.id=l.farm_id
  WHERE l.owner_id=v_owner AND c.company_id=p_company AND l.farm_id=selected.id)) THEN
  RAISE EXCEPTION 'Fazenda não encontrada nas origens da empresa selecionada.' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM unnest(v_plot_ids) selected(id) WHERE NOT EXISTS(
  SELECT 1 FROM public.billing_farm_plots plot WHERE plot.owner_id=v_owner AND plot.id=selected.id
   AND EXISTS(SELECT 1 FROM public.billing_contract_loads l
    JOIN public.billing_contracts c ON c.owner_id=l.owner_id AND c.id=l.contract_id
    WHERE l.owner_id=v_owner AND c.company_id=p_company AND l.farm_id=plot.farm_id))) THEN
  RAISE EXCEPTION 'Talhão não encontrado nas origens da empresa selecionada.' USING ERRCODE='42501';
 END IF;
 IF v_plot IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.billing_farm_plots
  WHERE owner_id=v_owner AND farm_id=v_farm AND id=v_plot) THEN
  RAISE EXCEPTION 'Talhão não encontrado na fazenda selecionada.' USING ERRCODE='42501';
 END IF;
END $$;
REVOKE ALL ON FUNCTION billing_private.summary_validate_selection(uuid,jsonb) FROM PUBLIC,anon,authenticated;

DO $migration$
DECLARE
 definition text;projection text;signature text;
 scope_before text:='billing_private.overview_scope(p_payload,ARRAY[''companyId'',''from'',''to'',''contractId'',''status'',''partnerId'',''farmId'',''plotId''])';
 validation_anchor text:='PERFORM billing_private.summary_validate_selection(v_company,p_payload);';
 contract_before text:=$selection$WHERE c.owner_id=v_owner AND c.company_id=v_company
    AND (nullif(p_payload->>'partnerId','') IS NULL OR c.client_id=nullif(p_payload->>'partnerId','')::uuid)
    AND ((nullif(p_payload->>'farmId','') IS NULL AND nullif(p_payload->>'plotId','') IS NULL)
     OR EXISTS(SELECT 1 FROM public.billing_contract_loads origin
      WHERE origin.owner_id=c.owner_id AND origin.contract_id=c.id
       AND (nullif(p_payload->>'farmId','') IS NULL OR origin.farm_id=nullif(p_payload->>'farmId','')::uuid)
       AND (nullif(p_payload->>'plotId','') IS NULL OR origin.plot_id=nullif(p_payload->>'plotId','')::uuid)))$selection$;
 contract_after text:=$selection$WHERE c.owner_id=v_owner AND c.company_id=v_company
    AND (cardinality(v_partner_ids)=0 OR c.client_id=ANY(v_partner_ids))
    AND ((cardinality(v_farm_ids)=0 AND cardinality(v_plot_ids)=0)
     OR EXISTS(SELECT 1 FROM public.billing_contract_loads origin
      WHERE origin.owner_id=c.owner_id AND origin.contract_id=c.id
       AND (origin.farm_id=ANY(v_farm_ids) OR origin.plot_id=ANY(v_plot_ids))))$selection$;
 origin_before text:=$selection$
    AND (nullif(p_payload->>'farmId','') IS NULL OR l.farm_id=nullif(p_payload->>'farmId','')::uuid)
    AND (nullif(p_payload->>'plotId','') IS NULL OR l.plot_id=nullif(p_payload->>'plotId','')::uuid)$selection$;
 origin_after text:=$selection$
    AND ((cardinality(v_farm_ids)=0 AND cardinality(v_plot_ids)=0)
     OR l.farm_id=ANY(v_farm_ids) OR l.plot_id=ANY(v_plot_ids))$selection$;
BEGIN
 FOREACH projection IN ARRAY ARRAY['summary_dashboard','summary_operational_intelligence','summary_harvest_methods','summary_dimensions'] LOOP
  signature=format('billing_private.%I(%s)',projection,CASE WHEN projection='summary_dimensions' THEN 'jsonb,jsonb' ELSE 'jsonb' END);
  definition=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
  IF strpos(definition,scope_before)=0 OR strpos(definition,validation_anchor)=0
   OR strpos(definition,origin_before)=0 OR strpos(definition,'v_partner_ids')>0 THEN
   RAISE EXCEPTION 'Unexpected Dashboard projection before multiselection: %',projection;
  END IF;
  definition=replace(definition,scope_before,'billing_private.summary_scope(p_payload)');
  definition=regexp_replace(definition,E'\nBEGIN\n',E'\n v_partner_ids uuid[];v_contract_ids uuid[];v_farm_ids uuid[];v_plot_ids uuid[];\nBEGIN\n');
  definition=replace(definition,validation_anchor,validation_anchor||$initialize$
 v_partner_ids=billing_private.summary_selection_ids(p_payload,'partnerIds','partnerId');
 v_contract_ids=billing_private.summary_selection_ids(p_payload,'contractIds','contractId');
 -- Legacy farm+plot means only that child, not the entire farm. Array farms
 -- are whole origins and union with arbitrary plot selections across farms.
 v_farm_ids=billing_private.summary_selection_ids(p_payload,'farmIds',CASE WHEN nullif(p_payload->>'plotId','') IS NULL THEN 'farmId' ELSE NULL END);
 v_plot_ids=billing_private.summary_selection_ids(p_payload,'plotIds','plotId');$initialize$);
  IF projection<>'summary_harvest_methods' THEN
   IF strpos(definition,contract_before)=0 THEN RAISE EXCEPTION 'Unexpected contract origin selection: %',projection; END IF;
   definition=replace(definition,contract_before,contract_after);
  END IF;
  definition=replace(definition,origin_before,origin_after);
  definition=replace(definition,
   '(nullif(p_payload->>''partnerId'','''') IS NULL OR c.client_id=nullif(p_payload->>''partnerId'','''')::uuid)',
   '(cardinality(v_partner_ids)=0 OR c.client_id=ANY(v_partner_ids))');
  definition=replace(definition,
   '(nullif(p_payload->>''contractId'','''') IS NULL OR c.id=nullif(p_payload->>''contractId'','''')::uuid)',
   '(cardinality(v_contract_ids)=0 OR c.id=ANY(v_contract_ids))');
  IF strpos(definition,'c.id=ANY(v_contract_ids)')=0 OR strpos(definition,'c.client_id=ANY(v_partner_ids)')=0
   OR strpos(definition,origin_after)=0 OR strpos(definition,origin_before)>0 THEN
   RAISE EXCEPTION 'Dashboard multiselection not installed: %',projection;
  END IF;
  EXECUTE definition;
 END LOOP;
END $migration$;

-- Preserve the complete option catalog and all legacy filter labels. Return
-- canonical effective arrays even to old clients; singular echo stays intact.
DO $migration$
DECLARE definition text;anchor text:='''cashScope'',''contract''),';
BEGIN
 definition=pg_get_functiondef('billing_private.summary_dispatch(text,jsonb)'::regprocedure);
 IF strpos(definition,anchor)=0 OR strpos(definition,'''clientId'',c.client_id')=0 OR strpos(definition,'''partnerIds''')>0 THEN
  RAISE EXCEPTION 'Unexpected Dashboard dispatcher before multiselection';
 END IF;
 definition=replace(definition,anchor,$echo$'cashScope','contract',
   'partnerIds',to_jsonb(billing_private.summary_selection_ids(p_payload,'partnerIds','partnerId')),
   'contractIds',to_jsonb(billing_private.summary_selection_ids(p_payload,'contractIds','contractId')),
   'farmIds',to_jsonb(billing_private.summary_selection_ids(p_payload,'farmIds',CASE WHEN nullif(p_payload->>'plotId','') IS NULL THEN 'farmId' ELSE NULL END)),
   'plotIds',to_jsonb(billing_private.summary_selection_ids(p_payload,'plotIds','plotId'))),$echo$);
 EXECUTE definition;
END $migration$;

COMMENT ON FUNCTION billing_private.summary_dispatch(text,jsonb) IS
 'Company/date/status dashboard with client/contract/origin UUID selections: AND between dimensions, OR within each; whole farms union individual plots. Singular filters remain compatible. Canonical arrays are echoed. Financial load valuation precedes slicing; cash remains attached to historically matching contracts. Option catalogs and workspace planning retain their established scopes.';

COMMIT;
