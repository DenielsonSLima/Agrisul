BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('88888888-8888-4888-8888-888888888881','load-atr-a@example.invalid',now()),
 ('88888888-8888-4888-8888-888888888882','load-atr-b@example.invalid',now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888881',true);
DO $$
DECLARE
 company uuid; client uuid; kind uuid; contract uuid; farm uuid; plot uuid; load_id uuid; quote_id uuid;
 contract_input jsonb; scope jsonb; input jsonb; quote_input jsonb; r jsonb; c jsonb; m jsonb; criterion jsonb;
 details jsonb:='{"tradeName":"","cnpj":"","street":"","number":"","complement":"","district":"","city":"","state":"","zipCode":"","phone":"","email":""}';
BEGIN
 company=(public.billing_rpc('companies','save',details||'{"legalName":"Empresa ATR","isPrimary":true}')->>'id')::uuid;
 client=(public.billing_rpc('clients','save',details||'{"legalName":"Cliente ATR","cnpj":"11222333000181"}')->'client'->>'id')::uuid;
 PERFORM public.billing_rpc('contract-types','save','{"name":"Contrato ATR","stages":[]}');
 kind=(public.billing_rpc('contract-types','list')->'types'->0->>'id')::uuid;
 contract_input=jsonb_build_object('companyId',company,'clientId',client,'typeId',kind,'title','Contrato ATR','status','Ativo','startDate','2026-01-01','contractedVolume','100');
 contract=(public.billing_rpc('contracts','save',contract_input)->'contract'->>'id')::uuid;
 contract_input=contract_input||jsonb_build_object('id',contract);
 farm=(public.billing_rpc('farms','save','{"name":"Fazenda ATR","areaHa":"10","city":"Cidade","state":"SE"}')->'farm'->>'id')::uuid;
 plot=(public.billing_rpc('plots','save',jsonb_build_object('farmId',farm,'name','Talhão ATR','areaHa','10'))->'data'->'plots'->0->>'id')::uuid;
 quote_input='{"year":2025,"month":12,"monthlyGrossValue":"2","monthlyNetValue":"1.5","accumulatedGrossValue":"3","accumulatedNetValue":"2.5"}';
 quote_id=(public.billing_rpc('atr','save',quote_input)->'record'->>'id')::uuid;
 PERFORM public.billing_rpc('atr','save',quote_input||'{"year":2026,"month":1,"monthlyGrossValue":"4"}');
 scope=jsonb_build_object('companyId',company,'contractId',contract);
 input=scope||jsonb_build_object('farmId',farm,'plotId',plot,'loadedAt','2026-01-31','volume','10','atr','130','document','','notes','');
 r=public.billing_rpc('contracts','save-load',input);
 load_id=(r->'load'->>'id')::uuid;
 IF r->'load'->>'atr'<>'130' OR r->'load'->>'atrReferenceMonth'<>'2025-12' THEN RAISE EXCEPTION 'January must resolve previous December: %',r; END IF;
 IF (SELECT atr FROM public.billing_contract_loads WHERE id=load_id) IS DISTINCT FROM 130 THEN RAISE EXCEPTION 'Measured ATR not stored'; END IF;
 PERFORM public.billing_rpc('contracts','save-load',input||'{"loadedAt":"2026-01-01","volume":"20","atr":"140"}');
 -- The four criteria are independent. Every January day uses December while keeping its own measured ATR.
 FOR criterion IN SELECT value FROM jsonb_array_elements('[
  {"atrPriceType":"gross","atrPeriodType":"monthly","quote":"2","amount":"8200"},
  {"atrPriceType":"net","atrPeriodType":"monthly","quote":"1.5","amount":"6150"},
  {"atrPriceType":"gross","atrPeriodType":"accumulated","quote":"3","amount":"12300"},
  {"atrPriceType":"net","atrPeriodType":"accumulated","quote":"2.5","amount":"10250"}
 ]') LOOP
  PERFORM public.billing_rpc('contracts','save',contract_input||(criterion-'quote'-'amount'));
  c=public.billing_rpc('contracts','get',jsonb_build_object('id',contract,'companyId',company))->'contract';
  m=c->'monthlySummary'->'months'->0;
  IF c->>'averageAtr'<>'136.666667' OR c->>'billingAmount'<>criterion->>'amount'
   OR m->>'atrQuote'<>criterion->>'quote' OR m->>'atrReferenceMonth'<>'2025-12'
   OR m->>'billingAmount'<>criterion->>'amount' OR c->'financialSummary'->'totals'->>'grossAmount'<>criterion->>'amount'
   OR c->'loads'->0->>'atr'<>'130' THEN
   RAISE EXCEPTION 'Criterion or monthly rounding inconsistent: %, %',criterion,c;
  END IF;
 END LOOP;
 PERFORM public.billing_rpc('contracts','save',contract_input||'{"atrPriceType":"gross","atrPeriodType":"monthly"}');
 -- Changing the entered date must change the reference, regardless of created_at.
 r=public.billing_rpc('contracts','save-load',input||jsonb_build_object('id',load_id,'loadedAt','2026-02-01'));
 IF r->'load'->>'atr'<>'130' OR r->'load'->>'atrReferenceMonth'<>'2026-01' THEN RAISE EXCEPTION 'Date edit did not resolve the new previous month'; END IF;
 c=public.billing_rpc('contracts','get',jsonb_build_object('id',contract,'companyId',company))->'contract';
 IF c->>'billingAmount'<>'10800' OR c->'monthlySummary'->'totals'->>'billingAmount'<>'10800' OR c->'financialSummary'->'totals'->>'grossAmount'<>'10800' THEN RAISE EXCEPTION 'Overall amount must sum monthly rounded amounts'; END IF;
 PERFORM public.billing_rpc('contracts','save-load',input||jsonb_build_object('id',load_id));
 -- Quotation edits recalculate existing loads and all indicators.
 PERFORM public.billing_rpc('atr','save',quote_input||jsonb_build_object('id',quote_id,'monthlyGrossValue','6'));
 r=public.billing_rpc('contracts','list',scope||'{"view":"loads","groupBy":"farm"}');
 IF r->'summary'->>'averageAtr'<>'136.666667' OR r->'groups'->0->>'averageAtr'<>'136.666667' THEN RAISE EXCEPTION 'Quote edit did not refresh grouped means'; END IF;
 c=public.billing_rpc('contracts','get',jsonb_build_object('id',contract,'companyId',company))->'contract';
 IF c->>'billingAmount'<>'24600' THEN RAISE EXCEPTION 'Quote edit did not refresh billing'; END IF;
 PERFORM public.billing_rpc('contracts','save-load',input||jsonb_build_object('id',load_id,'atr','150'));
 c=public.billing_rpc('contracts','get',jsonb_build_object('id',contract,'companyId',company))->'contract';
 IF c->>'billingAmount'<>'25800' OR c->>'averageAtr'<>'143.333333' THEN RAISE EXCEPTION 'ATR edit did not recalculate billing and measured mean'; END IF;
 -- An explicitly registered zero is a quote, not a missing value.
 PERFORM public.billing_rpc('atr','save',quote_input||jsonb_build_object('id',quote_id,'monthlyGrossValue','0'));
 c=public.billing_rpc('contracts','get',jsonb_build_object('id',contract,'companyId',company))->'contract';
 IF c->>'billingAmount'<>'0' OR c->>'billingPending'<>'false' THEN RAISE EXCEPTION 'Zero quotation incorrectly pending'; END IF;
 BEGIN PERFORM public.billing_rpc('contracts','save-load',input-'atr');RAISE EXCEPTION 'Missing measured ATR accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 FOR r IN SELECT value FROM jsonb_array_elements('[{"atr":""},{"atr":"0"},{"atr":"-1"},{"atr":"NaN"},{"atr":"1.0000001"},{"atr":130},{"atr":null}]') LOOP
  BEGIN PERFORM public.billing_rpc('contracts','save-load',input||r);RAISE EXCEPTION 'Invalid measured ATR accepted: %',r;EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 END LOOP;
 BEGIN PERFORM public.billing_rpc('contracts','save-load',input||'{"atrReferenceMonth":"2026-01"}');RAISE EXCEPTION 'Client reference override accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('contracts','save-load',input||'{"volume":"0.0001"}');RAISE EXCEPTION 'Weight precision accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 r=public.billing_rpc('contracts','save-load',input||'{"volume":"100","document":"EXCESS-CHECK"}');
 c=public.billing_rpc('contracts','get',jsonb_build_object('id',contract,'companyId',company))->'contract';
 IF c->>'loadedVolume'<>'130' OR c->>'remainingVolume'<>'0'
  OR c->'financialSummary'->'totals'->>'loadedVolume'<>'130' THEN
  RAISE EXCEPTION 'Excess load was not accepted in contract totals: %',c;
 END IF;
 PERFORM public.billing_rpc('contracts','delete-load',scope||jsonb_build_object('id',r->'load'->>'id'));
 PERFORM public.billing_rpc('atr','delete',jsonb_build_object('id',quote_id));
 -- Another owner's quote cannot fill the gap, nor can the current month's quote.
 PERFORM set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888882',true);
 PERFORM public.billing_rpc('atr','save',quote_input);
 PERFORM set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888881',true);
 c=public.billing_rpc('contracts','get',jsonb_build_object('id',contract,'companyId',company))->'contract';
 IF c->>'billingPending'<>'true' OR c->>'billingAmount'<>'' OR c->>'averageAtr'<>'143.333333' OR c->'loads'->0->>'atr'<>'150' THEN RAISE EXCEPTION 'Missing quote must remain pending without fallback'; END IF;
 r=public.billing_rpc('contracts','save-load',input||'{"loadedAt":"2026-04-30","volume":"1"}');
 IF r->'load'->>'atr'<>'130' OR r->'load'->>'atrReferenceMonth'<>'2026-03' THEN RAISE EXCEPTION 'Missing quote must allow weight entry'; END IF;
 -- Save the ID for a privileged, transaction-local legacy fixture below.
 PERFORM public.billing_rpc('atr','save',quote_input);
 PERFORM public.billing_rpc('atr','save',quote_input||'{"year":2026,"month":3}');
 PERFORM set_config('load_atr.input',(input||jsonb_build_object('id',load_id))::text,true);
 PERFORM set_config('load_atr.contract',contract::text,true);
 PERFORM set_config('load_atr.company',company::text,true);
 PERFORM set_config('load_atr.load',load_id::text,true);
END $$;
RESET ROLE;
UPDATE public.billing_contract_loads SET atr=123 WHERE id=current_setting('load_atr.load')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE c jsonb; BEGIN
 c=public.billing_rpc('contracts','get',jsonb_build_object('id',current_setting('load_atr.contract'),'companyId',current_setting('load_atr.company')))->'contract';
 IF c->>'billingAmount'<>'8320' THEN RAISE EXCEPTION 'Historical measured ATR must participate in billing'; END IF;
END $$;
RESET ROLE;
UPDATE public.billing_contract_loads SET atr=NULL WHERE id=current_setting('load_atr.load')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE c jsonb; BEGIN
 c=public.billing_rpc('contracts','get',jsonb_build_object('id',current_setting('load_atr.contract'),'companyId',current_setting('load_atr.company')))->'contract';
 IF c->>'billingPending'<>'true' OR c->>'billingAmount'<>'' OR c->>'averageAtr'<>'' OR c->'financialSummary'->'totals'->>'pendingAmount'<>'' THEN RAISE EXCEPTION 'Missing measured ATR fabricated revenue'; END IF;
 PERFORM public.billing_rpc('contracts','save-load',current_setting('load_atr.input')::jsonb);
 c=public.billing_rpc('contracts','get',jsonb_build_object('id',current_setting('load_atr.contract'),'companyId',current_setting('load_atr.company')))->'contract';
 IF c->>'billingPending'<>'false' OR c->>'billingAmount'<>'8460' THEN RAISE EXCEPTION 'Supplying missing ATR did not recover billing'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
