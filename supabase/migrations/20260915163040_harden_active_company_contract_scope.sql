-- Validate the requested lifecycle bucket before delegating and prevent an
-- existing contract from being moved out of its current company context.
CREATE OR REPLACE FUNCTION billing_private.contracts_company_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_company_id uuid;
 v_contract_id uuid;
 v_bucket text;
 v_open jsonb;
 v_finished jsonb;
 v_open_contracts jsonb;
 v_finished_contracts jsonb;
 v_contracts jsonb;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR jsonb_typeof(p_payload->'companyId') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Selecione uma empresa cadastrada.' USING ERRCODE='22023';
 END IF;

 v_company_id=nullif(p_payload->>'companyId','')::uuid;
 IF v_company_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.billing_companies
  WHERE owner_id=v_owner AND id=v_company_id
 ) THEN
  RAISE EXCEPTION 'Selecione uma empresa cadastrada.' USING ERRCODE='22023';
 END IF;

 IF p_action='list' THEN
  v_bucket=coalesce(nullif(p_payload->>'bucket',''),'open');
  IF v_bucket NOT IN ('open','finished') THEN
   RAISE EXCEPTION 'Confira os filtros dos contratos.' USING ERRCODE='22023';
  END IF;
  v_open=billing_private.contracts_active_dispatch(
   'list',p_payload||jsonb_build_object('bucket','open')
  );
  v_finished=billing_private.contracts_active_dispatch(
   'list',p_payload||jsonb_build_object('bucket','finished')
  );
  SELECT coalesce(jsonb_agg(item.value),'[]'::jsonb) INTO v_open_contracts
  FROM jsonb_array_elements(v_open->'contracts') item
  WHERE item.value->>'companyId'=v_company_id::text;
  SELECT coalesce(jsonb_agg(item.value),'[]'::jsonb) INTO v_finished_contracts
  FROM jsonb_array_elements(v_finished->'contracts') item
  WHERE item.value->>'companyId'=v_company_id::text;
  v_contracts=CASE WHEN v_bucket='finished' THEN v_finished_contracts ELSE v_open_contracts END;
  RETURN jsonb_build_object(
   'contracts',v_contracts,
   'counts',jsonb_build_object(
    'open',jsonb_array_length(v_open_contracts),
    'finished',jsonb_array_length(v_finished_contracts)
   ),
   'total',jsonb_array_length(v_contracts)
  );
 END IF;

 IF p_action='get' THEN
  v_contract_id=nullif(p_payload->>'id','')::uuid;
 ELSIF p_action IN ('save-load','delete-load') THEN
  v_contract_id=nullif(p_payload->>'contractId','')::uuid;
 ELSIF p_action='save' THEN
  v_contract_id=nullif(p_payload->>'id','')::uuid;
 ELSE
  RAISE EXCEPTION 'Operação de contrato inválida.' USING ERRCODE='22023';
 END IF;

 IF v_contract_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM public.billing_contracts
  WHERE owner_id=v_owner AND id=v_contract_id AND company_id=v_company_id
 ) THEN
  RAISE EXCEPTION 'Contrato não encontrado para a empresa ativa.' USING ERRCODE='P0002';
 END IF;

 RETURN billing_private.contracts_active_dispatch(p_action,p_payload);
EXCEPTION
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Informe identificadores válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.contracts_company_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.contracts_company_dispatch(text,jsonb) TO authenticated;
