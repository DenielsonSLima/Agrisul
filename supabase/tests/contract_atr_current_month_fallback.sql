BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('8a000000-0000-4000-8000-000000000001','atr-current-month@example.invalid',now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','8a000000-0000-4000-8000-000000000001',true);

DO $$
DECLARE
 company uuid;client uuid;kind uuid;contract uuid;farm uuid;plot uuid;october_quote uuid;
 contract_input jsonb;scope jsonb;detail jsonb;september jsonb;october jsonb;loads jsonb;listed jsonb;report jsonb;
 details jsonb:='{"tradeName":"","cnpj":"","street":"","number":"","complement":"","district":"","city":"","state":"","zipCode":"","phone":"","email":""}';
BEGIN
 company=(public.billing_rpc('companies','save',details||'{"legalName":"Empresa ATR atual","isPrimary":true}')->>'id')::uuid;
 client=(public.billing_rpc('clients','save',details||'{"legalName":"Cliente ATR atual","cnpj":"11222333000181"}')->'client'->>'id')::uuid;
 PERFORM public.billing_rpc('contract-types','save','{"name":"Contrato ATR atual","stages":[]}');
 kind=(public.billing_rpc('contract-types','list')->'types'->0->>'id')::uuid;
 contract_input=jsonb_build_object('companyId',company,'clientId',client,'typeId',kind,'title','Contrato ATR atual',
  'status','Ativo','startDate','2026-01-01','contractedVolume','1000','atrPriceType','gross','atrPeriodType','monthly');
 contract=(public.billing_rpc('contracts','save',contract_input)->'contract'->>'id')::uuid;
 farm=(public.billing_rpc('farms','save','{"name":"Fazenda ATR atual","areaHa":"10","city":"Cidade","state":"SE"}')->'farm'->>'id')::uuid;
 plot=(public.billing_rpc('plots','save',jsonb_build_object('farmId',farm,'name','Talhão ATR atual','areaHa','10'))->'data'->'plots'->0->>'id')::uuid;
 scope=jsonb_build_object('companyId',company,'contractId',contract);

 PERFORM public.billing_rpc('atr','save','{"year":2026,"month":8,"monthlyGrossValue":"1","monthlyNetValue":"1","accumulatedGrossValue":"1","accumulatedNetValue":"1"}');
 PERFORM public.billing_rpc('atr','save','{"year":2026,"month":9,"monthlyGrossValue":"9","monthlyNetValue":"8","accumulatedGrossValue":"7","accumulatedNetValue":"6"}');
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('farmId',farm,'plotId',plot,'loadedAt','2026-09-10','volume','10','atr','100','document','','notes',''));
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('farmId',farm,'plotId',plot,'loadedAt','2026-09-10','volume','5','atr','200','document','','notes',''));
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('farmId',farm,'plotId',plot,'loadedAt','2026-10-02','volume','20','atr','150','document','','notes',''));

 detail=public.billing_rpc('contracts','get',jsonb_build_object('companyId',company,'id',contract))->'contract';
 SELECT value INTO september FROM jsonb_array_elements(detail->'monthlySummary'->'months') WHERE value->>'month'='2026-09';
 SELECT value INTO october FROM jsonb_array_elements(detail->'monthlySummary'->'months') WHERE value->>'month'='2026-10';
 IF september->>'atrReferenceMonth'<>'2026-09' OR september->>'atrQuote'<>'9' OR september->>'billingAmount'<>'18000' THEN
  RAISE EXCEPTION 'Current-month quotation was not preferred: %',september;
 END IF;
 IF october->>'atrReferenceMonth'<>'2026-09' OR october->>'atrQuote'<>'9' OR october->>'billingAmount'<>'27000' THEN
  RAISE EXCEPTION 'Previous-month fallback was not used: %',october;
 END IF;
 IF detail->>'billingAmount'<>'45000' THEN RAISE EXCEPTION 'Resolved billing total is invalid: %',detail; END IF;
 listed=public.billing_rpc('contracts','list',jsonb_build_object('companyId',company,'bucket','open'))->'contracts'->0;
 IF listed->'atrQuoteSummary'->'referenceMonths'<>'["2026-09"]'::jsonb THEN
  RAISE EXCEPTION 'Quotation summary did not expose effective references: %',listed;
 END IF;

 loads=public.billing_rpc('contracts','list',scope||'{"view":"loads","search":"","from":"2026-09-01","to":"2026-10-31","groupBy":"day"}');
 IF loads->'filters'->>'groupBy'<>'day'
  OR loads->'summary'->>'loadCount'<>'3'
  OR loads->'summary'->>'volume'<>'35'
  OR loads->'summary'->>'activeDayCount'<>'2'
  OR loads->'summary'->>'averageDailyVolume'<>'17.5'
  OR loads->'summary'->>'monthCount'<>'2'
  OR loads->'groups'->0->>'key'<>'2026-10-02'
  OR loads->'groups'->0->>'label'<>'2026-10-02'
  OR loads->'groups'->0->>'volume'<>'20'
  OR loads->'groups'->1->>'key'<>'2026-09-10'
  OR loads->'groups'->1->>'loadCount'<>'2'
  OR loads->'groups'->1->>'volume'<>'15'
  OR loads->'monthlyVolumes'->0->>'month'<>'2026-09'
  OR loads->'monthlyVolumes'->0->>'volume'<>'15'
  OR loads->'monthlyVolumes'->0->>'loadCount'<>'2'
  OR loads->'monthlyVolumes'->1->>'month'<>'2026-10'
  OR loads->'monthlyVolumes'->1->>'volume'<>'20'
  OR loads->'monthlyVolumes'->1->>'loadCount'<>'1' THEN
  RAISE EXCEPTION 'Daily/monthly load aggregates are invalid: %',loads;
 END IF;
 IF loads->'groups'->0->'loads'->0->>'atrReferenceMonth'<>'2026-09'
  OR loads->'groups'->1->'loads'->0->>'atrReferenceMonth'<>'2026-09' THEN
  RAISE EXCEPTION 'Load reference month does not match its resolved quotation: %',loads;
 END IF;
 report=public.billing_rpc('reports','list',jsonb_build_object('companyId',company,'kind','loads','search','',
  'from','2026-09-01','to','2026-10-31','farmId','','plotId',''));
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(report->'groups'->0->'loads') item
  WHERE item->>'atrReferenceMonth'<>'2026-09') THEN
  RAISE EXCEPTION 'Detailed report did not expose effective ATR references: %',report;
 END IF;

 october_quote=(public.billing_rpc('atr','save','{"year":2026,"month":10,"monthlyGrossValue":"4","monthlyNetValue":"3","accumulatedGrossValue":"2","accumulatedNetValue":"1"}')->'record'->>'id')::uuid;
 detail=public.billing_rpc('contracts','get',jsonb_build_object('companyId',company,'id',contract))->'contract';
 SELECT value INTO october FROM jsonb_array_elements(detail->'monthlySummary'->'months') WHERE value->>'month'='2026-10';
 IF october->>'atrReferenceMonth'<>'2026-10' OR october->>'atrQuote'<>'4' OR october->>'billingAmount'<>'12000' OR detail->>'billingAmount'<>'30000' THEN
  RAISE EXCEPTION 'New current-month quotation did not replace the fallback: %, %',october,detail;
 END IF;
 listed=public.billing_rpc('contracts','list',jsonb_build_object('companyId',company,'bucket','open'))->'contracts'->0;
 IF listed->'atrQuoteSummary'->'referenceMonths'<>'["2026-09","2026-10"]'::jsonb THEN
  RAISE EXCEPTION 'Quotation summary did not refresh effective references: %',listed;
 END IF;
 PERFORM public.billing_rpc('atr','save',jsonb_build_object('id',october_quote,'year',2026,'month',10,
  'monthlyGrossValue','0','monthlyNetValue','0','accumulatedGrossValue','0','accumulatedNetValue','0'));
 detail=public.billing_rpc('contracts','get',jsonb_build_object('companyId',company,'id',contract))->'contract';
 SELECT value INTO october FROM jsonb_array_elements(detail->'monthlySummary'->'months') WHERE value->>'month'='2026-10';
 IF october->>'atrReferenceMonth'<>'2026-10' OR october->>'atrQuote'<>'0' OR october->>'billingAmount'<>'0'
  OR october->>'billingPending'<>'false' OR detail->>'billingAmount'<>'18000' THEN
  RAISE EXCEPTION 'A zero current-month quotation was treated as missing: %, %',october,detail;
 END IF;
END $$;

RESET ROLE;
DO $$
DECLARE v_invoker boolean;v_definer boolean;v_config text[];
BEGIN
 SELECT NOT p.prosecdef INTO v_invoker FROM pg_proc p WHERE p.oid='public.billing_rpc(text,text,jsonb)'::regprocedure;
 SELECT p.prosecdef,p.proconfig INTO v_definer,v_config FROM pg_proc p WHERE p.oid='billing_private.contract_atr_reference(public.billing_contracts,date)'::regprocedure;
 IF NOT v_invoker OR NOT v_definer OR NOT EXISTS(SELECT 1 FROM unnest(v_config) setting WHERE setting LIKE 'search_path=%')
  OR has_function_privilege('authenticated','billing_private.contract_atr_reference(public.billing_contracts,date)','EXECUTE') THEN
  RAISE EXCEPTION 'ATR resolver or public RPC privileges are unsafe';
 END IF;
END $$;
ROLLBACK;
