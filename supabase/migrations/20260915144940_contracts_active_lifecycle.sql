-- Contracts are operational as soon as they are created. There is no draft
-- stage in the product lifecycle.
UPDATE public.billing_contracts
SET status='Ativo'
WHERE status='Rascunho';

ALTER TABLE public.billing_contracts
 ALTER COLUMN status SET DEFAULT 'Ativo',
 DROP CONSTRAINT billing_contracts_status_check,
 ADD CONSTRAINT billing_contracts_status_check
  CHECK(status IN ('Ativo','Concluído','Cancelado'));

-- Keep the operational dispatcher stable and put the lifecycle rule in a
-- narrow server-side gate. Inserts always become active, regardless of a
-- forged client payload; updates accept only the remaining lifecycle states.
CREATE FUNCTION billing_private.contracts_active_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_payload jsonb:=p_payload;
BEGIN
 IF p_action='save' AND jsonb_typeof(v_payload)='object' THEN
  IF nullif(v_payload->>'id','') IS NULL THEN
   v_payload=jsonb_set(v_payload,'{status}',to_jsonb('Ativo'::text),true);
  ELSIF coalesce(v_payload->>'status','') NOT IN ('Ativo','Concluído','Cancelado') THEN
   RAISE EXCEPTION 'Confira a situação do contrato.' USING ERRCODE='22023';
  END IF;
 END IF;
 RETURN billing_private.contracts_dispatch(p_action,v_payload);
END $$;
REVOKE ALL ON FUNCTION billing_private.contracts_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION billing_private.contracts_active_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.contracts_active_dispatch(text,jsonb) TO authenticated;

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
 IF p_resource='contracts' THEN RETURN billing_private.contracts_active_dispatch(p_action,p_payload); END IF;
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
COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS 'Authenticated workspace RPC. New contracts are always active; lifecycle, volume capacity and weighted ATR are enforced in Postgres.';
