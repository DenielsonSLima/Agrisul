BEGIN;

-- Public market references stay private and use the same fenced collector,
-- exact NUMERIC values, authenticated reads and history as existing quotes.
ALTER TABLE billing_private.market_refresh_state DROP CONSTRAINT market_refresh_state_group_id_check;
ALTER TABLE billing_private.market_refresh_state ADD CONSTRAINT market_refresh_state_group_id_check
 CHECK(group_id IN ('currency','agriculture','cane','exchange'));
ALTER TABLE billing_private.market_quotes DROP CONSTRAINT market_quotes_check2;
ALTER TABLE billing_private.market_quotes ADD CONSTRAINT market_quotes_check2 CHECK(
 (group_id='currency' AND id IN ('usd','eur')) OR (group_id='cane' AND id='cane') OR
 (group_id='agriculture' AND id IN ('soy','corn','cattle','wheat','rice','beans','pork','chicken')) OR
 (group_id='exchange' AND id IN ('ibovespa','sp500','gold')));

INSERT INTO billing_private.market_refresh_state(group_id,refresh_seconds) VALUES('exchange',60);
INSERT INTO billing_private.market_quotes(id,group_id,source,source_url,note) VALUES
 ('ibovespa','exchange','Yahoo Finance','https://finance.yahoo.com/quote/%5EBVSP/','Índice Ibovespa · B3 · pontos · aguardando primeira consulta automática'),
 ('sp500','exchange','Yahoo Finance','https://finance.yahoo.com/quote/%5EGSPC/','S&P 500 · bolsa dos EUA · pontos · aguardando primeira consulta automática'),
 ('gold','exchange','Yahoo Finance','https://finance.yahoo.com/quote/GC%3DF/','Ouro futuro · COMEX · US$ por onça troy · aguardando primeira consulta automática');

-- Extend only the inspected group whitelist; preserve auth, validation,
-- leases, retention, comparisons and cadence in the existing functions.
DO $groups$
DECLARE target regprocedure;definition text;anchor text:='v_group NOT IN (''currency'',''agriculture'',''cane'')';
BEGIN
 FOREACH target IN ARRAY ARRAY['billing_private.market_feed_dispatch_v1(text,jsonb)'::regprocedure,
  'billing_private.refresh_dashboard_market(text,jsonb)'::regprocedure] LOOP
  definition:=pg_get_functiondef(target);
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Inspect market group whitelist before extending %.',target; END IF;
  EXECUTE replace(definition,anchor,'v_group NOT IN (''currency'',''agriculture'',''cane'',''exchange'')');
 END LOOP;
END $groups$;
SELECT cron.schedule('billing-market-exchange','* * * * *',$job$SELECT billing_private.enqueue_market_refresh('exchange')$job$);
COMMIT;
