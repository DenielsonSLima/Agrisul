-- Planning is an operational timeline. The same plot may receive several
-- successive activities, while each individual operation remains bounded by
-- the plot capacity. All filtering, totals and KPI calculations live here.
ALTER TABLE public.billing_planning_entries
 DROP CONSTRAINT IF EXISTS billing_planning_entries_owner_id_module_plot_id_key,
 DROP CONSTRAINT IF EXISTS billing_planning_entries_module_check;

ALTER TABLE public.billing_planning_entries
 ADD COLUMN activity_type text,
 ADD COLUMN planned_start_date date,
 ADD COLUMN planned_end_date date,
 ADD COLUMN actual_date date,
 ADD COLUMN status text,
 ADD COLUMN estimated_cost numeric(18,6),
 ADD COLUMN actual_cost numeric(18,6),
 ADD COLUMN expected_production_tons numeric(18,6),
 ADD COLUMN actual_production_tons numeric(18,6),
 ADD COLUMN notes text;

UPDATE public.billing_planning_entries SET
 module=CASE module
  WHEN 'preparacao-de-solo' THEN 'preparacao-de-solo'
  WHEN 'plantio' THEN 'plantio'
  WHEN 'mudas' THEN 'plantio'
  WHEN 'herbicidas' THEN 'manejo-do-canavial'
  WHEN 'quebra-de-lombo' THEN 'manejo-do-canavial'
  WHEN 'metas' THEN 'plantio'
 END,
 activity_type=CASE module
  WHEN 'preparacao-de-solo' THEN 'Preparação do solo'
  WHEN 'plantio' THEN 'Plantio'
  WHEN 'mudas' THEN 'Gestão de mudas'
  WHEN 'herbicidas' THEN 'Aplicação de herbicida'
  WHEN 'quebra-de-lombo' THEN 'Quebra de lombo'
  WHEN 'metas' THEN 'Meta de plantio'
 END,
 planned_start_date=(created_at AT TIME ZONE 'America/Sao_Paulo')::date,
 planned_end_date=(created_at AT TIME ZONE 'America/Sao_Paulo')::date,
 status='planejado',
 estimated_cost=0,
 actual_cost=0,
 expected_production_tons=0,
 actual_production_tons=0,
 notes='';

ALTER TABLE public.billing_planning_entries
 ALTER COLUMN activity_type SET NOT NULL,
 ALTER COLUMN planned_start_date SET NOT NULL,
 ALTER COLUMN planned_end_date SET NOT NULL,
 ALTER COLUMN status SET NOT NULL,
 ALTER COLUMN estimated_cost SET NOT NULL,
 ALTER COLUMN estimated_cost SET DEFAULT 0,
 ALTER COLUMN actual_cost SET NOT NULL,
 ALTER COLUMN actual_cost SET DEFAULT 0,
 ALTER COLUMN expected_production_tons SET NOT NULL,
 ALTER COLUMN expected_production_tons SET DEFAULT 0,
 ALTER COLUMN actual_production_tons SET NOT NULL,
 ALTER COLUMN actual_production_tons SET DEFAULT 0,
 ALTER COLUMN notes SET NOT NULL,
 ALTER COLUMN notes SET DEFAULT '',
 ADD CONSTRAINT billing_planning_entries_module_check
  CHECK(module IN('preparacao-de-solo','plantio','manejo-do-canavial','colheita')),
 ADD CONSTRAINT billing_planning_entries_activity_type_check
  CHECK(length(btrim(activity_type)) BETWEEN 2 AND 160),
 ADD CONSTRAINT billing_planning_entries_planned_dates_check
  CHECK(planned_end_date>=planned_start_date),
 ADD CONSTRAINT billing_planning_entries_status_check
  CHECK(status IN('planejado','em-andamento','concluido','cancelado')),
 ADD CONSTRAINT billing_planning_entries_estimated_cost_check
  CHECK(estimated_cost>=0 AND estimated_cost<1000000000000),
 ADD CONSTRAINT billing_planning_entries_actual_cost_check
  CHECK(actual_cost>=0 AND actual_cost<1000000000000),
 ADD CONSTRAINT billing_planning_entries_expected_production_check
  CHECK(expected_production_tons>=0 AND expected_production_tons<1000000000000),
 ADD CONSTRAINT billing_planning_entries_actual_production_check
  CHECK(actual_production_tons>=0 AND actual_production_tons<1000000000000),
 ADD CONSTRAINT billing_planning_entries_notes_check
  CHECK(length(notes)<=2000);

-- Only an exact repetition of activity and planned window is a duplicate.
-- Different operations and successive crop stages may reuse the same plot.
CREATE UNIQUE INDEX billing_planning_entries_operation_window_key
 ON public.billing_planning_entries(
  owner_id,module,plot_id,billing_private.name_key(activity_type),
  planned_start_date,planned_end_date
 );
CREATE INDEX billing_planning_entries_filter
 ON public.billing_planning_entries(owner_id,module,planned_start_date,planned_end_date,status);

CREATE OR REPLACE FUNCTION billing_private.present_planning_entry(p_entry public.billing_planning_entries)
RETURNS jsonb LANGUAGE sql STABLE STRICT SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p_entry.id,
  'module',p_entry.module,
  'farmId',p_entry.farm_id,
  'farmName',f.name,
  'plotId',p_entry.plot_id,
  'plotName',p.name,
  'plotAreaHa',billing_private.decimal_text(p.area_ha),
  'activityType',p_entry.activity_type,
  'plannedStartDate',p_entry.planned_start_date,
  'plannedEndDate',p_entry.planned_end_date,
  'actualDate',p_entry.actual_date,
  'areaHa',billing_private.decimal_text(p_entry.area_ha),
  'status',p_entry.status,
  'estimatedCost',billing_private.decimal_text(p_entry.estimated_cost),
  'actualCost',billing_private.decimal_text(p_entry.actual_cost),
  'expectedProductionTons',billing_private.decimal_text(p_entry.expected_production_tons),
  'actualProductionTons',billing_private.decimal_text(p_entry.actual_production_tons),
  'notes',p_entry.notes,
  'createdAt',p_entry.created_at,
  'updatedAt',p_entry.updated_at
 )
 FROM public.billing_farms f
 JOIN public.billing_farm_plots p
  ON p.owner_id=p_entry.owner_id AND p.farm_id=p_entry.farm_id AND p.id=p_entry.plot_id
 WHERE f.owner_id=p_entry.owner_id AND f.id=p_entry.farm_id
$$;
REVOKE ALL ON FUNCTION billing_private.present_planning_entry(public.billing_planning_entries) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.planning_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;
 v_module text;
 v_farm_id uuid;
 v_plot_id uuid;
 v_activity_type text;
 v_planned_start date;
 v_planned_end date;
 v_actual_date date;
 v_status text;
 v_search text;
 v_date_from date;
 v_date_to date;
 v_area_text text;
 v_estimated_cost_text text;
 v_actual_cost_text text;
 v_expected_production_text text;
 v_actual_production_text text;
 v_notes text;
 v_plot_area numeric;
 v_entry public.billing_planning_entries%ROWTYPE;
 v_farms jsonb;
 v_groups jsonb;
 v_entries jsonb;
 v_summary jsonb;
 v_kpis jsonb;
BEGIN
 IF v_owner IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
    OR p_action NOT IN('list','save','delete') THEN
  RAISE EXCEPTION 'Operação de planejamento inválida.' USING ERRCODE='22023';
 END IF;
 PERFORM billing_private.authorize('registrations.'||CASE WHEN p_action='list' THEN 'read' ELSE 'write' END);

 IF (p_action='list' AND EXISTS(
   SELECT 1 FROM jsonb_object_keys(p_payload) key
   WHERE key NOT IN('module','search','dateFrom','dateTo','startDate','endDate','status')
  )) OR (p_action='save' AND EXISTS(
   SELECT 1 FROM jsonb_object_keys(p_payload) key
   WHERE key NOT IN(
    'id','module','farmId','plotId','activityType','plannedStartDate','plannedEndDate',
    'actualDate','areaHa','status','estimatedCost','actualCost',
    'expectedProductionTons','actualProductionTons','notes'
   )
  )) OR (p_action='delete' AND EXISTS(
   SELECT 1 FROM jsonb_object_keys(p_payload) key WHERE key NOT IN('id','module')
  )) THEN
  RAISE EXCEPTION 'O planejamento recebeu campos não reconhecidos.' USING ERRCODE='22023';
 END IF;

 v_module=nullif(btrim(coalesce(p_payload->>'module','')),'');
 IF v_module IS NOT NULL AND v_module NOT IN('preparacao-de-solo','plantio','manejo-do-canavial','colheita') THEN
  RAISE EXCEPTION 'Selecione um submódulo de planejamento válido.' USING ERRCODE='22023';
 END IF;

 IF p_action='list' THEN
  v_search=nullif(btrim(coalesce(p_payload->>'search','')),'');
  v_status=nullif(btrim(coalesce(p_payload->>'status','')),'');
  IF length(coalesce(v_search,''))>160 THEN
   RAISE EXCEPTION 'A busca deve ter até 160 caracteres.' USING ERRCODE='22023';
  END IF;
  IF v_status IS NOT NULL AND v_status NOT IN('planejado','em-andamento','concluido','cancelado') THEN
   RAISE EXCEPTION 'Selecione um status de planejamento válido.' USING ERRCODE='22023';
  END IF;
  IF coalesce(p_payload->>'dateFrom',p_payload->>'startDate','')<>'' THEN
   IF coalesce(p_payload->>'dateFrom',p_payload->>'startDate')!~'^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'Informe a data inicial no formato AAAA-MM-DD.' USING ERRCODE='22023';
   END IF;
   v_date_from=coalesce(p_payload->>'dateFrom',p_payload->>'startDate')::date;
  END IF;
  IF coalesce(p_payload->>'dateTo',p_payload->>'endDate','')<>'' THEN
   IF coalesce(p_payload->>'dateTo',p_payload->>'endDate')!~'^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'Informe a data final no formato AAAA-MM-DD.' USING ERRCODE='22023';
   END IF;
   v_date_to=coalesce(p_payload->>'dateTo',p_payload->>'endDate')::date;
  END IF;
  IF v_date_from IS NOT NULL AND v_date_to IS NOT NULL AND v_date_to<v_date_from THEN
   RAISE EXCEPTION 'A data final do filtro não pode ser anterior à data inicial.' USING ERRCODE='22023';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',f.id,'name',f.name,'areaHa',billing_private.decimal_text(f.area_ha),
   'plots',coalesce((
    SELECT jsonb_agg(jsonb_build_object(
     'id',p.id,'name',p.name,'areaHa',billing_private.decimal_text(p.area_ha)
    ) ORDER BY lower(p.name),p.id)
    FROM public.billing_farm_plots p
    WHERE p.owner_id=f.owner_id AND p.farm_id=f.id
   ),'[]'::jsonb)
  ) ORDER BY lower(f.name),f.id),'[]'::jsonb)
  INTO v_farms FROM public.billing_farms f WHERE f.owner_id=v_owner;

  SELECT coalesce(jsonb_agg(billing_private.present_planning_entry(e)
   ORDER BY e.planned_start_date,lower(f.name),lower(p.name),lower(e.activity_type),e.id),'[]'::jsonb)
  INTO v_entries
  FROM public.billing_planning_entries e
  JOIN public.billing_farms f ON f.owner_id=e.owner_id AND f.id=e.farm_id
  JOIN public.billing_farm_plots p ON p.owner_id=e.owner_id AND p.farm_id=e.farm_id AND p.id=e.plot_id
  WHERE e.owner_id=v_owner
   AND (v_module IS NULL OR e.module=v_module)
   AND (v_status IS NULL OR e.status=v_status)
   AND (v_date_from IS NULL OR e.planned_end_date>=v_date_from)
   AND (v_date_to IS NULL OR e.planned_start_date<=v_date_to)
   AND (v_search IS NULL OR concat_ws(' ',f.name,p.name,e.activity_type,e.notes) ILIKE '%'||v_search||'%');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'farmId',q.farm_id,'farmName',q.farm_name,
   'totalAreaHa',billing_private.decimal_text(q.total_area),
   'entries',q.entries
  ) ORDER BY lower(q.farm_name),q.farm_id),'[]'::jsonb)
  INTO v_groups
  FROM (
   SELECT e.farm_id,f.name AS farm_name,sum(e.area_ha) AS total_area,
    jsonb_agg(billing_private.present_planning_entry(e)
     ORDER BY e.planned_start_date,lower(p.name),lower(e.activity_type),e.id) AS entries
   FROM public.billing_planning_entries e
   JOIN public.billing_farms f ON f.owner_id=e.owner_id AND f.id=e.farm_id
   JOIN public.billing_farm_plots p ON p.owner_id=e.owner_id AND p.farm_id=e.farm_id AND p.id=e.plot_id
   WHERE e.owner_id=v_owner
    AND (v_module IS NULL OR e.module=v_module)
    AND (v_status IS NULL OR e.status=v_status)
    AND (v_date_from IS NULL OR e.planned_end_date>=v_date_from)
    AND (v_date_to IS NULL OR e.planned_start_date<=v_date_to)
    AND (v_search IS NULL OR concat_ws(' ',f.name,p.name,e.activity_type,e.notes) ILIKE '%'||v_search||'%')
   GROUP BY e.farm_id,f.name
  ) q;

  SELECT jsonb_build_object(
   'entryCount',count(*)::integer,
   'farmCount',count(DISTINCT e.farm_id)::integer,
   'plotCount',count(DISTINCT e.plot_id)::integer,
   'totalAreaHa',billing_private.decimal_text(coalesce(sum(e.area_ha),0)),
   'completedAreaHa',billing_private.decimal_text(coalesce(sum(e.area_ha) FILTER(WHERE e.status='concluido'),0)),
   'estimatedCost',billing_private.decimal_text(coalesce(sum(e.estimated_cost),0)),
   'actualCost',billing_private.decimal_text(coalesce(sum(e.actual_cost),0)),
   'expectedProductionTons',billing_private.decimal_text(coalesce(sum(e.expected_production_tons),0)),
   'actualProductionTons',billing_private.decimal_text(coalesce(sum(e.actual_production_tons),0))
  ) INTO v_summary
  FROM public.billing_planning_entries e
  JOIN public.billing_farms f ON f.owner_id=e.owner_id AND f.id=e.farm_id
  JOIN public.billing_farm_plots p ON p.owner_id=e.owner_id AND p.farm_id=e.farm_id AND p.id=e.plot_id
  WHERE e.owner_id=v_owner
   AND (v_module IS NULL OR e.module=v_module)
   AND (v_status IS NULL OR e.status=v_status)
   AND (v_date_from IS NULL OR e.planned_end_date>=v_date_from)
   AND (v_date_to IS NULL OR e.planned_start_date<=v_date_to)
   AND (v_search IS NULL OR concat_ws(' ',f.name,p.name,e.activity_type,e.notes) ILIKE '%'||v_search||'%');

  SELECT jsonb_build_object(
   'entryCount',count(*)::integer,
   'farmCount',count(DISTINCT e.farm_id)::integer,
   'plotCount',count(DISTINCT e.plot_id)::integer,
   'totalAreaHa',billing_private.decimal_text(coalesce(sum(e.area_ha),0)),
   'plannedAreaHa',billing_private.decimal_text(coalesce(sum(e.area_ha),0)),
   'completedAreaHa',billing_private.decimal_text(coalesce(sum(e.area_ha) FILTER(WHERE e.status='concluido'),0)),
   'remainingAreaHa',billing_private.decimal_text(greatest(coalesce(sum(e.area_ha),0)-coalesce(sum(e.area_ha) FILTER(WHERE e.status='concluido'),0),0)),
   'completionPercent',billing_private.decimal_text(CASE WHEN coalesce(sum(e.area_ha),0)=0 THEN 0 ELSE coalesce(sum(e.area_ha) FILTER(WHERE e.status='concluido'),0)*100/sum(e.area_ha) END),
   'delayedCount',count(*) FILTER(WHERE e.status NOT IN('concluido','cancelado') AND e.planned_end_date<CURRENT_DATE)::integer,
   'estimatedCost',billing_private.decimal_text(coalesce(sum(e.estimated_cost),0)),
   'actualCost',billing_private.decimal_text(coalesce(sum(e.actual_cost),0)),
   'costPerHa',billing_private.decimal_text(CASE WHEN coalesce(sum(e.area_ha),0)=0 THEN 0 ELSE coalesce(sum(e.actual_cost),0)/sum(e.area_ha) END),
   'expectedProductionTons',billing_private.decimal_text(coalesce(sum(e.expected_production_tons),0)),
   'actualProductionTons',billing_private.decimal_text(coalesce(sum(e.actual_production_tons),0)),
   'yieldTonsPerHa',billing_private.decimal_text(CASE WHEN coalesce(sum(e.area_ha) FILTER(WHERE e.status='concluido'),0)=0 THEN 0 ELSE coalesce(sum(e.actual_production_tons),0)/sum(e.area_ha) FILTER(WHERE e.status='concluido') END)
  ) INTO v_kpis
  FROM public.billing_planning_entries e
  JOIN public.billing_farms f ON f.owner_id=e.owner_id AND f.id=e.farm_id
  JOIN public.billing_farm_plots p ON p.owner_id=e.owner_id AND p.farm_id=e.farm_id AND p.id=e.plot_id
  WHERE e.owner_id=v_owner
   AND (v_module IS NULL OR e.module=v_module)
   AND (v_status IS NULL OR e.status=v_status)
   AND (v_date_from IS NULL OR e.planned_end_date>=v_date_from)
   AND (v_date_to IS NULL OR e.planned_start_date<=v_date_to)
   AND (v_search IS NULL OR concat_ws(' ',f.name,p.name,e.activity_type,e.notes) ILIKE '%'||v_search||'%');

  RETURN jsonb_build_object(
   'farms',v_farms,'groups',v_groups,'entries',v_entries,
   'summary',v_summary,'kpis',v_kpis,
   'filters',jsonb_build_object(
    'module',v_module,'search',coalesce(v_search,''),'dateFrom',v_date_from,
    'dateTo',v_date_to,'status',v_status
   )
  );
 END IF;

 v_id=nullif(p_payload->>'id','')::uuid;
 IF p_action='delete' THEN
  IF v_id IS NULL THEN RAISE EXCEPTION 'Informe o lançamento.' USING ERRCODE='22023'; END IF;
  DELETE FROM public.billing_planning_entries
  WHERE owner_id=v_owner AND id=v_id AND (v_module IS NULL OR module=v_module)
  RETURNING * INTO v_entry;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('id',v_id,'deleted',true);
 END IF;

 IF v_module IS NULL THEN
  RAISE EXCEPTION 'Selecione um submódulo de planejamento válido.' USING ERRCODE='22023';
 END IF;
 v_farm_id=nullif(p_payload->>'farmId','')::uuid;
 v_plot_id=nullif(p_payload->>'plotId','')::uuid;
 v_activity_type=btrim(coalesce(p_payload->>'activityType',''));
 v_status=btrim(coalesce(p_payload->>'status',''));
 v_notes=btrim(coalesce(p_payload->>'notes',''));
 v_area_text=replace(btrim(coalesce(p_payload->>'areaHa','')),',','.');
 v_estimated_cost_text=replace(btrim(coalesce(p_payload->>'estimatedCost','0')),',','.');
 v_actual_cost_text=replace(btrim(coalesce(p_payload->>'actualCost','0')),',','.');
 v_expected_production_text=replace(btrim(coalesce(p_payload->>'expectedProductionTons','0')),',','.');
 v_actual_production_text=replace(btrim(coalesce(p_payload->>'actualProductionTons','0')),',','.');

 IF v_farm_id IS NULL OR v_plot_id IS NULL THEN
  RAISE EXCEPTION 'Selecione a fazenda e o talhão.' USING ERRCODE='22023';
 END IF;
 IF length(v_activity_type) NOT BETWEEN 2 AND 160 THEN
  RAISE EXCEPTION 'Informe uma atividade com 2 a 160 caracteres.' USING ERRCODE='22023';
 END IF;
 IF length(v_notes)>2000 THEN
  RAISE EXCEPTION 'As observações devem ter até 2.000 caracteres.' USING ERRCODE='22023';
 END IF;
 IF v_status NOT IN('planejado','em-andamento','concluido','cancelado') THEN
  RAISE EXCEPTION 'Selecione um status de planejamento válido.' USING ERRCODE='22023';
 END IF;
 IF coalesce(p_payload->>'plannedStartDate','')!~'^\d{4}-\d{2}-\d{2}$'
    OR coalesce(p_payload->>'plannedEndDate','')!~'^\d{4}-\d{2}-\d{2}$' THEN
  RAISE EXCEPTION 'Informe as datas planejadas no formato AAAA-MM-DD.' USING ERRCODE='22023';
 END IF;
 v_planned_start=(p_payload->>'plannedStartDate')::date;
 v_planned_end=(p_payload->>'plannedEndDate')::date;
 IF v_planned_end<v_planned_start THEN
  RAISE EXCEPTION 'A data final planejada não pode ser anterior à data inicial.' USING ERRCODE='22023';
 END IF;
 IF coalesce(p_payload->>'actualDate','')<>'' THEN
  IF (p_payload->>'actualDate')!~'^\d{4}-\d{2}-\d{2}$' THEN
   RAISE EXCEPTION 'Informe a data realizada no formato AAAA-MM-DD.' USING ERRCODE='22023';
  END IF;
  v_actual_date=(p_payload->>'actualDate')::date;
 END IF;
 IF v_area_text!~'^[0-9]{1,9}([.][0-9]{1,6})?$' OR v_area_text::numeric<=0 THEN
  RAISE EXCEPTION 'Informe uma área maior que zero, com até seis casas decimais.' USING ERRCODE='22023';
 END IF;
 IF v_estimated_cost_text!~'^[0-9]{1,12}([.][0-9]{1,6})?$'
    OR v_actual_cost_text!~'^[0-9]{1,12}([.][0-9]{1,6})?$'
    OR v_expected_production_text!~'^[0-9]{1,12}([.][0-9]{1,6})?$'
    OR v_actual_production_text!~'^[0-9]{1,12}([.][0-9]{1,6})?$' THEN
  RAISE EXCEPTION 'Custos e produção devem ser números não negativos com até seis casas decimais.' USING ERRCODE='22023';
 END IF;

 SELECT p.area_ha INTO v_plot_area
 FROM public.billing_farm_plots p
 WHERE p.owner_id=v_owner AND p.farm_id=v_farm_id AND p.id=v_plot_id
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Selecione um talhão válido para esta fazenda.' USING ERRCODE='22023'; END IF;
 IF v_area_text::numeric>v_plot_area THEN
  RAISE EXCEPTION 'A área planejada não pode ultrapassar a área do talhão.' USING ERRCODE='23514';
 END IF;

 IF v_id IS NULL THEN
  INSERT INTO public.billing_planning_entries(
   owner_id,module,farm_id,plot_id,activity_type,planned_start_date,planned_end_date,
   actual_date,area_ha,status,estimated_cost,actual_cost,
   expected_production_tons,actual_production_tons,notes
  ) VALUES(
   v_owner,v_module,v_farm_id,v_plot_id,v_activity_type,v_planned_start,v_planned_end,
   v_actual_date,v_area_text::numeric,v_status,v_estimated_cost_text::numeric,v_actual_cost_text::numeric,
   v_expected_production_text::numeric,v_actual_production_text::numeric,v_notes
  ) RETURNING * INTO v_entry;
 ELSE
  UPDATE public.billing_planning_entries SET
   module=v_module,farm_id=v_farm_id,plot_id=v_plot_id,activity_type=v_activity_type,
   planned_start_date=v_planned_start,planned_end_date=v_planned_end,actual_date=v_actual_date,
   area_ha=v_area_text::numeric,status=v_status,estimated_cost=v_estimated_cost_text::numeric,
   actual_cost=v_actual_cost_text::numeric,expected_production_tons=v_expected_production_text::numeric,
   actual_production_tons=v_actual_production_text::numeric,notes=v_notes
  WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_entry;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE='P0002'; END IF;
 END IF;
 RETURN jsonb_build_object('entry',billing_private.present_planning_entry(v_entry));
EXCEPTION
 WHEN unique_violation THEN
  RAISE EXCEPTION 'Esta atividade já foi planejada para o talhão na mesma janela.' USING ERRCODE='23505';
 WHEN not_null_violation THEN
  RAISE EXCEPTION 'Preencha os campos obrigatórios do planejamento.' USING ERRCODE='22023';
 WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Informe valores, datas e identificadores válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.planning_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.planning_dispatch(text,jsonb) TO authenticated;

COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS
 'Authenticated workspace RPC. Planning exposes soil preparation, planting, crop management and harvest operations with server-filtered KPIs.';
