-- Server-enforced first-login password rotation for administratively
-- provisioned accounts. The temporary password itself never enters the
-- application database; only the Auth bcrypt hash that was current when the
-- requirement was issued is retained in this private schema.

CREATE TABLE billing_private.password_change_requirements (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  password_hash_at_issue text NOT NULL,
  required_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CHECK (length(password_hash_at_issue)>0),
  CHECK (completed_at IS NULL OR completed_at>=required_at)
);
REVOKE ALL ON TABLE billing_private.password_change_requirements FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.require_temporary_password_change(p_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_password_hash text;
BEGIN
  SELECT encrypted_password INTO v_password_hash
  FROM auth.users
  WHERE id=p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado para exigir a troca de senha.' USING ERRCODE='22023';
  END IF;
  IF coalesce(v_password_hash,'')='' THEN
    RAISE EXCEPTION 'O usuário ainda não possui uma senha temporária.' USING ERRCODE='22023';
  END IF;

  INSERT INTO billing_private.password_change_requirements(
    user_id,password_hash_at_issue,required_at,completed_at
  ) VALUES(p_user_id,v_password_hash,clock_timestamp(),NULL)
  ON CONFLICT(user_id) DO UPDATE SET
    password_hash_at_issue=excluded.password_hash_at_issue,
    required_at=excluded.required_at,
    completed_at=NULL;
END $$;
REVOKE ALL ON FUNCTION billing_private.require_temporary_password_change(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.temporary_password_change_required() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_actor uuid:=auth.uid();
  v_baseline text;
  v_current text;
BEGIN
  IF v_actor IS NULL THEN RETURN false; END IF;

  SELECT requirement.password_hash_at_issue,auth_user.encrypted_password
    INTO v_baseline,v_current
  FROM billing_private.password_change_requirements requirement
  JOIN auth.users auth_user ON auth_user.id=requirement.user_id
  WHERE requirement.user_id=v_actor AND requirement.completed_at IS NULL
  FOR UPDATE OF requirement;

  IF NOT FOUND THEN RETURN false; END IF;

  -- GoTrue rejects reusing the current password. A changed Auth hash is
  -- therefore durable server-side evidence that updateUser({password}) ran.
  IF v_current IS DISTINCT FROM v_baseline THEN
    UPDATE billing_private.password_change_requirements
      SET completed_at=clock_timestamp()
    WHERE user_id=v_actor AND completed_at IS NULL;
    RETURN false;
  END IF;

  RETURN true;
END $$;
REVOKE ALL ON FUNCTION billing_private.temporary_password_change_required() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.temporary_password_change_required() TO authenticated;

CREATE OR REPLACE FUNCTION public.billing_rpc(p_resource text,p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;

 IF p_resource='onboarding' THEN
  IF billing_private.temporary_password_change_required() THEN
   IF p_action='inspect' THEN
    RETURN jsonb_build_object('status','password');
   END IF;
   RAISE EXCEPTION 'Troque a senha temporária antes de acessar o sistema.' USING ERRCODE='42501';
  END IF;
  IF p_action='complete-password' THEN
   RETURN jsonb_build_object('status','password-changed');
  END IF;
  RETURN billing_private.onboarding_dispatch(p_action,p_payload);
 END IF;

 IF billing_private.temporary_password_change_required() THEN
  RAISE EXCEPTION 'Troque a senha temporária antes de acessar o sistema.' USING ERRCODE='42501';
 END IF;

 PERFORM billing_private.ensure_actor_workspace();
 IF p_resource='home' THEN RETURN billing_private.home_dashboard(p_action,p_payload); END IF;
 IF p_resource='service-providers' THEN RETURN billing_private.service_providers_dispatch(p_action,p_payload); END IF;
 IF p_resource='document-templates' THEN RETURN billing_private.document_templates_dispatch(p_action,p_payload); END IF;
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
COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS
 'Authenticated workspace RPC. Accounts provisioned with temporary passwords remain blocked until Supabase Auth records a real password change.';
