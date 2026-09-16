-- Planning submodules share one plot allocation contract. The farm/plot pairing,
-- permitted modules and area capacity are enforced in Postgres, never inferred
-- from selectors rendered by the browser.
ALTER TABLE public.billing_farm_plots
  ADD CONSTRAINT billing_farm_plots_owner_farm_id_id_key UNIQUE(owner_id,farm_id,id);

CREATE TABLE public.billing_planning_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  module text NOT NULL CHECK(module IN ('metas','plantio','quebra-de-lombo','herbicidas','mudas','preparacao-de-solo')),
  farm_id uuid NOT NULL,
  plot_id uuid NOT NULL,
  area_ha numeric(15,6) NOT NULL CHECK(area_ha>0 AND area_ha<1000000000),
  UNIQUE(owner_id,id),
  UNIQUE(owner_id,module,plot_id),
  FOREIGN KEY(owner_id,farm_id) REFERENCES public.billing_farms(owner_id,id) ON DELETE CASCADE,
  FOREIGN KEY(owner_id,farm_id,plot_id) REFERENCES public.billing_farm_plots(owner_id,farm_id,id) ON DELETE CASCADE
);
ALTER TABLE public.billing_planning_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_planning_entries FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_planning_entries TO authenticated;
CREATE POLICY billing_planning_entries_read ON public.billing_planning_entries
 FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'registrations.read'));
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_planning_entries
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();

CREATE FUNCTION billing_private.present_planning_entry(p_entry public.billing_planning_entries)
RETURNS jsonb LANGUAGE sql STABLE STRICT SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p_entry.id,
  'module',p_entry.module,
  'farmId',p_entry.farm_id,
  'farmName',f.name,
  'plotId',p_entry.plot_id,
  'plotName',p.name,
  'plotAreaHa',billing_private.decimal_text(p.area_ha),
  'areaHa',billing_private.decimal_text(p_entry.area_ha),
  'createdAt',p_entry.created_at,
  'updatedAt',p_entry.updated_at
 )
 FROM public.billing_farms f
 JOIN public.billing_farm_plots p
  ON p.owner_id=p_entry.owner_id AND p.farm_id=p_entry.farm_id AND p.id=p_entry.plot_id
 WHERE f.owner_id=p_entry.owner_id AND f.id=p_entry.farm_id
$$;
REVOKE ALL ON FUNCTION billing_private.present_planning_entry(public.billing_planning_entries) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.planning_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;
 v_module text;
 v_farm_id uuid;
 v_plot_id uuid;
 v_area_text text;
 v_plot_area numeric;
 v_entry public.billing_planning_entries%ROWTYPE;
 v_farms jsonb;
 v_groups jsonb;
 v_summary jsonb;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_action NOT IN ('list','save','delete') THEN
  RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023';
 END IF;
 PERFORM billing_private.authorize('registrations.'||CASE WHEN p_action='list' THEN 'read' ELSE 'write' END);

 v_module=btrim(coalesce(p_payload->>'module',''));
 IF v_module NOT IN ('metas','plantio','quebra-de-lombo','herbicidas','mudas','preparacao-de-solo') THEN
  RAISE EXCEPTION 'Selecione um submódulo de planejamento válido.' USING ERRCODE='22023';
 END IF;

 IF p_action='list' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',f.id,
   'name',f.name,
   'plots',coalesce((
    SELECT jsonb_agg(jsonb_build_object(
     'id',p.id,'name',p.name,'areaHa',billing_private.decimal_text(p.area_ha)
    ) ORDER BY lower(p.name),p.id)
    FROM public.billing_farm_plots p
    WHERE p.owner_id=f.owner_id AND p.farm_id=f.id
   ),'[]'::jsonb)
  ) ORDER BY lower(f.name),f.id),'[]'::jsonb)
  INTO v_farms
  FROM public.billing_farms f
  WHERE f.owner_id=v_owner;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'farmId',f.id,
   'farmName',f.name,
   'totalAreaHa',billing_private.decimal_text(t.total_area),
   'entries',(
    SELECT jsonb_agg(billing_private.present_planning_entry(e) ORDER BY lower(p.name),e.id)
    FROM public.billing_planning_entries e
    JOIN public.billing_farm_plots p
     ON p.owner_id=e.owner_id AND p.farm_id=e.farm_id AND p.id=e.plot_id
    WHERE e.owner_id=v_owner AND e.module=v_module AND e.farm_id=f.id
   )
  ) ORDER BY lower(f.name),f.id),'[]'::jsonb)
  INTO v_groups
  FROM public.billing_farms f
  JOIN LATERAL (
   SELECT sum(e.area_ha) AS total_area
   FROM public.billing_planning_entries e
   WHERE e.owner_id=v_owner AND e.module=v_module AND e.farm_id=f.id
  ) t ON t.total_area IS NOT NULL
  WHERE f.owner_id=v_owner;

  SELECT jsonb_build_object(
   'entryCount',count(*)::integer,
   'farmCount',count(DISTINCT farm_id)::integer,
   'totalAreaHa',billing_private.decimal_text(coalesce(sum(area_ha),0))
  ) INTO v_summary
  FROM public.billing_planning_entries
  WHERE owner_id=v_owner AND module=v_module;

  RETURN jsonb_build_object('farms',v_farms,'groups',v_groups,'summary',v_summary);
 END IF;

 v_id=nullif(p_payload->>'id','')::uuid;
 IF p_action='delete' THEN
  IF v_id IS NULL THEN RAISE EXCEPTION 'Informe o lançamento.' USING ERRCODE='22023'; END IF;
  DELETE FROM public.billing_planning_entries
   WHERE owner_id=v_owner AND id=v_id AND module=v_module
   RETURNING * INTO v_entry;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('id',v_id,'deleted',true);
 END IF;

 v_farm_id=nullif(p_payload->>'farmId','')::uuid;
 v_plot_id=nullif(p_payload->>'plotId','')::uuid;
 v_area_text=replace(btrim(coalesce(p_payload->>'areaHa','')),',','.');
 IF v_farm_id IS NULL OR v_plot_id IS NULL THEN
  RAISE EXCEPTION 'Selecione a fazenda e o talhão.' USING ERRCODE='22023';
 END IF;
 IF v_area_text!~'^[0-9]{1,9}([.][0-9]{1,6})?$' OR v_area_text::numeric<=0 THEN
  RAISE EXCEPTION 'Informe uma área maior que zero, com até seis casas decimais.' USING ERRCODE='22023';
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
  INSERT INTO public.billing_planning_entries(owner_id,module,farm_id,plot_id,area_ha)
   VALUES(v_owner,v_module,v_farm_id,v_plot_id,v_area_text::numeric)
   RETURNING * INTO v_entry;
 ELSE
  UPDATE public.billing_planning_entries SET
   farm_id=v_farm_id,plot_id=v_plot_id,area_ha=v_area_text::numeric
   WHERE owner_id=v_owner AND id=v_id AND module=v_module
   RETURNING * INTO v_entry;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE='P0002'; END IF;
 END IF;
 RETURN jsonb_build_object('entry',billing_private.present_planning_entry(v_entry));
EXCEPTION
 WHEN unique_violation THEN
  RAISE EXCEPTION 'Este talhão já foi lançado neste submódulo. Abra o registro para editar a área.' USING ERRCODE='23505';
 WHEN not_null_violation THEN
  RAISE EXCEPTION 'Verifique o submódulo, a fazenda, o talhão e a área informada.' USING ERRCODE='22023';
 WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Informe valores e identificadores válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.planning_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.planning_dispatch(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.billing_rpc(p_resource text,p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.ensure_actor_workspace();
 IF p_resource IN ('settings','profile') THEN RETURN billing_private.workspace_settings(p_action,p_payload); END IF;
 IF p_resource='users' THEN RETURN billing_private.users_dispatch(p_action,p_payload); END IF;
 IF p_resource='access-profiles' THEN RETURN billing_private.access_profiles_dispatch(p_action,p_payload); END IF;
 IF p_resource='report-headers' THEN RETURN billing_private.report_headers_dispatch(p_action,p_payload); END IF;
 IF p_resource='planning' THEN RETURN billing_private.planning_dispatch(p_action,p_payload); END IF;
 PERFORM billing_private.authorize_resource(p_resource,p_action);
 IF p_resource='atr' THEN RETURN billing_private.atr_dispatch(p_action,p_payload); END IF;
 IF p_resource='farms' AND p_action='list' THEN RETURN billing_private.farm_summary_list(); END IF;
 IF p_resource='companies' AND p_action='save' THEN RETURN billing_private.save_company(p_payload); END IF;
 IF p_resource IN ('watermark','watermarks') THEN RETURN billing_private.watermark_variants(p_action,p_payload); END IF;
 RETURN billing_private.dispatch(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION public.billing_rpc(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_rpc(text,text,jsonb) TO authenticated;
COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS 'Authenticated workspace RPC. Planning allocations are validated against owner-scoped farm and plot capacity in Postgres.';

DO $realtime$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND
    NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='billing_planning_entries') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_planning_entries;
 END IF;
END $realtime$;
