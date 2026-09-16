-- The diary is an operational report: its date range, summaries, accumulated
-- values, detail rows and pagination must all be calculated from the same
-- server-side interval. Voided field logs remain auditable in the detail list,
-- but never create empty dates or affect totals.
CREATE FUNCTION billing_private.planning_v9_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_payload jsonb:=coalesce(p_payload,'{}'::jsonb);v_clean_payload jsonb;
 v_result jsonb;v_period public.billing_planning_periods%ROWTYPE;v_period_id uuid;
 v_section text;v_search text;v_from date;v_to date;
 v_page integer;v_page_size integer;v_total integer:=0;v_total_pages integer:=1;
 v_logs jsonb:='[]'::jsonb;v_loads jsonb:='[]'::jsonb;
 v_daily jsonb:='[]'::jsonb;v_monthly jsonb:='[]'::jsonb;v_summary jsonb;
 v_field_log_ids jsonb:='[]'::jsonb;v_harvest_load_ids jsonb:='[]'::jsonb;
BEGIN
 IF p_action<>'list' THEN RETURN billing_private.planning_v8_dispatch(p_action,p_payload); END IF;
 PERFORM billing_private.planning_v2_assert_payload(v_payload,ARRAY['periodId','search','page','pageSize','section','dateFrom','dateTo']);
 v_clean_payload=v_payload-'dateFrom'-'dateTo';
 v_result=billing_private.planning_v8_dispatch('list',v_clean_payload);
 v_period_id=nullif(v_payload->>'periodId','')::uuid;
 IF v_period_id IS NULL THEN
  RETURN v_result||jsonb_build_object('diaryPeriodSummary',jsonb_build_object(
   'dateFrom','','dateTo','','plantedAreaHa','0','managedAreaHa','0','lostAreaHa','0',
   'harvestedTons','0','fieldLogCount',0,'loadCount',0,'eventCount',0));
 END IF;

 SELECT * INTO v_period FROM public.billing_planning_periods WHERE owner_id=v_owner AND id=v_period_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Safra não encontrada.' USING ERRCODE='P0002'; END IF;
 v_section=coalesce(nullif(v_payload->>'section',''),'resumo');
 v_search=btrim(coalesce(v_payload->>'search',''));
 v_page=(coalesce(v_payload->>'page','1'))::integer;
 v_page_size=(coalesce(v_payload->>'pageSize','10'))::integer;
 v_from=CASE WHEN nullif(v_payload->>'dateFrom','') IS NULL THEN v_period.start_date ELSE billing_private.planning_v2_date(v_payload->>'dateFrom') END;
 v_to=CASE WHEN nullif(v_payload->>'dateTo','') IS NULL THEN v_period.end_date ELSE billing_private.planning_v2_date(v_payload->>'dateTo') END;
 IF v_from>v_to OR v_from<v_period.start_date OR v_to>v_period.end_date THEN
  RAISE EXCEPTION 'O período do Diário deve estar dentro das datas da safra e a data inicial não pode superar a final.' USING ERRCODE='23514';
 END IF;

 SELECT coalesce(jsonb_agg(billing_private.present_planning_field_log(l)
  ORDER BY l.occurred_on DESC,l.created_at DESC,l.id),'[]'::jsonb)
 INTO v_logs
 FROM public.billing_planning_field_logs l
 WHERE l.owner_id=v_owner AND l.period_id=v_period_id AND l.occurred_on BETWEEN v_from AND v_to;

 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',l.id,'contractId',l.contract_id,'contractNumber',c.contract_number,
   'farmId',l.farm_id,'farmName',f.name,'plotId',l.plot_id,'plotName',p.name,'loadedAt',l.loaded_at,
   'volumeTons',billing_private.decimal_text(l.volume),'document',l.document,'notes',l.notes)
   ORDER BY l.loaded_at DESC,l.created_at DESC,l.id),'[]'::jsonb)
 INTO v_loads
 FROM public.billing_contract_loads l
 JOIN billing_private.planning_v5_harvest_scope(v_owner,v_period_id) scope
  ON scope.farm_id=l.farm_id AND scope.plot_id=l.plot_id
 JOIN public.billing_contracts c ON c.owner_id=l.owner_id AND c.id=l.contract_id
 JOIN public.billing_farms f ON f.owner_id=l.owner_id AND f.id=l.farm_id
 JOIN public.billing_farm_plots p ON p.owner_id=l.owner_id AND p.id=l.plot_id
 WHERE l.owner_id=v_owner AND l.loaded_at BETWEEN v_from AND v_to;

 WITH events AS (
  SELECT l.occurred_on AS day,
   sum(l.area_ha) FILTER(WHERE l.kind='planting') planted,
   sum(l.area_ha) FILTER(WHERE l.kind='management') managed,
   sum(l.area_ha) FILTER(WHERE l.kind='loss') lost,
   0::numeric harvested,0::bigint loads,count(*)::bigint events
  FROM public.billing_planning_field_logs l
  WHERE l.owner_id=v_owner AND l.period_id=v_period_id AND l.voided_at IS NULL
   AND l.occurred_on BETWEEN v_from AND v_to
  GROUP BY l.occurred_on
  UNION ALL
  SELECT l.loaded_at,0,0,0,sum(l.volume),count(*)::bigint,count(*)::bigint
  FROM public.billing_contract_loads l
  JOIN billing_private.planning_v5_harvest_scope(v_owner,v_period_id) scope
   ON scope.farm_id=l.farm_id AND scope.plot_id=l.plot_id
  WHERE l.owner_id=v_owner AND l.loaded_at BETWEEN v_from AND v_to
  GROUP BY l.loaded_at
 ), days AS (
  SELECT day,coalesce(sum(planted),0) planted,coalesce(sum(managed),0) managed,
   coalesce(sum(lost),0) lost,coalesce(sum(harvested),0) harvested,
   sum(loads)::integer loads,sum(events)::integer events
  FROM events GROUP BY day
 ), running AS (
  SELECT *,sum(planted) OVER(ORDER BY day) accumulated_planted,
   sum(managed) OVER(ORDER BY day) accumulated_managed,
   sum(lost) OVER(ORDER BY day) accumulated_lost,
   sum(harvested) OVER(ORDER BY day) accumulated_harvested,
   sum(loads) OVER(ORDER BY day)::integer accumulated_loads
  FROM days
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'date',day,'plantedAreaHa',billing_private.decimal_text(planted),
   'managedAreaHa',billing_private.decimal_text(managed),'lostAreaHa',billing_private.decimal_text(lost),
   'harvestedTons',billing_private.decimal_text(harvested),'loadCount',loads,'eventCount',events,
   'accumulatedPlantedAreaHa',billing_private.decimal_text(accumulated_planted),
   'accumulatedManagedAreaHa',billing_private.decimal_text(accumulated_managed),
   'accumulatedLostAreaHa',billing_private.decimal_text(accumulated_lost),
   'accumulatedHarvestedTons',billing_private.decimal_text(accumulated_harvested),
   'accumulatedLoadCount',accumulated_loads) ORDER BY day DESC),'[]'::jsonb),
  jsonb_build_object('dateFrom',v_from,'dateTo',v_to,
   'plantedAreaHa',billing_private.decimal_text(coalesce(sum(planted),0)),
   'managedAreaHa',billing_private.decimal_text(coalesce(sum(managed),0)),
   'lostAreaHa',billing_private.decimal_text(coalesce(sum(lost),0)),
   'harvestedTons',billing_private.decimal_text(coalesce(sum(harvested),0)),
   'fieldLogCount',coalesce(sum(events-loads),0)::integer,
   'loadCount',coalesce(sum(loads),0)::integer,'eventCount',coalesce(sum(events),0)::integer)
 INTO v_daily,v_summary FROM running;

 WITH events AS (
  SELECT date_trunc('month',l.occurred_on)::date AS month,
   sum(l.area_ha) FILTER(WHERE l.kind='planting') planted,
   sum(l.area_ha) FILTER(WHERE l.kind='management') managed,
   sum(l.area_ha) FILTER(WHERE l.kind='loss') lost,0::numeric harvested,0::bigint loads
  FROM public.billing_planning_field_logs l
  WHERE l.owner_id=v_owner AND l.period_id=v_period_id AND l.voided_at IS NULL
   AND l.occurred_on BETWEEN v_from AND v_to
  GROUP BY 1
  UNION ALL
  SELECT date_trunc('month',l.loaded_at)::date,0,0,0,sum(l.volume),count(*)::bigint
  FROM public.billing_contract_loads l
  JOIN billing_private.planning_v5_harvest_scope(v_owner,v_period_id) scope
   ON scope.farm_id=l.farm_id AND scope.plot_id=l.plot_id
  WHERE l.owner_id=v_owner AND l.loaded_at BETWEEN v_from AND v_to
  GROUP BY 1
 ), months AS (
  SELECT month,coalesce(sum(planted),0) planted,coalesce(sum(managed),0) managed,
   coalesce(sum(lost),0) lost,coalesce(sum(harvested),0) harvested,sum(loads)::integer loads
  FROM events GROUP BY month
 ), running AS (
  SELECT *,sum(planted) OVER(ORDER BY month) accumulated_planted,
   sum(managed) OVER(ORDER BY month) accumulated_managed,
   sum(lost) OVER(ORDER BY month) accumulated_lost,
   sum(harvested) OVER(ORDER BY month) accumulated_harvested,
   sum(loads) OVER(ORDER BY month)::integer accumulated_loads
  FROM months
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'month',to_char(month,'YYYY-MM'),'plantedAreaHa',billing_private.decimal_text(planted),
   'managedAreaHa',billing_private.decimal_text(managed),'lostAreaHa',billing_private.decimal_text(lost),
   'harvestedTons',billing_private.decimal_text(harvested),'loadCount',loads,
   'accumulatedPlantedAreaHa',billing_private.decimal_text(accumulated_planted),
   'accumulatedManagedAreaHa',billing_private.decimal_text(accumulated_managed),
   'accumulatedLostAreaHa',billing_private.decimal_text(accumulated_lost),
   'accumulatedHarvestedTons',billing_private.decimal_text(accumulated_harvested),
   'accumulatedLoadCount',accumulated_loads) ORDER BY month DESC),'[]'::jsonb)
 INTO v_monthly FROM running;

 v_result=v_result||jsonb_build_object('fieldLogs',v_logs,'harvestLoads',v_loads,
  'dailySummary',v_daily,'monthlySummary',v_monthly,'diaryPeriodSummary',v_summary);

 IF v_section='diario' THEN
  WITH activities AS (
   SELECT 'field' source,item,item->>'id' id,item->>'occurredOn' activity_date,item->>'createdAt' activity_sort
    FROM jsonb_array_elements(v_logs) rows(item)
   UNION ALL
   SELECT 'harvest',item,item->>'id',item->>'loadedAt',item->>'loadedAt'
    FROM jsonb_array_elements(v_loads) rows(item)
  ) SELECT count(*)::integer INTO v_total FROM activities
   WHERE v_search='' OR strpos(lower(concat_ws(' ',item::text,CASE source WHEN 'field' THEN 'apontamento campo plantio manejo perda área morta' ELSE 'colheita carregamento contrato' END)),lower(v_search))>0;
  v_total_pages=greatest(1,ceil(v_total::numeric/v_page_size)::integer);v_page=least(v_page,v_total_pages);
  WITH activities AS (
   SELECT 'field' source,item,item->>'id' id,item->>'occurredOn' activity_date,item->>'createdAt' activity_sort
    FROM jsonb_array_elements(v_logs) rows(item)
   UNION ALL
   SELECT 'harvest',item,item->>'id',item->>'loadedAt',item->>'loadedAt'
    FROM jsonb_array_elements(v_loads) rows(item)
  ), page_rows AS (
   SELECT * FROM activities
   WHERE v_search='' OR strpos(lower(concat_ws(' ',item::text,CASE source WHEN 'field' THEN 'apontamento campo plantio manejo perda área morta' ELSE 'colheita carregamento contrato' END)),lower(v_search))>0
   ORDER BY activity_date DESC,activity_sort DESC,id DESC LIMIT v_page_size OFFSET (v_page-1)*v_page_size
  ) SELECT coalesce(jsonb_agg(id ORDER BY activity_date DESC,activity_sort DESC,id DESC) FILTER(WHERE source='field'),'[]'::jsonb),
    coalesce(jsonb_agg(id ORDER BY activity_date DESC,activity_sort DESC,id DESC) FILTER(WHERE source='harvest'),'[]'::jsonb)
   INTO v_field_log_ids,v_harvest_load_ids FROM page_rows;
  v_result=v_result||jsonb_build_object(
   'visibleFieldLogIds',v_field_log_ids,'visibleHarvestLoadIds',v_harvest_load_ids,
   'pagination',jsonb_build_object('page',v_page,'pageSize',v_page_size,'total',v_total,'totalPages',v_total_pages,
    'hasPrevious',v_page>1,'hasNext',v_page<v_total_pages));
 END IF;
 RETURN v_result;
EXCEPTION
 WHEN invalid_text_representation OR numeric_value_out_of_range OR division_by_zero THEN
  RAISE EXCEPTION 'Informe filtros e identificadores válidos.' USING ERRCODE='22023';
END $$;

REVOKE ALL ON FUNCTION billing_private.planning_v9_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.planning_v9_dispatch(text,jsonb) TO authenticated;

DO $$
DECLARE v_definition text;v_old text;v_new text;
BEGIN
 v_definition=pg_get_functiondef('public.billing_rpc(text,text,jsonb)'::regprocedure);
 v_old='IF p_resource=''planning'' THEN RETURN billing_private.planning_v8_dispatch(p_action,p_payload); END IF;';
 v_new='IF p_resource=''planning'' THEN RETURN billing_private.planning_v9_dispatch(p_action,p_payload); END IF;';
 IF strpos(v_definition,v_old)=0 THEN
  IF strpos(v_definition,v_new)=0 THEN RAISE EXCEPTION 'O contrato RPC instalado não corresponde ao Planejamento esperado.'; END IF;
 ELSE EXECUTE replace(v_definition,v_old,v_new);
 END IF;
END $$;

REVOKE ALL ON FUNCTION public.billing_rpc(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_rpc(text,text,jsonb) TO authenticated;
