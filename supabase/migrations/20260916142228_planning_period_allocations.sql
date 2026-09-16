-- Flexible planting periods, plot capacity, management selection and audit
-- history. The previous planning implementation remains inaccessible and its
-- empty legacy tables are preserved only for migration history.

ALTER TABLE public.billing_farm_plots
 ADD COLUMN planted_area_ha numeric(15,6) NOT NULL DEFAULT 0,
 ADD CONSTRAINT billing_farm_plots_planted_area_check
  CHECK(planted_area_ha>=0 AND planted_area_ha<=area_ha);

CREATE TABLE public.billing_planning_periods (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 160),
 start_date date NOT NULL,
 end_date date NOT NULL CHECK(end_date>=start_date),
 target_area_ha numeric(15,6) NOT NULL CHECK(target_area_ha>0 AND target_area_ha<1000000000),
 culture_id uuid NOT NULL,
 culture_subtype_id uuid NOT NULL,
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','completed','cancelled')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id),
 FOREIGN KEY(owner_id,culture_id) REFERENCES public.billing_cultures(owner_id,id),
 FOREIGN KEY(owner_id,culture_id,culture_subtype_id)
  REFERENCES public.billing_culture_subtypes(owner_id,culture_id,id)
);

CREATE TABLE public.billing_planning_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 period_id uuid NOT NULL,
 farm_id uuid NOT NULL,
 plot_id uuid NOT NULL,
 area_ha numeric(15,6) NOT NULL CHECK(area_ha>0 AND area_ha<1000000000),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','cancelled')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id),
 FOREIGN KEY(owner_id,period_id) REFERENCES public.billing_planning_periods(owner_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(owner_id,farm_id) REFERENCES public.billing_farms(owner_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(owner_id,plot_id) REFERENCES public.billing_farm_plots(owner_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX billing_planning_allocations_active_plot
 ON public.billing_planning_allocations(owner_id,period_id,plot_id) WHERE status='active';
CREATE INDEX billing_planning_allocations_period
 ON public.billing_planning_allocations(owner_id,period_id,status);
CREATE INDEX billing_planning_allocations_plot
 ON public.billing_planning_allocations(owner_id,plot_id,status);

CREATE TABLE public.billing_planning_allocation_practices (
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 allocation_id uuid NOT NULL,
 practice_id uuid NOT NULL,
 PRIMARY KEY(owner_id,allocation_id,practice_id),
 FOREIGN KEY(owner_id,allocation_id) REFERENCES public.billing_planning_allocations(owner_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(owner_id,practice_id) REFERENCES public.billing_cultural_practices(owner_id,id) ON DELETE RESTRICT
);

CREATE TABLE public.billing_planning_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 period_id uuid,
 allocation_id uuid,
 entity_type text NOT NULL CHECK(entity_type IN('period','allocation','plot','management')),
 action text NOT NULL CHECK(action IN('created','updated','cancelled','remanejado','planted-area','management')),
 reason text NOT NULL DEFAULT '' CHECK(length(reason)<=500),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id),
 FOREIGN KEY(owner_id,period_id) REFERENCES public.billing_planning_periods(owner_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(owner_id,allocation_id) REFERENCES public.billing_planning_allocations(owner_id,id) ON DELETE RESTRICT
);
CREATE INDEX billing_planning_history_period
 ON public.billing_planning_history(owner_id,period_id,created_at DESC);

CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_planning_periods
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_planning_allocations
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();

DO $$ DECLARE v_table text; BEGIN
 FOREACH v_table IN ARRAY ARRAY['billing_planning_periods','billing_planning_allocations','billing_planning_allocation_practices','billing_planning_history'] LOOP
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

CREATE FUNCTION billing_private.planning_v2_assert_payload(p_payload jsonb,p_fields text[]) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
  RAISE EXCEPTION 'Informe um objeto de dados válido.' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT(k=ANY(p_fields))) THEN
  RAISE EXCEPTION 'O planejamento recebeu campos não reconhecidos.' USING ERRCODE='22023';
 END IF;
END $$;

CREATE FUNCTION billing_private.planning_v2_number(p_value text,p_label text,p_positive boolean DEFAULT false) RETURNS numeric
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_text text:=replace(btrim(coalesce(p_value,'')),',','.');v_value numeric;
BEGIN
 IF v_text!~'^[0-9]{1,9}([.][0-9]{1,6})?$' THEN
  RAISE EXCEPTION 'Informe % válida, com até seis casas decimais.',lower(p_label) USING ERRCODE='22023';
 END IF;
 v_value=v_text::numeric;
 IF (p_positive AND v_value<=0) OR (NOT p_positive AND v_value<0) THEN
  RAISE EXCEPTION '% deve ser maior que %.',p_label,CASE WHEN p_positive THEN 'zero' ELSE 'ou igual a zero' END USING ERRCODE='22023';
 END IF;
 RETURN v_value;
END $$;

CREATE FUNCTION billing_private.planning_v2_date(p_value text) RETURNS date
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF coalesce(p_value,'')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
  RAISE EXCEPTION 'Informe um período válido.' USING ERRCODE='22023';
 END IF;
 RETURN p_value::date;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
 RAISE EXCEPTION 'Informe um período válido.' USING ERRCODE='22023';
END $$;

CREATE FUNCTION billing_private.present_planning_v2_period(p_period public.billing_planning_periods) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p_period.id,'name',p_period.name,'startDate',p_period.start_date,'endDate',p_period.end_date,
  'targetAreaHa',billing_private.decimal_text(p_period.target_area_ha),
  'allocatedAreaHa',billing_private.decimal_text(coalesce((SELECT sum(a.area_ha) FROM public.billing_planning_allocations a
    WHERE a.owner_id=p_period.owner_id AND a.period_id=p_period.id AND a.status='active'),0)),
  'remainingAreaHa',billing_private.decimal_text(greatest(p_period.target_area_ha-coalesce((SELECT sum(a.area_ha)
    FROM public.billing_planning_allocations a WHERE a.owner_id=p_period.owner_id AND a.period_id=p_period.id AND a.status='active'),0),0)),
  'allocationCount',(SELECT count(*)::integer FROM public.billing_planning_allocations a
    WHERE a.owner_id=p_period.owner_id AND a.period_id=p_period.id AND a.status='active'),
  'cultureId',p_period.culture_id,'cultureName',c.name,
  'cultureSubtypeId',p_period.culture_subtype_id,'cultureSubtypeName',s.name,
  'notes',p_period.notes,'status',p_period.status,'revision',p_period.revision,
  'createdAt',p_period.created_at,'updatedAt',p_period.updated_at)
 FROM public.billing_cultures c
 JOIN public.billing_culture_subtypes s ON s.owner_id=c.owner_id AND s.culture_id=c.id AND s.id=p_period.culture_subtype_id
 WHERE c.owner_id=p_period.owner_id AND c.id=p_period.culture_id
$$;

CREATE FUNCTION billing_private.present_planning_v2_allocation(p_allocation public.billing_planning_allocations) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p_allocation.id,'periodId',p_allocation.period_id,'farmId',p_allocation.farm_id,'farmName',f.name,
  'plotId',p_allocation.plot_id,'plotName',p.name,'areaHa',billing_private.decimal_text(p_allocation.area_ha),
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

CREATE FUNCTION billing_private.planning_v2_assert_plot_capacity(
 p_owner uuid,p_plot uuid,p_start date,p_end date,p_area numeric,p_exclude_allocation uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_plot_area numeric;v_planted numeric;v_planned numeric;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text||':planning-v2-plot:'||p_plot::text,0));
 SELECT area_ha,planted_area_ha INTO v_plot_area,v_planted FROM public.billing_farm_plots
  WHERE owner_id=p_owner AND id=p_plot FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Talhão não encontrado.' USING ERRCODE='P0002'; END IF;
 SELECT coalesce(sum(a.area_ha),0) INTO v_planned
 FROM public.billing_planning_allocations a
 JOIN public.billing_planning_periods q ON q.owner_id=a.owner_id AND q.id=a.period_id
 WHERE a.owner_id=p_owner AND a.plot_id=p_plot AND a.status='active' AND q.status<>'cancelled'
  AND a.id IS DISTINCT FROM p_exclude_allocation
  AND daterange(q.start_date,q.end_date,'[]') && daterange(p_start,p_end,'[]');
 IF v_planted+v_planned+p_area>v_plot_area THEN
  RAISE EXCEPTION 'A área plantada e os planos sobrepostos ultrapassam a capacidade do talhão.' USING ERRCODE='23514';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION billing_private.guard_planning_plot_capacity() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_required numeric;v_peak numeric;
BEGIN
 SELECT coalesce(sum(area_ha),0) INTO v_required FROM public.billing_planning_entries
  WHERE owner_id=NEW.owner_id AND plot_id=NEW.id AND actuals_from_executions
   AND status<>'cancelado';
 IF NEW.area_ha<v_required THEN
  RAISE EXCEPTION 'A área do talhão não pode ficar abaixo da execução já registrada.' USING ERRCODE='23514';
 END IF;
 WITH points AS (
  SELECT DISTINCT q.start_date AS day
  FROM public.billing_planning_allocations a JOIN public.billing_planning_periods q
   ON q.owner_id=a.owner_id AND q.id=a.period_id
  WHERE a.owner_id=NEW.owner_id AND a.plot_id=NEW.id AND a.status='active' AND q.status<>'cancelled'
 ), usage AS (
  SELECT day,(SELECT coalesce(sum(a.area_ha),0) FROM public.billing_planning_allocations a
   JOIN public.billing_planning_periods q ON q.owner_id=a.owner_id AND q.id=a.period_id
   WHERE a.owner_id=NEW.owner_id AND a.plot_id=NEW.id AND a.status='active' AND q.status<>'cancelled'
    AND day BETWEEN q.start_date AND q.end_date) amount FROM points
 ) SELECT coalesce(max(amount),0) INTO v_peak FROM usage;
 IF NEW.planted_area_ha+v_peak>NEW.area_ha THEN
  RAISE EXCEPTION 'A área do talhão não pode ficar abaixo da área plantada e planejada.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION billing_private.planning_v2_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_actor uuid:=auth.uid();
 v_period public.billing_planning_periods%ROWTYPE;v_allocation public.billing_planning_allocations%ROWTYPE;
 v_target_allocation public.billing_planning_allocations%ROWTYPE;
 v_id uuid;v_period_id uuid;v_plot_id uuid;v_target_plot uuid;v_farm_id uuid;v_culture uuid;v_subtype uuid;
 v_start date;v_end date;v_area numeric;v_target numeric;v_used numeric;v_peak numeric;v_plot_area numeric;
 v_name text;v_notes text;v_status text;v_reason text;v_expected integer;v_ids uuid[];v_item record;
 v_periods jsonb;v_farms jsonb;v_practices jsonb;v_history jsonb;v_snapshot jsonb;v_moved numeric;
BEGIN
 IF v_actor IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o planejamento.' USING ERRCODE='28000'; END IF;
 IF p_action NOT IN ('list','save-period','save-allocation','cancel-allocation','remanejar','set-practices','set-planted') THEN
  RAISE EXCEPTION 'Operação de planejamento inválida.' USING ERRCODE='22023';
 END IF;
 PERFORM billing_private.authorize(CASE WHEN p_action='list' THEN 'registrations.read' ELSE 'registrations.write' END);

 IF p_action='list' THEN
  PERFORM billing_private.planning_v2_assert_payload(p_payload,ARRAY['periodId']);
  v_period_id=nullif(p_payload->>'periodId','')::uuid;
  IF v_period_id IS NOT NULL THEN
   SELECT * INTO v_period FROM public.billing_planning_periods WHERE owner_id=v_owner AND id=v_period_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Plano não encontrado.' USING ERRCODE='P0002'; END IF;
  END IF;
  SELECT coalesce(jsonb_agg(billing_private.present_planning_v2_period(q) ORDER BY
   CASE q.status WHEN 'active' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,q.start_date DESC,q.created_at DESC),'[]'::jsonb)
   INTO v_periods FROM public.billing_planning_periods q WHERE q.owner_id=v_owner;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',f.id,'name',f.name,'city',f.city,'state',f.state,
   'totalAreaHa',billing_private.decimal_text(f.area_ha),
   'plotAreaHa',billing_private.decimal_text(coalesce((SELECT sum(p.area_ha) FROM public.billing_farm_plots p WHERE p.owner_id=f.owner_id AND p.farm_id=f.id),0)),
   'unmappedAreaHa',billing_private.decimal_text(f.area_ha-coalesce((SELECT sum(p.area_ha) FROM public.billing_farm_plots p WHERE p.owner_id=f.owner_id AND p.farm_id=f.id),0)),
   'plantedAreaHa',billing_private.decimal_text(coalesce((SELECT sum(p.planted_area_ha) FROM public.billing_farm_plots p WHERE p.owner_id=f.owner_id AND p.farm_id=f.id),0)),
   'plannedAreaHa',billing_private.decimal_text(coalesce((SELECT sum(a.area_ha) FROM public.billing_planning_allocations a
      WHERE a.owner_id=f.owner_id AND a.farm_id=f.id AND a.period_id=v_period_id AND a.status='active'),0)),
   'plots',coalesce((SELECT jsonb_agg(jsonb_build_object(
     'id',p.id,'name',p.name,'areaHa',billing_private.decimal_text(p.area_ha),
     'plantedAreaHa',billing_private.decimal_text(p.planted_area_ha),
     'otherPlannedAreaHa',billing_private.decimal_text(coalesce(other_plan.area_ha,0)),
     'maxAllocationAreaHa',billing_private.decimal_text(greatest(p.area_ha-p.planted_area_ha-coalesce(other_plan.area_ha,0),0)),
     'allocation',CASE WHEN selected.id IS NULL THEN NULL ELSE billing_private.present_planning_v2_allocation(selected) END
    ) ORDER BY lower(p.name),p.id)
    FROM public.billing_farm_plots p
    LEFT JOIN LATERAL (SELECT a.* FROM public.billing_planning_allocations a
      WHERE a.owner_id=p.owner_id AND a.plot_id=p.id AND a.period_id=v_period_id AND a.status='active' LIMIT 1) selected ON true
    LEFT JOIN LATERAL (SELECT coalesce(sum(a.area_ha),0) area_ha FROM public.billing_planning_allocations a
      JOIN public.billing_planning_periods q ON q.owner_id=a.owner_id AND q.id=a.period_id
      WHERE a.owner_id=p.owner_id AND a.plot_id=p.id AND a.status='active' AND q.status<>'cancelled'
       AND q.id IS DISTINCT FROM v_period_id AND v_period_id IS NOT NULL
       AND daterange(q.start_date,q.end_date,'[]') && daterange(v_period.start_date,v_period.end_date,'[]')) other_plan ON true
    WHERE p.owner_id=f.owner_id AND p.farm_id=f.id),'[]'::jsonb)
  ) ORDER BY lower(f.name),f.id),'[]'::jsonb) INTO v_farms FROM public.billing_farms f WHERE f.owner_id=v_owner;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',cp.id,'name',cp.name,'description',cp.description,
    'category',cp.category,'cultureId',cp.culture_id,'cultureSubtypeId',cp.culture_subtype_id)
    ORDER BY cp.category,lower(cp.name),cp.id),'[]'::jsonb) INTO v_practices
   FROM public.billing_cultural_practices cp
   WHERE cp.owner_id=v_owner AND v_period_id IS NOT NULL AND cp.culture_id=v_period.culture_id AND cp.culture_subtype_id=v_period.culture_subtype_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',h.id,'periodId',h.period_id,'allocationId',h.allocation_id,
    'entityType',h.entity_type,'action',h.action,'reason',h.reason,'snapshot',h.snapshot,
    'createdBy',h.created_by,'createdByName',coalesce(nullif(s.name,''),u.email,''),'createdAt',h.created_at)
    ORDER BY h.created_at DESC,h.id DESC),'[]'::jsonb) INTO v_history
   FROM public.billing_planning_history h LEFT JOIN public.billing_user_settings s ON s.user_id=h.created_by
   LEFT JOIN auth.users u ON u.id=h.created_by
   WHERE h.owner_id=v_owner AND (h.period_id=v_period_id OR (v_period_id IS NOT NULL AND h.period_id IS NULL));
  RETURN jsonb_build_object('periods',v_periods,'farms',v_farms,'practices',v_practices,'history',v_history);
 END IF;

 IF p_action='save-period' THEN
  PERFORM billing_private.planning_v2_assert_payload(p_payload,ARRAY['id','name','startDate','endDate','targetAreaHa','cultureId','cultureSubtypeId','notes','status','expectedRevision','revisionReason']);
  v_id=nullif(p_payload->>'id','')::uuid;v_name=btrim(coalesce(p_payload->>'name',''));
  v_start=billing_private.planning_v2_date(p_payload->>'startDate');v_end=billing_private.planning_v2_date(p_payload->>'endDate');
  v_target=billing_private.planning_v2_number(p_payload->>'targetAreaHa','Área da meta',true);
  v_culture=nullif(p_payload->>'cultureId','')::uuid;v_subtype=nullif(p_payload->>'cultureSubtypeId','')::uuid;
  v_notes=btrim(coalesce(p_payload->>'notes',''));v_status=coalesce(nullif(p_payload->>'status',''),'active');
  IF length(v_name) NOT BETWEEN 2 AND 160 OR length(v_notes)>2000 OR v_end<v_start OR v_status NOT IN('active','completed','cancelled') THEN
   RAISE EXCEPTION 'Confira nome, período, situação e observações do plano.' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.billing_culture_subtypes s WHERE s.owner_id=v_owner AND s.id=v_subtype AND s.culture_id=v_culture) THEN
   RAISE EXCEPTION 'Selecione uma cultura e um ciclo cadastrados.' USING ERRCODE='22023';
  END IF;
  IF v_id IS NOT NULL THEN
   SELECT * INTO v_period FROM public.billing_planning_periods WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Plano não encontrado.' USING ERRCODE='P0002'; END IF;
   v_expected=coalesce(nullif(p_payload->>'expectedRevision','')::integer,0);
   v_reason=btrim(coalesce(p_payload->>'revisionReason',''));
   IF v_expected<>v_period.revision THEN RAISE EXCEPTION 'Este plano foi alterado em outra sessão. Recarregue antes de salvar.' USING ERRCODE='PT409'; END IF;
   IF length(v_reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Informe o motivo da alteração.' USING ERRCODE='22023'; END IF;
  ELSE
   v_id=gen_random_uuid();v_reason='Criação do plano';
  END IF;
  SELECT coalesce(sum(area_ha),0) INTO v_used FROM public.billing_planning_allocations
   WHERE owner_id=v_owner AND period_id=v_id AND status='active';
  IF v_target<v_used THEN RAISE EXCEPTION 'A meta não pode ser menor que a área já distribuída.' USING ERRCODE='23514'; END IF;
  IF v_status<>'cancelled' THEN
   FOR v_item IN SELECT id,plot_id,area_ha FROM public.billing_planning_allocations
    WHERE owner_id=v_owner AND period_id=v_id AND status='active' ORDER BY plot_id
   LOOP
    PERFORM billing_private.planning_v2_assert_plot_capacity(v_owner,v_item.plot_id,v_start,v_end,v_item.area_ha,v_item.id);
   END LOOP;
  END IF;
  INSERT INTO public.billing_planning_periods(id,owner_id,name,start_date,end_date,target_area_ha,culture_id,culture_subtype_id,notes,status,created_by)
   VALUES(v_id,v_owner,v_name,v_start,v_end,v_target,v_culture,v_subtype,v_notes,v_status,v_actor)
  ON CONFLICT(id) DO UPDATE SET name=excluded.name,start_date=excluded.start_date,end_date=excluded.end_date,
   target_area_ha=excluded.target_area_ha,culture_id=excluded.culture_id,culture_subtype_id=excluded.culture_subtype_id,
   notes=excluded.notes,status=excluded.status,revision=billing_planning_periods.revision+1
   WHERE billing_planning_periods.owner_id=v_owner RETURNING * INTO v_period;
  v_snapshot=billing_private.present_planning_v2_period(v_period);
  INSERT INTO public.billing_planning_history(owner_id,period_id,entity_type,action,reason,snapshot,created_by)
   VALUES(v_owner,v_id,'period',CASE WHEN v_period.revision=1 THEN 'created' WHEN v_status='cancelled' THEN 'cancelled' ELSE 'updated' END,v_reason,v_snapshot,v_actor);
  RETURN jsonb_build_object('period',v_snapshot);
 END IF;

 IF p_action='save-allocation' THEN
  PERFORM billing_private.planning_v2_assert_payload(p_payload,ARRAY['id','periodId','plotId','areaHa','notes','expectedRevision','revisionReason']);
  v_id=nullif(p_payload->>'id','')::uuid;v_period_id=nullif(p_payload->>'periodId','')::uuid;
  v_plot_id=nullif(p_payload->>'plotId','')::uuid;v_area=billing_private.planning_v2_number(p_payload->>'areaHa','Área planejada',true);
  v_notes=btrim(coalesce(p_payload->>'notes',''));
  SELECT * INTO v_period FROM public.billing_planning_periods WHERE owner_id=v_owner AND id=v_period_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plano não encontrado.' USING ERRCODE='P0002'; END IF;
  IF v_period.status<>'active' THEN RAISE EXCEPTION 'Somente planos ativos podem receber distribuição.' USING ERRCODE='23514'; END IF;
  SELECT farm_id INTO v_farm_id FROM public.billing_farm_plots WHERE owner_id=v_owner AND id=v_plot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Talhão não encontrado.' USING ERRCODE='P0002'; END IF;
  IF v_id IS NOT NULL THEN
   SELECT * INTO v_allocation FROM public.billing_planning_allocations WHERE owner_id=v_owner AND id=v_id AND status='active' FOR UPDATE;
   IF NOT FOUND OR v_allocation.period_id<>v_period_id THEN RAISE EXCEPTION 'Distribuição não encontrada.' USING ERRCODE='P0002'; END IF;
   IF v_allocation.plot_id<>v_plot_id THEN RAISE EXCEPTION 'Use Remanejar para trocar o talhão.' USING ERRCODE='22023'; END IF;
   v_expected=coalesce(nullif(p_payload->>'expectedRevision','')::integer,0);v_reason=btrim(coalesce(p_payload->>'revisionReason',''));
   IF v_expected<>v_allocation.revision THEN RAISE EXCEPTION 'Esta distribuição foi alterada em outra sessão. Recarregue antes de salvar.' USING ERRCODE='PT409'; END IF;
   IF length(v_reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Informe o motivo da alteração.' USING ERRCODE='22023'; END IF;
  ELSE
   IF EXISTS(SELECT 1 FROM public.billing_planning_allocations WHERE owner_id=v_owner AND period_id=v_period_id AND plot_id=v_plot_id AND status='active') THEN
    RAISE EXCEPTION 'Este talhão já está distribuído no plano. Edite a distribuição existente.' USING ERRCODE='23505';
   END IF;
   v_id=gen_random_uuid();v_reason='Distribuição inicial';
  END IF;
  SELECT coalesce(sum(area_ha),0) INTO v_used FROM public.billing_planning_allocations
   WHERE owner_id=v_owner AND period_id=v_period_id AND status='active' AND id IS DISTINCT FROM v_id;
  IF v_used+v_area>v_period.target_area_ha THEN RAISE EXCEPTION 'A distribuição ultrapassa a meta de área do plano.' USING ERRCODE='23514'; END IF;
  PERFORM billing_private.planning_v2_assert_plot_capacity(v_owner,v_plot_id,v_period.start_date,v_period.end_date,v_area,v_id);
  INSERT INTO public.billing_planning_allocations(id,owner_id,period_id,farm_id,plot_id,area_ha,notes,created_by)
   VALUES(v_id,v_owner,v_period_id,v_farm_id,v_plot_id,v_area,v_notes,v_actor)
  ON CONFLICT(id) DO UPDATE SET area_ha=excluded.area_ha,notes=excluded.notes,revision=billing_planning_allocations.revision+1
   WHERE billing_planning_allocations.owner_id=v_owner RETURNING * INTO v_allocation;
  v_snapshot=billing_private.present_planning_v2_allocation(v_allocation);
  INSERT INTO public.billing_planning_history(owner_id,period_id,allocation_id,entity_type,action,reason,snapshot,created_by)
   VALUES(v_owner,v_period_id,v_id,'allocation',CASE WHEN v_allocation.revision=1 THEN 'created' ELSE 'updated' END,v_reason,v_snapshot,v_actor);
  RETURN jsonb_build_object('allocation',v_snapshot);
 END IF;

 IF p_action='cancel-allocation' THEN
  PERFORM billing_private.planning_v2_assert_payload(p_payload,ARRAY['id','expectedRevision','reason']);
  v_id=nullif(p_payload->>'id','')::uuid;v_expected=coalesce(nullif(p_payload->>'expectedRevision','')::integer,0);v_reason=btrim(coalesce(p_payload->>'reason',''));
  SELECT * INTO v_allocation FROM public.billing_planning_allocations WHERE owner_id=v_owner AND id=v_id AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Distribuição não encontrada.' USING ERRCODE='P0002'; END IF;
  IF v_expected<>v_allocation.revision THEN RAISE EXCEPTION 'Esta distribuição foi alterada em outra sessão. Recarregue antes de cancelar.' USING ERRCODE='PT409'; END IF;
  IF length(v_reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE='22023'; END IF;
  UPDATE public.billing_planning_allocations SET status='cancelled',revision=revision+1 WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_allocation;
  v_snapshot=billing_private.present_planning_v2_allocation(v_allocation);
  INSERT INTO public.billing_planning_history(owner_id,period_id,allocation_id,entity_type,action,reason,snapshot,created_by)
   VALUES(v_owner,v_allocation.period_id,v_id,'allocation','cancelled',v_reason,v_snapshot,v_actor);
  RETURN jsonb_build_object('allocation',v_snapshot);
 END IF;

 IF p_action='remanejar' THEN
  PERFORM billing_private.planning_v2_assert_payload(p_payload,ARRAY['allocationId','targetPlotId','areaHa','expectedRevision','reason']);
  v_id=nullif(p_payload->>'allocationId','')::uuid;v_target_plot=nullif(p_payload->>'targetPlotId','')::uuid;
  v_moved=billing_private.planning_v2_number(p_payload->>'areaHa','Área remanejada',true);
  v_expected=coalesce(nullif(p_payload->>'expectedRevision','')::integer,0);v_reason=btrim(coalesce(p_payload->>'reason',''));
  SELECT * INTO v_allocation FROM public.billing_planning_allocations WHERE owner_id=v_owner AND id=v_id AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Distribuição de origem não encontrada.' USING ERRCODE='P0002'; END IF;
  IF v_allocation.plot_id=v_target_plot OR v_moved>v_allocation.area_ha OR v_expected<>v_allocation.revision OR length(v_reason) NOT BETWEEN 3 AND 500 THEN
   RAISE EXCEPTION 'Confira a origem, o destino, a área e o motivo do remanejamento.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_period FROM public.billing_planning_periods WHERE owner_id=v_owner AND id=v_allocation.period_id AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Somente planos ativos podem ser remanejados.' USING ERRCODE='23514'; END IF;
  SELECT farm_id INTO v_farm_id FROM public.billing_farm_plots WHERE owner_id=v_owner AND id=v_target_plot;
  IF NOT FOUND THEN RAISE EXCEPTION 'Talhão de destino não encontrado.' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_target_allocation FROM public.billing_planning_allocations
   WHERE owner_id=v_owner AND period_id=v_allocation.period_id AND plot_id=v_target_plot AND status='active' FOR UPDATE;
  PERFORM billing_private.planning_v2_assert_plot_capacity(v_owner,v_target_plot,v_period.start_date,v_period.end_date,
   coalesce(v_target_allocation.area_ha,0)+v_moved,v_target_allocation.id);
  IF v_target_allocation.id IS NULL THEN
   INSERT INTO public.billing_planning_allocations(owner_id,period_id,farm_id,plot_id,area_ha,notes,created_by)
    VALUES(v_owner,v_allocation.period_id,v_farm_id,v_target_plot,v_moved,v_allocation.notes,v_actor) RETURNING * INTO v_target_allocation;
  ELSE
   UPDATE public.billing_planning_allocations SET area_ha=area_ha+v_moved,revision=revision+1
    WHERE owner_id=v_owner AND id=v_target_allocation.id RETURNING * INTO v_target_allocation;
  END IF;
  INSERT INTO public.billing_planning_allocation_practices(owner_id,allocation_id,practice_id)
   SELECT owner_id,v_target_allocation.id,practice_id FROM public.billing_planning_allocation_practices
   WHERE owner_id=v_owner AND allocation_id=v_allocation.id ON CONFLICT DO NOTHING;
  IF v_moved=v_allocation.area_ha THEN
   UPDATE public.billing_planning_allocations SET status='cancelled',revision=revision+1 WHERE owner_id=v_owner AND id=v_allocation.id RETURNING * INTO v_allocation;
  ELSE
   UPDATE public.billing_planning_allocations SET area_ha=area_ha-v_moved,revision=revision+1 WHERE owner_id=v_owner AND id=v_allocation.id RETURNING * INTO v_allocation;
  END IF;
  v_snapshot=jsonb_build_object('movedAreaHa',billing_private.decimal_text(v_moved),'source',billing_private.present_planning_v2_allocation(v_allocation),'target',billing_private.present_planning_v2_allocation(v_target_allocation));
  INSERT INTO public.billing_planning_history(owner_id,period_id,allocation_id,entity_type,action,reason,snapshot,created_by)
   VALUES(v_owner,v_allocation.period_id,v_allocation.id,'allocation','remanejado',v_reason,v_snapshot,v_actor);
  RETURN v_snapshot;
 END IF;

 IF p_action='set-practices' THEN
  PERFORM billing_private.planning_v2_assert_payload(p_payload,ARRAY['allocationId','practiceIds','expectedRevision','reason']);
  v_id=nullif(p_payload->>'allocationId','')::uuid;v_expected=coalesce(nullif(p_payload->>'expectedRevision','')::integer,0);
  v_reason=btrim(coalesce(nullif(p_payload->>'reason',''),'Manejos atualizados'));
  IF jsonb_typeof(p_payload->'practiceIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'practiceIds')>100 THEN
   RAISE EXCEPTION 'Selecione uma lista válida de manejos.' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(array_agg(value::uuid),'{}') INTO v_ids FROM jsonb_array_elements_text(p_payload->'practiceIds');
  IF cardinality(v_ids)<>(SELECT count(DISTINCT x) FROM unnest(v_ids) x) THEN RAISE EXCEPTION 'Há manejos repetidos na seleção.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_allocation FROM public.billing_planning_allocations WHERE owner_id=v_owner AND id=v_id AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Distribuição não encontrada.' USING ERRCODE='P0002'; END IF;
  IF v_expected<>v_allocation.revision THEN RAISE EXCEPTION 'Esta distribuição foi alterada em outra sessão. Recarregue antes de salvar.' USING ERRCODE='PT409'; END IF;
  SELECT * INTO v_period FROM public.billing_planning_periods WHERE owner_id=v_owner AND id=v_allocation.period_id;
  IF cardinality(v_ids)<>(SELECT count(*) FROM public.billing_cultural_practices cp WHERE cp.owner_id=v_owner AND cp.id=ANY(v_ids)
    AND cp.culture_id=v_period.culture_id AND cp.culture_subtype_id=v_period.culture_subtype_id) THEN
   RAISE EXCEPTION 'Selecione somente manejos cadastrados para a cultura e o ciclo do plano.' USING ERRCODE='23503';
  END IF;
  DELETE FROM public.billing_planning_allocation_practices WHERE owner_id=v_owner AND allocation_id=v_id;
  INSERT INTO public.billing_planning_allocation_practices(owner_id,allocation_id,practice_id)
   SELECT v_owner,v_id,unnest(v_ids);
  UPDATE public.billing_planning_allocations SET revision=revision+1 WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_allocation;
  v_snapshot=billing_private.present_planning_v2_allocation(v_allocation);
  INSERT INTO public.billing_planning_history(owner_id,period_id,allocation_id,entity_type,action,reason,snapshot,created_by)
   VALUES(v_owner,v_allocation.period_id,v_id,'management','management',v_reason,v_snapshot,v_actor);
  RETURN jsonb_build_object('allocation',v_snapshot);
 END IF;

 -- set-planted keeps the present occupied area separate from future plans.
 PERFORM billing_private.planning_v2_assert_payload(p_payload,ARRAY['plotId','plantedAreaHa','reason']);
 v_plot_id=nullif(p_payload->>'plotId','')::uuid;v_area=billing_private.planning_v2_number(p_payload->>'plantedAreaHa','Área plantada');
 v_reason=btrim(coalesce(p_payload->>'reason',''));
 IF length(v_reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Informe o motivo da atualização da área plantada.' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text||':planning-v2-plot:'||v_plot_id::text,0));
 SELECT area_ha INTO v_plot_area FROM public.billing_farm_plots WHERE owner_id=v_owner AND id=v_plot_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Talhão não encontrado.' USING ERRCODE='P0002'; END IF;
 WITH points AS (
  SELECT DISTINCT q.start_date AS day FROM public.billing_planning_allocations a JOIN public.billing_planning_periods q
   ON q.owner_id=a.owner_id AND q.id=a.period_id WHERE a.owner_id=v_owner AND a.plot_id=v_plot_id AND a.status='active' AND q.status<>'cancelled'
 ), usage AS (
  SELECT day,(SELECT coalesce(sum(a.area_ha),0) FROM public.billing_planning_allocations a JOIN public.billing_planning_periods q
    ON q.owner_id=a.owner_id AND q.id=a.period_id WHERE a.owner_id=v_owner AND a.plot_id=v_plot_id AND a.status='active'
     AND q.status<>'cancelled' AND day BETWEEN q.start_date AND q.end_date) amount FROM points
 ) SELECT coalesce(max(amount),0) INTO v_peak FROM usage;
 IF v_area+v_peak>v_plot_area THEN RAISE EXCEPTION 'A área plantada e a maior ocupação planejada ultrapassam a área do talhão.' USING ERRCODE='23514'; END IF;
 UPDATE public.billing_farm_plots SET planted_area_ha=v_area WHERE owner_id=v_owner AND id=v_plot_id;
 SELECT farm_id INTO v_farm_id FROM public.billing_farm_plots WHERE owner_id=v_owner AND id=v_plot_id;
 v_snapshot=jsonb_build_object('plotId',v_plot_id,'farmId',v_farm_id,'plantedAreaHa',billing_private.decimal_text(v_area));
 INSERT INTO public.billing_planning_history(owner_id,entity_type,action,reason,snapshot,created_by)
  VALUES(v_owner,'plot','planted-area',v_reason,v_snapshot,v_actor);
 RETURN jsonb_build_object('plot',v_snapshot);
EXCEPTION
 WHEN unique_violation THEN RAISE EXCEPTION 'Já existe uma distribuição ativa para este talhão no plano.' USING ERRCODE='23505';
 WHEN invalid_text_representation OR numeric_value_out_of_range OR array_subscript_error THEN
  RAISE EXCEPTION 'Informe valores e identificadores válidos.' USING ERRCODE='22023';
END $$;

REVOKE ALL ON FUNCTION billing_private.planning_v2_assert_payload(jsonb,text[]),
 billing_private.planning_v2_number(text,text,boolean),billing_private.planning_v2_date(text),
 billing_private.present_planning_v2_period(public.billing_planning_periods),
 billing_private.present_planning_v2_allocation(public.billing_planning_allocations),
 billing_private.planning_v2_assert_plot_capacity(uuid,uuid,date,date,numeric,uuid),
 billing_private.planning_v2_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.planning_v2_dispatch(text,jsonb) TO authenticated;

DO $$
DECLARE v_definition text;v_removed text;
BEGIN
 SELECT pg_get_functiondef('public.billing_rpc(text,text,jsonb)'::regprocedure) INTO v_definition;
 v_removed='IF p_resource IN (''planning'',''planning-goals'',''planning-executions'') THEN RAISE EXCEPTION ''Este módulo foi removido. Acesse Agenda ou Resumo.'' USING ERRCODE=''22023''; END IF;';
 IF strpos(v_definition,v_removed)=0 THEN RAISE EXCEPTION 'Unexpected billing_rpc definition while restoring Planning'; END IF;
 v_definition=replace(v_definition,v_removed,
  'IF p_resource=''planning'' THEN RETURN billing_private.planning_v2_dispatch(p_action,p_payload); END IF;'
  ||E'\n IF p_resource IN (''planning-goals'',''planning-executions'') THEN RAISE EXCEPTION ''Este contrato antigo de planejamento permanece desativado.'' USING ERRCODE=''22023''; END IF;');
 EXECUTE v_definition;
END $$;

COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS
 'Authenticated workspace RPC. Planning periods, planted baselines, plot allocations, management links and audit history are server-authorized and capacity-checked.';
