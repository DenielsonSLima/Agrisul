-- Extend only company-scoped projections. Workspace planning/registry stay unfiltered.
-- Keep contract_load_financials on the entire contract before date selection so
-- discount allocation and cent rounding remain exactly the contract's values.
CREATE FUNCTION billing_private.summary_validate_selection(p_company uuid,p_payload jsonb)
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();v_contract uuid;v_status text;
BEGIN
 IF (p_payload ? 'contractId' AND jsonb_typeof(p_payload->'contractId') IS DISTINCT FROM 'string')
 OR (p_payload ? 'status' AND jsonb_typeof(p_payload->'status') IS DISTINCT FROM 'string') THEN
  RAISE EXCEPTION 'Seleção de contrato ou status inválida.' USING ERRCODE='22023';
 END IF;
 v_status=coalesce(p_payload->>'status','');
 IF v_status NOT IN ('','Rascunho','Ativo','Concluído','Cancelado') THEN
  RAISE EXCEPTION 'Status do contrato inválido.' USING ERRCODE='22023';
 END IF;
 v_contract=nullif(p_payload->>'contractId','')::uuid;
 IF v_contract IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.billing_contracts
  WHERE owner_id=v_owner AND company_id=p_company AND id=v_contract) THEN
  RAISE EXCEPTION 'Contrato não encontrado na empresa selecionada.' USING ERRCODE='42501';
 END IF;
EXCEPTION WHEN invalid_text_representation THEN
 RAISE EXCEPTION 'Seleção de contrato inválida.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.summary_validate_selection(uuid,jsonb) FROM PUBLIC,anon,authenticated;

-- Guard the known projections instead of replacing later fixes (optional plots,
-- current-month ATR preference, refund handling, and workspace planning).
DO $migration$
DECLARE v_definition text;v_before text;v_name text;
BEGIN
 FOREACH v_name IN ARRAY ARRAY['summary_dashboard','summary_operational_intelligence'] LOOP
  SELECT pg_get_functiondef(format('billing_private.%I(jsonb)',v_name)::regprocedure) INTO v_definition;
  v_before=v_definition;
  IF strpos(v_definition,'ARRAY[''companyId'',''from'',''to'']')=0
   OR strpos(v_definition,'WHERE c.owner_id=v_owner AND c.company_id=v_company')=0
   OR strpos(v_definition,'LEFT JOIN public.billing_farm_plots p')=0 THEN
   RAISE EXCEPTION 'Unexpected summary projection: %',v_name;
  END IF;
  v_definition=replace(v_definition,
   'ARRAY[''companyId'',''from'',''to'']','ARRAY[''companyId'',''from'',''to'',''contractId'',''status'']');
  v_definition=replace(v_definition,
   'PERFORM billing_private.authorize(''registrations.read'');',
   'PERFORM billing_private.authorize(''registrations.read''); PERFORM billing_private.summary_validate_selection(v_company,p_payload);');
  v_definition=replace(v_definition,
   'WHERE c.owner_id=v_owner AND c.company_id=v_company',
   'WHERE c.owner_id=v_owner AND c.company_id=v_company
    AND (nullif(p_payload->>''contractId'','''') IS NULL OR c.id=nullif(p_payload->>''contractId'','''')::uuid)
    AND (coalesce(p_payload->>''status'','''')='''' OR c.status=p_payload->>''status'')');
  IF v_name='summary_dashboard' THEN
   IF strpos(v_definition,'FROM public.billing_contracts c JOIN LATERAL billing_private.contract_load_financials(c) finance ON true')=0 THEN
    RAISE EXCEPTION 'Unexpected contract financial projection';
   END IF;
   v_definition=replace(v_definition,
    'FROM public.billing_contracts c JOIN LATERAL billing_private.contract_load_financials(c) finance ON true',
    'FROM public.billing_contracts c JOIN contracts selected ON selected.id=c.id AND selected.owner_id=c.owner_id
   JOIN LATERAL billing_private.contract_load_financials(c) finance ON true');
  END IF;
  IF v_definition=v_before OR strpos(v_definition,'summary_validate_selection(v_company,p_payload)')=0 THEN
   RAISE EXCEPTION 'Summary selection was not installed: %',v_name;
  END IF;
  EXECUTE v_definition;
 END LOOP;
END $migration$;

CREATE OR REPLACE FUNCTION billing_private.summary_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb;v_owner uuid;v_company uuid;v_options jsonb;v_label text;
BEGIN
 IF p_action<>'dashboard' THEN RETURN billing_private.summary_monthly_dispatch(p_action,p_payload); END IF;
 -- Both projections validate owner, company, permissions, allowed fields/dates and selection.
 v_result=billing_private.summary_dashboard(p_payload)||billing_private.summary_operational_intelligence(p_payload);
 v_owner=billing_private.current_owner_id();v_company=(p_payload->>'companyId')::uuid;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'clientName',cl.legal_name,
  'contractNumber',c.contract_number,'title',c.title,'status',c.status)
  ORDER BY lower(cl.legal_name),c.contract_number,c.id),'[]'::jsonb) INTO v_options
 FROM public.billing_contracts c JOIN public.billing_clients cl ON cl.owner_id=c.owner_id AND cl.id=c.client_id
 WHERE c.owner_id=v_owner AND c.company_id=v_company;
 SELECT concat_ws(' · ',cl.legal_name,nullif(c.contract_number,''),c.title) INTO v_label
 FROM public.billing_contracts c JOIN public.billing_clients cl ON cl.owner_id=c.owner_id AND cl.id=c.client_id
 WHERE c.owner_id=v_owner AND c.company_id=v_company AND c.id=nullif(p_payload->>'contractId','')::uuid;
 RETURN v_result||jsonb_build_object(
  'filters',jsonb_build_object('companyId',v_company,'contractId',coalesce(p_payload->>'contractId',''),
   'contractLabel',coalesce(v_label,''),'status',coalesce(p_payload->>'status','')),
  'filterOptions',jsonb_build_object('contracts',v_options,
   'statuses',coalesce((SELECT jsonb_agg(status ORDER BY status) FROM
    (SELECT DISTINCT status FROM public.billing_contracts WHERE owner_id=v_owner AND company_id=v_company) statuses),'[]'::jsonb)));
END $$;
REVOKE ALL ON FUNCTION billing_private.summary_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.summary_dispatch(text,jsonb) TO authenticated;
COMMENT ON FUNCTION billing_private.summary_dispatch(text,jsonb) IS
 'Company/date/contract/current-status summary; exact contract load valuation before slicing; separate unfiltered workspace planning; effective filter echo for exports.';
