-- Daily field entries remain the source for period reports. Existing records
-- keep their identifiers, quantities, capacity locks and audit trail.
ALTER TABLE public.billing_planning_executions
 ADD COLUMN crew_name text NOT NULL DEFAULT '' CHECK(length(crew_name)<=100 AND (crew_name='' OR length(crew_name)>=2)),
 ADD COLUMN lot_reference text NOT NULL DEFAULT '' CHECK(length(lot_reference)<=100),
 ADD COLUMN responsible_name text NOT NULL DEFAULT '' CHECK(length(responsible_name)<=120),
 ADD COLUMN season text NOT NULL DEFAULT '' CHECK(length(season)<=80),
 ADD COLUMN work_mode text NOT NULL DEFAULT '' CHECK(work_mode IN('','manual','mecanizado','semimecanizado')),
 ADD COLUMN execution_structure text NOT NULL DEFAULT '' CHECK(execution_structure IN('','propria','terceirizada'));
COMMENT ON COLUMN public.billing_planning_executions.lot_reference IS 'User-supplied lot reference on the daily entry. Does not infer plot hierarchy or inventory movements.';
COMMENT ON COLUMN public.billing_planning_executions.season IS 'Cycle reported for this execution; an empty legacy value is unclassified and must not be inferred from a report date.';

CREATE OR REPLACE FUNCTION billing_private.present_planning_execution(p_execution public.billing_planning_executions)
RETURNS jsonb LANGUAGE sql STABLE STRICT SET search_path='' AS $$
 SELECT jsonb_build_object('id',p_execution.id,'entryId',p_execution.entry_id,'activityType',e.activity_type,
  'module',e.module,'farmId',e.farm_id,'plotId',e.plot_id,'farmName',f.name,'plotName',p.name,
  'crewName',p_execution.crew_name,'lotReference',p_execution.lot_reference,'responsibleName',p_execution.responsible_name,
  'season',p_execution.season,'workMode',p_execution.work_mode,'executionStructure',p_execution.execution_structure,'performedOn',p_execution.performed_on,
  'areaHa',billing_private.decimal_text(p_execution.area_ha),'productionTons',billing_private.decimal_text(p_execution.production_tons),
  'cost',billing_private.decimal_text(p_execution.cost),'notes',p_execution.notes,
  'voidedAt',p_execution.voided_at,'voidReason',p_execution.void_reason,'createdAt',p_execution.created_at,
  'createdBy',p_execution.created_by,'voidedBy',p_execution.voided_by)
 FROM public.billing_planning_entries e
 JOIN public.billing_farms f ON f.owner_id=e.owner_id AND f.id=e.farm_id
 JOIN public.billing_farm_plots p ON p.owner_id=e.owner_id AND p.farm_id=e.farm_id AND p.id=e.plot_id
 WHERE e.owner_id=p_execution.owner_id AND e.id=p_execution.entry_id
$$;

CREATE OR REPLACE FUNCTION billing_private.planning_executions_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_actor uuid:=auth.uid();v_id uuid;v_entry_id uuid;v_request uuid;
 v_entry public.billing_planning_entries%ROWTYPE;v_execution public.billing_planning_executions%ROWTYPE;
 v_date date;v_from date;v_to date;v_module text;v_search text;v_notes text;v_reason text;
 v_area numeric;v_tons numeric;v_cost numeric;v_used numeric;v_plot_area numeric;
 v_executions jsonb;v_entries jsonb;v_summary jsonb;v_groups jsonb;
 v_farm uuid;v_plot uuid;v_crew text;v_lot text;v_responsible text;v_season text;v_mode text;v_structure text;v_key text;
BEGIN
 IF v_actor IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar os apontamentos.' USING ERRCODE='28000'; END IF;
 IF p_action IS NULL OR p_action NOT IN('list','save','void') THEN
  RAISE EXCEPTION 'Operação de apontamentos inválida.' USING ERRCODE='22023';
 END IF;
 PERFORM billing_private.authorize('registrations.'||CASE WHEN p_action='list' THEN 'read' ELSE 'write' END);
 PERFORM billing_private.planning_assert_payload(p_payload,CASE p_action
  WHEN 'list' THEN ARRAY['entryId','search','dateFrom','dateTo','module','farmId','plotId','crewName','lotReference','season','workMode','executionStructure']
  WHEN 'void' THEN ARRAY['id','reason']
  ELSE ARRAY['entryId','performedOn','areaHa','productionTons','cost','notes','requestId','crewName','lotReference','responsibleName','season','workMode','executionStructure'] END);
 v_entry_id=nullif(p_payload->>'entryId','')::uuid;
 FOREACH v_key IN ARRAY ARRAY['crewName','lotReference','responsibleName','season','workMode','executionStructure'] LOOP
  IF p_payload ? v_key AND jsonb_typeof(p_payload->v_key) IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Informe texto válido para %.',v_key USING ERRCODE='22023';
  END IF;
 END LOOP;
 v_crew=btrim(coalesce(p_payload->>'crewName',''));v_lot=btrim(coalesce(p_payload->>'lotReference',''));
 v_responsible=btrim(coalesce(p_payload->>'responsibleName',''));v_season=btrim(coalesce(p_payload->>'season',''));
 v_mode=btrim(coalesce(p_payload->>'workMode',''));v_structure=btrim(coalesce(p_payload->>'executionStructure',''));
 IF length(v_crew)>100 OR length(v_lot)>100 OR length(v_responsible)>120 OR length(v_season)>80
  OR (p_action='save' AND p_payload ? 'crewName' AND length(v_crew)<2) THEN
  RAISE EXCEPTION 'Confira turma (2 a 100 caracteres), lote (até 100), responsável (até 120) e safra (até 80).' USING ERRCODE='22023';
 END IF;
 IF v_mode NOT IN('','manual','mecanizado','semimecanizado') OR v_structure NOT IN('','propria','terceirizada') THEN
  RAISE EXCEPTION 'Selecione modalidade e estrutura válidas.' USING ERRCODE='22023';
 END IF;
 IF p_action='list' THEN
  v_module=nullif(btrim(p_payload->>'module'),'');v_search=nullif(btrim(p_payload->>'search'),'');
  IF v_module IS NOT NULL AND v_module NOT IN('preparacao-de-solo','plantio','manejo-do-canavial','colheita') THEN
   RAISE EXCEPTION 'Selecione um módulo válido.' USING ERRCODE='22023';
  END IF;
  IF length(v_search)>160 THEN RAISE EXCEPTION 'A busca deve ter até 160 caracteres.' USING ERRCODE='22023'; END IF;
  v_from=billing_private.planning_date(p_payload->>'dateFrom');v_to=billing_private.planning_date(p_payload->>'dateTo');
  IF v_to<v_from THEN RAISE EXCEPTION 'A data final não pode ser anterior à inicial.' USING ERRCODE='22023'; END IF;
  v_farm=nullif(p_payload->>'farmId','')::uuid;v_plot=nullif(p_payload->>'plotId','')::uuid;
  -- A single SQL snapshot feeds detail, totals and report groups. The planning
  -- goal links are deliberately absent: one execution can serve many goals.
  WITH filtered AS MATERIALIZED (
   SELECT x AS execution,e.module,e.activity_type FROM public.billing_planning_executions x
   JOIN public.billing_planning_entries e ON e.owner_id=x.owner_id AND e.id=x.entry_id
   JOIN public.billing_farms f ON f.owner_id=e.owner_id AND f.id=e.farm_id
   JOIN public.billing_farm_plots p ON p.owner_id=e.owner_id AND p.farm_id=e.farm_id AND p.id=e.plot_id
   WHERE x.owner_id=v_owner AND (v_entry_id IS NULL OR x.entry_id=v_entry_id)
    AND (v_module IS NULL OR e.module=v_module) AND (v_from IS NULL OR x.performed_on>=v_from) AND (v_to IS NULL OR x.performed_on<=v_to)
    AND (v_farm IS NULL OR e.farm_id=v_farm) AND (v_plot IS NULL OR e.plot_id=v_plot)
    AND (v_crew='' OR x.crew_name ILIKE '%'||v_crew||'%') AND (v_lot='' OR x.lot_reference ILIKE '%'||v_lot||'%')
    AND (v_season='' OR x.season ILIKE '%'||v_season||'%') AND (v_mode='' OR x.work_mode=v_mode)
    AND (v_structure='' OR x.execution_structure=v_structure)
    AND (v_search IS NULL OR concat_ws(' ',e.activity_type,f.name,p.name,x.notes,x.crew_name,x.lot_reference,x.responsible_name,x.season) ILIKE '%'||v_search||'%')
  ), grouped AS (
   SELECT module,activity_type,(execution).season AS season,(execution).crew_name AS crew_name,
    (execution).work_mode AS work_mode,(execution).execution_structure AS execution_structure,
    count(*)::integer AS execution_count,sum((execution).area_ha) AS area_ha,
    sum((execution).production_tons) AS production_tons,sum((execution).cost) AS cost
   FROM filtered WHERE (execution).voided_at IS NULL
   GROUP BY module,activity_type,(execution).season,(execution).crew_name,(execution).work_mode,(execution).execution_structure
  )
  SELECT
   (SELECT coalesce(jsonb_agg(billing_private.present_planning_execution(execution) ORDER BY (execution).performed_on DESC,(execution).created_at DESC,(execution).id),'[]'::jsonb) FROM filtered),
   (SELECT jsonb_build_object('executionCount',count(*) FILTER(WHERE (execution).voided_at IS NULL)::integer,
    'areaHa',billing_private.decimal_text(coalesce(sum((execution).area_ha) FILTER(WHERE (execution).voided_at IS NULL),0)),
    'productionTons',billing_private.decimal_text(coalesce(sum((execution).production_tons) FILTER(WHERE (execution).voided_at IS NULL),0)),
    'cost',billing_private.decimal_text(coalesce(sum((execution).cost) FILTER(WHERE (execution).voided_at IS NULL),0))) FROM filtered),
   (SELECT coalesce(jsonb_agg(jsonb_build_object('module',module,'activityType',activity_type,'season',season,'crewName',crew_name,
    'workMode',work_mode,'executionStructure',execution_structure,'executionCount',execution_count,
    'areaHa',billing_private.decimal_text(area_ha),'productionTons',billing_private.decimal_text(production_tons),'cost',billing_private.decimal_text(cost))
    ORDER BY module,activity_type,season,crew_name,work_mode,execution_structure),'[]'::jsonb) FROM grouped)
  INTO v_executions,v_summary,v_groups;
  SELECT coalesce(jsonb_agg(billing_private.present_planning_entry(e) ORDER BY e.planned_start_date DESC,e.activity_type,e.id),'[]'::jsonb)
  INTO v_entries FROM public.billing_planning_entries e WHERE owner_id=v_owner;
  RETURN jsonb_build_object('executions',v_executions,'entries',v_entries,'summary',v_summary,'groups',v_groups,'canWrite',billing_private.has_permission('registrations.write'));
 END IF;
 IF p_action='void' THEN
  v_id=nullif(p_payload->>'id','')::uuid;v_reason=btrim(coalesce(p_payload->>'reason',''));
  IF v_id IS NULL OR length(v_reason) NOT BETWEEN 3 AND 500 THEN
   RAISE EXCEPTION 'Informe o apontamento e um motivo da anulação com 3 a 500 caracteres.' USING ERRCODE='22023';
  END IF;
  SELECT entry_id INTO v_entry_id FROM public.billing_planning_executions WHERE owner_id=v_owner AND id=v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Apontamento não encontrado.' USING ERRCODE='P0002'; END IF;
  PERFORM 1 FROM public.billing_planning_entries WHERE owner_id=v_owner AND id=v_entry_id FOR UPDATE;
  SELECT * INTO v_execution FROM public.billing_planning_executions WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
  IF v_execution.voided_at IS NOT NULL THEN
   IF v_execution.void_reason<>v_reason THEN
    RAISE EXCEPTION 'O apontamento já foi anulado. O motivo registrado deve ser preservado.' USING ERRCODE='23514';
   END IF;
   RETURN jsonb_build_object('execution',billing_private.present_planning_execution(v_execution));
  END IF;
  UPDATE public.billing_planning_executions SET voided_at=now(),voided_by=v_actor,void_reason=v_reason
   WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_execution;
  PERFORM billing_private.refresh_planning_execution_totals(v_owner,v_entry_id);
  RETURN jsonb_build_object('execution',billing_private.present_planning_execution(v_execution));
 END IF;

 v_request=nullif(p_payload->>'requestId','')::uuid;
 IF v_entry_id IS NULL OR v_request IS NULL THEN
  RAISE EXCEPTION 'Informe a atividade e a identificação da solicitação.' USING ERRCODE='22023';
 END IF;
 v_date=billing_private.planning_date(p_payload->>'performedOn',true);
 v_area=billing_private.planning_number(p_payload->>'areaHa','Área realizada',true);
 v_tons=billing_private.planning_number(coalesce(p_payload->>'productionTons','0'),'Produção');
 v_cost=billing_private.planning_number(coalesce(p_payload->>'cost','0'),'Custo');
 v_notes=btrim(coalesce(p_payload->>'notes',''));
 IF v_area>=1000000000 OR length(v_notes)>2000 THEN
  RAISE EXCEPTION 'Confira a área realizada e as observações (até 2.000 caracteres).' USING ERRCODE='22023';
 END IF;
 -- Serialize retries independently from the selected entry. Reusing a request
 -- identifier with a different payload is an error, never a second write.
 PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text||':planning-execution:'||v_request::text,0));
 SELECT * INTO v_execution FROM public.billing_planning_executions WHERE owner_id=v_owner AND request_id=v_request;
 IF FOUND THEN
  IF ROW(v_execution.entry_id,v_execution.performed_on,v_execution.area_ha,v_execution.production_tons,v_execution.cost,v_execution.notes,v_execution.crew_name,v_execution.lot_reference,v_execution.responsible_name,v_execution.season,v_execution.work_mode,v_execution.execution_structure)
     IS DISTINCT FROM ROW(v_entry_id,v_date,v_area,v_tons,v_cost,v_notes,v_crew,v_lot,v_responsible,v_season,v_mode,v_structure) THEN
   RAISE EXCEPTION 'A solicitação já foi utilizada com outros dados. Atualize antes de tentar novamente.' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('execution',billing_private.present_planning_execution(v_execution));
 END IF;
 SELECT * INTO v_entry FROM public.billing_planning_entries WHERE owner_id=v_owner AND id=v_entry_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Atividade não encontrada.' USING ERRCODE='P0002'; END IF;
 IF v_entry.status='cancelado' THEN RAISE EXCEPTION 'Atividades canceladas não recebem novos apontamentos.' USING ERRCODE='23514'; END IF;
 SELECT area_ha INTO v_plot_area FROM public.billing_farm_plots
  WHERE owner_id=v_owner AND farm_id=v_entry.farm_id AND id=v_entry.plot_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Talhão da atividade não encontrado.' USING ERRCODE='P0002'; END IF;
 SELECT coalesce(sum(area_ha),0) INTO v_used FROM public.billing_planning_executions
  WHERE owner_id=v_owner AND entry_id=v_entry_id AND voided_at IS NULL;
 IF v_used+v_area>v_entry.area_ha OR v_used+v_area>v_plot_area THEN
  RAISE EXCEPTION 'A área apontada ultrapassa o saldo da atividade ou a capacidade do talhão.' USING ERRCODE='23514';
 END IF;
 IF NOT v_entry.actuals_from_executions THEN
  UPDATE public.billing_planning_entries SET actuals_from_executions=true,legacy_actual_cost=actual_cost,
   legacy_actual_production_tons=actual_production_tons,legacy_actual_date=actual_date,legacy_status=status
  WHERE owner_id=v_owner AND id=v_entry_id;
 END IF;
 INSERT INTO public.billing_planning_executions(owner_id,entry_id,request_id,performed_on,area_ha,production_tons,cost,notes,created_by,crew_name,lot_reference,responsible_name,season,work_mode,execution_structure)
 VALUES(v_owner,v_entry_id,v_request,v_date,v_area,v_tons,v_cost,v_notes,v_actor,v_crew,v_lot,v_responsible,v_season,v_mode,v_structure) RETURNING * INTO v_execution;
 PERFORM billing_private.refresh_planning_execution_totals(v_owner,v_entry_id);
 RETURN jsonb_build_object('execution',billing_private.present_planning_execution(v_execution));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'Informe valores e identificadores válidos.' USING ERRCODE='22023';
END $$;

REVOKE ALL ON FUNCTION billing_private.planning_executions_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.planning_executions_dispatch(text,jsonb) TO authenticated;
-- No wrapper replacement, new resource or DML grant is needed: billing_rpc
-- already dispatches this resource and the existing owner RLS remains active.
