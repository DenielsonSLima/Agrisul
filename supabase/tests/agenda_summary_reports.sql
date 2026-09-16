BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('71717171-7171-4171-8171-717171717171','agenda-a@example.invalid',now()),
 ('72727272-7272-4272-8272-727272727272','agenda-b@example.invalid',now()),
 ('73737373-7373-4373-8373-737373737373','agenda-reader@example.invalid',now());
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.billing_planning_executions) THEN RAISE EXCEPTION 'Execution data not erased'; END IF;
 IF (SELECT prosecdef FROM pg_proc WHERE oid='public.billing_rpc(text,text,jsonb)'::regprocedure) THEN RAISE EXCEPTION 'Public wrapper must be invoker'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71717171-7171-4171-8171-717171717171',true);
DO $$
DECLARE
 company uuid;other_company uuid;client uuid;kind uuid;farm uuid;plot uuid;a uuid;b uuid;load_id uuid;
 input jsonb;scope jsonb;r jsonb;s jsonb;item jsonb;key text;profile uuid;payment uuid;
 details jsonb:='{"tradeName":"","cnpj":"","street":"","number":"","complement":"","district":"","city":"","state":"","zipCode":"","phone":"","email":""}';
BEGIN
 company=(public.billing_rpc('companies','save',details||'{"legalName":"Empresa agenda","isPrimary":true}')->'company'->>'id')::uuid;
 other_company=(public.billing_rpc('companies','save',details||'{"legalName":"Outra empresa agenda","isPrimary":false}')->'company'->>'id')::uuid;
 PERFORM set_config('agenda.company',company::text,true);
 client=(public.billing_rpc('clients','save',details||'{"legalName":"Cliente agenda","cnpj":"11222333000181","status":"Ativo"}')->'client'->>'id')::uuid;
 PERFORM public.billing_rpc('contract-types','save','{"name":"Tipo agenda","stages":[]}');
 kind=(public.billing_rpc('contract-types','list')->'types'->0->>'id')::uuid;
 farm=(public.billing_rpc('farms','save','{"name":"Fazenda agenda","areaHa":"10","city":"Cidade","state":"SP"}')->'farm'->>'id')::uuid;
 plot=(public.billing_rpc('plots','save',jsonb_build_object('farmId',farm,'name','Talhão agenda','areaHa','6'))->'data'->'plots'->0->>'id')::uuid;
 PERFORM public.billing_rpc('atr','save','{"year":2026,"month":8,"monthlyGrossValue":"1","monthlyNetValue":"1","accumulatedGrossValue":"1","accumulatedNetValue":"1"}');
 input=jsonb_build_object('title','Contrato agenda','contractNumber','AG-A','companyId',company,'clientId',client,'typeId',kind,'startDate','2026-09-01','endDate','2026-12-31','contractedVolume','1000','value','','notes','','atrPriceType','gross','atrPeriodType','monthly');
 a=(public.billing_rpc('contracts','save',input)->'contract'->>'id')::uuid;
 b=(public.billing_rpc('contracts','save',input||'{"contractNumber":"AG-B"}')->'contract'->>'id')::uuid;
 PERFORM public.billing_rpc('contracts','save',input||jsonb_build_object('companyId',other_company,'contractNumber','OTHER-COMPANY'));
 scope=jsonb_build_object('companyId',company);
 load_id=(public.billing_rpc('contracts','save-load',scope||jsonb_build_object('contractId',a,'farmId',farm,'plotId',plot,'loadedAt','2026-09-10','volume','10.125','atr','100','document','DOC 1','notes',''))->'load'->>'id')::uuid;
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('contractId',b,'farmId',farm,'plotId',plot,'loadedAt','2026-09-10','volume','30','atr','200','document','DOC 2','notes',''));
 PERFORM public.billing_rpc('contracts','save-discount',scope||jsonb_build_object('contractId',a,'requestId',gen_random_uuid(),'title','Acordo','ratePerTon','2','months',jsonb_build_array('2026-09'),'notes',''));
 -- Cash date differs from reference month: calendar and summary must respect both.
 payment=(public.billing_rpc('contracts','save-payment',scope||jsonb_build_object('contractId',a,'requestId',gen_random_uuid(),'kind','advance','receivedAt','2026-10-02','referenceMonth','2026-09','amount','200','document','','notes',''))->'payment'->>'id')::uuid;
 PERFORM public.billing_rpc('contracts','save-payment',scope||jsonb_build_object('contractId',b,'requestId',gen_random_uuid(),'kind','receipt','receivedAt','2026-09-10','referenceMonth','2026-09','amount','7000','document','','notes',''));
 r=public.billing_rpc('summary','list',scope||'{"month":"2026-09"}');s=r->'totals';
 IF s->>'contractCount'<>'2' OR s->>'loadedVolume'<>'40.125' OR s->>'grossAmount'<>'7012.5' OR s->>'discountAmount'<>'20.25' OR s->>'netAmount'<>'6992.25' OR s->>'receivedAmount'<>'7200' OR s->>'pendingAmount'<>'792.25' OR s->>'creditAmount'<>'1000' THEN RAISE EXCEPTION 'Monthly totals or credit isolation wrong: %',s; END IF;
 FOREACH key IN ARRAY ARRAY['loadedVolume','grossAmount','discountAmount','netAmount','receivedAmount','pendingAmount','creditAmount'] LOOP
  IF jsonb_typeof(s->key)<>'string' THEN RAISE EXCEPTION 'Numeric must be text: %',key; END IF;
 END LOOP;
 r=public.billing_rpc('reports','list',scope||'{"kind":"financial","month":"2026-09"}');
 IF r->'totals'<>s THEN RAISE EXCEPTION 'Report totals differ from summary'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(r->'rows') LOOP
  IF (SELECT m->>'netAmount' FROM jsonb_array_elements(public.billing_rpc('contracts','get',scope||jsonb_build_object('id',item->>'id'))->'contract'->'financialSummary'->'months') m WHERE m->>'month'='2026-09') IS DISTINCT FROM item->>'netAmount' THEN RAISE EXCEPTION 'Report differs from contract finance'; END IF;
 END LOOP;
 r=public.billing_rpc('agenda','list',scope||'{"month":"2026-09","kind":"load"}');
 IF jsonb_array_length(r->'days')<>30 OR r->'days'->0->>'date'<>'2026-09-01' OR r->'days'->0->>'gridColumn'<>'3' OR r->>'eventCount'<>'2' THEN RAISE EXCEPTION 'Calendar geometry/count wrong: %',r; END IF;
 SELECT d INTO item FROM jsonb_array_elements(r->'days') d WHERE d->>'date'='2026-09-10';
 IF item->>'eventCount'<>'2' OR item->'kinds'<>'["load"]'::jsonb OR jsonb_array_length(item->'events')<>2 THEN RAISE EXCEPTION 'Daily grouping wrong'; END IF;
 IF item->'summary'->0->>'volume'<>'40.125' OR item->'summary'->0->>'count'<>'2' THEN RAISE EXCEPTION 'Daily summary must be computed by database'; END IF;
 r=public.billing_rpc('agenda','list',scope||'{"month":"2026-09","kind":"advance"}');
 IF r->>'eventCount'<>'0' THEN RAISE EXCEPTION 'Calendar used reference month instead of receipt date'; END IF;
 r=public.billing_rpc('agenda','list',scope||'{"month":"2026-10","kind":"advance"}');
 IF r->>'eventCount'<>'1' THEN RAISE EXCEPTION 'Cash date missing'; END IF;
 r=public.billing_rpc('agenda','list',scope||'{"month":"2028-02"}');
 IF jsonb_array_length(r->'days')<>29 THEN RAISE EXCEPTION 'Leap month must contain only its 29 days'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'days') d WHERE d->>'date'='2028-02-29' AND (d->>'inMonth')::boolean) THEN RAISE EXCEPTION 'Leap day missing'; END IF;
 IF jsonb_array_length(public.billing_rpc('agenda','list',scope||'{"month":"2026-02"}')->'days')<>28 THEN RAISE EXCEPTION 'February must contain 28 days'; END IF;
 IF jsonb_array_length(public.billing_rpc('agenda','list',scope||'{"month":"2026-12"}')->'days')<>31 THEN RAISE EXCEPTION 'December must contain 31 days'; END IF;
 r=public.billing_rpc('reports','list',scope||'{"kind":"loads","month":"2026-09"}');
 IF r->>'total'<>'2' OR r->'totals'->>'volume'<>'40.125' THEN RAISE EXCEPTION 'Load report totals wrong'; END IF;
 r=public.billing_rpc('reports','list',scope||'{"kind":"farms","month":"2026-09"}');
 IF r->>'scope'<>'workspace' OR r->'totals'->>'preservedHa'<>'4' THEN RAISE EXCEPTION 'Farm scope/area wrong'; END IF;
 PERFORM public.billing_rpc('contracts','delete-load',scope||jsonb_build_object('contractId',a,'id',load_id));
 IF public.billing_rpc('agenda','list',scope||'{"month":"2026-09","kind":"load"}')->>'eventCount'<>'1' THEN RAISE EXCEPTION 'Deleted load remains in calendar'; END IF;
 IF public.billing_rpc('summary','list',scope||'{"month":"2026-09"}')->'totals'->>'loadedVolume'<>'30' THEN RAISE EXCEPTION 'Deleted load remains in summary'; END IF;
 -- Quotes missing in another month must remain unknown in both projections.
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('contractId',a,'farmId',farm,'plotId',plot,'loadedAt','2026-11-01','volume','1','atr','100','document','','notes',''));
 s=public.billing_rpc('summary','list',scope||'{"month":"2026-11"}')->'totals';
 IF s->>'billingPending'<>'true' OR s->>'grossAmount'<>'' THEN RAISE EXCEPTION 'Missing ATR became zero'; END IF;
 IF public.billing_rpc('reports','list',scope||'{"month":"2026-11","kind":"financial"}')->'totals'<>s THEN RAISE EXCEPTION 'Unknown totals report mismatch'; END IF;
 FOREACH key IN ARRAY ARRAY['agenda','summary','reports'] LOOP
  BEGIN PERFORM public.billing_rpc(key,'list',scope||'{"month":"2026-09","owner_id":"72727272-7272-4272-8272-727272727272"}');RAISE EXCEPTION 'Owner injection accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
  BEGIN PERFORM public.billing_rpc(key,'list',scope||'{"month":"2026-13"}');RAISE EXCEPTION 'Invalid month accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
  BEGIN PERFORM public.billing_rpc(key,'save',scope||'{"month":"2026-09"}');RAISE EXCEPTION 'Projection writes accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 END LOOP;
 FOREACH key IN ARRAY ARRAY['planning','planning-goals','planning-executions'] LOOP
  BEGIN PERFORM public.billing_rpc(key,'list','{}');RAISE EXCEPTION 'Removed module still accessible';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 END LOOP;
 BEGIN INSERT INTO public.billing_contract_loads(owner_id,contract_id) VALUES(auth.uid(),a);RAISE EXCEPTION 'Direct write allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 -- Existing read-only profile can read the new modules and cannot write sources.
 RESET ROLE;
 SELECT id INTO profile FROM public.billing_access_profiles WHERE owner_id='71717171-7171-4171-8171-717171717171' AND name='Somente leitura';
 INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,is_owner,status) VALUES('71717171-7171-4171-8171-717171717171','73737373-7373-4373-8373-737373737373',profile,false,'active');
 SET LOCAL ROLE authenticated;
 PERFORM set_config('request.jwt.claim.sub','73737373-7373-4373-8373-737373737373',true);
 PERFORM public.billing_rpc('agenda','list',scope||'{"month":"2026-09"}');
 PERFORM public.billing_rpc('summary','list',scope||'{"month":"2026-09"}');
 PERFORM public.billing_rpc('reports','list',scope||'{"month":"2026-09","kind":"farms"}');
 BEGIN PERFORM public.billing_rpc('contracts','save',input);RAISE EXCEPTION 'Read-only user wrote a contract';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 RESET ROLE;
 UPDATE public.billing_access_profiles SET permissions=ARRAY['companies.read'] WHERE id=profile;
 SET LOCAL ROLE authenticated;
 FOREACH key IN ARRAY ARRAY['agenda','summary','reports'] LOOP
  BEGIN PERFORM public.billing_rpc(key,'list',scope||'{"month":"2026-09","kind":"financial"}'-CASE WHEN key='reports' THEN 'absent' ELSE 'kind' END);RAISE EXCEPTION 'Unauthorized read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 END LOOP;
END $$;
SELECT set_config('request.jwt.claim.sub','72727272-7272-4272-8272-727272727272',true);
DO $$ DECLARE resource text;BEGIN
 PERFORM public.billing_rpc('settings','get');
 FOREACH resource IN ARRAY ARRAY['agenda','summary','reports'] LOOP
  BEGIN PERFORM public.billing_rpc(resource,'list',jsonb_build_object('companyId',current_setting('agenda.company'),'month','2026-09'));RAISE EXCEPTION 'Cross-owner read allowed';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 END LOOP;
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ BEGIN
 BEGIN PERFORM public.billing_rpc('agenda','list','{}');RAISE EXCEPTION 'Anonymous agenda allowed';EXCEPTION WHEN invalid_authorization_specification THEN NULL;END;
END $$;
ROLLBACK;
