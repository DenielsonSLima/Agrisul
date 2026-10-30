BEGIN;
-- Public meteorological reference data, never company records or city preferences.
CREATE TABLE billing_private.weather_forecasts(
 city_id text PRIMARY KEY CHECK(city_id ~ '^[0-9]{7}$'),
 source text NOT NULL DEFAULT 'INMET' CHECK(source='INMET'),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=131072),
 fetched_at timestamptz NOT NULL,
 CHECK(jsonb_typeof(payload->city_id)='object')
);
ALTER TABLE billing_private.weather_forecasts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON billing_private.weather_forecasts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION billing_private.dashboard_weather_cache(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id text:=p_payload->>'cityId';v_at timestamptz;v_result jsonb;v_changed boolean;
BEGIN
 IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Coletor não autorizado.' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR v_id IS NULL OR v_id!~'^[0-9]{7}$' OR
  EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('cityId','payload','fetchedAt')) THEN
  RAISE EXCEPTION 'Consulta de clima inválida.' USING ERRCODE='22023';
 END IF;
 IF p_action='get' THEN
  SELECT jsonb_build_object('payload',payload,'fetchedAt',to_char(fetched_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) INTO v_result
   FROM billing_private.weather_forecasts WHERE city_id=v_id;
  RETURN v_result;
 END IF;
 IF p_action<>'save' OR jsonb_typeof(p_payload->'payload') IS DISTINCT FROM 'object' OR
  jsonb_typeof(p_payload->'payload'->v_id) IS DISTINCT FROM 'object' OR octet_length((p_payload->'payload')::text)>131072 OR
  jsonb_typeof(p_payload->'fetchedAt') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Previsão inválida.' USING ERRCODE='22023';
 END IF;
 v_at:=(p_payload->>'fetchedAt')::timestamptz;
 IF v_at IS NULL OR v_at>now()+interval '1 minute' OR v_at<now()-interval '24 hours' THEN
  RAISE EXCEPTION 'Data da consulta inválida.' USING ERRCODE='22023';
 END IF;
 INSERT INTO billing_private.weather_forecasts(city_id,payload,fetched_at) VALUES(v_id,p_payload->'payload',v_at)
 ON CONFLICT(city_id) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at
 WHERE excluded.fetched_at>=weather_forecasts.fetched_at RETURNING true INTO v_changed;
 RETURN jsonb_build_object('saved',coalesce(v_changed,false));
END $$;
REVOKE ALL ON FUNCTION billing_private.dashboard_weather_cache(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.dashboard_weather_cache(text,jsonb) TO service_role;
GRANT USAGE ON SCHEMA billing_private TO service_role;
CREATE FUNCTION public.dashboard_weather_cache(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT billing_private.dashboard_weather_cache(p_action,p_payload) $$;
REVOKE ALL ON FUNCTION public.dashboard_weather_cache(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_weather_cache(text,jsonb) TO service_role;
COMMIT;
