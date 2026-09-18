BEGIN;
RESET ROLE;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('79000000-0000-4000-8000-000000000001','home-owner@example.invalid',now()),
 ('79000000-0000-4000-8000-000000000002','home-other@example.invalid',now()),
 ('79000000-0000-4000-8000-000000000003','home-requests@example.invalid',now()),
 ('79000000-0000-4000-8000-000000000004','home-contracts@example.invalid',now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','79000000-0000-4000-8000-000000000001',true);
DO $$
DECLARE company uuid;other_company uuid;client uuid;kind uuid;farm uuid;plot uuid;contract uuid;culture uuid;subtype uuid;period uuid;
 r jsonb;person jsonb;request jsonb;signature jsonb;v_today date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date;
 v_month date:=date_trunc('month',v_today)::date;quote_month date:=(date_trunc('month',v_today)-interval '1 month')::date;
 details jsonb:='{"tradeName":"","cnpj":"","street":"","number":"","complement":"","district":"","city":"","state":"","zipCode":"","phone":"","email":""}';
BEGIN
 r=public.billing_rpc('home','get');
 IF r->'finance'<>'null'::jsonb OR r->'requests'->>'pendingCount'<>'0' OR r->'registrations'->>'farmCount'<>'0' THEN RAISE EXCEPTION 'Empty workspace: %',r; END IF;
 company=(public.billing_rpc('companies','save',details||'{"legalName":"Empresa início","isPrimary":true}')->'company'->>'id')::uuid;
 other_company=(public.billing_rpc('companies','save',details||'{"legalName":"Outra empresa","isPrimary":false}')->'company'->>'id')::uuid;
 PERFORM set_config('test.home.company',company::text,true);
 client=(public.billing_rpc('clients','save',details||'{"legalName":"Cliente início","cnpj":"33444555000161","status":"Ativo"}')->'client'->>'id')::uuid;
 PERFORM public.billing_rpc('contract-types','save','{"name":"Tipo início","stages":[]}');
 kind=(public.billing_rpc('contract-types','list')->'types'->0->>'id')::uuid;
 farm=(public.billing_rpc('farms','save','{"name":"Fazenda início","areaHa":"50","city":"Cidade","state":"SP"}')->'farm'->>'id')::uuid;
 plot=(public.billing_rpc('plots','save',jsonb_build_object('farmId',farm,'name','Talhão início','areaHa','25'))->'data'->'plots'->0->>'id')::uuid;
 contract=(public.billing_rpc('contracts','save',jsonb_build_object('title','Contrato início','contractNumber','INICIO-1','companyId',company,
  'clientId',client,'typeId',kind,'status','Ativo','startDate',v_today-30,'endDate',v_today-1,'contractedVolume','100',
  'value','','notes','','atrPriceType','gross','atrPeriodType','monthly'))->'contract'->>'id')::uuid;
 PERFORM public.billing_rpc('contracts','save-load',jsonb_build_object('companyId',company,'contractId',contract,'farmId',farm,'plotId',plot,
  'loadedAt',v_today,'volume','10.125','atr','100','document','HOME','notes',''));
 PERFORM public.billing_rpc('contracts','save-payment',jsonb_build_object('companyId',company,'contractId',contract,'requestId',gen_random_uuid(),
  'kind','receipt','receivedAt',v_today,'referenceMonth',to_char(quote_month,'YYYY-MM'),'amount','500.25','document','','notes',''));
 r=public.billing_rpc('home','get',jsonb_build_object('companyId',company));
 IF r->'finance'->>'netAmount'<>'' OR r->'finance'->>'pendingLoadCount'<>'1' OR r->'finance'->>'loadedVolume'<>'10.125'
  OR r->'finance'->>'receivedAmount'<>'500.25' OR r->'contracts'->>'overdueCount'<>'1' OR r->'agenda'->>'todayCount'<>'3'
 THEN RAISE EXCEPTION 'Pending finance, cash dates or deadlines: %',r; END IF;
 PERFORM public.billing_rpc('atr','save',jsonb_build_object('year',extract(year FROM quote_month),'month',extract(month FROM quote_month),
  'monthlyGrossValue','2','monthlyNetValue','2','accumulatedGrossValue','2','accumulatedNetValue','2'));
 r=public.billing_rpc('home','get',jsonb_build_object('companyId',company));
 IF r->'finance'->>'netAmount'<>'2025' OR r->'finance'->>'pendingLoadCount'<>'0' OR r->'finance'->>'loadCount'<>'1' THEN RAISE EXCEPTION 'Known finance: %',r; END IF;
 IF r->'finance'->>'netAmount' IS DISTINCT FROM public.billing_rpc('summary','dashboard',jsonb_build_object('companyId',company,'from',v_month,'to',(v_month+interval '1 month')::date-1))->'totals'->>'netAmount'
 THEN RAISE EXCEPTION 'Summary finance differs'; END IF;
 r=public.billing_rpc('home','get',jsonb_build_object('companyId',other_company));
 IF r->'finance'->>'contractCount'<>'0' OR r->'finance'->>'receivedAmount'<>'0' OR r->'agenda'->>'total'<>'0'
 THEN RAISE EXCEPTION 'Company isolation: %',r; END IF;

 culture=(public.billing_rpc('cultures','save','{"kind":"culture","name":"Cultura início"}')->>'id')::uuid;
 subtype=(public.billing_rpc('cultures','save',jsonb_build_object('kind','subtype','cultureId',culture,'name','Ciclo início'))->>'id')::uuid;
 period=(public.billing_rpc('planning','save-period',jsonb_build_object('name','Safra atual','startDate',v_today-10,'endDate',v_today+30,
  'targetAreaHa','20','cultureId',culture,'cultureSubtypeId',subtype,'notes','','status','active'))->'period'->>'id')::uuid;
 PERFORM public.billing_rpc('planning','save-allocation',jsonb_build_object('periodId',period,'plotId',plot,'areaHa','20','notes',''));
 PERFORM public.billing_rpc('planning','save-field-log',jsonb_build_object('periodId',period,'plotId',plot,'kind','planting','practiceId','',
  'occurredOn',v_today,'areaHa','5','notes','','requestId',gen_random_uuid(),'details',jsonb_build_object('materials','[]'::jsonb)));
 r=public.billing_rpc('home','get',jsonb_build_object('companyId',other_company,'month','2020-01'));
 IF r->'planning'->>'plantingPercent'<>'25' OR r->'planning'->>'name'<>'Safra atual' OR r->'planning'->>'asOf'<>v_today::text
  OR r->'registrations'->>'plotCount'<>'1' THEN RAISE EXCEPTION 'Planning must use today and workspace: %',r; END IF;

 person=public.billing_rpc('signatures','save','{"name":"Solicitante início","role":"requester"}')->'signature';
 signature=public.billing_rpc('signatures','prepare-upload','{"fileName":"diretor.png","contentType":"image/png","size":100}')->'file';
 INSERT INTO storage.objects(bucket_id,name) VALUES(signature->>'bucket',signature->>'path');
 PERFORM public.billing_rpc('signatures','save',jsonb_build_object('name','Diretor','role','manager','userId','79000000-0000-4000-8000-000000000001','fileId',signature->>'id'));
 request=public.billing_rpc('service-requests','create',jsonb_build_object('requestId',gen_random_uuid(),'requesterSignatureId',person->>'id',
  'requesterSigningMode','manual','companyName','Oficina início','items','[{"description":"Manutenção","application":"Trator"}]'::jsonb))->'request';
 PERFORM public.billing_rpc('service-requests','decide',jsonb_build_object('id',request->>'id','decision','approved'));
 PERFORM public.billing_rpc('service-requests','complement',jsonb_build_object('id',request->>'id','operationId',gen_random_uuid(),
  'expectedComplementId',null,'serviceValue','20','returnDate',v_today-1,'attachmentIds','[]'::jsonb));
 r=public.billing_rpc('home','get');
 IF r->'requests'->>'inProgressCount'<>'1' OR r->'requests'->>'overdueCount'<>'1' OR r->'requests'->'items'->0->>'returnDate'<>(v_today-1)::text
 THEN RAISE EXCEPTION 'Latest complement must drive overdue returns: %',r; END IF;
 PERFORM public.billing_rpc('service-requests','complete',jsonb_build_object('id',request->>'id'));
 IF public.billing_rpc('home','get')->'requests'->>'overdueCount'<>'0' THEN RAISE EXCEPTION 'Completed service remains overdue'; END IF;
 PERFORM public.billing_rpc('service-requests','create',jsonb_build_object('requestId',gen_random_uuid(),'requesterSignatureId',person->>'id',
  'requesterSigningMode','manual','companyName','Oficina pendente','items','[{"description":"Serviço","application":"Trator"}]'::jsonb));
 BEGIN PERFORM public.billing_rpc('home','get','{"ownerId":"79000000-0000-4000-8000-000000000002"}'); RAISE EXCEPTION 'Owner spoof accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.billing_rpc('home','delete'); RAISE EXCEPTION 'Invalid action accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.billing_rpc('home','get','{"month":"2026-13"}'); RAISE EXCEPTION 'Invalid month accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
INSERT INTO public.billing_access_profiles(id,owner_id,name,permissions) VALUES
 ('79000000-0000-4000-8000-000000000005','79000000-0000-4000-8000-000000000001','Home requests',ARRAY['requests.read']),
 ('79000000-0000-4000-8000-000000000006','79000000-0000-4000-8000-000000000001','Home contracts',ARRAY['contracts.read']);
INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,is_owner,status) VALUES
 ('79000000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000003','79000000-0000-4000-8000-000000000005',false,'active'),
 ('79000000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000004','79000000-0000-4000-8000-000000000006',false,'active');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','79000000-0000-4000-8000-000000000003',true);
DO $$ DECLARE r jsonb;
BEGIN
 r=public.billing_rpc('home','get',jsonb_build_object('companyId',current_setting('test.home.company')));
 IF r->'requests'->>'pendingCount'<>'1' OR r->'finance'<>'null'::jsonb OR r->'agenda'<>'null'::jsonb OR r->'contracts'<>'null'::jsonb
  OR r->'registrations'<>'null'::jsonb OR r->'planning'<>'null'::jsonb OR r->'permissions'->>'createRequest'<>'false'
 THEN RAISE EXCEPTION 'Request-only permission leak: %',r; END IF;
 BEGIN UPDATE public.billing_contracts SET title='Unauthorized' WHERE owner_id='79000000-0000-4000-8000-000000000001'; RAISE EXCEPTION 'Direct DML allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','79000000-0000-4000-8000-000000000004',true);
DO $$ DECLARE r jsonb;
BEGIN
 r=public.billing_rpc('home','get',jsonb_build_object('companyId',current_setting('test.home.company')));
 IF r->'finance'->>'netAmount'<>'2025' OR r->'requests'<>'null'::jsonb OR r->'registrations'<>'null'::jsonb OR r->'planning'<>'null'::jsonb
 THEN RAISE EXCEPTION 'Contracts-only permission leak: %',r; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','79000000-0000-4000-8000-000000000002',true);
DO $$ DECLARE r jsonb;
BEGIN
 r=public.billing_rpc('home','get');
 IF r->'requests'->>'pendingCount'<>'0' OR r->'registrations'->>'farmCount'<>'0' OR r->'planning'<>'null'::jsonb THEN RAISE EXCEPTION 'Workspace isolation leak: %',r; END IF;
 BEGIN PERFORM public.billing_rpc('home','get',jsonb_build_object('companyId',current_setting('test.home.company'))); RAISE EXCEPTION 'Foreign company accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ BEGIN
 BEGIN PERFORM public.billing_rpc('home','get'); RAISE EXCEPTION 'No session accepted'; EXCEPTION WHEN invalid_authorization_specification THEN NULL; END;
END $$;
ROLLBACK;
