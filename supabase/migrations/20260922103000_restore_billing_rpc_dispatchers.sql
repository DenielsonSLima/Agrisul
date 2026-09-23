-- Restore the final public dispatcher routes that predate quotations.
-- The quotation migration must not remove existing operational modules.
CREATE OR REPLACE FUNCTION billing_private.authorize_resource(p_resource text,p_action text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_permission text;
BEGIN
 v_permission=CASE
  WHEN p_resource='companies' THEN 'companies.'||CASE WHEN p_action IN ('get','list') THEN 'read' ELSE 'write' END
  WHEN p_resource IN ('clients','atr','farms','plots','contract-types','cultures','cultural-practices','materials') THEN 'registrations.'||CASE WHEN p_action IN ('get','list') THEN 'read' ELSE 'write' END
  WHEN p_resource='contracts' THEN 'contracts.'||CASE WHEN p_action IN ('get','list') THEN 'read' ELSE 'write' END
  WHEN p_resource='quotations' THEN 'quotations.'||CASE WHEN p_action IN ('get','list') THEN 'read' ELSE 'write' END
  WHEN p_resource IN ('watermark','watermarks') THEN 'watermarks.'||CASE WHEN p_action IN ('get','list') THEN 'read' ELSE 'write' END
  ELSE NULL
 END;
 IF v_permission IS NOT NULL THEN PERFORM billing_private.authorize(v_permission); END IF;
END $$;
REVOKE ALL ON FUNCTION billing_private.authorize_resource(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.authorize_resource(text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.billing_rpc(p_resource text,p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 IF p_resource='onboarding' THEN RETURN billing_private.onboarding_dispatch(p_action,p_payload); END IF;
 PERFORM billing_private.ensure_actor_workspace();
 IF p_resource='signatures' THEN RETURN billing_private.signatures_dispatch(p_action,p_payload); END IF;
 IF p_resource='service-requests' THEN RETURN billing_private.service_requests_dispatch(p_action,p_payload); END IF;
 IF p_resource IN ('settings','profile') THEN RETURN billing_private.workspace_settings(p_action,p_payload); END IF;
 IF p_resource='users' THEN RETURN billing_private.users_dispatch(p_action,p_payload); END IF;
 IF p_resource='access-profiles' THEN RETURN billing_private.access_profiles_dispatch(p_action,p_payload); END IF;
 IF p_resource='report-headers' THEN RETURN billing_private.report_headers_dispatch(p_action,p_payload); END IF;
 IF p_resource='agenda' THEN RETURN billing_private.agenda_dispatch(p_action,p_payload); END IF;
 IF p_resource='summary' THEN RETURN billing_private.summary_dispatch(p_action,p_payload); END IF;
 IF p_resource='reports' THEN RETURN billing_private.reports_dispatch(p_action,p_payload); END IF;
 IF p_resource='planning' THEN RETURN billing_private.planning_v9_dispatch(p_action,p_payload); END IF;
 IF p_resource IN ('planning-goals','planning-executions') THEN RAISE EXCEPTION 'Este contrato antigo de planejamento permanece desativado.' USING ERRCODE='22023'; END IF;
 PERFORM billing_private.authorize_resource(p_resource,p_action);
 IF p_resource IN ('materials','quotations') THEN RETURN billing_private.quotations_dispatch(p_resource,p_action,p_payload); END IF;
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
