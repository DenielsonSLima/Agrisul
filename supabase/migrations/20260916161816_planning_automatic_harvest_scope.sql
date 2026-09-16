-- Contract loads from plots already allocated to the season belong to that
-- season automatically. Explicit harvest plots remain an additive scope for
-- plots that are not part of the planting allocation.
CREATE FUNCTION billing_private.planning_v5_harvest_scope(p_owner uuid,p_period uuid)
RETURNS TABLE(farm_id uuid,plot_id uuid)
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT a.farm_id,a.plot_id
 FROM public.billing_planning_allocations a
 WHERE a.owner_id=p_owner AND a.period_id=p_period AND a.status='active'
 UNION
 SELECT hp.farm_id,hp.plot_id
 FROM public.billing_planning_harvest_plots hp
 WHERE hp.owner_id=p_owner AND hp.period_id=p_period
$$;

REVOKE ALL ON FUNCTION billing_private.planning_v5_harvest_scope(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.present_planning_v2_period(p_period public.billing_planning_periods) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH metrics AS (
  SELECT
   coalesce((SELECT sum(a.area_ha) FROM public.billing_planning_allocations a
    WHERE a.owner_id=p_period.owner_id AND a.period_id=p_period.id AND a.status='active'),0) allocated,
   coalesce((SELECT sum(l.area_ha) FROM public.billing_planning_field_logs l
    WHERE l.owner_id=p_period.owner_id AND l.period_id=p_period.id AND l.kind='planting' AND l.voided_at IS NULL),0) planted_executed,
   coalesce((SELECT sum(l.area_ha) FROM public.billing_planning_field_logs l
    WHERE l.owner_id=p_period.owner_id AND l.period_id=p_period.id AND l.kind='loss' AND l.voided_at IS NULL),0) lost,
   coalesce((SELECT sum(load.volume) FROM public.billing_contract_loads load
    JOIN billing_private.planning_v5_harvest_scope(p_period.owner_id,p_period.id) scope
     ON scope.farm_id=load.farm_id AND scope.plot_id=load.plot_id
    WHERE load.owner_id=p_period.owner_id AND load.loaded_at BETWEEN p_period.start_date AND p_period.end_date),0) harvested
 )
 SELECT jsonb_build_object(
  'id',p_period.id,'name',p_period.name,'startDate',p_period.start_date,'endDate',p_period.end_date,
  'targetAreaHa',billing_private.decimal_text(p_period.target_area_ha),
  'allocatedAreaHa',billing_private.decimal_text(m.allocated),
  'remainingAreaHa',billing_private.decimal_text(greatest(p_period.target_area_ha-m.allocated,0)),
  'plantedExecutedAreaHa',billing_private.decimal_text(m.planted_executed),
  'plantingRemainingAreaHa',billing_private.decimal_text(greatest(p_period.target_area_ha-m.planted_executed,0)),
  'lostAreaHa',billing_private.decimal_text(m.lost),
  'harvestTargetTons',billing_private.decimal_text(p_period.harvest_target_tons),
  'harvestActualTons',billing_private.decimal_text(m.harvested),
  'harvestRemainingTons',billing_private.decimal_text(greatest(p_period.harvest_target_tons-m.harvested,0)),
  'harvestPercent',billing_private.decimal_text(CASE WHEN p_period.harvest_target_tons=0 THEN 0 ELSE least(100,m.harvested*100/p_period.harvest_target_tons) END),
  'harvestScopeCount',(SELECT count(*)::integer FROM billing_private.planning_v5_harvest_scope(p_period.owner_id,p_period.id)),
  'allocationCount',(SELECT count(*)::integer FROM public.billing_planning_allocations a
    WHERE a.owner_id=p_period.owner_id AND a.period_id=p_period.id AND a.status='active'),
  'cultureId',p_period.culture_id,'cultureName',c.name,
  'cultureSubtypeId',p_period.culture_subtype_id,'cultureSubtypeName',s.name,
  'notes',p_period.notes,'status',p_period.status,'revision',p_period.revision,
  'createdAt',p_period.created_at,'updatedAt',p_period.updated_at)
 FROM public.billing_cultures c
 JOIN public.billing_culture_subtypes s ON s.owner_id=c.owner_id AND s.culture_id=c.id AND s.id=p_period.culture_subtype_id
 CROSS JOIN metrics m
 WHERE c.owner_id=p_period.owner_id AND c.id=p_period.culture_id
$$;

DO $$
DECLARE
 v_definition text;
 v_selected_old text:='EXISTS(SELECT 1 FROM public.billing_planning_harvest_plots hp WHERE hp.owner_id=p.owner_id AND hp.period_id=v_period_id AND hp.plot_id=p.id)';
 v_selected_new text:='EXISTS(SELECT 1 FROM billing_private.planning_v5_harvest_scope(p.owner_id,v_period_id) scope WHERE scope.farm_id=p.farm_id AND scope.plot_id=p.id)';
 v_join_old text:='FROM public.billing_contract_loads l JOIN public.billing_planning_harvest_plots hp
    ON hp.owner_id=l.owner_id AND hp.period_id=v_period_id AND hp.plot_id=l.plot_id';
 v_join_new text:='FROM public.billing_contract_loads l JOIN billing_private.planning_v5_harvest_scope(v_owner,v_period_id) hp
    ON hp.farm_id=l.farm_id AND hp.plot_id=l.plot_id';
 v_scope_old text:='SELECT coalesce(jsonb_agg(plot_id ORDER BY plot_id),''[]''::jsonb) INTO v_scope
   FROM public.billing_planning_harvest_plots WHERE owner_id=v_owner AND period_id=v_period_id;';
 v_scope_new text:='SELECT coalesce(jsonb_agg(plot_id ORDER BY plot_id),''[]''::jsonb) INTO v_scope
   FROM billing_private.planning_v5_harvest_scope(v_owner,v_period_id);';
 v_join_count integer;
BEGIN
 v_definition=pg_get_functiondef('billing_private.planning_v3_dispatch(text,jsonb)'::regprocedure);
 IF strpos(v_definition,v_selected_old)=0 OR strpos(v_definition,v_scope_old)=0 THEN
  RAISE EXCEPTION 'O dispatcher do Planejamento não corresponde à versão esperada para o escopo automático.';
 END IF;
 v_join_count=(length(v_definition)-length(replace(v_definition,v_join_old,'')))/length(v_join_old);
 IF v_join_count<>3 THEN
  RAISE EXCEPTION 'Foram encontrados % vínculos de carregamento; eram esperados 3.',v_join_count;
 END IF;
 v_definition=replace(v_definition,v_selected_old,v_selected_new);
 v_definition=replace(v_definition,v_join_old,v_join_new);
 v_definition=replace(v_definition,v_scope_old,v_scope_new);
 EXECUTE v_definition;
END $$;
