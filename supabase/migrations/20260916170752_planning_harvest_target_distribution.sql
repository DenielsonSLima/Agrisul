CREATE TABLE public.billing_planning_harvest_targets (
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 period_id uuid NOT NULL,
 farm_id uuid NOT NULL,
 plot_id uuid NOT NULL,
 target_tons numeric(15,6) NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,period_id,plot_id),
 CHECK(target_tons>0 AND target_tons<1000000000),
 FOREIGN KEY(owner_id,period_id) REFERENCES public.billing_planning_periods(owner_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(owner_id,farm_id) REFERENCES public.billing_farms(owner_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(owner_id,farm_id,plot_id) REFERENCES public.billing_farm_plots(owner_id,farm_id,id) ON DELETE RESTRICT
);

CREATE INDEX billing_planning_harvest_targets_plot
 ON public.billing_planning_harvest_targets(owner_id,plot_id,period_id);

ALTER TABLE public.billing_planning_harvest_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_planning_harvest_targets REPLICA IDENTITY FULL;
REVOKE ALL ON public.billing_planning_harvest_targets FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_planning_harvest_targets TO authenticated;
CREATE POLICY billing_planning_harvest_targets_read ON public.billing_planning_harvest_targets
 FOR SELECT TO authenticated USING(billing_private.can_access_owner(owner_id,'registrations.read'));

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND
    NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime'
     AND schemaname='public' AND tablename='billing_planning_harvest_targets') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_planning_harvest_targets;
 END IF;
END $$;

-- Preserve existing goals. The former model only stored a general target, so
-- its first distribution is proportional to the area allocated to each plot.
-- If no allocated area exists, the target is divided equally across the scope.
WITH scoped AS (
 SELECT period.owner_id,period.id period_id,period.harvest_target_tons,scope.farm_id,scope.plot_id,
  coalesce(allocation.area_ha,0) weight,
  sum(coalesce(allocation.area_ha,0)) OVER(PARTITION BY period.owner_id,period.id) total_weight,
  count(*) OVER(PARTITION BY period.owner_id,period.id) scope_count,
  row_number() OVER(PARTITION BY period.owner_id,period.id ORDER BY scope.farm_id,scope.plot_id) position
 FROM public.billing_planning_periods period
 JOIN billing_private.planning_v5_harvest_scope(period.owner_id,period.id) scope ON true
 LEFT JOIN public.billing_planning_allocations allocation ON allocation.owner_id=period.owner_id
  AND allocation.period_id=period.id AND allocation.farm_id=scope.farm_id AND allocation.plot_id=scope.plot_id
  AND allocation.status='active'
 WHERE period.harvest_target_tons>0
), weighted AS (
 SELECT *,round(harvest_target_tons*CASE WHEN total_weight>0 THEN weight/total_weight ELSE 1::numeric/scope_count END,6) base_target
 FROM scoped
), adjusted AS (
 SELECT *,CASE WHEN position=scope_count THEN greatest(harvest_target_tons-coalesce(sum(base_target) OVER(
   PARTITION BY owner_id,period_id ORDER BY position ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0),0)
  ELSE base_target END final_target
 FROM weighted
)
INSERT INTO public.billing_planning_harvest_targets(owner_id,period_id,farm_id,plot_id,target_tons,created_by)
SELECT owner_id,period_id,farm_id,plot_id,final_target,owner_id FROM adjusted WHERE final_target>0;

CREATE OR REPLACE FUNCTION billing_private.planning_v6_harvest_comparison(p_owner uuid,p_period uuid) RETURNS jsonb
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
   coalesce(target.target_tons,0) harvest_target_tons,
   coalesce(loads.harvested_tons,0) harvested_tons,
   greatest(coalesce(target.target_tons,0)-coalesce(loads.harvested_tons,0),0) harvest_remaining_tons,
   CASE WHEN coalesce(target.target_tons,0)=0 THEN 0
    ELSE least(100,coalesce(loads.harvested_tons,0)*100/target.target_tons) END harvest_percent,
   coalesce(loads.load_count,0)::integer harvest_load_count
  FROM selected_period season
  JOIN billing_private.planning_v5_harvest_scope(p_owner,season.id) scope ON true
  JOIN public.billing_farms f ON f.owner_id=p_owner AND f.id=scope.farm_id
  JOIN public.billing_farm_plots p ON p.owner_id=p_owner AND p.farm_id=f.id AND p.id=scope.plot_id
  LEFT JOIN public.billing_planning_allocations a ON a.owner_id=p_owner AND a.period_id=season.id
   AND a.farm_id=f.id AND a.plot_id=p.id AND a.status='active'
  LEFT JOIN public.billing_planning_harvest_targets target ON target.owner_id=p_owner
   AND target.period_id=season.id AND target.farm_id=f.id AND target.plot_id=p.id
  LEFT JOIN LATERAL (
   SELECT coalesce(sum(l.volume),0) harvested_tons,count(*)::integer load_count
   FROM public.billing_contract_loads l
   WHERE l.owner_id=p_owner AND l.farm_id=f.id AND l.plot_id=p.id
    AND l.loaded_at BETWEEN season.start_date AND season.end_date
  ) loads ON true
 ), farm_metrics AS (
  SELECT farm_id,farm_name,
   sum(target_area_ha) target_area_ha,sum(planted_area_ha) planted_area_ha,sum(remaining_area_ha) remaining_area_ha,
   CASE WHEN sum(target_area_ha)=0 THEN 0 ELSE least(100,sum(planted_area_ha)*100/sum(target_area_ha)) END planting_percent,
   sum(harvest_target_tons) harvest_target_tons,sum(harvested_tons) harvested_tons,
   greatest(sum(harvest_target_tons)-sum(harvested_tons),0) harvest_remaining_tons,
   CASE WHEN sum(harvest_target_tons)=0 THEN 0 ELSE least(100,sum(harvested_tons)*100/sum(harvest_target_tons)) END harvest_percent,
   sum(harvest_load_count)::integer harvest_load_count,
   jsonb_agg(jsonb_build_object(
    'plotId',plot_id,'plotName',plot_name,
    'targetAreaHa',billing_private.decimal_text(target_area_ha),
    'plantedAreaHa',billing_private.decimal_text(planted_area_ha),
    'remainingAreaHa',billing_private.decimal_text(remaining_area_ha),
    'plantingPercent',billing_private.decimal_text(planting_percent),
    'targetTons',billing_private.decimal_text(harvest_target_tons),
    'harvestedTons',billing_private.decimal_text(harvested_tons),
    'remainingTons',billing_private.decimal_text(harvest_remaining_tons),
    'harvestPercent',billing_private.decimal_text(harvest_percent),
    'harvestLoadCount',harvest_load_count
   ) ORDER BY lower(plot_name),plot_id) plots
  FROM plot_metrics GROUP BY farm_id,farm_name
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'farmId',farm_id,'farmName',farm_name,
  'targetAreaHa',billing_private.decimal_text(target_area_ha),
  'plantedAreaHa',billing_private.decimal_text(planted_area_ha),
  'remainingAreaHa',billing_private.decimal_text(remaining_area_ha),
  'plantingPercent',billing_private.decimal_text(planting_percent),
  'targetTons',billing_private.decimal_text(harvest_target_tons),
  'harvestedTons',billing_private.decimal_text(harvested_tons),
  'remainingTons',billing_private.decimal_text(harvest_remaining_tons),
  'harvestPercent',billing_private.decimal_text(harvest_percent),
  'harvestLoadCount',harvest_load_count,'plots',plots
 ) ORDER BY lower(farm_name),farm_id),'[]'::jsonb)
 FROM farm_metrics
$$;

CREATE FUNCTION billing_private.planning_v7_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_actor uuid:=auth.uid();v_payload jsonb:=coalesce(p_payload,'{}'::jsonb);
 v_period public.billing_planning_periods%ROWTYPE;v_period_id uuid;v_target numeric;v_distributed numeric;
 v_expected integer;v_reason text;v_ids uuid[];v_snapshot jsonb;
BEGIN
 IF p_action<>'save-harvest-goal' THEN RETURN billing_private.planning_v6_dispatch(p_action,p_payload); END IF;
 IF v_actor IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o planejamento.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize('registrations.write');
 IF NOT(v_payload?'targets') THEN
  RAISE EXCEPTION 'Atualize a tela do Planejamento para distribuir a meta entre os talhões.' USING ERRCODE='22023';
 END IF;
 PERFORM billing_private.planning_v2_assert_payload(v_payload,ARRAY['periodId','targetTons','targets','expectedRevision','reason']);
 v_period_id=nullif(v_payload->>'periodId','')::uuid;
 v_target=billing_private.planning_v2_number(v_payload->>'targetTons','Meta geral de colheita');
 v_expected=coalesce(nullif(v_payload->>'expectedRevision','')::integer,0);
 v_reason=btrim(coalesce(v_payload->>'reason',''));
 IF jsonb_typeof(v_payload->'targets') IS DISTINCT FROM 'array' OR jsonb_array_length(v_payload->'targets')>500
    OR length(v_reason) NOT BETWEEN 3 AND 500 THEN
  RAISE EXCEPTION 'Informe a meta geral, a distribuição por talhão e o motivo da alteração.' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_payload->'targets') row(item) WHERE jsonb_typeof(item)<>'object') THEN
  RAISE EXCEPTION 'A distribuição por talhão é inválida.' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_payload->'targets') row(item)
   WHERE NOT(item?'plotId') OR NOT(item?'targetTons') OR EXISTS(
    SELECT 1 FROM jsonb_object_keys(item) keys(key) WHERE key NOT IN('plotId','targetTons'))) THEN
  RAISE EXCEPTION 'Cada distribuição deve informar somente o talhão e sua meta.' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(array_agg((item->>'plotId')::uuid),'{}'),
  coalesce(sum(billing_private.planning_v2_number(item->>'targetTons','Meta do talhão')),0)
  INTO v_ids,v_distributed FROM jsonb_array_elements(v_payload->'targets') row(item);
 IF cardinality(v_ids)<>(SELECT count(DISTINCT id) FROM unnest(v_ids) id) THEN
  RAISE EXCEPTION 'Cada talhão pode aparecer somente uma vez na distribuição.' USING ERRCODE='23505';
 END IF;
 IF v_distributed<>v_target OR (v_target>0 AND cardinality(v_ids)=0) THEN
  RAISE EXCEPTION 'A soma das metas dos talhões deve ser exatamente igual à meta geral de colheita.' USING ERRCODE='23514';
 END IF;
 SELECT * INTO v_period FROM public.billing_planning_periods WHERE owner_id=v_owner AND id=v_period_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Safra não encontrada.' USING ERRCODE='P0002'; END IF;
 IF v_period.revision<>v_expected THEN
  RAISE EXCEPTION 'Esta safra foi alterada em outra sessão. Recarregue antes de salvar.' USING ERRCODE='PT409';
 END IF;
 IF (SELECT count(*) FROM public.billing_farm_plots p WHERE p.owner_id=v_owner AND p.id=ANY(v_ids))<>cardinality(v_ids) THEN
  RAISE EXCEPTION 'Distribua a meta somente entre talhões deste espaço de trabalho.' USING ERRCODE='23503';
 END IF;
 UPDATE public.billing_planning_periods SET harvest_target_tons=v_target,revision=revision+1
  WHERE owner_id=v_owner AND id=v_period_id RETURNING * INTO v_period;
 DELETE FROM public.billing_planning_harvest_plots WHERE owner_id=v_owner AND period_id=v_period_id;
 DELETE FROM public.billing_planning_harvest_targets WHERE owner_id=v_owner AND period_id=v_period_id;
 INSERT INTO public.billing_planning_harvest_targets(owner_id,period_id,farm_id,plot_id,target_tons,created_by)
  SELECT v_owner,v_period_id,p.farm_id,p.id,
   billing_private.planning_v2_number(item->>'targetTons','Meta do talhão'),v_actor
  FROM jsonb_array_elements(v_payload->'targets') row(item)
  JOIN public.billing_farm_plots p ON p.owner_id=v_owner AND p.id=(item->>'plotId')::uuid
  WHERE billing_private.planning_v2_number(item->>'targetTons','Meta do talhão')>0;
 INSERT INTO public.billing_planning_harvest_plots(owner_id,period_id,farm_id,plot_id,created_by)
  SELECT owner_id,period_id,farm_id,plot_id,v_actor FROM public.billing_planning_harvest_targets
  WHERE owner_id=v_owner AND period_id=v_period_id;
 v_snapshot=billing_private.present_planning_v2_period(v_period)||jsonb_build_object(
  'harvestComparison',billing_private.planning_v6_harvest_comparison(v_owner,v_period_id));
 INSERT INTO public.billing_planning_history(owner_id,period_id,entity_type,action,reason,snapshot,created_by)
  VALUES(v_owner,v_period_id,'harvest-goal','updated',v_reason,v_snapshot,v_actor);
 RETURN jsonb_build_object('period',billing_private.present_planning_v2_period(v_period));
EXCEPTION
 WHEN invalid_text_representation OR numeric_value_out_of_range OR array_subscript_error THEN
  RAISE EXCEPTION 'Informe valores e identificadores válidos na distribuição da colheita.' USING ERRCODE='22023';
END $$;

REVOKE ALL ON FUNCTION billing_private.planning_v7_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.planning_v7_dispatch(text,jsonb) TO authenticated;

DO $$
DECLARE v_definition text;v_old text;v_new text;
BEGIN
 v_definition=pg_get_functiondef('public.billing_rpc(text,text,jsonb)'::regprocedure);
 v_old='IF p_resource=''planning'' THEN RETURN billing_private.planning_v6_dispatch(p_action,p_payload); END IF;';
 v_new='IF p_resource=''planning'' THEN RETURN billing_private.planning_v7_dispatch(p_action,p_payload); END IF;';
 IF strpos(v_definition,v_old)=0 THEN
  IF strpos(v_definition,v_new)=0 THEN RAISE EXCEPTION 'O contrato RPC instalado não corresponde ao Planejamento esperado.'; END IF;
 ELSE EXECUTE replace(v_definition,v_old,v_new);
 END IF;
END $$;

REVOKE ALL ON FUNCTION public.billing_rpc(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_rpc(text,text,jsonb) TO authenticated;
