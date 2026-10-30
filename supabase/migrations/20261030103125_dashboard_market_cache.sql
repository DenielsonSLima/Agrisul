BEGIN;

-- Shared public reference data, never company/user financial records. These
-- tables stay in the unexposed schema; clients only read the authenticated RPC.
CREATE TABLE billing_private.market_refresh_state(
 group_id text PRIMARY KEY CHECK(group_id IN ('currency','agriculture','cane')),
 refresh_seconds integer NOT NULL CHECK(refresh_seconds IN (60,600)),
 next_refresh_at timestamptz NOT NULL DEFAULT '-infinity',
 lease_token uuid,lease_until timestamptz,
 checked_at timestamptz,last_success_at timestamptz,last_error text,
 CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE TABLE billing_private.market_quotes(
 id text PRIMARY KEY,
 group_id text NOT NULL REFERENCES billing_private.market_refresh_state(group_id),
 value numeric CHECK(value>0 AND value<1e30),
 publication_date date,observed_at timestamptz,change_percent numeric CHECK(abs(change_percent)<1e30),
 source text NOT NULL CHECK(length(source) BETWEEN 1 AND 200),
 source_url text NOT NULL CHECK(source_url ~ '^https://[^/@[:space:]]+'),
 note text NOT NULL CHECK(length(note)<=2000),
 status text NOT NULL DEFAULT 'unavailable' CHECK(status IN ('available','stale','unavailable')),
 checked_at timestamptz,last_success_at timestamptz,
 CHECK((value IS NULL)=(publication_date IS NULL)),
 CHECK((value IS NULL)=(status='unavailable')),
 CHECK((group_id='currency' AND id IN ('usd','eur')) OR (group_id='cane' AND id='cane') OR
  (group_id='agriculture' AND id IN ('soy','corn','cattle','wheat','rice','beans','pork','chicken')))
);
ALTER TABLE billing_private.market_refresh_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_private.market_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON billing_private.market_refresh_state,billing_private.market_quotes FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO billing_private.market_refresh_state(group_id,refresh_seconds) VALUES('currency',60),('agriculture',600),('cane',600);
INSERT INTO billing_private.market_quotes(id,group_id,source,source_url,note)
 SELECT id,'currency','AwesomeAPI / Frankfurter','https://docs.awesomeapi.com.br/api-de-moedas','Aguardando primeira consulta automática' FROM unnest(ARRAY['usd','eur']) id;
INSERT INTO billing_private.market_quotes(id,group_id,source,source_url,note)
 SELECT id,'agriculture','Epagri/Cepa','https://cepa.epagri.sc.gov.br/index.php/mercado-agricola/','Aguardando primeira consulta automática' FROM unnest(ARRAY['soy','corn','cattle','wheat','rice','beans','pork','chicken']) id;
INSERT INTO billing_private.market_quotes(id,group_id,source,source_url,note)
 VALUES('cane','cane','Consecana-PR · Sistema FAEP','https://www.sistemafaep.org.br/consecana/','Aguardando primeira consulta automática');

CREATE FUNCTION billing_private.market_feed_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_group text:=p_payload->>'group';v_result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para acompanhar o mercado.' USING ERRCODE='28000'; END IF;
 IF p_action<>'get' OR jsonb_typeof(p_payload)<>'object' OR
  EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k<>'group') OR
  (p_payload?'group' AND (jsonb_typeof(p_payload->'group')<>'string' OR v_group NOT IN ('currency','agriculture','cane'))) THEN
  RAISE EXCEPTION 'Consulta de mercado inválida.' USING ERRCODE='22023';
 END IF;
 SELECT jsonb_build_object('quotes',jsonb_agg(jsonb_build_object(
  'id',q.id,'value',CASE WHEN q.value IS NULL THEN NULL ELSE q.value::text END,'date',q.publication_date,
  'source',q.source,'sourceUrl',q.source_url,'note',q.note,
  'status',CASE WHEN q.value IS NULL THEN 'unavailable' WHEN q.status='stale' OR q.checked_at<now()-make_interval(secs=>s.refresh_seconds*3) THEN 'stale' ELSE q.status END
 )||CASE WHEN q.observed_at IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('observedAt',to_char(q.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) END
  ||CASE WHEN q.change_percent IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('changePercent',q.change_percent::text) END ORDER BY q.id),
 'checkedAt',to_char(coalesce(max(s.checked_at),now()) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'refreshSeconds',min(s.refresh_seconds)) INTO v_result
 FROM billing_private.market_quotes q JOIN billing_private.market_refresh_state s ON s.group_id=q.group_id
 WHERE v_group IS NULL OR q.group_id=v_group;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION billing_private.market_feed_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.market_feed_dispatch(text,jsonb) TO authenticated;

DO $route$
DECLARE definition text:=pg_get_functiondef('public.billing_rpc(text,text,jsonb)'::regprocedure);
 anchor text:='PERFORM billing_private.ensure_actor_workspace();';
BEGIN
 IF strpos(definition,anchor)=0 OR strpos(definition,'''dashboard-market''')>0 THEN RAISE EXCEPTION 'Inspect RPC before adding the market route.'; END IF;
 EXECUTE replace(definition,anchor,anchor||E'\n IF p_resource=''dashboard-market'' THEN RETURN billing_private.market_feed_dispatch(p_action,p_payload); END IF;');
END $route$;

-- Worker-only entry point. A fenced lease prevents concurrent/late collectors
-- from replacing newer prices. Failures keep the last successful publication.
CREATE FUNCTION billing_private.refresh_dashboard_market(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_group text:=p_payload->>'group';v_state billing_private.market_refresh_state;
 v_quote jsonb;v_old billing_private.market_quotes;v_date date;v_observed timestamptz;v_valid boolean;v_success boolean:=false;
BEGIN
 IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Coletor não autorizado.' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_payload)<>'object' OR v_group IS NULL OR v_group NOT IN ('currency','agriculture','cane') OR
  EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('group','token','quotes','error')) THEN
  RAISE EXCEPTION 'Atualização de mercado inválida.' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_state FROM billing_private.market_refresh_state WHERE group_id=v_group FOR UPDATE;
 IF p_action='claim' THEN
  IF v_state.next_refresh_at>now() OR v_state.lease_until>now() THEN RETURN jsonb_build_object('token',NULL); END IF;
  UPDATE billing_private.market_refresh_state SET lease_token=gen_random_uuid(),lease_until=now()+interval '120 seconds'
   WHERE group_id=v_group RETURNING * INTO v_state;
  RETURN jsonb_build_object('token',v_state.lease_token);
 END IF;
 IF p_action<>'finish' OR (p_payload->>'token')::uuid IS DISTINCT FROM v_state.lease_token OR v_state.lease_token IS NULL OR v_state.lease_until<now() THEN
  RAISE EXCEPTION 'Consulta de mercado expirada ou inválida.' USING ERRCODE='22023';
 END IF;
 IF jsonb_typeof(p_payload->'quotes') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'quotes')>8 THEN
  RAISE EXCEPTION 'Cotações inválidas.' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'quotes') q
  WHERE jsonb_typeof(q)<>'object' OR NOT EXISTS(SELECT 1 FROM billing_private.market_quotes m WHERE m.id=q->>'id' AND m.group_id=v_group)) OR
  EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'quotes') q GROUP BY q->>'id' HAVING count(*)>1) THEN
  RAISE EXCEPTION 'Indicadores inválidos.' USING ERRCODE='22023';
 END IF;
 FOR v_old IN SELECT * FROM billing_private.market_quotes WHERE group_id=v_group ORDER BY id LOOP
  SELECT q INTO v_quote FROM jsonb_array_elements(p_payload->'quotes') q WHERE q->>'id'=v_old.id;
  v_valid:=false;
  IF v_quote->>'status'='available' THEN
   IF jsonb_typeof(v_quote->'value') IS DISTINCT FROM 'string' OR length(v_quote->>'value')>80 OR
    (v_quote->>'value')!~'^[0-9]+(\.[0-9]+)?$' OR
    coalesce(v_quote->>'date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR
    coalesce(v_quote->>'source','')='' OR length(v_quote->>'source')>200 OR
    coalesce(v_quote->>'sourceUrl','')!~'^https://[^/@[:space:]]+' OR length(v_quote->>'sourceUrl')>2048 OR
    length(coalesce(v_quote->>'note',''))>2000 OR
    (v_quote?'changePercent' AND (jsonb_typeof(v_quote->'changePercent')<>'string' OR length(v_quote->>'changePercent')>80 OR (v_quote->>'changePercent')!~'^-?[0-9]+(\.[0-9]+)?$')) THEN
    RAISE EXCEPTION 'Publicação de mercado inválida.' USING ERRCODE='22023';
   END IF;
   v_date:=(v_quote->>'date')::date;v_observed:=(v_quote->>'observedAt')::timestamptz;
   IF v_date>(now() AT TIME ZONE 'America/Sao_Paulo')::date OR v_observed>now()+interval '5 minutes' THEN RAISE EXCEPTION 'Publicação futura inválida.' USING ERRCODE='22023'; END IF;
   v_valid:=v_old.value IS NULL OR v_date>v_old.publication_date OR (v_date=v_old.publication_date AND
    (v_old.observed_at IS NULL OR v_observed>=v_old.observed_at));
   IF v_valid THEN
    UPDATE billing_private.market_quotes SET value=(v_quote->>'value')::numeric,publication_date=v_date,observed_at=v_observed,
     change_percent=(v_quote->>'changePercent')::numeric,source=v_quote->>'source',source_url=v_quote->>'sourceUrl',
     note=coalesce(v_quote->>'note',''),status='available',checked_at=now(),last_success_at=now() WHERE id=v_old.id;
    v_success:=true;
   END IF;
  END IF;
  IF NOT coalesce(v_valid,false) THEN
   UPDATE billing_private.market_quotes SET status=CASE WHEN value IS NULL THEN 'unavailable' ELSE 'stale' END,checked_at=now() WHERE id=v_old.id;
  END IF;
 END LOOP;
 UPDATE billing_private.market_refresh_state SET lease_token=NULL,lease_until=NULL,checked_at=now(),
  last_success_at=CASE WHEN v_success THEN now() ELSE last_success_at END,
  last_error=CASE WHEN EXISTS(SELECT 1 FROM billing_private.market_quotes WHERE group_id=v_group AND status<>'available') THEN left(coalesce(p_payload->>'error','Fonte indisponível ou publicação anterior; última referência preservada.'),500) ELSE NULL END,
  next_refresh_at=now()+make_interval(secs=>refresh_seconds) WHERE group_id=v_group;
 RETURN jsonb_build_object('updated',true,'group',v_group);
END $$;
REVOKE ALL ON FUNCTION billing_private.refresh_dashboard_market(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.refresh_dashboard_market(text,jsonb) TO service_role;
GRANT USAGE ON SCHEMA billing_private TO service_role;
CREATE FUNCTION public.refresh_dashboard_market(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT billing_private.refresh_dashboard_market(p_action,p_payload) $$;
REVOKE ALL ON FUNCTION public.refresh_dashboard_market(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_dashboard_market(text,jsonb) TO service_role;

-- Scheduling is independent of open dashboards. The scoped invocation token
-- is provisioned separately into Vault and Edge secrets, never into this file.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE FUNCTION billing_private.enqueue_market_refresh(p_group text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_token text;v_id bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM billing_private.market_refresh_state WHERE group_id=p_group AND next_refresh_at<=now() AND coalesce(lease_until,'-infinity')<=now()) THEN RETURN NULL; END IF;
 SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name='dashboard_market_refresh_token';
 IF v_token IS NULL THEN RETURN NULL; END IF;
 SELECT net.http_post(url:='https://ykounjabfsrtkzostbbz.supabase.co/functions/v1/dashboard-market-refresh',
  headers:=jsonb_build_object('Content-Type','application/json','x-market-refresh-token',v_token),
  body:=jsonb_build_object('group',p_group),timeout_milliseconds:=90000) INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION billing_private.enqueue_market_refresh(text) FROM PUBLIC,anon,authenticated,service_role;
SELECT cron.schedule('billing-market-currency','* * * * *',$job$SELECT billing_private.enqueue_market_refresh('currency')$job$);
SELECT cron.schedule('billing-market-agriculture','*/10 * * * *',$job$SELECT billing_private.enqueue_market_refresh('agriculture')$job$);
SELECT cron.schedule('billing-market-cane','5-59/10 * * * *',$job$SELECT billing_private.enqueue_market_refresh('cane')$job$);
COMMIT;
