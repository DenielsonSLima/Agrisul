-- Independent management periods, many-to-many goal links and an append-only
-- execution ledger. Existing actuals are kept as a separately identified baseline;
-- no hectares or dated executions are invented from a legacy completion status.
ALTER TABLE public.billing_planning_entries
 ADD COLUMN actuals_from_executions boolean NOT NULL DEFAULT false,
 ADD COLUMN legacy_actual_cost numeric(18,6),
 ADD COLUMN legacy_actual_production_tons numeric(18,6),
 ADD COLUMN legacy_actual_date date,
 ADD COLUMN legacy_status text;

CREATE TABLE public.billing_planning_goals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 2 AND 160),
 module text NOT NULL CHECK(module IN('preparacao-de-solo','plantio','manejo-do-canavial','colheita')),
 period_type text NOT NULL CHECK(period_type IN('diario','semanal','quinzenal','mensal','bimestral','trimestral','semestral','anual','safra','personalizado')),
 start_date date NOT NULL,
 end_date date NOT NULL CHECK(end_date>=start_date),
 target_quantity numeric(18,6) NOT NULL CHECK(target_quantity>=0 AND target_quantity<1000000000000),
 unit text NOT NULL CHECK(unit IN('ha','t')),
 season text NOT NULL DEFAULT '' CHECK(length(season)<=80),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 status text NOT NULL DEFAULT 'ativo' CHECK(status IN('ativo','cancelado')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id)
);
CREATE TABLE public.billing_planning_goal_entries (
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 goal_id uuid NOT NULL,
 entry_id uuid NOT NULL,
 PRIMARY KEY(owner_id,goal_id,entry_id),
 FOREIGN KEY(owner_id,goal_id) REFERENCES public.billing_planning_goals(owner_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,entry_id) REFERENCES public.billing_planning_entries(owner_id,id) ON DELETE NO ACTION
);
CREATE TABLE public.billing_planning_goal_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 goal_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,goal_id,revision),
 FOREIGN KEY(owner_id,goal_id) REFERENCES public.billing_planning_goals(owner_id,id) ON DELETE CASCADE
);
CREATE TABLE public.billing_planning_executions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 entry_id uuid NOT NULL,
 request_id uuid NOT NULL,
 performed_on date NOT NULL,
 area_ha numeric(15,6) NOT NULL CHECK(area_ha>0 AND area_ha<1000000000),
 production_tons numeric(18,6) NOT NULL CHECK(production_tons>=0 AND production_tons<1000000000000),
 cost numeric(18,6) NOT NULL CHECK(cost>=0 AND cost<1000000000000),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 voided_at timestamptz,
 voided_by uuid,
 void_reason text NOT NULL DEFAULT '',
 CHECK((voided_at IS NULL AND voided_by IS NULL AND void_reason='') OR
       (voided_at IS NOT NULL AND voided_by IS NOT NULL AND length(btrim(void_reason)) BETWEEN 3 AND 500)),
 UNIQUE(owner_id,id),
 UNIQUE(owner_id,request_id),
 FOREIGN KEY(owner_id,entry_id) REFERENCES public.billing_planning_entries(owner_id,id) ON DELETE NO ACTION
);
CREATE INDEX billing_planning_goals_filter ON public.billing_planning_goals(owner_id,module,start_date,end_date,status);
CREATE INDEX billing_planning_goal_entries_entry ON public.billing_planning_goal_entries(owner_id,entry_id);
CREATE INDEX billing_planning_executions_period ON public.billing_planning_executions(owner_id,performed_on,entry_id);
CREATE INDEX billing_planning_executions_entry ON public.billing_planning_executions(owner_id,entry_id,performed_on) WHERE voided_at IS NULL;

DO $$ DECLARE v_table text; BEGIN
 FOREACH v_table IN ARRAY ARRAY['billing_planning_goals','billing_planning_goal_entries','billing_planning_goal_revisions','billing_planning_executions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',v_table);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',v_table);
  EXECUTE format('CREATE POLICY billing_owner_read ON public.%I FOR SELECT TO authenticated USING(billing_private.can_access_owner(owner_id,''registrations.read''))',v_table);
  EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL',v_table);
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND
     NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=v_table) THEN
   EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',v_table);
  END IF;
 END LOOP;
END $$;
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_planning_goals
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();

CREATE FUNCTION billing_private.planning_assert_payload(p_payload jsonb,p_fields text[]) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
  RAISE EXCEPTION 'Informe um objeto de dados válido.' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT(k=ANY(p_fields))) THEN
  RAISE EXCEPTION 'A operação recebeu campos não reconhecidos.' USING ERRCODE='22023';
 END IF;
END $$;
CREATE FUNCTION billing_private.planning_number(p_value text,p_label text,p_positive boolean DEFAULT false) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ DECLARE v text:=replace(btrim(coalesce(p_value,'')),',','.'); BEGIN
 IF v!~'^[0-9]{1,12}([.][0-9]{1,6})?$' THEN
  RAISE EXCEPTION '%: informe um número não negativo com até seis casas decimais.',p_label USING ERRCODE='22023';
 END IF;
 IF p_positive AND v::numeric<=0 THEN
  RAISE EXCEPTION '% deve ser maior que zero.',p_label USING ERRCODE='22023';
 END IF;
 RETURN v::numeric;
END $$;
CREATE FUNCTION billing_private.planning_date(p_value text,p_required boolean DEFAULT false) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 IF coalesce(p_value,'')='' AND NOT p_required THEN RETURN NULL; END IF;
 IF coalesce(p_value,'')!~'^\d{4}-\d{2}-\d{2}$' THEN
  RAISE EXCEPTION 'Informe datas válidas no formato AAAA-MM-DD.' USING ERRCODE='22023';
 END IF;
 RETURN p_value::date;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
 RAISE EXCEPTION 'Informe uma data válida no calendário.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.planning_assert_payload(jsonb,text[]),billing_private.planning_number(text,text,boolean),billing_private.planning_date(text,boolean) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.present_planning_entry(public.billing_planning_entries) RENAME TO present_planning_entry_before_executions;
CREATE FUNCTION billing_private.present_planning_entry(p_entry public.billing_planning_entries)
RETURNS jsonb LANGUAGE sql STABLE STRICT SET search_path='' AS $$
 SELECT billing_private.present_planning_entry_before_executions(p_entry)||jsonb_build_object(
  'executedAreaHa',billing_private.decimal_text(x.area_ha),
  'remainingAreaHa',billing_private.decimal_text(greatest(p_entry.area_ha-x.area_ha,0)),
  'executionCount',x.execution_count,
  'goalCount',(SELECT count(*)::integer FROM public.billing_planning_goal_entries WHERE owner_id=p_entry.owner_id AND entry_id=p_entry.id),
  'actualsFromExecutions',p_entry.actuals_from_executions,
  'legacyActualCost',billing_private.decimal_text(CASE WHEN p_entry.actuals_from_executions THEN p_entry.legacy_actual_cost ELSE p_entry.actual_cost END),
  'legacyActualProductionTons',billing_private.decimal_text(CASE WHEN p_entry.actuals_from_executions THEN p_entry.legacy_actual_production_tons ELSE p_entry.actual_production_tons END),
  'legacyActualDate',CASE WHEN p_entry.actuals_from_executions THEN p_entry.legacy_actual_date ELSE p_entry.actual_date END
 ) FROM (
  SELECT coalesce(sum(area_ha),0) area_ha,count(*)::integer execution_count
  FROM public.billing_planning_executions WHERE owner_id=p_entry.owner_id AND entry_id=p_entry.id AND voided_at IS NULL
 ) x
$$;
REVOKE ALL ON FUNCTION billing_private.present_planning_entry(public.billing_planning_entries) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.planning_goal_definition(p_goal public.billing_planning_goals)
RETURNS jsonb LANGUAGE sql STABLE STRICT SET search_path='' AS $$
 SELECT jsonb_build_object('title',p_goal.title,'module',p_goal.module,'periodType',p_goal.period_type,
  'startDate',p_goal.start_date,'endDate',p_goal.end_date,'targetQuantity',billing_private.decimal_text(p_goal.target_quantity),
  'unit',p_goal.unit,'season',p_goal.season,'notes',p_goal.notes,'status',p_goal.status,
  'entryIds',coalesce((SELECT jsonb_agg(entry_id ORDER BY entry_id) FROM public.billing_planning_goal_entries
   WHERE owner_id=p_goal.owner_id AND goal_id=p_goal.id),'[]'::jsonb))
$$;
CREATE FUNCTION billing_private.present_planning_goal(p_goal public.billing_planning_goals)
RETURNS jsonb LANGUAGE sql STABLE STRICT SET search_path='' AS $$
 SELECT billing_private.planning_goal_definition(p_goal)||jsonb_build_object(
  'id',p_goal.id,'revision',p_goal.revision,'createdAt',p_goal.created_at,'updatedAt',p_goal.updated_at,
  'actualQuantity',billing_private.decimal_text(x.actual),
  'remainingQuantity',billing_private.decimal_text(greatest(p_goal.target_quantity-x.actual,0)),
  'differenceQuantity',billing_private.decimal_text(x.actual-p_goal.target_quantity),
  'completionPercent',CASE WHEN p_goal.target_quantity=0 THEN NULL ELSE billing_private.decimal_text(round(x.actual*100/p_goal.target_quantity,6)) END,
  'entryCount',(SELECT count(*)::integer FROM public.billing_planning_goal_entries WHERE owner_id=p_goal.owner_id AND goal_id=p_goal.id)
 ) FROM (
  SELECT coalesce(sum(CASE WHEN p_goal.unit='ha' THEN e.area_ha ELSE e.production_tons END),0) actual
  FROM public.billing_planning_goal_entries l
  JOIN public.billing_planning_executions e ON e.owner_id=l.owner_id AND e.entry_id=l.entry_id
  WHERE l.owner_id=p_goal.owner_id AND l.goal_id=p_goal.id AND e.voided_at IS NULL
   AND e.performed_on BETWEEN p_goal.start_date AND p_goal.end_date
 ) x
$$;
CREATE FUNCTION billing_private.present_planning_execution(p_execution public.billing_planning_executions)
RETURNS jsonb LANGUAGE sql STABLE STRICT SET search_path='' AS $$
 SELECT jsonb_build_object('id',p_execution.id,'entryId',p_execution.entry_id,'activityType',e.activity_type,
  'module',e.module,'farmName',f.name,'plotName',p.name,'performedOn',p_execution.performed_on,
  'areaHa',billing_private.decimal_text(p_execution.area_ha),'productionTons',billing_private.decimal_text(p_execution.production_tons),
  'cost',billing_private.decimal_text(p_execution.cost),'notes',p_execution.notes,
  'voidedAt',p_execution.voided_at,'voidReason',p_execution.void_reason,'createdAt',p_execution.created_at,
  'createdBy',p_execution.created_by,'voidedBy',p_execution.voided_by)
 FROM public.billing_planning_entries e
 JOIN public.billing_farms f ON f.owner_id=e.owner_id AND f.id=e.farm_id
 JOIN public.billing_farm_plots p ON p.owner_id=e.owner_id AND p.farm_id=e.farm_id AND p.id=e.plot_id
 WHERE e.owner_id=p_execution.owner_id AND e.id=p_execution.entry_id
$$;
REVOKE ALL ON FUNCTION billing_private.planning_goal_definition(public.billing_planning_goals),billing_private.present_planning_goal(public.billing_planning_goals),billing_private.present_planning_execution(public.billing_planning_executions) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.refresh_planning_execution_totals(p_owner uuid,p_entry_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_area numeric;v_cost numeric;v_tons numeric;v_count integer;v_date date; BEGIN
 SELECT coalesce(sum(area_ha),0),coalesce(sum(cost),0),coalesce(sum(production_tons),0),count(*)::integer,max(performed_on)
 INTO v_area,v_cost,v_tons,v_count,v_date FROM public.billing_planning_executions
 WHERE owner_id=p_owner AND entry_id=p_entry_id AND voided_at IS NULL;
 UPDATE public.billing_planning_entries SET
  actual_cost=legacy_actual_cost+v_cost,actual_production_tons=legacy_actual_production_tons+v_tons,
  actual_date=greatest(legacy_actual_date,v_date),
  status=CASE WHEN v_count=0 THEN legacy_status WHEN v_area>=area_ha THEN 'concluido' ELSE 'em-andamento' END
 WHERE owner_id=p_owner AND id=p_entry_id AND actuals_from_executions;
END $$;
REVOKE ALL ON FUNCTION billing_private.refresh_planning_execution_totals(uuid,uuid) FROM PUBLIC,anon,authenticated;

-- Shrinking a plot must not invalidate a plan/execution saved under its lock.
CREATE FUNCTION billing_private.guard_planning_plot_capacity() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF NEW.area_ha<OLD.area_ha AND EXISTS(SELECT 1 FROM public.billing_planning_entries
   WHERE owner_id=NEW.owner_id AND plot_id=NEW.id AND area_ha>NEW.area_ha) THEN
  RAISE EXCEPTION 'A área do talhão não pode ficar abaixo de uma atividade planejada.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION billing_private.guard_planning_plot_capacity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER billing_planning_plot_capacity BEFORE UPDATE OF area_ha ON public.billing_farm_plots
 FOR EACH ROW EXECUTE FUNCTION billing_private.guard_planning_plot_capacity();

ALTER FUNCTION billing_private.planning_dispatch(text,jsonb) RENAME TO planning_dispatch_before_executions;
REVOKE ALL ON FUNCTION billing_private.planning_dispatch_before_executions(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.planning_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();v_id uuid;v_entry public.billing_planning_entries%ROWTYPE;
 v_result jsonb;v_payload jsonb:=p_payload;v_completed numeric;v_executed numeric;v_total numeric;v_count integer;v_yield_tons numeric;
BEGIN
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o planejamento.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize('registrations.'||CASE WHEN p_action='list' THEN 'read' ELSE 'write' END);
 IF p_action IN('save','delete') AND jsonb_typeof(p_payload)='object' THEN
  v_id=nullif(p_payload->>'id','')::uuid;
  IF v_id IS NOT NULL THEN
   SELECT * INTO v_entry FROM public.billing_planning_entries WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Atividade não encontrada.' USING ERRCODE='P0002'; END IF;
   IF EXISTS(SELECT 1 FROM public.billing_planning_executions WHERE owner_id=v_owner AND entry_id=v_id)
      OR EXISTS(SELECT 1 FROM public.billing_planning_goal_entries WHERE owner_id=v_owner AND entry_id=v_id) THEN
    IF p_action='delete' THEN
     RAISE EXCEPTION 'A atividade possui metas vinculadas ou histórico de apontamentos e não pode ser excluída.' USING ERRCODE='23503';
    END IF;
    IF ROW(p_payload->>'module',nullif(p_payload->>'farmId','')::uuid,nullif(p_payload->>'plotId','')::uuid,btrim(p_payload->>'activityType'))
       IS DISTINCT FROM ROW(v_entry.module,v_entry.farm_id,v_entry.plot_id,v_entry.activity_type) THEN
     RAISE EXCEPTION 'Preserve o módulo, fazenda, talhão e atividade dos registros vinculados.' USING ERRCODE='23514';
    END IF;
   END IF;
   IF v_entry.actuals_from_executions AND p_action='save' THEN
    IF p_payload ?| ARRAY['status','actualDate','actualCost','actualProductionTons'] THEN
     RAISE EXCEPTION 'Status e valores realizados são calculados pelos apontamentos; omita estes campos.' USING ERRCODE='22023';
    END IF;
    SELECT coalesce(sum(area_ha),0) INTO v_executed FROM public.billing_planning_executions
     WHERE owner_id=v_owner AND entry_id=v_id AND voided_at IS NULL;
    IF billing_private.planning_number(p_payload->>'areaHa','Área planejada',true)<v_executed THEN
     RAISE EXCEPTION 'A área planejada não pode ficar abaixo da área já apontada.' USING ERRCODE='23514';
    END IF;
    v_payload=p_payload||jsonb_build_object('status',v_entry.status,'actualDate',v_entry.actual_date,
     'actualCost',billing_private.decimal_text(v_entry.actual_cost),'actualProductionTons',billing_private.decimal_text(v_entry.actual_production_tons));
   END IF;
  END IF;
 END IF;
 v_result=billing_private.planning_dispatch_before_executions(p_action,v_payload);
 IF p_action='save' AND v_entry.actuals_from_executions THEN
  PERFORM billing_private.refresh_planning_execution_totals(v_owner,v_id);
  SELECT * INTO v_entry FROM public.billing_planning_entries WHERE owner_id=v_owner AND id=v_id;
  RETURN jsonb_build_object('entry',billing_private.present_planning_entry(v_entry));
 END IF;
 IF p_action='list' THEN
  -- Keep the former status KPI for untouched legacy records. Once a record uses
  -- the ledger, partial measured area replaces the old all-or-nothing status KPI.
  SELECT coalesce(sum(CASE WHEN (e->>'actualsFromExecutions')::boolean THEN (e->>'executedAreaHa')::numeric
    WHEN e->>'status'='concluido' THEN (e->>'areaHa')::numeric ELSE 0 END),0),
   coalesce(sum((e->>'executedAreaHa')::numeric),0),coalesce(sum((e->>'areaHa')::numeric),0),
   coalesce(sum((e->>'executionCount')::integer),0)::integer,
   coalesce(sum(CASE WHEN (e->>'actualsFromExecutions')::boolean
    THEN (e->>'actualProductionTons')::numeric-(e->>'legacyActualProductionTons')::numeric
    ELSE (e->>'actualProductionTons')::numeric END),0)
  INTO v_completed,v_executed,v_total,v_count,v_yield_tons FROM jsonb_array_elements(v_result->'entries') e;
  v_result=jsonb_set(v_result,'{summary}',(v_result->'summary')||jsonb_build_object(
   'completedAreaHa',billing_private.decimal_text(v_completed),'executedAreaHa',billing_private.decimal_text(v_executed),'executionCount',v_count));
  v_result=jsonb_set(v_result,'{kpis}',(v_result->'kpis')||jsonb_build_object(
   'completedAreaHa',billing_private.decimal_text(v_completed),'executedAreaHa',billing_private.decimal_text(v_executed),'executionCount',v_count,
   'remainingAreaHa',billing_private.decimal_text(greatest(v_total-v_completed,0)),
   'completionPercent',billing_private.decimal_text(CASE WHEN v_total=0 THEN 0 ELSE v_completed*100/v_total END),
   'yieldTonsPerHa',billing_private.decimal_text(CASE WHEN v_completed=0 THEN 0 ELSE v_yield_tons/v_completed END)));
  RETURN v_result||jsonb_build_object('canWrite',billing_private.has_permission('registrations.write'));
 END IF;
 RETURN v_result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'Informe valores e identificadores válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.planning_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.planning_dispatch(text,jsonb) TO authenticated;

CREATE FUNCTION billing_private.planning_goals_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_actor uuid:=auth.uid();v_id uuid;v_goal public.billing_planning_goals%ROWTYPE;
 v_module text;v_period text;v_status text;v_search text;v_from date;v_to date;v_title text;v_unit text;
 v_season text;v_notes text;v_reason text;v_target numeric;v_expected integer;v_ids uuid[];v_revision integer;
 v_goals jsonb;v_entries jsonb;v_revisions jsonb;v_snapshot jsonb;
BEGIN
 IF v_actor IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar as metas.' USING ERRCODE='28000'; END IF;
 IF p_action IS NULL OR p_action NOT IN('list','save','delete','history') THEN
  RAISE EXCEPTION 'Operação de metas inválida.' USING ERRCODE='22023';
 END IF;
 PERFORM billing_private.authorize('registrations.'||CASE WHEN p_action IN('list','history') THEN 'read' ELSE 'write' END);
 PERFORM billing_private.planning_assert_payload(p_payload,CASE p_action
  WHEN 'list' THEN ARRAY['search','dateFrom','dateTo','periodType','module','status']
  WHEN 'history' THEN ARRAY['id']
  WHEN 'delete' THEN ARRAY['id','expectedRevision']
  ELSE ARRAY['id','title','module','periodType','startDate','endDate','targetQuantity','unit','season','notes','status','entryIds','expectedRevision','revisionReason'] END);
 v_module=nullif(btrim(p_payload->>'module'),'');v_period=nullif(btrim(p_payload->>'periodType'),'');v_status=nullif(btrim(p_payload->>'status'),'');
 IF v_module IS NOT NULL AND v_module NOT IN('preparacao-de-solo','plantio','manejo-do-canavial','colheita') THEN
  RAISE EXCEPTION 'Selecione um módulo de planejamento válido.' USING ERRCODE='22023';
 END IF;
 IF v_period IS NOT NULL AND v_period NOT IN('diario','semanal','quinzenal','mensal','bimestral','trimestral','semestral','anual','safra','personalizado') THEN
  RAISE EXCEPTION 'Selecione um tipo de período válido.' USING ERRCODE='22023';
 END IF;
 IF v_status IS NOT NULL AND v_status NOT IN('ativo','cancelado') THEN
  RAISE EXCEPTION 'Selecione um status de meta válido.' USING ERRCODE='22023';
 END IF;
 IF p_action='list' THEN
  v_search=nullif(btrim(p_payload->>'search'),'');
  IF length(v_search)>160 THEN RAISE EXCEPTION 'A busca deve ter até 160 caracteres.' USING ERRCODE='22023'; END IF;
  v_from=billing_private.planning_date(p_payload->>'dateFrom');v_to=billing_private.planning_date(p_payload->>'dateTo');
  IF v_to<v_from THEN RAISE EXCEPTION 'A data final não pode ser anterior à inicial.' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(billing_private.present_planning_goal(g) ORDER BY g.start_date DESC,lower(g.title),g.id),'[]'::jsonb)
  INTO v_goals FROM public.billing_planning_goals g WHERE owner_id=v_owner
   AND (v_module IS NULL OR module=v_module) AND (v_period IS NULL OR period_type=v_period)
   AND (v_status IS NULL OR status=v_status) AND (v_from IS NULL OR end_date>=v_from) AND (v_to IS NULL OR start_date<=v_to)
   AND (v_search IS NULL OR concat_ws(' ',title,season,notes) ILIKE '%'||v_search||'%');
  SELECT coalesce(jsonb_agg(billing_private.present_planning_entry(e) ORDER BY e.planned_start_date DESC,e.activity_type,e.id),'[]'::jsonb)
  INTO v_entries FROM public.billing_planning_entries e WHERE owner_id=v_owner;
  -- Each overlapping period is evaluated separately. There is deliberately no
  -- sum of goal targets/actuals across weekly, monthly or other periods.
  RETURN jsonb_build_object('goals',v_goals,'entries',v_entries,'canWrite',billing_private.has_permission('registrations.write'));
 END IF;
 v_id=nullif(p_payload->>'id','')::uuid;
 IF p_action IN('history','delete') AND v_id IS NULL THEN
  RAISE EXCEPTION 'Informe a meta.' USING ERRCODE='22023';
 END IF;
 IF v_id IS NOT NULL THEN
  IF p_action='history' THEN
   SELECT * INTO v_goal FROM public.billing_planning_goals WHERE owner_id=v_owner AND id=v_id;
  ELSE
   SELECT * INTO v_goal FROM public.billing_planning_goals WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meta não encontrada.' USING ERRCODE='P0002'; END IF;
 END IF;
 IF p_action='history' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'goalId',r.goal_id,'revision',r.revision,
   'reason',r.reason,'createdAt',r.created_at,'changedAt',r.created_at,'changedBy',r.created_by,'snapshot',r.snapshot)
   ORDER BY r.revision DESC),'[]'::jsonb)
  INTO v_revisions FROM public.billing_planning_goal_revisions r WHERE owner_id=v_owner AND goal_id=v_id;
  RETURN jsonb_build_object('revisions',v_revisions);
 END IF;
 IF v_id IS NOT NULL THEN
  IF coalesce(p_payload->>'expectedRevision','')!~'^[1-9][0-9]{0,8}$' THEN
   RAISE EXCEPTION 'Informe a versão da meta para alterar ou excluir.' USING ERRCODE='22023';
  END IF;
  v_expected=(p_payload->>'expectedRevision')::integer;
  IF v_expected<>v_goal.revision THEN
   RAISE EXCEPTION 'Esta meta foi alterada por outra sessão. Atualize os dados antes de salvar.' USING ERRCODE='40001';
  END IF;
 END IF;
 IF p_action='delete' THEN
  -- Lock every entry ever linked in the revision history so a simultaneous
  -- execution cannot slip past the historical-reference check.
  PERFORM e.id FROM public.billing_planning_entries e WHERE e.owner_id=v_owner AND e.id IN(
   SELECT (j.value #>> '{}')::uuid FROM public.billing_planning_goal_revisions r,
    LATERAL jsonb_array_elements(r.snapshot->'entryIds') j
   WHERE r.owner_id=v_owner AND r.goal_id=v_id
  ) ORDER BY e.id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.billing_planning_executions e WHERE e.owner_id=v_owner AND e.entry_id IN(
   SELECT (j.value #>> '{}')::uuid FROM public.billing_planning_goal_revisions r,
    LATERAL jsonb_array_elements(r.snapshot->'entryIds') j
   WHERE r.owner_id=v_owner AND r.goal_id=v_id
  )) THEN
   RAISE EXCEPTION 'A meta tem histórico de apontamentos. Cancele a meta para preservar esse histórico.' USING ERRCODE='23503';
  END IF;
  DELETE FROM public.billing_planning_goals WHERE owner_id=v_owner AND id=v_id;
  RETURN jsonb_build_object('id',v_id,'deleted',true);
 END IF;

 v_title=btrim(coalesce(p_payload->>'title',''));v_unit=p_payload->>'unit';
 v_season=btrim(coalesce(p_payload->>'season',''));v_notes=btrim(coalesce(p_payload->>'notes',''));
 v_reason=btrim(coalesce(p_payload->>'revisionReason',CASE WHEN v_id IS NULL THEN 'Criação da meta' ELSE '' END));
 IF length(v_title) NOT BETWEEN 2 AND 160 OR length(v_season)>80 OR length(v_notes)>2000 THEN
  RAISE EXCEPTION 'Confira o título (2 a 160 caracteres), safra (até 80) e observações (até 2.000).' USING ERRCODE='22023';
 END IF;
 IF length(v_reason) NOT BETWEEN 3 AND 500 THEN
  RAISE EXCEPTION 'Informe um motivo da revisão com 3 a 500 caracteres.' USING ERRCODE='22023';
 END IF;
 IF v_module IS NULL OR v_period IS NULL OR v_status IS NULL OR v_unit IS NULL OR v_unit NOT IN('ha','t') THEN
  RAISE EXCEPTION 'Selecione módulo, período, status e unidade da meta.' USING ERRCODE='22023';
 END IF;
 v_from=billing_private.planning_date(p_payload->>'startDate',true);v_to=billing_private.planning_date(p_payload->>'endDate',true);
 IF v_to<v_from THEN RAISE EXCEPTION 'A data final não pode ser anterior à inicial.' USING ERRCODE='22023'; END IF;
 v_target=billing_private.planning_number(p_payload->>'targetQuantity','Meta');
 IF jsonb_typeof(p_payload->'entryIds') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Informe a lista de atividades vinculadas.' USING ERRCODE='22023';
 END IF;
 IF jsonb_array_length(p_payload->'entryIds')>500 OR EXISTS(
  SELECT 1 FROM jsonb_array_elements(p_payload->'entryIds') e WHERE jsonb_typeof(e)<>'string'
 ) THEN RAISE EXCEPTION 'Informe até 500 identificadores de atividades válidos.' USING ERRCODE='22023'; END IF;
 SELECT coalesce(array_agg(DISTINCT value::uuid ORDER BY value::uuid),ARRAY[]::uuid[]) INTO v_ids
 FROM jsonb_array_elements_text(p_payload->'entryIds');
 IF cardinality(v_ids)<>jsonb_array_length(p_payload->'entryIds') THEN
  RAISE EXCEPTION 'Uma atividade não pode ser vinculada duas vezes à mesma meta.' USING ERRCODE='22023';
 END IF;
 PERFORM e.id FROM public.billing_planning_entries e WHERE e.owner_id=v_owner AND e.id=ANY(v_ids) ORDER BY e.id FOR UPDATE;
 IF (SELECT count(*) FROM public.billing_planning_entries WHERE owner_id=v_owner AND id=ANY(v_ids) AND module=v_module)<>cardinality(v_ids) THEN
  RAISE EXCEPTION 'Vincule atividades cadastradas no mesmo módulo e espaço de trabalho da meta.' USING ERRCODE='22023';
 END IF;
 IF v_id IS NULL THEN
  INSERT INTO public.billing_planning_goals(owner_id,title,module,period_type,start_date,end_date,target_quantity,unit,season,notes,status,created_by)
  VALUES(v_owner,v_title,v_module,v_period,v_from,v_to,v_target,v_unit,v_season,v_notes,v_status,v_actor) RETURNING * INTO v_goal;
  v_id=v_goal.id;
 ELSE
  UPDATE public.billing_planning_goals SET title=v_title,module=v_module,period_type=v_period,start_date=v_from,end_date=v_to,
   target_quantity=v_target,unit=v_unit,season=v_season,notes=v_notes,status=v_status,revision=revision+1
  WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_goal;
 END IF;
 DELETE FROM public.billing_planning_goal_entries WHERE owner_id=v_owner AND goal_id=v_id;
 INSERT INTO public.billing_planning_goal_entries(owner_id,goal_id,entry_id) SELECT v_owner,v_id,unnest(v_ids);
 v_snapshot=billing_private.planning_goal_definition(v_goal)||jsonb_build_object('revisionReason',v_reason);
 INSERT INTO public.billing_planning_goal_revisions(owner_id,goal_id,revision,reason,snapshot,created_by)
 VALUES(v_owner,v_id,v_goal.revision,v_reason,v_snapshot,v_actor);
 RETURN jsonb_build_object('goal',billing_private.present_planning_goal(v_goal));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'Informe valores, versões e identificadores válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.planning_goals_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.planning_goals_dispatch(text,jsonb) TO authenticated;

CREATE FUNCTION billing_private.planning_executions_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_actor uuid:=auth.uid();v_id uuid;v_entry_id uuid;v_request uuid;
 v_entry public.billing_planning_entries%ROWTYPE;v_execution public.billing_planning_executions%ROWTYPE;
 v_date date;v_from date;v_to date;v_module text;v_search text;v_notes text;v_reason text;
 v_area numeric;v_tons numeric;v_cost numeric;v_used numeric;v_plot_area numeric;
 v_executions jsonb;v_entries jsonb;v_summary jsonb;
BEGIN
 IF v_actor IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar os apontamentos.' USING ERRCODE='28000'; END IF;
 IF p_action IS NULL OR p_action NOT IN('list','save','void') THEN
  RAISE EXCEPTION 'Operação de apontamentos inválida.' USING ERRCODE='22023';
 END IF;
 PERFORM billing_private.authorize('registrations.'||CASE WHEN p_action='list' THEN 'read' ELSE 'write' END);
 PERFORM billing_private.planning_assert_payload(p_payload,CASE p_action
  WHEN 'list' THEN ARRAY['entryId','search','dateFrom','dateTo','module']
  WHEN 'void' THEN ARRAY['id','reason']
  ELSE ARRAY['entryId','performedOn','areaHa','productionTons','cost','notes','requestId'] END);
 v_entry_id=nullif(p_payload->>'entryId','')::uuid;
 IF p_action='list' THEN
  v_module=nullif(btrim(p_payload->>'module'),'');v_search=nullif(btrim(p_payload->>'search'),'');
  IF v_module IS NOT NULL AND v_module NOT IN('preparacao-de-solo','plantio','manejo-do-canavial','colheita') THEN
   RAISE EXCEPTION 'Selecione um módulo válido.' USING ERRCODE='22023';
  END IF;
  IF length(v_search)>160 THEN RAISE EXCEPTION 'A busca deve ter até 160 caracteres.' USING ERRCODE='22023'; END IF;
  v_from=billing_private.planning_date(p_payload->>'dateFrom');v_to=billing_private.planning_date(p_payload->>'dateTo');
  IF v_to<v_from THEN RAISE EXCEPTION 'A data final não pode ser anterior à inicial.' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(billing_private.present_planning_execution(x) ORDER BY x.performed_on DESC,x.created_at DESC,x.id),'[]'::jsonb),
   jsonb_build_object('executionCount',count(*) FILTER(WHERE x.voided_at IS NULL)::integer,
    'areaHa',billing_private.decimal_text(coalesce(sum(x.area_ha) FILTER(WHERE x.voided_at IS NULL),0)),
    'productionTons',billing_private.decimal_text(coalesce(sum(x.production_tons) FILTER(WHERE x.voided_at IS NULL),0)),
    'cost',billing_private.decimal_text(coalesce(sum(x.cost) FILTER(WHERE x.voided_at IS NULL),0)))
  INTO v_executions,v_summary FROM public.billing_planning_executions x
  JOIN public.billing_planning_entries e ON e.owner_id=x.owner_id AND e.id=x.entry_id
  JOIN public.billing_farms f ON f.owner_id=e.owner_id AND f.id=e.farm_id
  JOIN public.billing_farm_plots p ON p.owner_id=e.owner_id AND p.farm_id=e.farm_id AND p.id=e.plot_id
  WHERE x.owner_id=v_owner AND (v_entry_id IS NULL OR x.entry_id=v_entry_id)
   AND (v_module IS NULL OR e.module=v_module) AND (v_from IS NULL OR x.performed_on>=v_from) AND (v_to IS NULL OR x.performed_on<=v_to)
   AND (v_search IS NULL OR concat_ws(' ',e.activity_type,f.name,p.name,x.notes) ILIKE '%'||v_search||'%');
  SELECT coalesce(jsonb_agg(billing_private.present_planning_entry(e) ORDER BY e.planned_start_date DESC,e.activity_type,e.id),'[]'::jsonb)
  INTO v_entries FROM public.billing_planning_entries e WHERE owner_id=v_owner;
  RETURN jsonb_build_object('executions',v_executions,'entries',v_entries,'summary',v_summary,'canWrite',billing_private.has_permission('registrations.write'));
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
  IF ROW(v_execution.entry_id,v_execution.performed_on,v_execution.area_ha,v_execution.production_tons,v_execution.cost,v_execution.notes)
     IS DISTINCT FROM ROW(v_entry_id,v_date,v_area,v_tons,v_cost,v_notes) THEN
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
 INSERT INTO public.billing_planning_executions(owner_id,entry_id,request_id,performed_on,area_ha,production_tons,cost,notes,created_by)
 VALUES(v_owner,v_entry_id,v_request,v_date,v_area,v_tons,v_cost,v_notes,v_actor) RETURNING * INTO v_execution;
 PERFORM billing_private.refresh_planning_execution_totals(v_owner,v_entry_id);
 RETURN jsonb_build_object('execution',billing_private.present_planning_execution(v_execution));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'Informe valores e identificadores válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.planning_executions_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.planning_executions_dispatch(text,jsonb) TO authenticated;

-- Extend the currently installed public invoker. Do not reconstruct an older
-- wrapper and accidentally remove contract/company or management dispatches.
DO $$ DECLARE v_definition text;v_anchor text;v_replacement text; BEGIN
 v_definition=pg_get_functiondef('public.billing_rpc(text,text,jsonb)'::regprocedure);
 v_anchor='IF p_resource=''planning'' THEN RETURN billing_private.planning_dispatch(p_action,p_payload); END IF;';
 IF strpos(v_definition,v_anchor)=0 OR strpos(v_definition,'planning-goals')>0
    OR (SELECT prosecdef FROM pg_proc WHERE oid='public.billing_rpc(text,text,jsonb)'::regprocedure) THEN
  RAISE EXCEPTION 'O contrato RPC instalado não corresponde à extensão de planejamento esperada.';
 END IF;
 v_replacement=v_anchor||E'\n IF p_resource=''planning-goals'' THEN RETURN billing_private.planning_goals_dispatch(p_action,p_payload); END IF;'
  ||E'\n IF p_resource=''planning-executions'' THEN RETURN billing_private.planning_executions_dispatch(p_action,p_payload); END IF;';
 EXECUTE replace(v_definition,v_anchor,v_replacement);
END $$;
REVOKE ALL ON FUNCTION public.billing_rpc(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_rpc(text,text,jsonb) TO authenticated;
COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS
 'Authenticated workspace RPC. Preserves existing dispatches and adds independent planning goals, version history and owner-isolated partial executions.';
