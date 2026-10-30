BEGIN;
CREATE TABLE billing_private.weather_cities(
 city_id text PRIMARY KEY CHECK(city_id ~ '^[0-9]{7}$'),name text NOT NULL CHECK(length(name) BETWEEN 2 AND 100),
 state text NOT NULL CHECK(state ~ '^[A-Z]{2}$'),next_refresh_at timestamptz NOT NULL DEFAULT '-infinity',
 lease_token uuid,lease_until timestamptz,last_attempt_at timestamptz,last_error text,
 CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
INSERT INTO billing_private.weather_cities(city_id,name,state) VALUES
 ('2803302','Japaratuba','SE'),('2803401','Japoatã','SE'),('2704302','Maceió','AL'),('2804904','Pacatuba','SE'),('2927408','Salvador','BA');
CREATE TABLE public.billing_weather_settings(
 owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,revision bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.billing_weather_cities(
 owner_id uuid NOT NULL REFERENCES public.billing_weather_settings(owner_id) ON DELETE CASCADE,
 city_id text NOT NULL REFERENCES billing_private.weather_cities(city_id),position integer NOT NULL CHECK(position>=0),
 PRIMARY KEY(owner_id,city_id),UNIQUE(owner_id,position)
);
CREATE INDEX billing_weather_cities_city_idx ON public.billing_weather_cities(city_id);
CREATE TABLE billing_private.weather_refresh_log(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,city_id text NOT NULL REFERENCES billing_private.weather_cities(city_id),
 attempted_at timestamptz NOT NULL DEFAULT now(),status text NOT NULL CHECK(status IN ('success','error')),error text CHECK(length(error)<=500)
);
CREATE INDEX weather_refresh_log_time_idx ON billing_private.weather_refresh_log(attempted_at);
ALTER TABLE billing_private.weather_cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_private.weather_refresh_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_weather_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_weather_cities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON billing_private.weather_cities,billing_private.weather_refresh_log FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.billing_weather_settings,public.billing_weather_cities FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.billing_weather_settings,public.billing_weather_cities TO authenticated;
CREATE POLICY weather_settings_owner ON public.billing_weather_settings FOR SELECT TO authenticated USING(owner_id=(SELECT auth.uid()));
CREATE POLICY weather_cities_owner ON public.billing_weather_cities FOR SELECT TO authenticated USING(owner_id=(SELECT auth.uid()));

CREATE FUNCTION billing_private.weather_preferences_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=auth.uid();v_revision bigint;v_count integer;v_id text;v_ids text[];v_changed integer:=0;
BEGIN
 IF v_owner IS NULL THEN RAISE EXCEPTION 'Entre para configurar a previsão.' USING ERRCODE='28000'; END IF;
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE
  NOT ((p_action='initialize' AND k='cityIds') OR (p_action IN ('add','remove') AND k='cityId'))) THEN
  RAISE EXCEPTION 'Preferências inválidas.' USING ERRCODE='22023'; END IF;
 IF p_action NOT IN ('get','initialize','add','remove','reset') THEN RAISE EXCEPTION 'Ação inválida.' USING ERRCODE='22023'; END IF;
 IF p_action='initialize' THEN
  IF jsonb_typeof(p_payload->'cityIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'cityIds')>20 OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'cityIds') x WHERE jsonb_typeof(x)<>'string') THEN
   RAISE EXCEPTION 'Selecione até 20 cidades válidas.' USING ERRCODE='22023'; END IF;
  SELECT coalesce(array_agg(x),ARRAY[]::text[]) INTO v_ids FROM jsonb_array_elements_text(p_payload->'cityIds') x;
  IF cardinality(v_ids)<>(SELECT count(DISTINCT x) FROM unnest(v_ids) x) OR EXISTS(SELECT 1 FROM unnest(v_ids) x WHERE NOT EXISTS(SELECT 1 FROM billing_private.weather_cities c WHERE c.city_id=x)) THEN
   RAISE EXCEPTION 'Cidade não encontrada no IBGE.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.billing_weather_settings(owner_id) VALUES(v_owner) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_changed=ROW_COUNT;
  IF v_changed=1 THEN
   INSERT INTO public.billing_weather_cities(owner_id,city_id,position) SELECT v_owner,x,(n-1)::integer FROM unnest(v_ids) WITH ORDINALITY s(x,n);
  END IF;
 END IF;
 SELECT revision INTO v_revision FROM public.billing_weather_settings WHERE owner_id=v_owner FOR UPDATE;
 IF v_revision IS NULL THEN
  IF p_action<>'get' THEN RAISE EXCEPTION 'Carregue as preferências antes de alterá-las.' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('configured',false,'cities','[]'::jsonb,'revision','0');
 END IF;
 IF p_action IN ('add','remove') THEN
  v_id:=p_payload->>'cityId';
  IF v_id IS NULL OR v_id!~'^[0-9]{7}$' OR NOT EXISTS(SELECT 1 FROM billing_private.weather_cities WHERE city_id=v_id) THEN RAISE EXCEPTION 'Cidade não encontrada no IBGE.' USING ERRCODE='22023'; END IF;
  IF p_action='add' AND NOT EXISTS(SELECT 1 FROM public.billing_weather_cities WHERE owner_id=v_owner AND city_id=v_id) THEN
   SELECT count(*) INTO v_count FROM public.billing_weather_cities WHERE owner_id=v_owner;
   IF v_count>=20 THEN RAISE EXCEPTION 'Selecione até 20 cidades.' USING ERRCODE='22023'; END IF;
   INSERT INTO public.billing_weather_cities(owner_id,city_id,position) SELECT v_owner,v_id,coalesce(max(position)+1,0) FROM public.billing_weather_cities WHERE owner_id=v_owner;
   v_changed:=1;
  ELSIF p_action='remove' THEN
   DELETE FROM public.billing_weather_cities WHERE owner_id=v_owner AND city_id=v_id;GET DIAGNOSTICS v_changed=ROW_COUNT;
  END IF;
 ELSIF p_action='reset' THEN
  DELETE FROM public.billing_weather_cities WHERE owner_id=v_owner;
  INSERT INTO public.billing_weather_cities(owner_id,city_id,position) SELECT v_owner,x,(n-1)::integer
   FROM unnest(ARRAY['2803302','2803401','2704302','2804904','2927408']) WITH ORDINALITY s(x,n);v_changed:=1;
 END IF;
 IF v_changed>0 AND p_action<>'initialize' THEN
  UPDATE public.billing_weather_settings SET revision=revision+1,updated_at=now() WHERE owner_id=v_owner RETURNING revision INTO v_revision;
 END IF;
 RETURN jsonb_build_object('configured',true,'revision',v_revision::text,'cities',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.city_id,'name',c.name,'state',c.state) ORDER BY s.position)
  FROM public.billing_weather_cities s JOIN billing_private.weather_cities c ON c.city_id=s.city_id WHERE s.owner_id=v_owner),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION billing_private.weather_preferences_dispatch(text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION billing_private.weather_preferences_dispatch(text,jsonb) TO authenticated;
DO $route$
DECLARE definition text:=pg_get_functiondef('public.billing_rpc(text,text,jsonb)'::regprocedure);anchor text:='PERFORM billing_private.ensure_actor_workspace();';
BEGIN
 IF strpos(definition,anchor)=0 OR strpos(definition,'''weather-preferences''')>0 THEN RAISE EXCEPTION 'Inspect RPC before adding weather preferences.'; END IF;
 EXECUTE replace(definition,anchor,anchor||E'\n IF p_resource=''weather-preferences'' THEN RETURN billing_private.weather_preferences_dispatch(p_action,p_payload); END IF;');
END $route$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='billing_weather_settings') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_weather_settings; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='billing_weather_cities') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_weather_cities; END IF;
END $$;

-- Keep the original validated forecast storage, adding a worker-only directory,
-- bounded consultation log and fenced background refresh claims around it.
ALTER FUNCTION billing_private.dashboard_weather_cache(text,jsonb) RENAME TO dashboard_weather_cache_v1;
REVOKE ALL ON FUNCTION billing_private.dashboard_weather_cache_v1(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION billing_private.dashboard_weather_cache(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id text:=p_payload->>'cityId';v_row jsonb;v_result jsonb;v_city billing_private.weather_cities;v_at timestamptz;
BEGIN
 IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Coletor não autorizado.' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Dados inválidos.' USING ERRCODE='22023'; END IF;
 IF p_action='register' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k<>'cities') OR jsonb_typeof(p_payload->'cities') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'cities')>20 THEN RAISE EXCEPTION 'Cidades inválidas.' USING ERRCODE='22023'; END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_payload->'cities') LOOP
   IF jsonb_typeof(v_row) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_row) k WHERE k NOT IN ('id','name','state')) OR coalesce(v_row->>'id','')!~'^[0-9]{7}$' OR
    length(coalesce(v_row->>'name','')) NOT BETWEEN 2 AND 100 OR coalesce(v_row->>'state','')!~'^[A-Z]{2}$' THEN RAISE EXCEPTION 'Cidade inválida.' USING ERRCODE='22023'; END IF;
   INSERT INTO billing_private.weather_cities(city_id,name,state) VALUES(v_row->>'id',v_row->>'name',v_row->>'state')
    ON CONFLICT(city_id) DO UPDATE SET name=excluded.name,state=excluded.state;
  END LOOP;
  RETURN jsonb_build_object('registered',true);
 ELSIF p_action='due' THEN
  IF p_payload<>'{}'::jsonb THEN RAISE EXCEPTION 'Dados inválidos.' USING ERRCODE='22023'; END IF;
  DELETE FROM billing_private.weather_refresh_log WHERE attempted_at<now()-interval '30 days';
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',city_id,'name',name,'state',state)) FROM
   (SELECT c.* FROM billing_private.weather_cities c WHERE c.next_refresh_at<=now() AND coalesce(c.lease_until,'-infinity')<=now()
    AND EXISTS(SELECT 1 FROM public.billing_weather_cities s WHERE s.city_id=c.city_id) ORDER BY c.next_refresh_at,c.city_id LIMIT 20) q),'[]'::jsonb);
 ELSIF p_action IN ('get','save') THEN
  v_result:=billing_private.dashboard_weather_cache_v1(p_action,p_payload);
  IF p_action='save' AND v_result->>'saved'='true' AND EXISTS(SELECT 1 FROM billing_private.weather_cities WHERE city_id=v_id) THEN
   UPDATE billing_private.weather_cities SET next_refresh_at=(p_payload->>'fetchedAt')::timestamptz+interval '30 minutes',last_attempt_at=now(),last_error=NULL WHERE city_id=v_id;
   INSERT INTO billing_private.weather_refresh_log(city_id,status) VALUES(v_id,'success');
  END IF;
  RETURN v_result;
 END IF;
 IF v_id IS NULL OR v_id!~'^[0-9]{7}$' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('cityId','token','success','error')) THEN RAISE EXCEPTION 'Consulta inválida.' USING ERRCODE='22023'; END IF;
 IF p_action='claim' THEN
  UPDATE billing_private.weather_cities SET lease_token=gen_random_uuid(),lease_until=now()+interval '120 seconds'
   WHERE city_id=v_id AND next_refresh_at<=now() AND coalesce(lease_until,'-infinity')<=now()
    AND EXISTS(SELECT 1 FROM public.billing_weather_cities s WHERE s.city_id=v_id) RETURNING * INTO v_city;
  RETURN jsonb_build_object('token',v_city.lease_token);
 ELSIF p_action='finish' THEN
  SELECT * INTO v_city FROM billing_private.weather_cities WHERE city_id=v_id FOR UPDATE;
  IF v_city.lease_token IS NULL OR v_city.lease_token IS DISTINCT FROM (p_payload->>'token')::uuid OR v_city.lease_until<now() THEN RAISE EXCEPTION 'Coleta expirada.' USING ERRCODE='22023'; END IF;
 ELSIF p_action<>'failed' THEN RAISE EXCEPTION 'Ação inválida.' USING ERRCODE='22023'; END IF;
 IF p_action='finish' AND p_payload->>'success'='true' THEN
  SELECT fetched_at INTO v_at FROM billing_private.weather_forecasts WHERE city_id=v_id;
  UPDATE billing_private.weather_cities SET lease_token=NULL,lease_until=NULL,next_refresh_at=coalesce(v_at,now())+interval '30 minutes',last_attempt_at=now() WHERE city_id=v_id;
 ELSE
  UPDATE billing_private.weather_cities SET lease_token=CASE WHEN p_action='finish' THEN NULL ELSE lease_token END,
   lease_until=CASE WHEN p_action='finish' THEN NULL ELSE lease_until END,next_refresh_at=greatest(next_refresh_at,now()+interval '5 minutes'),last_attempt_at=now(),last_error=left(coalesce(p_payload->>'error','INMET indisponível.'),500) WHERE city_id=v_id;
  IF FOUND THEN INSERT INTO billing_private.weather_refresh_log(city_id,status,error) VALUES(v_id,'error',left(coalesce(p_payload->>'error','INMET indisponível.'),500)); END IF;
 END IF;
 RETURN jsonb_build_object('finished',true);
END $$;
REVOKE ALL ON FUNCTION billing_private.dashboard_weather_cache(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.dashboard_weather_cache(text,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.dashboard_weather_cache(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT billing_private.dashboard_weather_cache(p_action,p_payload) $$;

CREATE FUNCTION billing_private.enqueue_weather_refresh() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_token text;v_id bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM billing_private.weather_cities c WHERE next_refresh_at<=now() AND coalesce(lease_until,'-infinity')<=now() AND EXISTS(SELECT 1 FROM public.billing_weather_cities s WHERE s.city_id=c.city_id)) THEN RETURN NULL; END IF;
 SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name='dashboard_weather_refresh_token';IF v_token IS NULL THEN RETURN NULL; END IF;
 SELECT net.http_post(url:='https://ykounjabfsrtkzostbbz.supabase.co/functions/v1/dashboard-weather-refresh',headers:=jsonb_build_object('Content-Type','application/json','x-weather-refresh-token',v_token),body:='{}'::jsonb,timeout_milliseconds:=90000) INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION billing_private.enqueue_weather_refresh() FROM PUBLIC,anon,authenticated,service_role;
SELECT cron.schedule('billing-weather-refresh','*/5 * * * *',$job$SELECT billing_private.enqueue_weather_refresh()$job$);
COMMIT;
