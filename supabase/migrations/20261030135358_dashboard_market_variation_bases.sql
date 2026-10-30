BEGIN;
-- Seven days of successful collections of public references. Publication dates
-- remain the source's dates, even when a source has not published recently.
CREATE TABLE billing_private.market_quote_history(
 id text NOT NULL REFERENCES billing_private.market_quotes(id),
 captured_at timestamptz NOT NULL DEFAULT now(),
 value numeric NOT NULL CHECK(value>0 AND value<1e30),
 publication_date date NOT NULL,observed_at timestamptz,
 source text NOT NULL,source_url text NOT NULL,reference_url text NOT NULL,
 source_change_percent numeric,
 PRIMARY KEY(id,captured_at,publication_date,source_url)
);
CREATE INDEX market_history_retention ON billing_private.market_quote_history(captured_at);
CREATE INDEX market_history_comparison ON billing_private.market_quote_history(id,source,source_url,publication_date DESC,captured_at DESC);
ALTER TABLE billing_private.market_quote_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON billing_private.market_quote_history FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE billing_private.market_quotes
 ADD COLUMN comparison_value numeric CHECK(comparison_value>0 AND comparison_value<1e30),
 ADD COLUMN comparison_date date,
 ADD COLUMN comparison_url text,
 ADD COLUMN change_basis text CHECK(change_basis IN ('source','previous-publication')),
 ADD CONSTRAINT market_comparison_pair CHECK((comparison_value IS NULL)=(comparison_date IS NULL) AND (comparison_date IS NULL)=(comparison_url IS NULL)),
 ADD CONSTRAINT market_comparison_earlier CHECK(comparison_date<publication_date);
UPDATE billing_private.market_quotes SET change_basis='source' WHERE change_percent IS NOT NULL;
INSERT INTO billing_private.market_quote_history(id,captured_at,value,publication_date,observed_at,source,source_url,reference_url,source_change_percent)
 SELECT id,last_success_at,value,publication_date,observed_at,source,source_url,source_url,change_percent FROM billing_private.market_quotes
 WHERE value IS NOT NULL AND last_success_at>=now()-interval '7 days';

CREATE FUNCTION billing_private.record_market_quote(p_quote jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_old billing_private.market_quotes;v_base billing_private.market_quote_history;
 v_date date:=(p_quote->>'date')::date;v_previous numeric;v_previous_date date;v_previous_url text;v_change numeric;v_basis text;
BEGIN
 SELECT * INTO STRICT v_old FROM billing_private.market_quotes WHERE id=p_quote->>'id';
 IF p_quote?'previousValue' OR p_quote?'previousDate' OR p_quote?'previousSourceUrl' THEN
  IF jsonb_typeof(p_quote->'previousValue') IS DISTINCT FROM 'string' OR length(p_quote->>'previousValue')>80 OR
   coalesce(p_quote->>'previousValue','')!~'^[0-9]+(\.[0-9]+)?$' OR
   coalesce(p_quote->>'previousDate','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
   RAISE EXCEPTION 'Base de comparação inválida.' USING ERRCODE='22023'; END IF;
  v_previous:=(p_quote->>'previousValue')::numeric;v_previous_date:=(p_quote->>'previousDate')::date;
  v_previous_url:=coalesce(p_quote->>'previousSourceUrl',p_quote->>'sourceUrl');
  IF v_previous<=0 OR v_previous>=1e30 OR v_previous_date>=v_date OR length(v_previous_url)>2048 OR v_previous_url!~'^https://[^/@[:space:]]+' THEN
   RAISE EXCEPTION 'Base de comparação inválida.' USING ERRCODE='22023'; END IF;
 ELSIF v_old.source=p_quote->>'source' AND v_old.source_url=p_quote->>'sourceUrl' THEN
  IF v_old.publication_date<v_date THEN
   v_previous:=v_old.value;v_previous_date:=v_old.publication_date;v_previous_url:=v_old.source_url;
  ELSIF v_old.publication_date=v_date THEN
   v_previous:=v_old.comparison_value;v_previous_date:=v_old.comparison_date;v_previous_url:=v_old.comparison_url;
  END IF;
 END IF;
 DELETE FROM billing_private.market_quote_history WHERE captured_at<now()-interval '7 days';
 IF v_previous IS NOT NULL THEN
  INSERT INTO billing_private.market_quote_history(id,value,publication_date,source,source_url,reference_url)
   VALUES(v_old.id,v_previous,v_previous_date,p_quote->>'source',p_quote->>'sourceUrl',v_previous_url) ON CONFLICT DO NOTHING;
 END IF;
 INSERT INTO billing_private.market_quote_history(id,value,publication_date,observed_at,source,source_url,reference_url,source_change_percent)
  VALUES(v_old.id,(p_quote->>'value')::numeric,v_date,(p_quote->>'observedAt')::timestamptz,p_quote->>'source',p_quote->>'sourceUrl',p_quote->>'sourceUrl',(p_quote->>'changePercent')::numeric) ON CONFLICT DO NOTHING;
 SELECT * INTO v_base FROM billing_private.market_quote_history WHERE id=v_old.id AND source=p_quote->>'source' AND source_url=p_quote->>'sourceUrl'
  AND publication_date<v_date AND captured_at>=now()-interval '7 days' ORDER BY publication_date DESC,captured_at DESC LIMIT 1;
 IF p_quote?'changePercent' THEN v_change:=(p_quote->>'changePercent')::numeric;v_basis:='source';
 ELSIF v_base.value IS NOT NULL THEN v_change:=round(((p_quote->>'value')::numeric-v_base.value)*100/v_base.value,6);v_basis:='previous-publication'; END IF;
 RETURN (p_quote-'changePercent'-'previousValue'-'previousDate'-'previousSourceUrl'-'changeBasis')||jsonb_strip_nulls(jsonb_build_object(
  'changePercent',v_change::text,'changeBasis',v_basis,'previousValue',v_base.value::text,'previousDate',v_base.publication_date,'previousSourceUrl',v_base.reference_url));
END $$;
REVOKE ALL ON FUNCTION billing_private.record_market_quote(jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $worker$
DECLARE definition text:=pg_get_functiondef('billing_private.refresh_dashboard_market(text,jsonb)'::regprocedure);
 anchor text:='change_percent=(v_quote->>''changePercent'')::numeric,source=';
BEGIN
 IF strpos(definition,anchor)=0 OR strpos(definition,'record_market_quote')>0 THEN RAISE EXCEPTION 'Inspect market worker before adding history.'; END IF;
 definition:=replace(definition,'IF v_valid THEN','IF v_valid THEN'||E'\n    v_quote:=billing_private.record_market_quote(v_quote);');
 definition:=replace(definition,anchor,'change_percent=(v_quote->>''changePercent'')::numeric,change_basis=v_quote->>''changeBasis'',comparison_value=(v_quote->>''previousValue'')::numeric,comparison_date=(v_quote->>''previousDate'')::date,comparison_url=v_quote->>''previousSourceUrl'',source=');
 EXECUTE definition;
END $worker$;

ALTER FUNCTION billing_private.market_feed_dispatch(text,jsonb) RENAME TO market_feed_dispatch_v1;
REVOKE ALL ON FUNCTION billing_private.market_feed_dispatch_v1(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION billing_private.market_feed_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_feed jsonb;v_id text:=p_payload->>'id';
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para acompanhar o mercado.' USING ERRCODE='28000'; END IF;
 IF p_action='history' THEN
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k<>'id') OR
   v_id IS NULL OR NOT EXISTS(SELECT 1 FROM billing_private.market_quotes WHERE id=v_id) THEN RAISE EXCEPTION 'Indicador inválido.' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('id',v_id,'days',coalesce((SELECT jsonb_agg(jsonb_build_object('day',q.collection_day,'value',q.value::text,'date',q.publication_date,
   'capturedAt',to_char(q.captured_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'source',q.source) ORDER BY q.collection_day DESC) FROM
   (SELECT DISTINCT ON ((captured_at AT TIME ZONE 'America/Sao_Paulo')::date) (captured_at AT TIME ZONE 'America/Sao_Paulo')::date AS collection_day,h.*
    FROM billing_private.market_quote_history h WHERE id=v_id AND captured_at>=now()-interval '7 days'
    ORDER BY (captured_at AT TIME ZONE 'America/Sao_Paulo')::date DESC,captured_at DESC,publication_date DESC LIMIT 7)q),'[]'::jsonb));
 END IF;
 v_feed:=billing_private.market_feed_dispatch_v1(p_action,p_payload);
 SELECT jsonb_set(v_feed,'{quotes}',jsonb_agg(q.item||jsonb_strip_nulls(jsonb_build_object('changeBasis',m.change_basis,
  'previousValue',m.comparison_value::text,'previousDate',m.comparison_date,'previousSourceUrl',m.comparison_url)) ORDER BY q.item->>'id')) INTO v_feed
  FROM jsonb_array_elements(v_feed->'quotes') q(item) JOIN billing_private.market_quotes m ON m.id=q.item->>'id';
 RETURN v_feed;
END $$;
REVOKE ALL ON FUNCTION billing_private.market_feed_dispatch(text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION billing_private.market_feed_dispatch(text,jsonb) TO authenticated;
DO $route$ BEGIN EXECUTE pg_get_functiondef('public.billing_rpc(text,text,jsonb)'::regprocedure); END $route$;
SELECT cron.schedule('billing-quote-history-retention','17 * * * *',$job$DELETE FROM billing_private.market_quote_history WHERE captured_at<now()-interval '7 days'$job$);
COMMIT;
