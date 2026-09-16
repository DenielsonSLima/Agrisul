-- Gross planting progress survives later allocation cancellation, while a
-- request id can never be silently reused with different field data.
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
    JOIN public.billing_planning_harvest_plots hp ON hp.owner_id=load.owner_id AND hp.plot_id=load.plot_id AND hp.period_id=p_period.id
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
  'harvestScopeCount',(SELECT count(*)::integer FROM public.billing_planning_harvest_plots hp WHERE hp.owner_id=p_period.owner_id AND hp.period_id=p_period.id),
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
 v_anchor text;
 v_replacement text;
BEGIN
 v_definition=pg_get_functiondef('billing_private.planning_v3_dispatch(text,jsonb)'::regprocedure);
 v_anchor='IF FOUND THEN RETURN jsonb_build_object(''fieldLog'',billing_private.present_planning_field_log(v_log)); END IF;';
 v_replacement='IF FOUND THEN
   IF ROW(v_log.period_id,v_log.plot_id,v_log.occurred_on,v_log.kind,v_log.practice_id,v_log.area_ha,v_log.notes)
      IS DISTINCT FROM ROW(v_period_id,v_plot_id,v_date,v_kind,v_practice,v_area,v_notes) THEN
    RAISE EXCEPTION ''A solicitação diária já foi utilizada com outros dados. Atualize antes de tentar novamente.'' USING ERRCODE=''23505'';
   END IF;
   RETURN jsonb_build_object(''fieldLog'',billing_private.present_planning_field_log(v_log));
  END IF;';
 IF strpos(v_definition,v_anchor)=0 THEN
  IF strpos(v_definition,'A solicitação diária já foi utilizada com outros dados')=0 THEN
   RAISE EXCEPTION 'O dispatcher do Diário não corresponde à versão esperada.';
  END IF;
 ELSE
  EXECUTE replace(v_definition,v_anchor,v_replacement);
 END IF;
END $$;
