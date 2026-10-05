BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('a1050000-0000-4000-8000-000000000001','summary-filters-a@example.invalid',now()),
 ('a1050000-0000-4000-8000-000000000002','summary-filters-b@example.invalid',now()),
 ('a1050000-0000-4000-8000-000000000003','summary-filters-reader@example.invalid',now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1050000-0000-4000-8000-000000000001',true);
DO $test$
DECLARE
 company uuid;other_company uuid;client uuid;kind uuid;farm uuid;plot uuid;a uuid;b uuid;idle uuid;foreign_contract uuid;
 tiny uuid;pending uuid;load_a uuid;load_b uuid;profile uuid;
 input jsonb;scope jsonb;baseline jsonb;r jsonb;row_data jsonb;period uuid;culture uuid;subtype uuid;
 details jsonb:='{"tradeName":"","cnpj":"","street":"","number":"","complement":"","district":"","city":"","state":"","zipCode":"","phone":"","email":""}';
BEGIN
 PERFORM public.billing_rpc('settings','get');
 company=(public.billing_rpc('companies','save',details||'{"legalName":"Empresa de validação local","isPrimary":true}')->'company'->>'id')::uuid;
 other_company=(public.billing_rpc('companies','save',details||'{"legalName":"Outra empresa de validação","isPrimary":false}')->'company'->>'id')::uuid;
 client=(public.billing_rpc('clients','save',details||'{"legalName":"Cliente de validação","cnpj":"11222333000181","status":"Ativo"}')->'client'->>'id')::uuid;
 kind=(public.billing_rpc('contract-types','save','{"name":"Contrato de validação","stages":[]}')->'type'->>'id')::uuid;
 farm=(public.billing_rpc('farms','save','{"name":"Fazenda de validação","areaHa":"50","city":"Cidade","state":"SE"}')->'farm'->>'id')::uuid;
 plot=(public.billing_rpc('plots','save',jsonb_build_object('farmId',farm,'name','Talhão de validação','areaHa','25'))->'data'->'plots'->0->>'id')::uuid;
 input=jsonb_build_object('companyId',company,'clientId',client,'typeId',kind,'title','Contrato em operação','contractNumber','TEST-A',
  'status','Ativo','startDate','2026-01-01','endDate','','contractedVolume','20','value','','notes','','atrPriceType','gross','atrPeriodType','monthly');
 a=(public.billing_rpc('contracts','save',input)->'contract'->>'id')::uuid;
 b=(public.billing_rpc('contracts','save',input||'{"title":"Contrato concluído","contractNumber":"TEST-B"}')->'contract'->>'id')::uuid;
 idle=(public.billing_rpc('contracts','save',input||'{"title":"Contrato sem movimento","contractNumber":"TEST-IDLE"}')->'contract'->>'id')::uuid;
 foreign_contract=(public.billing_rpc('contracts','save',input||jsonb_build_object('companyId',other_company,'title','Contrato de outra empresa','contractNumber','TEST-OTHER'))->'contract'->>'id')::uuid;
 PERFORM set_config('summary.selection.company',company::text,true);
 PERFORM set_config('summary.selection.contract',a::text,true);
 PERFORM public.billing_rpc('atr','save','{"year":2026,"month":8,"monthlyGrossValue":"1","monthlyNetValue":"1","accumulatedGrossValue":"1","accumulatedNetValue":"1"}');
 PERFORM public.billing_rpc('atr','save','{"year":2026,"month":9,"monthlyGrossValue":"2","monthlyNetValue":"2","accumulatedGrossValue":"2","accumulatedNetValue":"2"}');
 scope=jsonb_build_object('companyId',company,'contractId',a);
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('farmId',farm,'plotId',plot,'loadedAt','2026-09-01','volume','10','atr','100','document','TEST-A-1','notes',''));
 -- Farm-only deliveries must remain in both projections.
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('farmId',farm,'plotId','','loadedAt','2026-09-20','volume','30','atr','140','document','TEST-A-2','notes',''));
 PERFORM public.billing_rpc('contracts','save-discount',scope||jsonb_build_object('requestId',gen_random_uuid(),'title','Transporte','ratePerTon','0.333','months',jsonb_build_array('2026-09'),'notes',''));
 PERFORM public.billing_rpc('contracts','save-payment',scope||jsonb_build_object('requestId',gen_random_uuid(),'kind','advance','receivedAt','2026-08-31','referenceMonth','2026-09','amount','100','document','','notes',''));
 PERFORM public.billing_rpc('contracts','save-payment',scope||jsonb_build_object('requestId',gen_random_uuid(),'kind','receipt','receivedAt','2026-09-20','referenceMonth','2026-08','amount','500','document','','notes',''));
 PERFORM public.billing_rpc('contracts','save-payment',scope||jsonb_build_object('requestId',gen_random_uuid(),'kind','receipt','receivedAt','2026-09-30','referenceMonth','2026-10','amount','100','document','','notes',''));
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('contractId',b,'farmId',farm,'plotId',plot,'loadedAt','2026-09-05','volume','5','atr','100','document','TEST-B-1','notes',''));
 PERFORM public.billing_rpc('contracts','save-payment',scope||jsonb_build_object('contractId',b,'requestId',gen_random_uuid(),'kind','advance','receivedAt','2026-08-01','referenceMonth','2026-08','amount','2000','document','','notes',''));
 PERFORM public.billing_rpc('contracts','close',scope||jsonb_build_object('contractId',b));
 PERFORM public.billing_rpc('contracts','save-refund',scope||jsonb_build_object('contractId',b,'requestId',gen_random_uuid(),'refundedAt','2026-10-01','referenceMonth','2026-10','amount','1000','document','','notes',''));
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('companyId',other_company,'contractId',foreign_contract,'farmId',farm,'plotId',plot,'loadedAt','2026-09-05','volume','100','atr','100','document','TEST-OTHER','notes',''));
 culture=(public.billing_rpc('cultures','save','{"kind":"culture","name":"Cultura de validação"}')->>'id')::uuid;
 subtype=(public.billing_rpc('cultures','save',jsonb_build_object('kind','subtype','cultureId',culture,'name','Ciclo de validação'))->>'id')::uuid;
 period=(public.billing_rpc('planning','save-period',jsonb_build_object('name','Safra de validação','startDate','2026-01-01','endDate','2026-12-31','targetAreaHa','20','cultureId',culture,'cultureSubtypeId',subtype,'notes','','status','active'))->'period'->>'id')::uuid;
 PERFORM public.billing_rpc('planning','save-allocation',jsonb_build_object('periodId',period,'plotId',plot,'areaHa','20','notes',''));
 PERFORM public.billing_rpc('planning','save-field-log',jsonb_build_object('periodId',period,'plotId',plot,'kind','planting','practiceId','','occurredOn','2026-02-05','areaHa','5','notes','','requestId',gen_random_uuid(),'details',jsonb_build_object('materials','[]'::jsonb)));
 scope=jsonb_build_object('companyId',company,'from','2026-09-01','to','2026-09-30');
 baseline=public.billing_rpc('summary','dashboard',scope);
 IF baseline->'totals'->>'contractCount'<>'3' OR baseline->'totals'->>'loadedVolume'<>'45'
 OR baseline->'totals'->>'receivedAmount'<>'600' OR jsonb_array_length(baseline->'filterOptions'->'contracts')<>3 THEN
  RAISE EXCEPTION 'Baseline scope/dates/available options wrong: %',baseline->'totals';
 END IF;
 r=public.billing_rpc('summary','dashboard',scope||jsonb_build_object('contractId',a,'status','Ativo'));
 IF r->'totals'->>'loadCount'<>'2' OR r->'totals'->>'loadedVolume'<>'40'
 OR r->'totals'->>'grossAmount'<>'10400' OR r->'totals'->>'discountAmount'<>'13.32'
 OR r->'totals'->>'netAmount'<>'10386.68' OR r->'totals'->>'receivedAmount'<>'600'
 OR r->'operationalTotals'->>'averageAtr'<>'130' OR r->'operationalTotals'->>'plotCount'<>'1'
 OR r->'monthlyOperations'->0->>'loadedVolume'<>'40' OR r->'months'->0->>'netAmount'<>'10386.68'
 OR r->'farms'->0->>'loadedVolume'<>'40' OR jsonb_array_length(r->'contracts')<>1
 OR r->'contractPerformance'->0->>'deliveryPercent'<>'200'
 OR r->'filters'->>'contractId'<>a::text OR r->'filters'->>'status'<>'Ativo' THEN
  RAISE EXCEPTION 'Combined filters/weighted ATR/lifetime delivery/financial cents wrong: %',r;
 END IF;
 IF r->'planning' IS DISTINCT FROM baseline->'planning' OR r->'planningPerformance' IS DISTINCT FROM baseline->'planningPerformance'
 OR r->'agriculture' IS DISTINCT FROM baseline->'agriculture' OR r->'planning'->>'plantedAreaHa'<>'5' THEN
  RAISE EXCEPTION 'Contract selection improperly filtered workspace planning/registry';
 END IF;
 IF jsonb_array_length(r->'filterOptions'->'contracts')<>3 THEN RAISE EXCEPTION 'Selection hid reset options'; END IF;
 -- Save a real local RPC response for optional isolated UI verification.
 PERFORM set_config('summary.selection.preview',r::text,true);
 r=public.billing_rpc('summary','dashboard',scope||jsonb_build_object('status','Concluído'));
 IF r->'totals'->>'contractCount'<>'1' OR r->'totals'->>'loadedVolume'<>'5' OR r->'totals'->>'receivedAmount'<>'0' THEN
  RAISE EXCEPTION 'Current status filter wrong: %',r->'totals';
 END IF;
 r=public.billing_rpc('summary','dashboard',scope||jsonb_build_object('contractId',a,'status','Concluído'));
 IF r->'totals'->>'contractCount'<>'0' OR r->'totals'->>'loadCount'<>'0' OR r->'totals'->>'netAmount'<>'0'
 OR jsonb_array_length(r->'contracts')<>0 OR jsonb_array_length(r->'months')<>1 THEN
  RAISE EXCEPTION 'Empty combined selection returned stale data';
 END IF;
 r=public.billing_rpc('summary','dashboard',scope||jsonb_build_object('contractId',b,'from','2026-10-01','to','2026-10-31'));
 IF r->'totals'->>'receivedAmount'<>'-1000' OR r->'totals'->>'advanceAmount'<>'-1000' OR r->'months'->0->>'receivedAmount'<>'-1000' THEN
  RAISE EXCEPTION 'Refund cash must remain negative in its actual date slice';
 END IF;
 r=public.billing_rpc('summary','dashboard',scope||'{"contractId":"","status":""}');
 IF r->'totals' IS DISTINCT FROM baseline->'totals' OR r->'operationalTotals' IS DISTINCT FROM baseline->'operationalTotals' THEN
  RAISE EXCEPTION 'Reset did not recover exact baseline';
 END IF;
 -- Reconcile a partial-month slice with values already allocated to its loads.
 r=public.billing_rpc('contracts','list',jsonb_build_object('companyId',company,'contractId',a,'view','loads','from','2026-09-20','to','2026-09-20'));
 SELECT value INTO row_data FROM jsonb_array_elements(r->'groups'->0->'loads');
 r=public.billing_rpc('summary','dashboard',scope||jsonb_build_object('contractId',a,'from','2026-09-20','to','2026-09-20'));
 IF r->'totals'->>'grossAmount' IS DISTINCT FROM row_data->>'grossAmount'
 OR r->'totals'->>'discountAmount' IS DISTINCT FROM row_data->>'discountAmount'
 OR r->'totals'->>'netAmount' IS DISTINCT FROM row_data->>'netAmount'
 OR r->'totals'->>'receivedAmount'<>'500' OR r->'totals'->>'plotCount'<>'0' THEN
  RAISE EXCEPTION 'Date slice changed cents, cash date or farm-only delivery: %',r->'totals';
 END IF;
 -- Tiny loads expose cent allocation regressions when hidden siblings disappear.
 tiny=(public.billing_rpc('contracts','save',input||'{"title":"Contrato de centavos","contractNumber":"TEST-CENTS"}')->'contract'->>'id')::uuid;
 PERFORM public.billing_rpc('contracts','save-load',jsonb_build_object('companyId',company,'contractId',tiny,'farmId',farm,'plotId',plot,'loadedAt','2026-09-01','volume','0.003','atr','1','document','CENT-1','notes',''));
 PERFORM public.billing_rpc('contracts','save-load',jsonb_build_object('companyId',company,'contractId',tiny,'farmId',farm,'plotId',plot,'loadedAt','2026-09-30','volume','0.002','atr','1','document','CENT-2','notes',''));
 PERFORM public.billing_rpc('contracts','save-discount',jsonb_build_object('companyId',company,'contractId',tiny,'requestId',gen_random_uuid(),'title','Acordo','ratePerTon','4','months',jsonb_build_array('2026-09'),'notes',''));
 r=public.billing_rpc('contracts','list',jsonb_build_object('companyId',company,'contractId',tiny,'view','loads','from','2026-09-30','to','2026-09-30'));
 SELECT value INTO row_data FROM jsonb_array_elements(r->'groups'->0->'loads');
 r=public.billing_rpc('summary','dashboard',scope||jsonb_build_object('contractId',tiny,'from','2026-09-30','to','2026-09-30'));
 IF r->'totals'->>'grossAmount' IS DISTINCT FROM row_data->>'grossAmount' OR r->'totals'->>'discountAmount' IS DISTINCT FROM row_data->>'discountAmount'
 OR r->'totals'->>'netAmount' IS DISTINCT FROM row_data->>'netAmount' THEN RAISE EXCEPTION 'Hidden load cents reassigned'; END IF;
 pending=(public.billing_rpc('contracts','save',input||'{"title":"Contrato a apurar","contractNumber":"TEST-PENDING"}')->'contract'->>'id')::uuid;
 load_a=(public.billing_rpc('contracts','save-load',jsonb_build_object('companyId',company,'contractId',pending,'farmId',farm,'plotId','','loadedAt','2026-10-01','volume','1','atr','1','document','PENDING','notes',''))->'load'->>'id')::uuid;
 -- The current write RPC requires ATR; historical/imported NULLs are permitted
 -- in the schema. Seed this legacy condition only inside the local transaction.
 RESET ROLE;
 UPDATE public.billing_contract_loads SET atr=NULL WHERE id=load_a AND owner_id='a1050000-0000-4000-8000-000000000001';
 SET LOCAL ROLE authenticated;
 r=public.billing_rpc('summary','dashboard',scope||jsonb_build_object('contractId',pending,'from','2026-10-01','to','2026-10-31'));
 IF r->'totals'->>'billingPending'<>'true' OR r->'totals'->>'netAmount'<>'' OR r->'operationalTotals'->>'averageAtr'<>'' THEN
  RAISE EXCEPTION 'Missing ATR fabricated zero or financial value';
 END IF;
 PERFORM public.billing_rpc('contracts','save-load',jsonb_build_object('companyId',company,'contractId',pending,'farmId',farm,'plotId','','loadedAt','2026-11-01','volume','1','atr','100','document','NO-QUOTE','notes',''));
 r=public.billing_rpc('summary','dashboard',scope||jsonb_build_object('contractId',pending,'from','2026-11-01','to','2026-11-30'));
 IF r->'totals'->>'billingPending'<>'true' OR r->'totals'->>'netAmount'<>'' OR r->'operationalTotals'->>'averageAtr'<>'100' THEN
  RAISE EXCEPTION 'Missing quotation must keep financials pending while preserving measured ATR';
 END IF;
 BEGIN PERFORM public.billing_rpc('summary','dashboard',scope||jsonb_build_object('contractId',foreign_contract));RAISE EXCEPTION 'Cross-company contract accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('summary','dashboard',scope||'{"contractId":"not-a-uuid"}');RAISE EXCEPTION 'Invalid contract accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('summary','dashboard',scope||'{"status":"invented"}');RAISE EXCEPTION 'Invalid status accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('summary','dashboard',scope||'{"ownerId":"a1050000-0000-4000-8000-000000000002"}');RAISE EXCEPTION 'Owner injection accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 -- A read-only member must still require both business read permissions.
 RESET ROLE;
 SELECT id INTO profile FROM public.billing_access_profiles WHERE owner_id='a1050000-0000-4000-8000-000000000001' AND name='Somente leitura';
 INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,is_owner,status)
 VALUES('a1050000-0000-4000-8000-000000000001','a1050000-0000-4000-8000-000000000003',profile,false,'active');
 SET LOCAL ROLE authenticated;
 PERFORM set_config('request.jwt.claim.sub','a1050000-0000-4000-8000-000000000003',true);
 PERFORM public.billing_rpc('summary','dashboard',scope||jsonb_build_object('contractId',a));
 RESET ROLE;
 UPDATE public.billing_access_profiles SET permissions=ARRAY['contracts.read','companies.read'] WHERE id=profile;
 SET LOCAL ROLE authenticated;
 BEGIN PERFORM public.billing_rpc('summary','dashboard',scope);RAISE EXCEPTION 'Missing registrations.read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 RESET ROLE;
 UPDATE public.billing_access_profiles SET permissions=ARRAY['registrations.read','companies.read'] WHERE id=profile;
 SET LOCAL ROLE authenticated;
 BEGIN PERFORM public.billing_rpc('summary','dashboard',scope);RAISE EXCEPTION 'Missing contracts.read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $test$;
SELECT set_config('request.jwt.claim.sub','a1050000-0000-4000-8000-000000000002',true);
DO $test$ BEGIN
 PERFORM public.billing_rpc('settings','get');
 BEGIN PERFORM public.billing_rpc('summary','dashboard',jsonb_build_object('companyId',current_setting('summary.selection.company'),'contractId',current_setting('summary.selection.contract'),'from','2026-09-01','to','2026-09-30'));
 RAISE EXCEPTION 'Other owner read selected company';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 IF EXISTS(SELECT 1 FROM public.billing_contract_loads) THEN RAISE EXCEPTION 'Load RLS leaked fixtures'; END IF;
END $test$;
SELECT set_config('request.jwt.claim.sub','',true);
DO $test$ BEGIN
 BEGIN PERFORM public.billing_rpc('summary','dashboard','{}');RAISE EXCEPTION 'Anonymous summary accepted';EXCEPTION WHEN invalid_authorization_specification THEN NULL;END;
END $test$;
RESET ROLE;
SELECT current_setting('summary.selection.preview',true) AS preview_data;
ROLLBACK;
