-- Operational intelligence for the executive summary. The existing dashboard
-- remains the financial source; this projection adds weighted production
-- indicators without moving business calculations to the browser.
CREATE FUNCTION billing_private.summary_operational_intelligence(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_company uuid;
 v_from date;v_to date;v_days integer;v_result jsonb;
BEGIN
 v_company=billing_private.overview_scope(p_payload,ARRAY['companyId','from','to']);
 PERFORM billing_private.authorize_resource('contracts','list');
 PERFORM billing_private.authorize('registrations.read');
 IF p_payload->>'from' IS NULL AND p_payload->>'to' IS NULL THEN
  v_to=(now() AT TIME ZONE 'America/Sao_Paulo')::date;v_from=v_to-364;
 ELSIF p_payload->>'from' IS NULL OR p_payload->>'to' IS NULL OR
    p_payload->>'from'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR p_payload->>'to'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
  RAISE EXCEPTION 'Informe o período completo do resumo.' USING ERRCODE='22023';
 ELSE v_from=(p_payload->>'from')::date;v_to=(p_payload->>'to')::date;
 END IF;
 v_days=v_to-v_from+1;
 IF v_from<'1900-01-01' OR v_to>'9999-12-31' OR v_days<1 THEN
  RAISE EXCEPTION 'A data inicial deve ser igual ou anterior à data final.' USING ERRCODE='22023';
 END IF;
 IF v_days>1827 THEN RAISE EXCEPTION 'O resumo aceita períodos de até cinco anos.' USING ERRCODE='22023'; END IF;

 WITH contracts AS MATERIALIZED (
  SELECT c.id,c.client_id,c.contract_number,c.title,c.status,c.contracted_volume,cl.legal_name client_name
  FROM public.billing_contracts c JOIN public.billing_clients cl ON cl.owner_id=c.owner_id AND cl.id=c.client_id
  WHERE c.owner_id=v_owner AND c.company_id=v_company
 ), current_loads AS MATERIALIZED (
  SELECT l.id,l.contract_id,l.farm_id,l.plot_id,l.loaded_at,l.volume,l.atr,
   f.name farm_name,f.area_ha farm_area_ha,p.name plot_name,p.area_ha plot_area_ha
  FROM public.billing_contract_loads l JOIN contracts c ON c.id=l.contract_id
  JOIN public.billing_farms f ON f.owner_id=v_owner AND f.id=l.farm_id
  JOIN public.billing_farm_plots p ON p.owner_id=v_owner AND p.farm_id=l.farm_id AND p.id=l.plot_id
  WHERE l.owner_id=v_owner AND l.loaded_at BETWEEN v_from AND v_to
 ), operational_totals AS MATERIALIZED (
  SELECT count(*)::integer load_count,coalesce(sum(volume),0) loaded_volume,
   CASE WHEN count(*)=0 OR count(*) FILTER(WHERE atr IS NULL)>0 THEN NULL
    ELSE round(sum(volume*atr)/nullif(sum(volume),0),6) END average_atr,
   CASE WHEN count(*)=0 THEN 0 ELSE round(sum(volume)/count(*),6) END average_load_volume,
   count(DISTINCT contract_id)::integer contract_count,count(DISTINCT farm_id)::integer farm_count,
   count(DISTINCT plot_id)::integer plot_count
  FROM current_loads
 ), calendar AS MATERIALIZED (
  SELECT generate_series(date_trunc('month',v_from)::date,date_trunc('month',v_to)::date,interval '1 month')::date month_start
 ), monthly_operations AS (
  SELECT cal.month_start,count(l.id)::integer load_count,coalesce(sum(l.volume),0) loaded_volume,
   CASE WHEN count(l.id)=0 OR count(l.id) FILTER(WHERE l.atr IS NULL)>0 THEN NULL
    ELSE round(sum(l.volume*l.atr)/nullif(sum(l.volume),0),6) END average_atr,
   CASE WHEN count(l.id)=0 THEN 0 ELSE round(sum(l.volume)/count(l.id),6) END average_load_volume,
   count(DISTINCT l.contract_id)::integer contract_count,count(DISTINCT l.farm_id)::integer farm_count,
   count(DISTINCT l.plot_id)::integer plot_count
  FROM calendar cal LEFT JOIN current_loads l ON date_trunc('month',l.loaded_at)::date=cal.month_start
  GROUP BY cal.month_start
 ), farm_performance AS (
  SELECT farm_id,farm_name,max(farm_area_ha) area_ha,count(*)::integer load_count,sum(volume) loaded_volume,
   CASE WHEN count(*) FILTER(WHERE atr IS NULL)>0 THEN NULL ELSE round(sum(volume*atr)/nullif(sum(volume),0),6) END average_atr,
   round(sum(volume)/count(*),6) average_load_volume,
   CASE WHEN max(farm_area_ha)>0 THEN round(sum(volume)/max(farm_area_ha),6) ELSE NULL END tons_per_ha,
   count(DISTINCT plot_id)::integer plot_count,count(DISTINCT contract_id)::integer contract_count
  FROM current_loads GROUP BY farm_id,farm_name
 ), plot_performance AS (
  SELECT plot_id,plot_name,farm_id,farm_name,max(plot_area_ha) area_ha,count(*)::integer load_count,sum(volume) loaded_volume,
   CASE WHEN count(*) FILTER(WHERE atr IS NULL)>0 THEN NULL ELSE round(sum(volume*atr)/nullif(sum(volume),0),6) END average_atr,
   round(sum(volume)/count(*),6) average_load_volume,
   CASE WHEN max(plot_area_ha)>0 THEN round(sum(volume)/max(plot_area_ha),6) ELSE NULL END tons_per_ha,
   count(DISTINCT contract_id)::integer contract_count
  FROM current_loads GROUP BY plot_id,plot_name,farm_id,farm_name
 ), contract_period AS (
  SELECT contract_id,count(*)::integer load_count,sum(volume) loaded_volume,
   CASE WHEN count(*) FILTER(WHERE atr IS NULL)>0 THEN NULL ELSE round(sum(volume*atr)/nullif(sum(volume),0),6) END average_atr,
   round(sum(volume)/count(*),6) average_load_volume
  FROM current_loads GROUP BY contract_id
 ), contract_lifetime AS (
  SELECT l.contract_id,count(*)::integer load_count,sum(l.volume) loaded_volume
  FROM public.billing_contract_loads l JOIN contracts c ON c.id=l.contract_id
  WHERE l.owner_id=v_owner GROUP BY l.contract_id
 ), contract_performance AS (
  SELECT c.id,c.client_name,c.contract_number,c.title,c.status,c.contracted_volume,
   coalesce(p.load_count,0) period_load_count,coalesce(p.loaded_volume,0) period_loaded_volume,p.average_atr,
   coalesce(p.average_load_volume,0) average_load_volume,coalesce(all_loads.loaded_volume,0) total_loaded_volume,
   greatest(c.contracted_volume-coalesce(all_loads.loaded_volume,0),0) remaining_volume,
   CASE WHEN c.contracted_volume>0 THEN round(coalesce(all_loads.loaded_volume,0)*100/c.contracted_volume,2) ELSE 0 END delivery_percent
  FROM contracts c LEFT JOIN contract_period p ON p.contract_id=c.id
  LEFT JOIN contract_lifetime all_loads ON all_loads.contract_id=c.id
 ), focused_period AS MATERIALIZED (
  SELECT p.* FROM public.billing_planning_periods p
  WHERE p.owner_id=v_owner AND p.status<>'cancelled' AND p.start_date<=v_to AND p.end_date>=v_from
  ORDER BY (v_to BETWEEN p.start_date AND p.end_date) DESC,(p.status='active') DESC,p.end_date DESC,p.created_at DESC,p.id
  LIMIT 1
 ), planning_scope AS MATERIALIZED (
  SELECT scope.farm_id,scope.plot_id
  FROM focused_period period JOIN LATERAL billing_private.planning_v5_harvest_scope(v_owner,period.id) scope ON true
 ), planning_plot_performance AS (
  SELECT scope.farm_id,f.name farm_name,scope.plot_id,p.name plot_name,p.area_ha,
   coalesce(allocation.target_area_ha,0) target_area_ha,coalesce(planting.planted_area_ha,0) planted_area_ha,
   CASE WHEN coalesce(allocation.target_area_ha,0)>0 THEN round(coalesce(planting.planted_area_ha,0)*100/allocation.target_area_ha,2) ELSE 0 END planting_percent,
   coalesce(target.target_tons,0) target_tons,coalesce(harvest.harvested_tons,0) harvested_tons,
   greatest(coalesce(target.target_tons,0)-coalesce(harvest.harvested_tons,0),0) remaining_tons,
   CASE WHEN coalesce(target.target_tons,0)>0 THEN round(coalesce(harvest.harvested_tons,0)*100/target.target_tons,2) ELSE 0 END harvest_percent,
   coalesce(harvest.load_count,0)::integer load_count
  FROM planning_scope scope JOIN public.billing_farms f ON f.owner_id=v_owner AND f.id=scope.farm_id
  JOIN public.billing_farm_plots p ON p.owner_id=v_owner AND p.farm_id=scope.farm_id AND p.id=scope.plot_id
  LEFT JOIN LATERAL (SELECT sum(a.area_ha) target_area_ha FROM public.billing_planning_allocations a JOIN focused_period period ON period.id=a.period_id
   WHERE a.owner_id=v_owner AND a.plot_id=scope.plot_id AND a.status='active') allocation ON true
  LEFT JOIN LATERAL (SELECT sum(l.area_ha) planted_area_ha FROM public.billing_planning_field_logs l JOIN focused_period period ON period.id=l.period_id
   WHERE l.owner_id=v_owner AND l.plot_id=scope.plot_id AND l.voided_at IS NULL AND l.kind='planting'
    AND l.occurred_on BETWEEN period.start_date AND least(v_to,period.end_date)) planting ON true
  LEFT JOIN LATERAL (SELECT sum(t.target_tons) target_tons FROM public.billing_planning_harvest_targets t JOIN focused_period period ON period.id=t.period_id
   WHERE t.owner_id=v_owner AND t.plot_id=scope.plot_id) target ON true
  LEFT JOIN LATERAL (SELECT sum(l.volume) harvested_tons,count(*)::integer load_count FROM public.billing_contract_loads l JOIN focused_period period ON true
   WHERE l.owner_id=v_owner AND l.farm_id=scope.farm_id AND l.plot_id=scope.plot_id
    AND l.loaded_at BETWEEN period.start_date AND least(v_to,period.end_date)) harvest ON true
 ), planning_farm_performance AS (
  SELECT farm_id,farm_name,sum(target_area_ha) target_area_ha,sum(planted_area_ha) planted_area_ha,
   CASE WHEN sum(target_area_ha)>0 THEN round(sum(planted_area_ha)*100/sum(target_area_ha),2) ELSE 0 END planting_percent,
   sum(target_tons) target_tons,sum(harvested_tons) harvested_tons,greatest(sum(target_tons)-sum(harvested_tons),0) remaining_tons,
   CASE WHEN sum(target_tons)>0 THEN round(sum(harvested_tons)*100/sum(target_tons),2) ELSE 0 END harvest_percent,
   sum(load_count)::integer load_count,count(*)::integer plot_count
  FROM planning_plot_performance GROUP BY farm_id,farm_name
 )
 SELECT jsonb_build_object(
  'operationalTotals',jsonb_build_object('loadCount',o.load_count,'loadedVolume',billing_private.decimal_text(o.loaded_volume),
   'averageAtr',coalesce(billing_private.decimal_text(o.average_atr),''),'averageLoadVolume',billing_private.decimal_text(o.average_load_volume),
   'contractCount',o.contract_count,'farmCount',o.farm_count,'plotCount',o.plot_count),
  'monthlyOperations',coalesce((SELECT jsonb_agg(jsonb_build_object('month',to_char(m.month_start,'YYYY-MM'),'loadCount',m.load_count,
   'loadedVolume',billing_private.decimal_text(m.loaded_volume),'averageAtr',coalesce(billing_private.decimal_text(m.average_atr),''),
   'averageLoadVolume',billing_private.decimal_text(m.average_load_volume),'contractCount',m.contract_count,'farmCount',m.farm_count,
   'plotCount',m.plot_count) ORDER BY m.month_start) FROM monthly_operations m),'[]'::jsonb),
  'farmPerformance',coalesce((SELECT jsonb_agg(jsonb_build_object('id',farm_id,'name',farm_name,'areaHa',billing_private.decimal_text(area_ha),
   'loadCount',load_count,'loadedVolume',billing_private.decimal_text(loaded_volume),'averageAtr',coalesce(billing_private.decimal_text(average_atr),''),
   'averageLoadVolume',billing_private.decimal_text(average_load_volume),'tonsPerHa',coalesce(billing_private.decimal_text(tons_per_ha),''),
   'plotCount',plot_count,'contractCount',contract_count) ORDER BY loaded_volume DESC,lower(farm_name),farm_id) FROM farm_performance),'[]'::jsonb),
  'plotPerformance',coalesce((SELECT jsonb_agg(jsonb_build_object('id',plot_id,'name',plot_name,'farmId',farm_id,'farmName',farm_name,
   'areaHa',billing_private.decimal_text(area_ha),'loadCount',load_count,'loadedVolume',billing_private.decimal_text(loaded_volume),
   'averageAtr',coalesce(billing_private.decimal_text(average_atr),''),'averageLoadVolume',billing_private.decimal_text(average_load_volume),
   'tonsPerHa',coalesce(billing_private.decimal_text(tons_per_ha),''),'contractCount',contract_count)
   ORDER BY loaded_volume DESC,lower(farm_name),lower(plot_name),plot_id) FROM plot_performance),'[]'::jsonb),
  'contractPerformance',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'clientName',client_name,'contractNumber',contract_number,
   'title',title,'status',status,'contractedVolume',billing_private.decimal_text(contracted_volume),'periodLoadCount',period_load_count,
   'periodLoadedVolume',billing_private.decimal_text(period_loaded_volume),'averageAtr',coalesce(billing_private.decimal_text(average_atr),''),
   'averageLoadVolume',billing_private.decimal_text(average_load_volume),'totalLoadedVolume',billing_private.decimal_text(total_loaded_volume),
   'remainingVolume',billing_private.decimal_text(remaining_volume),'deliveryPercent',billing_private.decimal_text(delivery_percent))
   ORDER BY period_loaded_volume DESC,total_loaded_volume DESC,lower(client_name),id) FROM contract_performance),'[]'::jsonb),
  'planningPerformance',jsonb_build_object('periodName',coalesce((SELECT name FROM focused_period),''),
   'farms',coalesce((SELECT jsonb_agg(jsonb_build_object('id',farm_id,'name',farm_name,'plotCount',plot_count,
    'targetAreaHa',billing_private.decimal_text(target_area_ha),'plantedAreaHa',billing_private.decimal_text(planted_area_ha),
    'plantingPercent',billing_private.decimal_text(planting_percent),'targetTons',billing_private.decimal_text(target_tons),
    'harvestedTons',billing_private.decimal_text(harvested_tons),'remainingTons',billing_private.decimal_text(remaining_tons),
    'harvestPercent',billing_private.decimal_text(harvest_percent),'loadCount',load_count)
    ORDER BY harvested_tons DESC,lower(farm_name),farm_id) FROM planning_farm_performance),'[]'::jsonb),
   'plots',coalesce((SELECT jsonb_agg(jsonb_build_object('id',plot_id,'name',plot_name,'farmId',farm_id,'farmName',farm_name,
    'areaHa',billing_private.decimal_text(area_ha),'targetAreaHa',billing_private.decimal_text(target_area_ha),
    'plantedAreaHa',billing_private.decimal_text(planted_area_ha),'plantingPercent',billing_private.decimal_text(planting_percent),
    'targetTons',billing_private.decimal_text(target_tons),'harvestedTons',billing_private.decimal_text(harvested_tons),
    'remainingTons',billing_private.decimal_text(remaining_tons),'harvestPercent',billing_private.decimal_text(harvest_percent),'loadCount',load_count)
    ORDER BY harvested_tons DESC,lower(farm_name),lower(plot_name),plot_id) FROM planning_plot_performance),'[]'::jsonb)
  )
 ) INTO v_result FROM operational_totals o;
 RETURN v_result;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
 RAISE EXCEPTION 'Informe um período válido.' USING ERRCODE='22023';
END $$;

REVOKE ALL ON FUNCTION billing_private.summary_operational_intelligence(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.summary_operational_intelligence(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION billing_private.summary_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_action='dashboard' THEN
  RETURN billing_private.summary_dashboard(p_payload)||billing_private.summary_operational_intelligence(p_payload);
 END IF;
 RETURN billing_private.summary_monthly_dispatch(p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION billing_private.summary_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.summary_dispatch(text,jsonb) TO authenticated;

COMMENT ON FUNCTION billing_private.summary_operational_intelligence(jsonb) IS
 'Owner-isolated weighted ATR, monthly operations, farm/plot performance, contract fulfillment and focused planning progress for the executive summary.';
COMMENT ON FUNCTION billing_private.summary_dashboard(jsonb) IS
 'Owner-isolated executive dashboard combined by summary_dispatch with operational intelligence calculated in Postgres.';
