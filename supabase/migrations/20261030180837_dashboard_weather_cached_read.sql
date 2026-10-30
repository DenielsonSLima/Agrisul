BEGIN;
-- Dashboard reads stored references only. The scheduled collector owns refreshes.
CREATE FUNCTION billing_private.dashboard_weather_read(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=auth.uid();v_ids text[];v_cities jsonb;
BEGIN
 IF v_owner IS NULL THEN RAISE EXCEPTION 'Entre para acompanhar a previsão.' USING ERRCODE='28000'; END IF;
 IF p_action IS DISTINCT FROM 'get' OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR
  EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k<>'cityIds') OR
  jsonb_typeof(p_payload->'cityIds') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Consulta de clima inválida.' USING ERRCODE='22023';
 END IF;
 IF jsonb_array_length(p_payload->'cityIds')>20 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'cityIds') x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}'!~'^[0-9]{7}$') THEN
  RAISE EXCEPTION 'Selecione até 20 cidades válidas.' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(array_agg(x),ARRAY[]::text[]) INTO v_ids FROM jsonb_array_elements_text(p_payload->'cityIds') x;
 IF cardinality(v_ids)<>(SELECT count(DISTINCT x) FROM unnest(v_ids) x) THEN RAISE EXCEPTION 'Não repita cidades.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(v_ids) x WHERE NOT EXISTS(SELECT 1 FROM public.billing_weather_cities s WHERE s.owner_id=v_owner AND s.city_id=x)) THEN
  RAISE EXCEPTION 'Cidade não selecionada na sua conta.' USING ERRCODE='42501';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('city',jsonb_build_object('id',c.city_id,'name',c.name,'state',c.state),
  'payload',f.payload,'fetchedAt',to_char(f.fetched_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY s.position),'[]'::jsonb)
 INTO v_cities FROM public.billing_weather_cities s JOIN billing_private.weather_cities c USING(city_id)
 LEFT JOIN billing_private.weather_forecasts f USING(city_id) WHERE s.owner_id=v_owner AND s.city_id=ANY(v_ids);
 RETURN jsonb_build_object('cities',v_cities,'checkedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END $$;
REVOKE ALL ON FUNCTION billing_private.dashboard_weather_read(text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION billing_private.dashboard_weather_read(text,jsonb) TO authenticated;
DO $route$
DECLARE definition text:=pg_get_functiondef('public.billing_rpc(text,text,jsonb)'::regprocedure);anchor text:='PERFORM billing_private.ensure_actor_workspace();';
BEGIN
 IF strpos(definition,anchor)=0 OR strpos(definition,'''dashboard-weather''')>0 THEN RAISE EXCEPTION 'Inspect RPC before adding weather cache reads.'; END IF;
 EXECUTE replace(definition,anchor,anchor||E'\n IF p_resource=''dashboard-weather'' THEN RETURN billing_private.dashboard_weather_read(p_action,p_payload); END IF;');
END $route$;
COMMIT;
