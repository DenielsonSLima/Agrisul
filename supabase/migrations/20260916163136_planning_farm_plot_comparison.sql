-- The overview needs server-calculated farm and plot rows so the same season,
-- ownership and load rules used by the headline totals also drive the detail.
CREATE FUNCTION billing_private.planning_v6_harvest_comparison(p_owner uuid,p_period uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH selected_period AS (
  SELECT id,start_date,end_date
  FROM public.billing_planning_periods
  WHERE owner_id=p_owner AND id=p_period
 ), plot_metrics AS (
  SELECT f.id farm_id,f.name farm_name,p.id plot_id,p.name plot_name,
   coalesce(a.area_ha,0) target_area_ha,
   coalesce(a.executed_area_ha,0) planted_area_ha,
   greatest(coalesce(a.area_ha,0)-coalesce(a.executed_area_ha,0),0) remaining_area_ha,
   CASE WHEN coalesce(a.area_ha,0)=0 THEN 0
    ELSE least(100,coalesce(a.executed_area_ha,0)*100/a.area_ha) END planting_percent,
   coalesce(loads.harvested_tons,0) harvested_tons,
   coalesce(loads.load_count,0)::integer harvest_load_count
  FROM selected_period season
  JOIN billing_private.planning_v5_harvest_scope(p_owner,season.id) scope ON true
  JOIN public.billing_farms f ON f.owner_id=p_owner AND f.id=scope.farm_id
  JOIN public.billing_farm_plots p ON p.owner_id=p_owner AND p.farm_id=f.id AND p.id=scope.plot_id
  LEFT JOIN public.billing_planning_allocations a ON a.owner_id=p_owner AND a.period_id=season.id
   AND a.farm_id=f.id AND a.plot_id=p.id AND a.status='active'
  LEFT JOIN LATERAL (
   SELECT coalesce(sum(l.volume),0) harvested_tons,count(*)::integer load_count
   FROM public.billing_contract_loads l
   WHERE l.owner_id=p_owner AND l.farm_id=f.id AND l.plot_id=p.id
    AND l.loaded_at BETWEEN season.start_date AND season.end_date
  ) loads ON true
 ), farm_metrics AS (
  SELECT farm_id,farm_name,
   sum(target_area_ha) target_area_ha,
   sum(planted_area_ha) planted_area_ha,
   sum(remaining_area_ha) remaining_area_ha,
   CASE WHEN sum(target_area_ha)=0 THEN 0
    ELSE least(100,sum(planted_area_ha)*100/sum(target_area_ha)) END planting_percent,
   sum(harvested_tons) harvested_tons,
   sum(harvest_load_count)::integer harvest_load_count,
   jsonb_agg(jsonb_build_object(
    'plotId',plot_id,'plotName',plot_name,
    'targetAreaHa',billing_private.decimal_text(target_area_ha),
    'plantedAreaHa',billing_private.decimal_text(planted_area_ha),
    'remainingAreaHa',billing_private.decimal_text(remaining_area_ha),
    'plantingPercent',billing_private.decimal_text(planting_percent),
    'harvestedTons',billing_private.decimal_text(harvested_tons),
    'harvestLoadCount',harvest_load_count
   ) ORDER BY lower(plot_name),plot_id) plots
  FROM plot_metrics
  GROUP BY farm_id,farm_name
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'farmId',farm_id,'farmName',farm_name,
  'targetAreaHa',billing_private.decimal_text(target_area_ha),
  'plantedAreaHa',billing_private.decimal_text(planted_area_ha),
  'remainingAreaHa',billing_private.decimal_text(remaining_area_ha),
  'plantingPercent',billing_private.decimal_text(planting_percent),
  'harvestedTons',billing_private.decimal_text(harvested_tons),
  'harvestLoadCount',harvest_load_count,'plots',plots
 ) ORDER BY lower(farm_name),farm_id),'[]'::jsonb)
 FROM farm_metrics
$$;

REVOKE ALL ON FUNCTION billing_private.planning_v6_harvest_comparison(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.planning_v6_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_period_id uuid;
 v_result jsonb;
BEGIN
 v_result=billing_private.planning_v4_dispatch(p_action,p_payload);
 IF p_action<>'list' THEN RETURN v_result; END IF;
 v_period_id=nullif(coalesce(p_payload,'{}'::jsonb)->>'periodId','')::uuid;
 RETURN v_result||jsonb_build_object('harvestComparison',CASE WHEN v_period_id IS NULL THEN '[]'::jsonb
  ELSE billing_private.planning_v6_harvest_comparison(v_owner,v_period_id) END);
END $$;

REVOKE ALL ON FUNCTION billing_private.planning_v6_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.planning_v6_dispatch(text,jsonb) TO authenticated;

DO $$
DECLARE v_definition text;v_old text;v_new text;
BEGIN
 v_definition=pg_get_functiondef('public.billing_rpc(text,text,jsonb)'::regprocedure);
 v_old='IF p_resource=''planning'' THEN RETURN billing_private.planning_v4_dispatch(p_action,p_payload); END IF;';
 v_new='IF p_resource=''planning'' THEN RETURN billing_private.planning_v6_dispatch(p_action,p_payload); END IF;';
 IF strpos(v_definition,v_old)=0 THEN
  IF strpos(v_definition,v_new)=0 THEN RAISE EXCEPTION 'O contrato RPC instalado não corresponde ao Planejamento esperado.'; END IF;
 ELSE EXECUTE replace(v_definition,v_old,v_new);
 END IF;
END $$;

REVOKE ALL ON FUNCTION public.billing_rpc(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_rpc(text,text,jsonb) TO authenticated;
