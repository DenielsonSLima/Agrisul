-- Complete agricultural-season workflow: goals, plot distribution, daily
-- field ledger, physical planted-area movements and harvest actuals sourced
-- from contract loads.

ALTER TABLE public.billing_planning_periods
 ADD COLUMN harvest_target_tons numeric(15,6) NOT NULL DEFAULT 0,
 ADD CONSTRAINT billing_planning_periods_harvest_target_check
  CHECK(harvest_target_tons>=0 AND harvest_target_tons<1000000000);

ALTER TABLE public.billing_planning_allocations
 ADD COLUMN executed_area_ha numeric(15,6) NOT NULL DEFAULT 0,
 ADD CONSTRAINT billing_planning_allocations_executed_check
  CHECK(executed_area_ha>=0 AND executed_area_ha<=area_ha);

CREATE TABLE public.billing_planning_harvest_plots (
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 period_id uuid NOT NULL,
 farm_id uuid NOT NULL,
 plot_id uuid NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,period_id,plot_id),
 FOREIGN KEY(owner_id,period_id) REFERENCES public.billing_planning_periods(owner_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(owner_id,farm_id) REFERENCES public.billing_farms(owner_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(owner_id,farm_id,plot_id) REFERENCES public.billing_farm_plots(owner_id,farm_id,id) ON DELETE RESTRICT
);
CREATE INDEX billing_planning_harvest_plots_plot
 ON public.billing_planning_harvest_plots(owner_id,plot_id,period_id);

CREATE TABLE public.billing_planning_field_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 period_id uuid NOT NULL,
 allocation_id uuid,
 farm_id uuid NOT NULL,
 plot_id uuid NOT NULL,
 request_id uuid NOT NULL,
 occurred_on date NOT NULL CHECK(occurred_on>='1900-01-01'),
 kind text NOT NULL CHECK(kind IN('planting','management','loss')),
 practice_id uuid,
 area_ha numeric(15,6) NOT NULL CHECK(area_ha>0 AND area_ha<1000000000),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 voided_at timestamptz,
 voided_by uuid,
 void_reason text NOT NULL DEFAULT '' CHECK(length(void_reason)<=500),
 UNIQUE(owner_id,id),
 UNIQUE(owner_id,request_id),
 CHECK((kind='management')=(practice_id IS NOT NULL)),
 CHECK(kind<>'planting' OR allocation_id IS NOT NULL),
 CHECK((voided_at IS NULL AND voided_by IS NULL AND void_reason='') OR
       (voided_at IS NOT NULL AND voided_by IS NOT NULL AND length(btrim(void_reason)) BETWEEN 3 AND 500)),
 FOREIGN KEY(owner_id,period_id) REFERENCES public.billing_planning_periods(owner_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(owner_id,allocation_id) REFERENCES public.billing_planning_allocations(owner_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(owner_id,farm_id) REFERENCES public.billing_farms(owner_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(owner_id,farm_id,plot_id) REFERENCES public.billing_farm_plots(owner_id,farm_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(owner_id,practice_id) REFERENCES public.billing_cultural_practices(owner_id,id) ON DELETE RESTRICT
);
CREATE INDEX billing_planning_field_logs_period_day
 ON public.billing_planning_field_logs(owner_id,period_id,occurred_on DESC,id);
CREATE INDEX billing_planning_field_logs_plot
 ON public.billing_planning_field_logs(owner_id,plot_id,occurred_on DESC,id);
CREATE INDEX billing_planning_field_logs_allocation
 ON public.billing_planning_field_logs(owner_id,allocation_id,occurred_on DESC,id);

ALTER TABLE public.billing_planning_history DROP CONSTRAINT billing_planning_history_entity_type_check;
ALTER TABLE public.billing_planning_history ADD CONSTRAINT billing_planning_history_entity_type_check
 CHECK(entity_type IN('period','allocation','plot','management','field-log','harvest-goal'));
ALTER TABLE public.billing_planning_history DROP CONSTRAINT billing_planning_history_action_check;
ALTER TABLE public.billing_planning_history ADD CONSTRAINT billing_planning_history_action_check
 CHECK(action IN('created','updated','cancelled','remanejado','planted-area','management','logged','voided'));

DO $$ DECLARE v_table text; BEGIN
 FOREACH v_table IN ARRAY ARRAY['billing_planning_harvest_plots','billing_planning_field_logs'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
  EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL',v_table);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',v_table);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',v_table);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING(billing_private.can_access_owner(owner_id,''registrations.read''))',v_table||'_read',v_table);
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND
     NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=v_table) THEN
   EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',v_table);
  END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION billing_private.present_planning_v2_allocation(p_allocation public.billing_planning_allocations) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p_allocation.id,'periodId',p_allocation.period_id,'farmId',p_allocation.farm_id,'farmName',f.name,
  'plotId',p_allocation.plot_id,'plotName',p.name,'areaHa',billing_private.decimal_text(p_allocation.area_ha),
  'executedAreaHa',billing_private.decimal_text(p_allocation.executed_area_ha),
  'remainingExecutionAreaHa',billing_private.decimal_text(greatest(p_allocation.area_ha-p_allocation.executed_area_ha,0)),
  'notes',p_allocation.notes,'status',p_allocation.status,'revision',p_allocation.revision,
  'practiceIds',coalesce((SELECT jsonb_agg(x.practice_id ORDER BY lower(cp.name),x.practice_id)
    FROM public.billing_planning_allocation_practices x JOIN public.billing_cultural_practices cp
     ON cp.owner_id=x.owner_id AND cp.id=x.practice_id
    WHERE x.owner_id=p_allocation.owner_id AND x.allocation_id=p_allocation.id),'[]'::jsonb),
  'practiceNames',coalesce((SELECT jsonb_agg(cp.name ORDER BY lower(cp.name),cp.id)
    FROM public.billing_planning_allocation_practices x JOIN public.billing_cultural_practices cp
     ON cp.owner_id=x.owner_id AND cp.id=x.practice_id
    WHERE x.owner_id=p_allocation.owner_id AND x.allocation_id=p_allocation.id),'[]'::jsonb),
  'createdAt',p_allocation.created_at,'updatedAt',p_allocation.updated_at)
 FROM public.billing_farms f JOIN public.billing_farm_plots p
  ON p.owner_id=f.owner_id AND p.farm_id=f.id AND p.id=p_allocation.plot_id
 WHERE f.owner_id=p_allocation.owner_id AND f.id=p_allocation.farm_id
$$;

CREATE OR REPLACE FUNCTION billing_private.present_planning_v2_period(p_period public.billing_planning_periods) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH metrics AS (
  SELECT
   coalesce((SELECT sum(a.area_ha) FROM public.billing_planning_allocations a
    WHERE a.owner_id=p_period.owner_id AND a.period_id=p_period.id AND a.status='active'),0) allocated,
   coalesce((SELECT sum(a.executed_area_ha) FROM public.billing_planning_allocations a
    WHERE a.owner_id=p_period.owner_id AND a.period_id=p_period.id AND a.status='active'),0) planted_executed,
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

CREATE OR REPLACE FUNCTION billing_private.planning_v2_assert_plot_capacity(
 p_owner uuid,p_plot uuid,p_start date,p_end date,p_area numeric,p_exclude_allocation uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_plot_area numeric;v_planted numeric;v_planned numeric;v_executed numeric:=0;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text||':planning-v2-plot:'||p_plot::text,0));
 SELECT area_ha,planted_area_ha INTO v_plot_area,v_planted FROM public.billing_farm_plots
  WHERE owner_id=p_owner AND id=p_plot FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Talhão não encontrado.' USING ERRCODE='P0002'; END IF;
 IF p_exclude_allocation IS NOT NULL THEN
  SELECT coalesce((SELECT executed_area_ha FROM public.billing_planning_allocations
   WHERE owner_id=p_owner AND id=p_exclude_allocation),0) INTO v_executed;
 END IF;
 SELECT coalesce(sum(greatest(a.area_ha-a.executed_area_ha,0)),0) INTO v_planned
 FROM public.billing_planning_allocations a
 JOIN public.billing_planning_periods q ON q.owner_id=a.owner_id AND q.id=a.period_id
 WHERE a.owner_id=p_owner AND a.plot_id=p_plot AND a.status='active' AND q.status<>'cancelled'
  AND a.id IS DISTINCT FROM p_exclude_allocation
  AND daterange(q.start_date,q.end_date,'[]') && daterange(p_start,p_end,'[]');
 IF v_planted+v_planned+greatest(p_area-v_executed,0)>v_plot_area THEN
  RAISE EXCEPTION 'A área plantada e os saldos dos planos sobrepostos ultrapassam a capacidade do talhão.' USING ERRCODE='23514';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION billing_private.guard_planning_plot_capacity() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_required numeric;v_peak numeric;
BEGIN
 SELECT coalesce(sum(area_ha),0) INTO v_required FROM public.billing_planning_entries
  WHERE owner_id=NEW.owner_id AND plot_id=NEW.id AND actuals_from_executions AND status<>'cancelado';
 IF NEW.area_ha<v_required THEN
  RAISE EXCEPTION 'A área do talhão não pode ficar abaixo da execução já registrada.' USING ERRCODE='23514';
 END IF;
 WITH points AS (
  SELECT DISTINCT q.start_date AS day FROM public.billing_planning_allocations a
  JOIN public.billing_planning_periods q ON q.owner_id=a.owner_id AND q.id=a.period_id
  WHERE a.owner_id=NEW.owner_id AND a.plot_id=NEW.id AND a.status='active' AND q.status<>'cancelled'
 ), usage AS (
  SELECT day,(SELECT coalesce(sum(greatest(a.area_ha-a.executed_area_ha,0)),0)
   FROM public.billing_planning_allocations a JOIN public.billing_planning_periods q
    ON q.owner_id=a.owner_id AND q.id=a.period_id
   WHERE a.owner_id=NEW.owner_id AND a.plot_id=NEW.id AND a.status='active' AND q.status<>'cancelled'
    AND day BETWEEN q.start_date AND q.end_date) amount FROM points
 ) SELECT coalesce(max(amount),0) INTO v_peak FROM usage;
 IF NEW.planted_area_ha+v_peak>NEW.area_ha THEN
  RAISE EXCEPTION 'A área do talhão não pode ficar abaixo da área plantada e do saldo planejado.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION billing_private.present_planning_field_log(p_log public.billing_planning_field_logs) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p_log.id,'periodId',p_log.period_id,'allocationId',p_log.allocation_id,
  'farmId',p_log.farm_id,'farmName',f.name,'plotId',p_log.plot_id,'plotName',p.name,
  'occurredOn',p_log.occurred_on,'kind',p_log.kind,'practiceId',coalesce(p_log.practice_id::text,''),
  'practiceName',coalesce(cp.name,''),'areaHa',billing_private.decimal_text(p_log.area_ha),'notes',p_log.notes,
  'createdBy',p_log.created_by,'createdByName',coalesce(nullif(s.name,''),u.email,''),'createdAt',p_log.created_at,
  'voidedAt',p_log.voided_at,'voidedBy',p_log.voided_by,'voidReason',p_log.void_reason)
 FROM public.billing_farms f JOIN public.billing_farm_plots p
  ON p.owner_id=f.owner_id AND p.farm_id=f.id AND p.id=p_log.plot_id
 LEFT JOIN public.billing_cultural_practices cp ON cp.owner_id=p_log.owner_id AND cp.id=p_log.practice_id
 LEFT JOIN public.billing_user_settings s ON s.user_id=p_log.created_by
 LEFT JOIN auth.users u ON u.id=p_log.created_by
 WHERE f.owner_id=p_log.owner_id AND f.id=p_log.farm_id
$$;

CREATE FUNCTION billing_private.planning_v3_assert_current_capacity(p_owner uuid,p_plot uuid,p_planted numeric) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_area numeric;v_peak numeric;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text||':planning-v2-plot:'||p_plot::text,0));
 SELECT area_ha INTO v_area FROM public.billing_farm_plots WHERE owner_id=p_owner AND id=p_plot FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Talhão não encontrado.' USING ERRCODE='P0002'; END IF;
 WITH points AS (
  SELECT DISTINCT q.start_date AS day FROM public.billing_planning_allocations a
  JOIN public.billing_planning_periods q ON q.owner_id=a.owner_id AND q.id=a.period_id
  WHERE a.owner_id=p_owner AND a.plot_id=p_plot AND a.status='active' AND q.status<>'cancelled'
 ), usage AS (
  SELECT day,(SELECT coalesce(sum(greatest(a.area_ha-a.executed_area_ha,0)),0)
   FROM public.billing_planning_allocations a JOIN public.billing_planning_periods q
    ON q.owner_id=a.owner_id AND q.id=a.period_id
   WHERE a.owner_id=p_owner AND a.plot_id=p_plot AND a.status='active' AND q.status<>'cancelled'
    AND day BETWEEN q.start_date AND q.end_date) amount FROM points
 ) SELECT coalesce(max(amount),0) INTO v_peak FROM usage;
 IF p_planted<0 OR p_planted+v_peak>v_area THEN
  RAISE EXCEPTION 'A área plantada e os saldos planejados ultrapassam a área física do talhão.' USING ERRCODE='23514';
 END IF;
END $$;

CREATE FUNCTION billing_private.planning_v3_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_actor uuid:=auth.uid();v_result jsonb;
 v_period public.billing_planning_periods%ROWTYPE;v_allocation public.billing_planning_allocations%ROWTYPE;
 v_log public.billing_planning_field_logs%ROWTYPE;v_id uuid;v_period_id uuid;v_plot_id uuid;v_farm_id uuid;
 v_practice uuid;v_request uuid;v_kind text;v_reason text;v_notes text;v_date date;v_area numeric;
 v_target numeric;v_expected integer;v_planted numeric;v_plot_area numeric;v_ids uuid[];v_snapshot jsonb;
 v_farms jsonb;v_logs jsonb;v_loads jsonb;v_daily jsonb;v_monthly jsonb;v_scope jsonb;
BEGIN
 IF v_actor IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o planejamento.' USING ERRCODE='28000'; END IF;
 IF p_action NOT IN('list','save-period','save-allocation','cancel-allocation','remanejar','set-practices','set-planted',
  'save-harvest-goal','save-field-log','void-field-log') THEN
  RAISE EXCEPTION 'Operação de planejamento inválida.' USING ERRCODE='22023';
 END IF;
 PERFORM billing_private.authorize(CASE WHEN p_action='list' THEN 'registrations.read' ELSE 'registrations.write' END);

 IF p_action='list' THEN
  PERFORM billing_private.planning_v2_assert_payload(p_payload,ARRAY['periodId']);
  v_period_id=nullif(p_payload->>'periodId','')::uuid;
  v_result=billing_private.planning_v2_dispatch('list',p_payload);
  IF v_period_id IS NULL THEN
   RETURN v_result||jsonb_build_object('fieldLogs','[]'::jsonb,'harvestLoads','[]'::jsonb,
    'dailySummary','[]'::jsonb,'monthlySummary','[]'::jsonb,'harvestPlotIds','[]'::jsonb);
  END IF;
  SELECT * INTO v_period FROM public.billing_planning_periods WHERE owner_id=v_owner AND id=v_period_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',f.id,'name',f.name,'city',f.city,'state',f.state,'totalAreaHa',billing_private.decimal_text(f.area_ha),
   'plotAreaHa',billing_private.decimal_text(coalesce((SELECT sum(p.area_ha) FROM public.billing_farm_plots p WHERE p.owner_id=f.owner_id AND p.farm_id=f.id),0)),
   'unmappedAreaHa',billing_private.decimal_text(f.area_ha-coalesce((SELECT sum(p.area_ha) FROM public.billing_farm_plots p WHERE p.owner_id=f.owner_id AND p.farm_id=f.id),0)),
   'plantedAreaHa',billing_private.decimal_text(coalesce((SELECT sum(p.planted_area_ha) FROM public.billing_farm_plots p WHERE p.owner_id=f.owner_id AND p.farm_id=f.id),0)),
   'plannedAreaHa',billing_private.decimal_text(coalesce((SELECT sum(a.area_ha) FROM public.billing_planning_allocations a WHERE a.owner_id=f.owner_id AND a.farm_id=f.id AND a.period_id=v_period_id AND a.status='active'),0)),
   'remainingPlannedAreaHa',billing_private.decimal_text(coalesce((SELECT sum(greatest(a.area_ha-a.executed_area_ha,0)) FROM public.billing_planning_allocations a WHERE a.owner_id=f.owner_id AND a.farm_id=f.id AND a.period_id=v_period_id AND a.status='active'),0)),
   'plots',coalesce((SELECT jsonb_agg(jsonb_build_object(
     'id',p.id,'name',p.name,'areaHa',billing_private.decimal_text(p.area_ha),
     'plantedAreaHa',billing_private.decimal_text(p.planted_area_ha),
     'otherPlannedAreaHa',billing_private.decimal_text(coalesce(other_plan.area_ha,0)),
     'maxAllocationAreaHa',billing_private.decimal_text(greatest(p.area_ha-p.planted_area_ha-coalesce(other_plan.area_ha,0)+coalesce(selected.executed_area_ha,0),0)),
     'harvestSelected',EXISTS(SELECT 1 FROM public.billing_planning_harvest_plots hp WHERE hp.owner_id=p.owner_id AND hp.period_id=v_period_id AND hp.plot_id=p.id),
     'allocation',CASE WHEN selected.id IS NULL THEN NULL ELSE billing_private.present_planning_v2_allocation(selected) END
    ) ORDER BY lower(p.name),p.id)
    FROM public.billing_farm_plots p
    LEFT JOIN LATERAL (SELECT a.* FROM public.billing_planning_allocations a WHERE a.owner_id=p.owner_id AND a.plot_id=p.id AND a.period_id=v_period_id AND a.status='active' LIMIT 1) selected ON true
    LEFT JOIN LATERAL (SELECT coalesce(sum(greatest(a.area_ha-a.executed_area_ha,0)),0) area_ha FROM public.billing_planning_allocations a
      JOIN public.billing_planning_periods q ON q.owner_id=a.owner_id AND q.id=a.period_id
      WHERE a.owner_id=p.owner_id AND a.plot_id=p.id AND a.status='active' AND q.status<>'cancelled'
       AND q.id IS DISTINCT FROM v_period_id AND daterange(q.start_date,q.end_date,'[]') && daterange(v_period.start_date,v_period.end_date,'[]')) other_plan ON true
    WHERE p.owner_id=f.owner_id AND p.farm_id=f.id),'[]'::jsonb)
  ) ORDER BY lower(f.name),f.id),'[]'::jsonb) INTO v_farms FROM public.billing_farms f WHERE f.owner_id=v_owner;

  SELECT coalesce(jsonb_agg(billing_private.present_planning_field_log(l) ORDER BY l.occurred_on DESC,l.created_at DESC,l.id),'[]'::jsonb)
   INTO v_logs FROM public.billing_planning_field_logs l WHERE l.owner_id=v_owner AND l.period_id=v_period_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'contractId',l.contract_id,'contractNumber',c.contract_number,
    'farmId',l.farm_id,'farmName',f.name,'plotId',l.plot_id,'plotName',p.name,'loadedAt',l.loaded_at,
    'volumeTons',billing_private.decimal_text(l.volume),'document',l.document,'notes',l.notes)
    ORDER BY l.loaded_at DESC,l.created_at DESC,l.id),'[]'::jsonb) INTO v_loads
   FROM public.billing_contract_loads l JOIN public.billing_planning_harvest_plots hp
    ON hp.owner_id=l.owner_id AND hp.period_id=v_period_id AND hp.plot_id=l.plot_id
   JOIN public.billing_contracts c ON c.owner_id=l.owner_id AND c.id=l.contract_id
   JOIN public.billing_farms f ON f.owner_id=l.owner_id AND f.id=l.farm_id
   JOIN public.billing_farm_plots p ON p.owner_id=l.owner_id AND p.id=l.plot_id
   WHERE l.owner_id=v_owner AND l.loaded_at BETWEEN v_period.start_date AND v_period.end_date;
  WITH events AS (
   SELECT l.occurred_on AS day,
    sum(l.area_ha) FILTER(WHERE l.kind='planting' AND l.voided_at IS NULL) planted,
    sum(l.area_ha) FILTER(WHERE l.kind='management' AND l.voided_at IS NULL) managed,
    sum(l.area_ha) FILTER(WHERE l.kind='loss' AND l.voided_at IS NULL) lost,
    0::numeric harvested,0::bigint loads,count(*) FILTER(WHERE l.voided_at IS NULL)::bigint events
   FROM public.billing_planning_field_logs l WHERE l.owner_id=v_owner AND l.period_id=v_period_id GROUP BY l.occurred_on
   UNION ALL
   SELECT l.loaded_at,0,0,0,sum(l.volume),count(*)::bigint,count(*)::bigint
   FROM public.billing_contract_loads l JOIN public.billing_planning_harvest_plots hp
    ON hp.owner_id=l.owner_id AND hp.period_id=v_period_id AND hp.plot_id=l.plot_id
   WHERE l.owner_id=v_owner AND l.loaded_at BETWEEN v_period.start_date AND v_period.end_date GROUP BY l.loaded_at
  ), days AS (
   SELECT day,coalesce(sum(planted),0) planted,coalesce(sum(managed),0) managed,coalesce(sum(lost),0) lost,
    coalesce(sum(harvested),0) harvested,sum(loads)::integer loads,sum(events)::integer events FROM events GROUP BY day
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('date',day,'plantedAreaHa',billing_private.decimal_text(planted),
    'managedAreaHa',billing_private.decimal_text(managed),'lostAreaHa',billing_private.decimal_text(lost),
    'harvestedTons',billing_private.decimal_text(harvested),'loadCount',loads,'eventCount',events) ORDER BY day DESC),'[]'::jsonb)
   INTO v_daily FROM days;
  WITH events AS (
   SELECT date_trunc('month',l.occurred_on)::date AS month,
    sum(l.area_ha) FILTER(WHERE l.kind='planting' AND l.voided_at IS NULL) planted,
    sum(l.area_ha) FILTER(WHERE l.kind='management' AND l.voided_at IS NULL) managed,
    sum(l.area_ha) FILTER(WHERE l.kind='loss' AND l.voided_at IS NULL) lost,0::numeric harvested,0::bigint loads
   FROM public.billing_planning_field_logs l WHERE l.owner_id=v_owner AND l.period_id=v_period_id GROUP BY 1
   UNION ALL
   SELECT date_trunc('month',l.loaded_at)::date,0,0,0,sum(l.volume),count(*)::bigint
   FROM public.billing_contract_loads l JOIN public.billing_planning_harvest_plots hp
    ON hp.owner_id=l.owner_id AND hp.period_id=v_period_id AND hp.plot_id=l.plot_id
   WHERE l.owner_id=v_owner AND l.loaded_at BETWEEN v_period.start_date AND v_period.end_date GROUP BY 1
  ), months AS (
   SELECT month,coalesce(sum(planted),0) planted,coalesce(sum(managed),0) managed,coalesce(sum(lost),0) lost,
    coalesce(sum(harvested),0) harvested,sum(loads)::integer loads FROM events GROUP BY month
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('month',to_char(month,'YYYY-MM'),'plantedAreaHa',billing_private.decimal_text(planted),
    'managedAreaHa',billing_private.decimal_text(managed),'lostAreaHa',billing_private.decimal_text(lost),
    'harvestedTons',billing_private.decimal_text(harvested),'loadCount',loads) ORDER BY month DESC),'[]'::jsonb)
   INTO v_monthly FROM months;
  SELECT coalesce(jsonb_agg(plot_id ORDER BY plot_id),'[]'::jsonb) INTO v_scope
   FROM public.billing_planning_harvest_plots WHERE owner_id=v_owner AND period_id=v_period_id;
  RETURN jsonb_set(v_result,'{farms}',v_farms)||jsonb_build_object('fieldLogs',v_logs,'harvestLoads',v_loads,
   'dailySummary',v_daily,'monthlySummary',v_monthly,'harvestPlotIds',v_scope);
 END IF;

 IF p_action='save-harvest-goal' THEN
  PERFORM billing_private.planning_v2_assert_payload(p_payload,ARRAY['periodId','targetTons','plotIds','expectedRevision','reason']);
  v_period_id=nullif(p_payload->>'periodId','')::uuid;v_target=billing_private.planning_v2_number(p_payload->>'targetTons','Meta de colheita');
  v_expected=coalesce(nullif(p_payload->>'expectedRevision','')::integer,0);v_reason=btrim(coalesce(p_payload->>'reason',''));
  IF jsonb_typeof(p_payload->'plotIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'plotIds')>500 OR length(v_reason) NOT BETWEEN 3 AND 500 THEN
   RAISE EXCEPTION 'Informe a meta, os talhões e o motivo da alteração.' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(array_agg(value::uuid),'{}') INTO v_ids FROM jsonb_array_elements_text(p_payload->'plotIds');
  IF cardinality(v_ids)<>(SELECT count(DISTINCT x) FROM unnest(v_ids) x) OR (v_target>0 AND cardinality(v_ids)=0) THEN
   RAISE EXCEPTION 'Selecione os talhões da meta de colheita sem repetições.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_period FROM public.billing_planning_periods WHERE owner_id=v_owner AND id=v_period_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Safra não encontrada.' USING ERRCODE='P0002'; END IF;
  IF v_period.revision<>v_expected THEN RAISE EXCEPTION 'Esta safra foi alterada em outra sessão. Recarregue antes de salvar.' USING ERRCODE='PT409'; END IF;
  IF (SELECT count(*) FROM public.billing_farm_plots p WHERE p.owner_id=v_owner AND p.id=ANY(v_ids))<>cardinality(v_ids) THEN
   RAISE EXCEPTION 'Selecione somente talhões deste espaço de trabalho.' USING ERRCODE='23503';
  END IF;
  UPDATE public.billing_planning_periods SET harvest_target_tons=v_target,revision=revision+1 WHERE owner_id=v_owner AND id=v_period_id RETURNING * INTO v_period;
  DELETE FROM public.billing_planning_harvest_plots WHERE owner_id=v_owner AND period_id=v_period_id;
  INSERT INTO public.billing_planning_harvest_plots(owner_id,period_id,farm_id,plot_id,created_by)
   SELECT v_owner,v_period_id,p.farm_id,p.id,v_actor FROM public.billing_farm_plots p WHERE p.owner_id=v_owner AND p.id=ANY(v_ids);
  v_snapshot=billing_private.present_planning_v2_period(v_period)||jsonb_build_object('harvestPlotIds',to_jsonb(v_ids));
  INSERT INTO public.billing_planning_history(owner_id,period_id,entity_type,action,reason,snapshot,created_by)
   VALUES(v_owner,v_period_id,'harvest-goal','updated',v_reason,v_snapshot,v_actor);
  RETURN jsonb_build_object('period',billing_private.present_planning_v2_period(v_period));
 END IF;

 IF p_action='save-field-log' THEN
  PERFORM billing_private.planning_v2_assert_payload(p_payload,ARRAY['periodId','plotId','kind','practiceId','occurredOn','areaHa','notes','requestId']);
  v_period_id=nullif(p_payload->>'periodId','')::uuid;v_plot_id=nullif(p_payload->>'plotId','')::uuid;
  v_practice=nullif(p_payload->>'practiceId','')::uuid;v_request=nullif(p_payload->>'requestId','')::uuid;
  v_kind=p_payload->>'kind';v_date=billing_private.planning_v2_date(p_payload->>'occurredOn');
  v_area=billing_private.planning_v2_number(p_payload->>'areaHa','Área realizada',true);v_notes=btrim(coalesce(p_payload->>'notes',''));
  IF v_request IS NULL OR v_kind NOT IN('planting','management','loss') OR length(v_notes)>2000 THEN
   RAISE EXCEPTION 'Confira o tipo, a identificação e as observações do apontamento.' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text||':planning-v3-log:'||v_request::text,0));
  SELECT * INTO v_log FROM public.billing_planning_field_logs WHERE owner_id=v_owner AND request_id=v_request;
  IF FOUND THEN RETURN jsonb_build_object('fieldLog',billing_private.present_planning_field_log(v_log)); END IF;
  SELECT * INTO v_period FROM public.billing_planning_periods WHERE owner_id=v_owner AND id=v_period_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Safra não encontrada.' USING ERRCODE='P0002'; END IF;
  IF v_period.status<>'active' OR v_date NOT BETWEEN v_period.start_date AND v_period.end_date THEN
   RAISE EXCEPTION 'O apontamento deve estar dentro do período de uma safra ativa.' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text||':planning-v2-plot:'||v_plot_id::text,0));
  SELECT farm_id,area_ha,planted_area_ha INTO v_farm_id,v_plot_area,v_planted FROM public.billing_farm_plots
   WHERE owner_id=v_owner AND id=v_plot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Talhão não encontrado.' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_allocation FROM public.billing_planning_allocations
   WHERE owner_id=v_owner AND period_id=v_period_id AND plot_id=v_plot_id AND status='active' FOR UPDATE;
  IF v_kind='planting' THEN
   IF v_allocation.id IS NULL OR v_allocation.executed_area_ha+v_area>v_allocation.area_ha THEN
    RAISE EXCEPTION 'A área plantada ultrapassa o saldo distribuído para este talhão.' USING ERRCODE='23514';
   END IF;
   UPDATE public.billing_planning_allocations SET executed_area_ha=executed_area_ha+v_area,revision=revision+1
    WHERE owner_id=v_owner AND id=v_allocation.id RETURNING * INTO v_allocation;
   UPDATE public.billing_farm_plots SET planted_area_ha=planted_area_ha+v_area WHERE owner_id=v_owner AND id=v_plot_id;
  ELSIF v_kind='management' THEN
   IF v_practice IS NULL OR NOT EXISTS(SELECT 1 FROM public.billing_cultural_practices cp WHERE cp.owner_id=v_owner AND cp.id=v_practice
      AND cp.culture_id=v_period.culture_id AND cp.culture_subtype_id=v_period.culture_subtype_id) THEN
    RAISE EXCEPTION 'Selecione um manejo cadastrado para a cultura e o ciclo da safra.' USING ERRCODE='23503';
   END IF;
   IF v_area>v_plot_area THEN RAISE EXCEPTION 'A área manejada ultrapassa a área física do talhão.' USING ERRCODE='23514'; END IF;
  ELSE
   v_practice=NULL;
   IF v_area>v_planted THEN RAISE EXCEPTION 'A perda não pode ser maior que a área plantada atual do talhão.' USING ERRCODE='23514'; END IF;
   UPDATE public.billing_farm_plots SET planted_area_ha=planted_area_ha-v_area WHERE owner_id=v_owner AND id=v_plot_id;
  END IF;
  INSERT INTO public.billing_planning_field_logs(owner_id,period_id,allocation_id,farm_id,plot_id,request_id,occurred_on,kind,practice_id,area_ha,notes,created_by)
   VALUES(v_owner,v_period_id,v_allocation.id,v_farm_id,v_plot_id,v_request,v_date,v_kind,v_practice,v_area,v_notes,v_actor) RETURNING * INTO v_log;
  v_snapshot=billing_private.present_planning_field_log(v_log);
  INSERT INTO public.billing_planning_history(owner_id,period_id,allocation_id,entity_type,action,reason,snapshot,created_by)
   VALUES(v_owner,v_period_id,v_allocation.id,'field-log','logged',CASE v_kind WHEN 'planting' THEN 'Plantio realizado' WHEN 'management' THEN 'Manejo realizado' ELSE 'Perda de área registrada' END,v_snapshot,v_actor);
  RETURN jsonb_build_object('fieldLog',v_snapshot);
 END IF;

 IF p_action='void-field-log' THEN
  PERFORM billing_private.planning_v2_assert_payload(p_payload,ARRAY['id','reason']);
  v_id=nullif(p_payload->>'id','')::uuid;v_reason=btrim(coalesce(p_payload->>'reason',''));
  IF v_id IS NULL OR length(v_reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Informe o apontamento e o motivo da anulação.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_log FROM public.billing_planning_field_logs WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Apontamento não encontrado.' USING ERRCODE='P0002'; END IF;
  IF v_log.voided_at IS NOT NULL THEN
   IF v_log.void_reason<>v_reason THEN RAISE EXCEPTION 'O apontamento já foi anulado e o motivo original deve ser preservado.' USING ERRCODE='23514'; END IF;
   RETURN jsonb_build_object('fieldLog',billing_private.present_planning_field_log(v_log));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text||':planning-v2-plot:'||v_log.plot_id::text,0));
  SELECT planted_area_ha INTO v_planted FROM public.billing_farm_plots WHERE owner_id=v_owner AND id=v_log.plot_id FOR UPDATE;
  IF v_log.kind='planting' THEN
   IF v_planted<v_log.area_ha THEN RAISE EXCEPTION 'Anule primeiro as perdas posteriores vinculadas a esta área.' USING ERRCODE='23514'; END IF;
   UPDATE public.billing_farm_plots SET planted_area_ha=planted_area_ha-v_log.area_ha WHERE owner_id=v_owner AND id=v_log.plot_id;
   UPDATE public.billing_planning_allocations SET executed_area_ha=executed_area_ha-v_log.area_ha,revision=revision+1
    WHERE owner_id=v_owner AND id=v_log.allocation_id;
  ELSIF v_log.kind='loss' THEN
   PERFORM billing_private.planning_v3_assert_current_capacity(v_owner,v_log.plot_id,v_planted+v_log.area_ha);
   UPDATE public.billing_farm_plots SET planted_area_ha=planted_area_ha+v_log.area_ha WHERE owner_id=v_owner AND id=v_log.plot_id;
  END IF;
  UPDATE public.billing_planning_field_logs SET voided_at=now(),voided_by=v_actor,void_reason=v_reason
   WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_log;
  v_snapshot=billing_private.present_planning_field_log(v_log);
  INSERT INTO public.billing_planning_history(owner_id,period_id,allocation_id,entity_type,action,reason,snapshot,created_by)
   VALUES(v_owner,v_log.period_id,v_log.allocation_id,'field-log','voided',v_reason,v_snapshot,v_actor);
  RETURN jsonb_build_object('fieldLog',v_snapshot);
 END IF;

 IF p_action='set-planted' THEN
  PERFORM billing_private.planning_v2_assert_payload(p_payload,ARRAY['plotId','plantedAreaHa','reason']);
  v_plot_id=nullif(p_payload->>'plotId','')::uuid;v_area=billing_private.planning_v2_number(p_payload->>'plantedAreaHa','Área plantada');
  v_reason=btrim(coalesce(p_payload->>'reason',''));
  IF length(v_reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Informe o motivo da atualização da área plantada.' USING ERRCODE='22023'; END IF;
  PERFORM billing_private.planning_v3_assert_current_capacity(v_owner,v_plot_id,v_area);
  UPDATE public.billing_farm_plots SET planted_area_ha=v_area WHERE owner_id=v_owner AND id=v_plot_id RETURNING farm_id INTO v_farm_id;
  v_snapshot=jsonb_build_object('plotId',v_plot_id,'farmId',v_farm_id,'plantedAreaHa',billing_private.decimal_text(v_area));
  INSERT INTO public.billing_planning_history(owner_id,entity_type,action,reason,snapshot,created_by)
   VALUES(v_owner,'plot','planted-area',v_reason,v_snapshot,v_actor);
  RETURN jsonb_build_object('plot',v_snapshot);
 END IF;

 RETURN billing_private.planning_v2_dispatch(p_action,p_payload);
EXCEPTION
 WHEN invalid_text_representation OR numeric_value_out_of_range OR array_subscript_error THEN
  RAISE EXCEPTION 'Informe valores e identificadores válidos.' USING ERRCODE='22023';
END $$;

REVOKE ALL ON FUNCTION billing_private.present_planning_field_log(public.billing_planning_field_logs),
 billing_private.planning_v3_assert_current_capacity(uuid,uuid,numeric),billing_private.planning_v3_dispatch(text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.planning_v3_dispatch(text,jsonb) TO authenticated;

DO $$ DECLARE v_definition text;v_old text;v_new text; BEGIN
 v_definition=pg_get_functiondef('public.billing_rpc(text,text,jsonb)'::regprocedure);
 v_old='IF p_resource=''planning'' THEN RETURN billing_private.planning_v2_dispatch(p_action,p_payload); END IF;';
 v_new='IF p_resource=''planning'' THEN RETURN billing_private.planning_v3_dispatch(p_action,p_payload); END IF;';
 IF strpos(v_definition,v_old)=0 OR (SELECT prosecdef FROM pg_proc WHERE oid='public.billing_rpc(text,text,jsonb)'::regprocedure) THEN
  RAISE EXCEPTION 'O contrato RPC instalado não corresponde à extensão de safra esperada.';
 END IF;
 EXECUTE replace(v_definition,v_old,v_new);
END $$;
REVOKE ALL ON FUNCTION public.billing_rpc(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_rpc(text,text,jsonb) TO authenticated;
