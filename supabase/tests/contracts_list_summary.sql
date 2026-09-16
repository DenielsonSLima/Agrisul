BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('77777777-7777-4777-8777-777777777777','list-summary-a@example.invalid',now()),
 ('88888888-8888-4888-8888-888888888888','list-summary-b@example.invalid',now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',true);
DO $$
DECLARE
 company uuid;other_company uuid;client uuid;kind uuid;farm uuid;plot uuid;a uuid;b uuid;finished uuid;missing uuid;
 input jsonb;scope jsonb;r jsonb;s jsonb;item jsonb;key text;expected_atr numeric;quote_id uuid;extra_load uuid;
 details jsonb:='{"tradeName":"","cnpj":"","street":"","number":"","complement":"","district":"","city":"","state":"","zipCode":"","phone":"","email":""}';
BEGIN
 company=(public.billing_rpc('companies','save',details||'{"legalName":"Empresa resumo","isPrimary":true}')->'company'->>'id')::uuid;
 other_company=(public.billing_rpc('companies','save',details||'{"legalName":"Outra empresa resumo","isPrimary":false}')->'company'->>'id')::uuid;
 PERFORM set_config('summary.company',company::text,true);
 client=(public.billing_rpc('clients','save',details||'{"legalName":"Cliente resumo","cnpj":"11222333000181","status":"Ativo"}')->'client'->>'id')::uuid;
 PERFORM public.billing_rpc('contract-types','save','{"name":"Tipo resumo","stages":[]}');
 kind=(public.billing_rpc('contract-types','list')->'types'->0->>'id')::uuid;
 farm=(public.billing_rpc('farms','save','{"name":"Fazenda resumo","areaHa":"10","city":"Cidade","state":"SP"}')->'farm'->>'id')::uuid;
 plot=(public.billing_rpc('plots','save',jsonb_build_object('farmId',farm,'name','Talhão resumo','areaHa','10'))->'data'->'plots'->0->>'id')::uuid;
 PERFORM public.billing_rpc('atr','save','{"year":2026,"month":6,"monthlyGrossValue":"1","monthlyNetValue":"1","accumulatedGrossValue":"1","accumulatedNetValue":"1"}');
 PERFORM public.billing_rpc('atr','save','{"year":2026,"month":7,"monthlyGrossValue":"1","monthlyNetValue":"1","accumulatedGrossValue":"1","accumulatedNetValue":"1"}');
 input=jsonb_build_object('title','Contrato resumo','contractNumber','RES-A','companyId',company,'clientId',client,'typeId',kind,'startDate','2026-07-01','endDate','','contractedVolume','1000','value','','notes','','atrPriceType','gross','atrPeriodType','monthly');
 a=(public.billing_rpc('contracts','save',input)->'contract'->>'id')::uuid;
 b=(public.billing_rpc('contracts','save',input||'{"contractNumber":"RES-B","startDate":"2026-08-01"}')->'contract'->>'id')::uuid;
 finished=(public.billing_rpc('contracts','save',input||'{"contractNumber":"RES-F"}')->'contract'->>'id')::uuid;
 PERFORM public.billing_rpc('contracts','save',input||jsonb_build_object('id',finished,'contractNumber','RES-F','status','Concluído'));
 PERFORM public.billing_rpc('contracts','save',input||jsonb_build_object('companyId',other_company));
 scope=jsonb_build_object('companyId',company,'farmId',farm,'plotId',plot,'document','','notes','');
 -- Seed production directly: this suite tests read aggregation; load validation
 -- and the chosen ATR pricing rules have their own behavioral suites.
 RESET ROLE;
 INSERT INTO public.billing_contract_loads(owner_id,contract_id,farm_id,plot_id,loaded_at,volume,atr) VALUES
  ('77777777-7777-4777-8777-777777777777',a,farm,plot,'2026-07-10',10,100),
  ('77777777-7777-4777-8777-777777777777',b,farm,plot,'2026-08-10',30,200);
 SET LOCAL ROLE authenticated;
 scope=jsonb_build_object('companyId',company);
 PERFORM public.billing_rpc('contracts','save-discount',scope||jsonb_build_object('contractId',a,'requestId',gen_random_uuid(),'title','Acordo A','ratePerTon','2','months',jsonb_build_array('2026-07'),'notes',''));
 PERFORM public.billing_rpc('contracts','save-discount',scope||jsonb_build_object('contractId',b,'requestId',gen_random_uuid(),'title','Acordo B','ratePerTon','2','months',jsonb_build_array('2026-08'),'notes',''));
 PERFORM public.billing_rpc('contracts','save-payment',scope||jsonb_build_object('contractId',a,'requestId',gen_random_uuid(),'kind','advance','receivedAt','2026-07-01','referenceMonth','2026-07','amount','200','document','','notes',''));
 PERFORM public.billing_rpc('contracts','save-payment',scope||jsonb_build_object('contractId',b,'requestId',gen_random_uuid(),'kind','receipt','receivedAt','2026-08-01','referenceMonth','2026-08','amount','7000','document','','notes',''));
 r=public.billing_rpc('contracts','list',scope);s=r->'summary';
 expected_atr=round(((public.billing_rpc('contracts','get',scope||jsonb_build_object('id',a))->'contract'->'financialSummary'->'totals'->>'averageAtr')::numeric*10+(public.billing_rpc('contracts','get',scope||jsonb_build_object('id',b))->'contract'->'financialSummary'->'totals'->>'averageAtr')::numeric*30)/40,6);
 IF r->>'total'<>'2' OR r->'counts'<>jsonb_build_object('open',2,'finished',1) THEN RAISE EXCEPTION 'Wrong selected scope: %',r; END IF;
 IF s->>'loadedVolume'<>'40' OR (s->>'averageAtr')::numeric<>expected_atr OR s->>'grossAmount'<>'7000' OR s->>'discountAmount'<>'80' OR s->>'netAmount'<>'6920' OR s->>'receivedAmount'<>'7200' OR s->>'pendingAmount'<>'780' OR s->>'creditAmount'<>'1060' THEN RAISE EXCEPTION 'Wrong list KPIs: %',s; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(r->'contracts') LOOP
  IF item->'financialTotals' IS DISTINCT FROM public.billing_rpc('contracts','get',scope||jsonb_build_object('id',item->>'id'))->'contract'->'financialSummary'->'totals' THEN RAISE EXCEPTION 'List/detail metrics differ'; END IF;
 END LOOP;
 FOREACH key IN ARRAY ARRAY['loadedVolume','averageAtr','grossAmount','discountAmount','netAmount','receivedAmount','pendingAmount'] LOOP
  IF jsonb_typeof(s->key)<>'string' THEN RAISE EXCEPTION 'Numeric must travel as text: %',key; END IF;
 END LOOP;
 r=public.billing_rpc('contracts','list',scope||'{"search":"res-b"}');
 IF r->>'total'<>'1' OR r->'summary'->>'loadedVolume'<>'30' OR r->'summary'->>'pendingAmount'<>'0' THEN RAISE EXCEPTION 'Contract number search not reflected in summary: %',r; END IF;
 r=public.billing_rpc('contracts','list',scope||'{"search":"11.222.333/0001-81"}');
 IF r->>'total'<>'2' THEN RAISE EXCEPTION 'Formatted CNPJ search failed'; END IF;
 r=public.billing_rpc('contracts','list',scope||'{"from":"2026-07-01","to":"2026-07-01"}');
 IF r->>'total'<>'1' OR r->'summary'->>'loadedVolume'<>'10' OR r->'summary'->>'receivedAmount'<>'200' THEN RAISE EXCEPTION 'Dates must select contracts, preserving their complete loads/payments: %',r; END IF;
 r=public.billing_rpc('contracts','list',scope||'{"bucket":"finished"}');
 IF r->>'total'<>'1' OR r->'contracts'->0->>'id'<>finished::text OR r->'summary'->>'loadedVolume'<>'0' THEN RAISE EXCEPTION 'Finished tab included active contracts'; END IF;
 r=public.billing_rpc('contracts','list',scope||'{"search":"absent-contract"}');s=r->'summary';
 IF r->>'total'<>'0' OR s->>'loadedVolume'<>'0' OR s->>'grossAmount'<>'0' OR s->>'pendingAmount'<>'0' OR s->>'averageAtr'<>'' OR s->>'billingPending'<>'false' THEN RAISE EXCEPTION 'Empty summary wrong: %',s; END IF;
 missing=(public.billing_rpc('contracts','save',input||'{"contractNumber":"MISSING"}')->'contract'->>'id')::uuid;
 RESET ROLE;
 INSERT INTO public.billing_contract_loads(owner_id,contract_id,farm_id,plot_id,loaded_at,volume,atr) VALUES ('77777777-7777-4777-8777-777777777777',missing,farm,plot,'2026-11-01',1,1);
 SET LOCAL ROLE authenticated;
 s=public.billing_rpc('contracts','list',scope)->'summary';
 IF s->>'pendingContractCount'<>'1' OR s->>'billingPending'<>'true' OR s->>'grossAmount'<>'' OR s->>'netAmount'<>'' OR s->>'pendingAmount'<>'' OR s->>'loadedVolume'<>'41' OR s->>'discountAmount'<>'80' OR s->>'receivedAmount'<>'7200' THEN RAISE EXCEPTION 'Missing quote must not become zero: %',s; END IF;
 BEGIN PERFORM public.billing_rpc('contracts','list',scope||'{"from":"2026-09-01","to":"2026-01-01"}');RAISE EXCEPTION 'Invalid dates accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('contracts','list',scope||'{"bucket":"all"}');RAISE EXCEPTION 'Invalid bucket accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('contracts','list',scope||'{"owner_id":"88888888-8888-4888-8888-888888888888"}');RAISE EXCEPTION 'Owner injection accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;

 -- Report quote average is separate from measured ATR and from billing amounts.
 SELECT id INTO quote_id FROM public.billing_atr_records WHERE year=2026 AND month=6;
 PERFORM public.billing_rpc('atr','save',jsonb_build_object('id',quote_id,'year',2026,'month',6,'monthlyGrossValue','1.1','monthlyNetValue','0.9','accumulatedGrossValue','1.5','accumulatedNetValue','1.2'));
 SELECT id INTO quote_id FROM public.billing_atr_records WHERE year=2026 AND month=7;
 PERFORM public.billing_rpc('atr','save',jsonb_build_object('id',quote_id,'year',2026,'month',7,'monthlyGrossValue','1.3','monthlyNetValue','1.1','accumulatedGrossValue','1.7','accumulatedNetValue','1.4'));
 PERFORM public.billing_rpc('atr','save','{"year":2026,"month":8,"monthlyGrossValue":"999","monthlyNetValue":"999","accumulatedGrossValue":"999","accumulatedNetValue":"999"}');
 extra_load=(public.billing_rpc('contracts','save-load',scope||jsonb_build_object('contractId',a,'farmId',farm,'plotId',plot,'loadedAt','2026-08-10','volume','30','atr','200','document','','notes',''))->'load'->>'id')::uuid;
 FOR item IN SELECT value FROM jsonb_array_elements('[
  {"atrPriceType":"gross","atrPeriodType":"monthly","expected":"1.25"},
  {"atrPriceType":"net","atrPeriodType":"monthly","expected":"1.05"},
  {"atrPriceType":"gross","atrPeriodType":"accumulated","expected":"1.65"},
  {"atrPriceType":"net","atrPeriodType":"accumulated","expected":"1.35"}
 ]') LOOP
  PERFORM public.billing_rpc('contracts','save',input||jsonb_build_object('id',a,'status','Ativo')||(item-'expected'));
  r=public.billing_rpc('contracts','list',scope||'{"search":"RES-A","from":"2026-07-01","to":"2026-07-01"}')->'contracts'->0;
  IF r->>'averageAtr'<>'175' OR r->'atrQuoteSummary'->>'average'<>item->>'expected' OR r->'atrQuoteSummary'->>'pending'<>'false'
   OR r->'atrQuoteSummary'->'loadedMonths'<>'["2026-07","2026-08"]'::jsonb OR r->'atrQuoteSummary'->'referenceMonths'<>'["2026-06","2026-07"]'::jsonb THEN
   RAISE EXCEPTION 'Wrong selected quotation, weighting, reference months or measured ATR: %, %',item,r;
  END IF;
 END LOOP;
 PERFORM public.billing_rpc('contracts','save',input||jsonb_build_object('id',a,'status','Ativo'));
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('id',extra_load,'contractId',a,'farmId',farm,'plotId',plot,'loadedAt','2027-01-31','volume','30','atr','200','document','','notes',''));
 r=public.billing_rpc('contracts','list',scope||'{"search":"RES-A"}')->'contracts'->0;
 IF r->'atrQuoteSummary'->>'average'<>'' OR r->'atrQuoteSummary'->>'pending'<>'true' OR r->'atrQuoteSummary'->'referenceMonths'<>'["2026-06","2026-12"]'::jsonb THEN RAISE EXCEPTION 'Missing prior December quotation must remain pending: %',r; END IF;
 PERFORM public.billing_rpc('atr','save','{"year":2026,"month":12,"monthlyGrossValue":"1.654321","monthlyNetValue":"1","accumulatedGrossValue":"1","accumulatedNetValue":"1"}');
 r=public.billing_rpc('contracts','list',scope||'{"search":"RES-A"}')->'contracts'->0;
 IF r->'atrQuoteSummary'->>'average'<>'1.515741' OR jsonb_typeof(r->'atrQuoteSummary'->'average')<>'string' THEN RAISE EXCEPTION 'Quote update must recalculate to six decimal places: %',r; END IF;
 RESET ROLE;
 UPDATE public.billing_contract_loads SET atr=NULL WHERE id=extra_load;
 SET LOCAL ROLE authenticated;
 r=public.billing_rpc('contracts','list',scope||'{"search":"RES-A"}')->'contracts'->0;
 IF r->'atrQuoteSummary'->>'average'<>'1.515741' OR r->'atrQuoteSummary'->>'pending'<>'false' OR r->>'billingPending'<>'true' THEN RAISE EXCEPTION 'Quotation cannot depend on missing measured ATR: %',r; END IF;
 r=public.billing_rpc('contracts','list',scope||'{"bucket":"finished"}')->'contracts'->0;
 IF r->'atrQuoteSummary' IS DISTINCT FROM '{"average":"","pending":false,"loadedMonths":[],"referenceMonths":[]}'::jsonb THEN RAISE EXCEPTION 'No loads must not fabricate an average: %',r; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888888',true);
DO $$ BEGIN
 BEGIN PERFORM public.billing_rpc('contracts','list',jsonb_build_object('companyId',current_setting('summary.company')));RAISE EXCEPTION 'Cross owner summary exposed';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 IF EXISTS(SELECT 1 FROM public.billing_contracts) THEN RAISE EXCEPTION 'RLS exposed contracts'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ BEGIN
 BEGIN PERFORM public.billing_rpc('contracts','list',jsonb_build_object('companyId',current_setting('summary.company')));RAISE EXCEPTION 'Anonymous summary exposed';EXCEPTION WHEN invalid_authorization_specification THEN NULL;END;
END $$;
ROLLBACK;
