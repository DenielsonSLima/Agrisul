-- Keep operational contracts inside the company selected in the application.
-- The selected company is always checked against the authenticated workspace.
CREATE OR REPLACE FUNCTION billing_private.present(value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT coalesce(jsonb_object_agg(
 CASE key WHEN 'legal_name' THEN 'legalName' WHEN 'trade_name' THEN 'tradeName'
 WHEN 'zip_code' THEN 'zipCode' WHEN 'is_primary' THEN 'isPrimary'
 WHEN 'created_at' THEN 'createdAt' WHEN 'updated_at' THEN 'updatedAt'
 WHEN 'company_id' THEN 'companyId' WHEN 'contract_id' THEN 'contractId'
 WHEN 'client_id' THEN 'clientId' WHEN 'type_id' THEN 'typeId' WHEN 'type_name' THEN 'typeName'
 WHEN 'start_date' THEN 'startDate' WHEN 'end_date' THEN 'endDate' WHEN 'loaded_at' THEN 'loadedAt'
 WHEN 'farm_id' THEN 'farmId' WHEN 'plot_id' THEN 'plotId' WHEN 'culture_id' THEN 'cultureId'
 WHEN 'area_ha' THEN 'areaHa' WHEN 'image_key' THEN 'imageKey' WHEN 'image_name' THEN 'imageName'
 WHEN 'logo_key' THEN 'logoKey' WHEN 'logo_name' THEN 'logoName'
 WHEN 'portrait_image_key' THEN 'portraitImageKey' WHEN 'portrait_image_name' THEN 'portraitImageName'
 WHEN 'landscape_image_key' THEN 'landscapeImageKey' WHEN 'landscape_image_name' THEN 'landscapeImageName' ELSE key END,
 CASE WHEN key IN ('area_ha','value') THEN to_jsonb(billing_private.decimal_text((v #>> '{}')::numeric)) ELSE v END),'{}')
 FROM jsonb_each(value) AS e(key,v) WHERE key NOT IN ('owner_id','name_key')
$$;
REVOKE ALL ON FUNCTION billing_private.present(jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.contracts_company_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_company_id uuid;
 v_contract_id uuid;
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
  v_contracts=CASE WHEN coalesce(p_payload->>'bucket','open')='finished'
   THEN v_finished_contracts ELSE v_open_contracts END;
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
 ELSIF p_action<>'save' THEN
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

CREATE OR REPLACE FUNCTION public.billing_rpc(p_resource text,p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.ensure_actor_workspace();
 IF p_resource IN ('settings','profile') THEN RETURN billing_private.workspace_settings(p_action,p_payload); END IF;
 IF p_resource='users' THEN RETURN billing_private.users_dispatch(p_action,p_payload); END IF;
 IF p_resource='access-profiles' THEN RETURN billing_private.access_profiles_dispatch(p_action,p_payload); END IF;
 IF p_resource='report-headers' THEN RETURN billing_private.report_headers_dispatch(p_action,p_payload); END IF;
 IF p_resource='planning' THEN RETURN billing_private.planning_dispatch(p_action,p_payload); END IF;
 PERFORM billing_private.authorize_resource(p_resource,p_action);
 IF p_resource='contracts' THEN RETURN billing_private.contracts_company_dispatch(p_action,p_payload); END IF;
 IF p_resource='cultural-practices' AND p_action='bootstrap-sugarcane' THEN RETURN billing_private.bootstrap_sugarcane_management(p_payload); END IF;
 IF p_resource='cultural-practices' THEN RETURN billing_private.management_dispatch(p_action,p_payload); END IF;
 IF p_resource='atr' THEN RETURN billing_private.atr_dispatch(p_action,p_payload); END IF;
 IF p_resource='farms' AND p_action='list' THEN RETURN billing_private.farm_summary_list(); END IF;
 IF p_resource='companies' AND p_action='save' THEN RETURN billing_private.save_company(p_payload); END IF;
 IF p_resource IN ('watermark','watermarks') THEN RETURN billing_private.watermark_variants(p_action,p_payload); END IF;
 RETURN billing_private.dispatch(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION public.billing_rpc(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_rpc(text,text,jsonb) TO authenticated;
COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS 'Authenticated workspace RPC. Contract operations are scoped to the active company supplied by the client and verified against auth.uid().';
