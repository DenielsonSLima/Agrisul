BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('99999999-9999-4999-8999-999999999971','load-money-a@example.invalid',now()),
 ('99999999-9999-4999-8999-999999999972','load-money-b@example.invalid',now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999971',true);
DO $$
DECLARE
 company uuid; other_company uuid; client uuid; kind uuid; contract uuid; other_contract uuid;
 farm_a uuid; farm_b uuid; plot_a uuid; plot_b uuid; first_load uuid; second_load uuid; quote_id uuid;
 scope jsonb; contract_input jsonb; input jsonb; second_input jsonb; quote_input jsonb;
 r jsonb; row_data jsonb; finance jsonb; month_data jsonb; baseline jsonb; current_rows jsonb; criterion jsonb;
 grouping text; total_gross numeric; total_discount numeric; total_net numeric;
 details jsonb:='{"tradeName":"","cnpj":"","street":"","number":"","complement":"","district":"","city":"","state":"","zipCode":"","phone":"","email":""}';
BEGIN
 company=(public.billing_rpc('companies','save',details||'{"legalName":"Empresa valores de cargas","isPrimary":true}')->>'id')::uuid;
 other_company=(public.billing_rpc('companies','save',details||'{"legalName":"Outra empresa valores","isPrimary":false}')->>'id')::uuid;
 client=(public.billing_rpc('clients','save',details||'{"legalName":"Usina valores de cargas","cnpj":"11222333000181"}')->'client'->>'id')::uuid;
 PERFORM public.billing_rpc('contract-types','save','{"name":"Valores por carga","stages":[]}');
 kind=(public.billing_rpc('contract-types','list')->'types'->0->>'id')::uuid;
 contract_input=jsonb_build_object('companyId',company,'clientId',client,'typeId',kind,'title','Valores por carregamento','status','Ativo','startDate','2026-01-01','contractedVolume','100','atrPriceType','gross','atrPeriodType','monthly');
 contract=(public.billing_rpc('contracts','save',contract_input)->'contract'->>'id')::uuid;
 other_contract=(public.billing_rpc('contracts','save',contract_input||'{"title":"Outro contrato de valores"}')->'contract'->>'id')::uuid;
 contract_input=contract_input||jsonb_build_object('id',contract);
 scope=jsonb_build_object('companyId',company,'contractId',contract);
 farm_a=(public.billing_rpc('farms','save','{"name":"Origem Alfa","areaHa":"10","city":"Cidade","state":"SE"}')->'farm'->>'id')::uuid;
 plot_a=(public.billing_rpc('plots','save',jsonb_build_object('farmId',farm_a,'name','Talhão Alfa','areaHa','10'))->'data'->'plots'->0->>'id')::uuid;
 farm_b=(public.billing_rpc('farms','save','{"name":"Origem Beta","areaHa":"10","city":"Cidade","state":"SE"}')->'farm'->>'id')::uuid;
 plot_b=(public.billing_rpc('plots','save',jsonb_build_object('farmId',farm_b,'name','Talhão Beta','areaHa','10'))->'data'->'plots'->0->>'id')::uuid;
 quote_input='{"year":2025,"month":12,"monthlyGrossValue":"0.01","monthlyNetValue":"0.02","accumulatedGrossValue":"0.03","accumulatedNetValue":"0.04"}';
 quote_id=(public.billing_rpc('atr','save',quote_input)->'record'->>'id')::uuid;
 PERFORM public.billing_rpc('atr','save',quote_input||'{"year":2026,"month":1,"monthlyGrossValue":"0.02"}');
 PERFORM public.billing_rpc('atr','save',quote_input||'{"year":2026,"month":2,"monthlyGrossValue":"0"}');
 PERFORM public.billing_rpc('atr','save',quote_input||'{"year":2026,"month":4,"monthlyGrossValue":"1.1999"}');
 input=scope||jsonb_build_object('farmId',farm_a,'plotId',plot_a,'loadedAt','2026-01-01','volume','0.003','atr','100','document','JAN-FIRST','notes','');
 first_load=(public.billing_rpc('contracts','save-load',input)->'load'->>'id')::uuid;
 second_input=input||jsonb_build_object('farmId',farm_b,'plotId',plot_b,'loadedAt','2026-01-31','volume','0.002','document','JAN-SECOND');
 second_load=(public.billing_rpc('contracts','save-load',second_input)->'load'->>'id')::uuid;
 PERFORM public.billing_rpc('contracts','save-load',input||'{"loadedAt":"2026-02-01","volume":"0.005","document":"FEB"}');
 PERFORM public.billing_rpc('contracts','save-load',input||'{"loadedAt":"2026-03-01","volume":"2","document":"ZERO"}');
 PERFORM public.billing_rpc('contracts','save-load',input||'{"loadedAt":"2026-04-01","volume":"3","document":"MISSING"}');
 PERFORM public.billing_rpc('contracts','save-load',input||'{"loadedAt":"2026-05-01","volume":"40","atr":"134","document":"NORMAL"}');
 PERFORM public.billing_rpc('contracts','save-load',input||jsonb_build_object('contractId',other_contract,'volume','50','document','OTHER-CONTRACT'));
 PERFORM public.billing_rpc('contracts','save-discount',scope||jsonb_build_object('requestId',gen_random_uuid(),'title','Transporte','ratePerTon','1','months',jsonb_build_array('2026-01','2026-02','2026-03','2026-04'),'notes',''));
 PERFORM public.billing_rpc('contracts','save-discount',scope||jsonb_build_object('requestId',gen_random_uuid(),'title','Serviços','ratePerTon','3','months',jsonb_build_array('2026-01'),'notes',''));
 PERFORM public.billing_rpc('contracts','save-discount',scope||jsonb_build_object('requestId',gen_random_uuid(),'title','Acordo normal','ratePerTon','75','months',jsonb_build_array('2026-05'),'notes',''));

 r=public.billing_rpc('contracts','list',scope||'{"view":"loads"}');
 SELECT jsonb_object_agg(l->>'id',l) INTO baseline FROM jsonb_array_elements(r->'groups') g CROSS JOIN LATERAL jsonb_array_elements(g->'loads') l;
 IF (SELECT count(*) FROM jsonb_each(baseline))<>6 THEN RAISE EXCEPTION 'Contract loads leaked or disappeared: %',r; END IF;
 row_data=baseline->first_load::text;
 IF row_data->>'grossAmount' IS DISTINCT FROM '0' OR row_data->>'discountAmount' IS DISTINCT FROM '0.01' OR row_data->>'netAmount' IS DISTINCT FROM '-0.01'
  OR row_data->>'billingPending' IS DISTINCT FROM 'false' OR row_data->>'atrQuote' IS DISTINCT FROM '0.01' OR row_data->>'atrReferenceMonth' IS DISTINCT FROM '2025-12'
 THEN RAISE EXCEPTION 'First load, previous December or negative amount incorrect: %',row_data; END IF;
 row_data=baseline->second_load::text;
 IF row_data->>'grossAmount' IS DISTINCT FROM '0.01' OR row_data->>'discountAmount' IS DISTINCT FROM '0.02' OR row_data->>'netAmount' IS DISTINCT FROM '-0.01'
 THEN RAISE EXCEPTION 'Separate agreement/month cents lost: %',row_data; END IF;
 SELECT value INTO row_data FROM jsonb_each(baseline) WHERE value->>'document'='NORMAL';
 IF row_data->>'grossAmount' IS DISTINCT FROM '6431.46' OR row_data->>'discountAmount' IS DISTINCT FROM '3000' OR row_data->>'netAmount' IS DISTINCT FROM '3431.46'
 THEN RAISE EXCEPTION 'Tonnes times measured ATR times quote or discount incorrect: %',row_data; END IF;
 SELECT value INTO row_data FROM jsonb_each(baseline) WHERE value->>'document'='ZERO';
 IF row_data->>'grossAmount' IS DISTINCT FROM '0' OR row_data->>'netAmount' IS DISTINCT FROM '-2' OR row_data->>'billingPending' IS DISTINCT FROM 'false' OR row_data->>'atrQuote' IS DISTINCT FROM '0'
 THEN RAISE EXCEPTION 'Registered zero quote was treated as pending: %',row_data; END IF;
 SELECT value INTO row_data FROM jsonb_each(baseline) WHERE value->>'document'='MISSING';
 IF row_data->>'grossAmount' IS DISTINCT FROM '' OR row_data->>'netAmount' IS DISTINCT FROM '' OR row_data->>'discountAmount' IS DISTINCT FROM '3' OR row_data->>'billingPending' IS DISTINCT FROM 'true' OR row_data->>'atrQuote' IS DISTINCT FROM ''
 THEN RAISE EXCEPTION 'Missing quote fabricated money or hid calculable discounts: %',row_data; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(baseline) l CROSS JOIN LATERAL unnest(ARRAY['grossAmount','discountAmount','netAmount','atrQuote']) field WHERE jsonb_typeof(l.value->field) IS DISTINCT FROM 'string')
 THEN RAISE EXCEPTION 'Financial decimals must remain JSON strings'; END IF;

 -- Reconcile each full month with the established finance results, including
 -- separate agreement rounding and months whose gross amount is still pending.
 finance=public.billing_rpc('contracts','get',jsonb_build_object('companyId',company,'id',contract))->'contract'->'financialSummary';
 IF r->'summary'->>'grossAmount' IS DISTINCT FROM '' OR r->'summary'->>'netAmount' IS DISTINCT FROM '' OR r->'summary'->>'billingPending' IS DISTINCT FROM 'true'
  OR (r->'summary'->>'discountAmount')::numeric IS DISTINCT FROM (finance->'totals'->>'discountAmount')::numeric
 THEN RAISE EXCEPTION 'Mixed known/pending financial KPIs must preserve discounts and pending totals: %',r->'summary'; END IF;
 FOR month_data IN SELECT value FROM jsonb_array_elements(finance->'months') LOOP
  SELECT coalesce(sum(nullif(value->>'grossAmount','')::numeric),0),coalesce(sum((value->>'discountAmount')::numeric),0),coalesce(sum(nullif(value->>'netAmount','')::numeric),0)
   INTO total_gross,total_discount,total_net FROM jsonb_each(baseline) WHERE left(value->>'loadedAt',7)=month_data->>'month';
  IF total_discount IS DISTINCT FROM (month_data->>'discountAmount')::numeric OR
   ((month_data->>'billingPending')::boolean=false AND (total_gross IS DISTINCT FROM (month_data->>'grossAmount')::numeric OR total_net IS DISTINCT FROM (month_data->>'netAmount')::numeric))
  THEN RAISE EXCEPTION 'Load cents do not reconcile with finance month: %',month_data; END IF;
  r=public.billing_rpc('contracts','list',scope||jsonb_build_object('view','loads','from',(month_data->>'month')||'-01','to',(((month_data->>'month')||'-01')::date+interval '1 month'-interval '1 day')::date::text));
  IF r->'summary'->>'grossAmount' IS DISTINCT FROM month_data->>'grossAmount'
   OR r->'summary'->>'discountAmount' IS DISTINCT FROM month_data->>'discountAmount'
   OR r->'summary'->>'netAmount' IS DISTINCT FROM month_data->>'netAmount'
   OR r->'summary'->>'billingPending' IS DISTINCT FROM month_data->>'billingPending'
  THEN RAISE EXCEPTION 'Filtered monthly KPIs must match the finance totals: %',r->'summary'; END IF;
 END LOOP;
 IF (SELECT sum((value->>'discountAmount')::numeric) FROM jsonb_each(baseline)) IS DISTINCT FROM (finance->'totals'->>'discountAmount')::numeric
 THEN RAISE EXCEPTION 'Total load discounts differ from finance'; END IF;

 -- Grouping, farm search and a partial month must not reassign another load's cents.
 FOREACH grouping IN ARRAY ARRAY['month','farm','none'] LOOP
  r=public.billing_rpc('contracts','list',scope||jsonb_build_object('view','loads','groupBy',grouping));
  SELECT jsonb_object_agg(l->>'id',l) INTO current_rows FROM jsonb_array_elements(r->'groups') g CROSS JOIN LATERAL jsonb_array_elements(g->'loads') l;
  IF current_rows IS DISTINCT FROM baseline THEN RAISE EXCEPTION 'Grouping changes individual load values: %',grouping; END IF;
  r=public.billing_rpc('contracts','list',scope||jsonb_build_object('view','loads','groupBy',grouping,'search','Beta','from','2026-01-31','to','2026-01-31'));
  IF r->'summary'->>'loadCount' IS DISTINCT FROM '1' OR r->'groups'->0->'loads'->0 IS DISTINCT FROM baseline->second_load::text
  THEN RAISE EXCEPTION 'Filtering reassigned cents from hidden loads: %',r; END IF;
  IF r->'summary'->>'grossAmount' IS DISTINCT FROM '0.01' OR r->'summary'->>'discountAmount' IS DISTINCT FROM '0.02'
   OR r->'summary'->>'netAmount' IS DISTINCT FROM '-0.01' OR r->'summary'->>'billingPending' IS DISTINCT FROM 'false'
  THEN RAISE EXCEPTION 'Partial search/date KPIs must include only visible loads for every grouping: %',r->'summary'; END IF;
 END LOOP;
 r=public.billing_rpc('contracts','list',scope||'{"view":"loads","search":"NO-LOAD-MATCHES"}');
 IF r->'summary'->>'grossAmount' IS DISTINCT FROM '0' OR r->'summary'->>'discountAmount' IS DISTINCT FROM '0'
  OR r->'summary'->>'netAmount' IS DISTINCT FROM '0' OR r->'summary'->>'billingPending' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Empty financial KPIs must be zero instead of stale or pending: %',r->'summary'; END IF;

 -- The four contract quote criteria resolve separately in the load list.
 FOR criterion IN SELECT value FROM jsonb_array_elements('[
  {"atrPriceType":"gross","atrPeriodType":"monthly","quote":"0.01","gross":"0.01"},
  {"atrPriceType":"net","atrPeriodType":"monthly","quote":"0.02","gross":"0.01"},
  {"atrPriceType":"gross","atrPeriodType":"accumulated","quote":"0.03","gross":"0.02"},
  {"atrPriceType":"net","atrPeriodType":"accumulated","quote":"0.04","gross":"0.02"}
 ]') LOOP
  PERFORM public.billing_rpc('contracts','save',contract_input||(criterion-'quote'-'gross'));
  r=public.billing_rpc('contracts','list',scope||'{"view":"loads","from":"2026-01-01","to":"2026-01-31"}');
  SELECT sum((value->>'grossAmount')::numeric) INTO total_gross FROM jsonb_array_elements(r->'groups'->0->'loads');
  IF total_gross IS DISTINCT FROM (criterion->>'gross')::numeric OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->'groups'->0->'loads') WHERE value->>'atrQuote' IS DISTINCT FROM criterion->>'quote')
  THEN RAISE EXCEPTION 'Load quote criterion mismatch: %, %',criterion,r; END IF;
 END LOOP;
 PERFORM public.billing_rpc('contracts','save',contract_input);

 -- Cash receipts change balances, never the price or net amount of a load.
 PERFORM public.billing_rpc('contracts','save-payment',scope||jsonb_build_object('requestId',gen_random_uuid(),'kind','advance','receivedAt','2026-05-01','referenceMonth','2026-05','amount','100','document','','notes',''));
 r=public.billing_rpc('contracts','list',scope||'{"view":"loads","groupBy":"none"}');
 SELECT jsonb_object_agg(value->>'id',value) INTO current_rows FROM jsonb_array_elements(r->'groups'->0->'loads');
 IF current_rows IS DISTINCT FROM baseline THEN RAISE EXCEPTION 'Payments changed load amounts'; END IF;

 PERFORM public.billing_rpc('atr','save',quote_input||jsonb_build_object('id',quote_id,'monthlyGrossValue','0.03'));
 r=public.billing_rpc('contracts','list',scope||'{"view":"loads","search":"JAN-FIRST"}');
 IF r->'groups'->0->'loads'->0->>'grossAmount' IS DISTINCT FROM '0.01' OR r->'groups'->0->'loads'->0->>'netAmount' IS DISTINCT FROM '0'
 THEN RAISE EXCEPTION 'Quote edit did not refresh existing load values: %',r; END IF;
 PERFORM public.billing_rpc('contracts','save-load',second_input||jsonb_build_object('id',second_load,'loadedAt','2026-02-15'));
 r=public.billing_rpc('contracts','list',scope||'{"view":"loads","search":"JAN-SECOND"}');
 row_data=r->'groups'->0->'loads'->0;
 IF row_data->>'atrReferenceMonth' IS DISTINCT FROM '2026-01' OR row_data->>'atrQuote' IS DISTINCT FROM '0.02' OR row_data->>'grossAmount' IS DISTINCT FROM '0' OR row_data->>'discountAmount' IS DISTINCT FROM '0'
 THEN RAISE EXCEPTION 'Date edit did not change quote, applicable agreements or cents: %',row_data; END IF;
 PERFORM public.billing_rpc('contracts','save-load',second_input||jsonb_build_object('id',second_load));
 PERFORM public.billing_rpc('atr','save',quote_input||jsonb_build_object('id',quote_id));

 -- A second contract must not receive this contract's agreements or volumes.
 r=public.billing_rpc('contracts','list',scope||jsonb_build_object('view','loads','contractId',other_contract));
 IF r->'summary'->>'loadCount' IS DISTINCT FROM '1' OR r->'groups'->0->'loads'->0->>'grossAmount' IS DISTINCT FROM '50' OR r->'groups'->0->'loads'->0->>'discountAmount' IS DISTINCT FROM '0'
 THEN RAISE EXCEPTION 'Financial values leaked between contracts: %',r; END IF;
 BEGIN PERFORM public.billing_rpc('contracts','list',scope||jsonb_build_object('view','loads','companyId',other_company));RAISE EXCEPTION 'Wrong company can read financial loads';EXCEPTION WHEN no_data_found THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('contracts','list',scope||'{"view":"loads","ownerId":"99999999-9999-4999-8999-999999999972"}');RAISE EXCEPTION 'Owner injection accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('contracts','save-load',input||'{"grossAmount":"0"}');RAISE EXCEPTION 'Client financial override accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN UPDATE public.billing_contract_loads SET volume=1 WHERE id=first_load;RAISE EXCEPTION 'Direct financial source update accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM billing_private.contract_load_financials(NULL::public.billing_contracts);RAISE EXCEPTION 'Private financial helper exposed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM set_config('load_money.scope',scope::text,true);
 PERFORM set_config('load_money.input',(input||jsonb_build_object('id',first_load))::text,true);
 PERFORM set_config('load_money.first',first_load::text,true);
 PERFORM set_config('load_money.second',second_load::text,true);
END $$;

-- Historical missing ATR remains readable with an independently known discount.
RESET ROLE;
UPDATE public.billing_contract_loads SET atr=NULL WHERE id=current_setting('load_money.first')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; row_data jsonb; scope jsonb:=current_setting('load_money.scope')::jsonb; BEGIN
 r=public.billing_rpc('contracts','list',scope||'{"view":"loads","groupBy":"none"}');
 SELECT value INTO row_data FROM jsonb_array_elements(r->'groups'->0->'loads') WHERE value->>'id'=current_setting('load_money.first');
 IF row_data->>'atr' IS DISTINCT FROM '' OR row_data->>'grossAmount' IS DISTINCT FROM '' OR row_data->>'netAmount' IS DISTINCT FROM '' OR row_data->>'billingPending' IS DISTINCT FROM 'true' OR row_data->>'discountAmount' IS DISTINCT FROM '0.01' OR row_data->>'atrQuote' IS DISTINCT FROM '0.01'
 THEN RAISE EXCEPTION 'Missing legacy measurement was fabricated or hid discounts: %',row_data; END IF;
 SELECT value INTO row_data FROM jsonb_array_elements(r->'groups'->0->'loads') WHERE value->>'id'=current_setting('load_money.second');
 IF row_data->>'billingPending' IS DISTINCT FROM 'false' OR row_data->>'grossAmount' IS DISTINCT FROM '0' OR row_data->>'discountAmount' IS DISTINCT FROM '0.02'
 THEN RAISE EXCEPTION 'Missing ATR corrupted a separately known load: %',row_data; END IF;
 PERFORM public.billing_rpc('contracts','save-load',current_setting('load_money.input')::jsonb);
 r=public.billing_rpc('contracts','list',scope||'{"view":"loads","search":"JAN-FIRST"}');
 IF r->'groups'->0->'loads'->0->>'billingPending' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Restoring measurement did not clear pending load'; END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999972',true);
DO $$ DECLARE scope jsonb:=current_setting('load_money.scope')::jsonb; BEGIN
 BEGIN PERFORM public.billing_rpc('contracts','list',scope||'{"view":"loads"}');RAISE EXCEPTION 'Another owner can read load values';EXCEPTION WHEN no_data_found THEN NULL;END;
 IF EXISTS(SELECT 1 FROM public.billing_contract_loads) OR EXISTS(SELECT 1 FROM public.billing_contract_discounts) THEN RAISE EXCEPTION 'Financial source RLS leaked another owner'; END IF;
 PERFORM public.billing_rpc('atr','save','{"year":2026,"month":3,"monthlyGrossValue":"10","monthlyNetValue":"9","accumulatedGrossValue":"8","accumulatedNetValue":"7"}');
END $$;
SELECT set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999971',true);
DO $$ DECLARE r jsonb; BEGIN
 r=public.billing_rpc('contracts','list',current_setting('load_money.scope')::jsonb||'{"view":"loads","search":"MISSING"}');
 IF r->'groups'->0->'loads'->0->>'billingPending' IS DISTINCT FROM 'true' OR r->'groups'->0->'loads'->0->>'atrQuote' IS DISTINCT FROM '' THEN RAISE EXCEPTION 'Another owner quote filled missing load price'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ BEGIN
 BEGIN PERFORM public.billing_rpc('contracts','list',current_setting('load_money.scope')::jsonb||'{"view":"loads"}');RAISE EXCEPTION 'Unauthenticated financial loads allowed';EXCEPTION WHEN invalid_authorization_specification THEN NULL;END;
END $$;
RESET ROLE;
ROLLBACK;
