-- Fazenda is the entry point for plots. Return server-calculated portfolio and
-- per-farm allocation summaries without exposing table writes to the client.
CREATE OR REPLACE FUNCTION billing_private.farm_summary_list() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_owner uuid:=billing_private.current_owner_id();
  v_farms jsonb;
  v_summary jsonb;
BEGIN
  PERFORM billing_private.authorize('registrations.read');

  SELECT coalesce(jsonb_agg(
    billing_private.present(to_jsonb(f)) || jsonb_build_object(
      'plotCount', totals.plot_count,
      'totalHa', billing_private.decimal_text(f.area_ha),
      'usedHa', billing_private.decimal_text(totals.used_ha),
      'preservedHa', billing_private.decimal_text(f.area_ha-totals.used_ha),
      'usedPercent', CASE WHEN f.area_ha=0 THEN 0 ELSE round(totals.used_ha/f.area_ha*100,4) END
    ) ORDER BY lower(f.name),f.id
  ),'[]'::jsonb) INTO v_farms
  FROM public.billing_farms f
  CROSS JOIN LATERAL (
    SELECT count(*)::integer AS plot_count,coalesce(sum(p.area_ha),0) AS used_ha
    FROM public.billing_farm_plots p
    WHERE p.owner_id=f.owner_id AND p.farm_id=f.id
  ) totals
  WHERE f.owner_id=v_owner;

  SELECT jsonb_build_object(
    'farmCount',count(*)::integer,
    'plotCount',coalesce(sum(t.plot_count),0)::integer,
    'totalHa',billing_private.decimal_text(coalesce(sum(t.area_ha),0)),
    'usedHa',billing_private.decimal_text(coalesce(sum(t.used_ha),0)),
    'preservedHa',billing_private.decimal_text(coalesce(sum(t.area_ha-t.used_ha),0)),
    'usedPercent',CASE WHEN coalesce(sum(t.area_ha),0)=0 THEN 0 ELSE round(sum(t.used_ha)/sum(t.area_ha)*100,4) END
  ) INTO v_summary
  FROM (
    SELECT f.area_ha,count(p.id)::integer AS plot_count,coalesce(sum(p.area_ha),0) AS used_ha
    FROM public.billing_farms f
    LEFT JOIN public.billing_farm_plots p ON p.owner_id=f.owner_id AND p.farm_id=f.id
    WHERE f.owner_id=v_owner
    GROUP BY f.id,f.area_ha
  ) t;

  RETURN jsonb_build_object('farms',v_farms,'summary',v_summary);
END $$;
REVOKE ALL ON FUNCTION billing_private.farm_summary_list() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.farm_summary_list() TO authenticated;

CREATE OR REPLACE FUNCTION public.billing_rpc(p_resource text,p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
  PERFORM billing_private.ensure_actor_workspace();
  IF p_resource IN ('settings','profile') THEN RETURN billing_private.workspace_settings(p_action,p_payload); END IF;
  IF p_resource='users' THEN RETURN billing_private.users_dispatch(p_action,p_payload); END IF;
  IF p_resource='access-profiles' THEN RETURN billing_private.access_profiles_dispatch(p_action,p_payload); END IF;
  IF p_resource='report-headers' THEN RETURN billing_private.report_headers_dispatch(p_action,p_payload); END IF;
  PERFORM billing_private.authorize_resource(p_resource,p_action);
  IF p_resource='farms' AND p_action='list' THEN RETURN billing_private.farm_summary_list(); END IF;
  IF p_resource='companies' AND p_action='save' THEN RETURN billing_private.save_company(p_payload); END IF;
  IF p_resource IN ('watermark','watermarks') THEN RETURN billing_private.watermark_variants(p_action,p_payload); END IF;
  RETURN billing_private.dispatch(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION public.billing_rpc(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_rpc(text,text,jsonb) TO authenticated;
COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS 'Authenticated workspace RPC. Farm list summaries and all authorization are calculated server-side from the effective workspace owner.';
