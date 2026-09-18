BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('61616161-6161-4161-8161-616161616161','summary-dashboard@example.invalid',now()),
 ('62626262-6262-4262-8262-626262626262','summary-dashboard-other@example.invalid',now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','61616161-6161-4161-8161-616161616161',true);
DO $$
DECLARE
 company uuid;client uuid;kind uuid;farm uuid;plot uuid;contract uuid;culture uuid;subtype uuid;practice uuid;period uuid;
 r jsonb;totals jsonb;details jsonb:='{"tradeName":"","cnpj":"","street":"","number":"","complement":"","district":"","city":"","state":"","zipCode":"","phone":"","email":""}';
BEGIN
 PERFORM public.billing_rpc('settings','get');
 company=(public.billing_rpc('companies','save',details||'{"legalName":"Empresa painel","isPrimary":true}')->'company'->>'id')::uuid;
 client=(public.billing_rpc('clients','save',details||'{"legalName":"Cliente painel","cnpj":"33444555000161","status":"Ativo"}')->'client'->>'id')::uuid;
 PERFORM public.billing_rpc('contract-types','save','{"name":"Tipo painel","stages":[]}');
 kind=(public.billing_rpc('contract-types','list')->'types'->0->>'id')::uuid;
 farm=(public.billing_rpc('farms','save','{"name":"Fazenda painel","areaHa":"50","city":"Cidade","state":"SP"}')->'farm'->>'id')::uuid;
 plot=(public.billing_rpc('plots','save',jsonb_build_object('farmId',farm,'name','Talhão painel','areaHa','25'))->'data'->'plots'->0->>'id')::uuid;
 culture=(public.billing_rpc('cultures','save','{"kind":"culture","name":"Cultura painel"}')->>'id')::uuid;
 subtype=(public.billing_rpc('cultures','save',jsonb_build_object('kind','subtype','cultureId',culture,'name','Ciclo painel'))->>'id')::uuid;
 practice=(public.billing_rpc('cultural-practices','save',jsonb_build_object('cultureId',culture,'cultureSubtypeId',subtype,
  'category','soil-preparation','name','Adubação de plantio','description',''))->'practice'->>'id')::uuid;
 period=(public.billing_rpc('planning','save-period',jsonb_build_object('name','Safra painel','startDate','2026-01-01','endDate','2026-12-31',
  'targetAreaHa','20','cultureId',culture,'cultureSubtypeId',subtype,'notes','','status','active'))->'period'->>'id')::uuid;
 PERFORM public.billing_rpc('planning','save-allocation',jsonb_build_object('periodId',period,'plotId',plot,'areaHa','20','notes',''));
 PERFORM public.billing_rpc('planning','save-field-log',jsonb_build_object('periodId',period,'plotId',plot,'kind','planting','practiceId','',
  'occurredOn','2026-02-05','areaHa','5','notes','','requestId','63616161-6161-4161-8161-616161616161','details',jsonb_build_object('materials','[]'::jsonb)));
 PERFORM public.billing_rpc('planning','save-field-log',jsonb_build_object('periodId',period,'plotId',plot,'kind','management','practiceId',practice,
  'occurredOn','2026-02-06','areaHa','4','notes','','requestId','64616161-6161-4161-8161-616161616161','details',jsonb_build_object('materials','[]'::jsonb)));
 PERFORM public.billing_rpc('planning','save-harvest-goal',jsonb_build_object('periodId',period,'targetTons','100',
  'targets',jsonb_build_array(jsonb_build_object('plotId',plot,'targetTons','100')),'expectedRevision',1,'reason','Meta do painel'));
 PERFORM public.billing_rpc('atr','save','{"year":2026,"month":1,"monthlyGrossValue":"2","monthlyNetValue":"2","accumulatedGrossValue":"2","accumulatedNetValue":"2"}');
 contract=(public.billing_rpc('contracts','save',jsonb_build_object('title','Contrato painel','contractNumber','PAINEL-1','companyId',company,
  'clientId',client,'typeId',kind,'status','Ativo','startDate','2026-01-01','endDate','2026-12-31','contractedVolume','100',
  'value','','notes','','atrPriceType','gross','atrPeriodType','monthly'))->'contract'->>'id')::uuid;
 PERFORM public.billing_rpc('contracts','save-load',jsonb_build_object('companyId',company,'contractId',contract,'farmId',farm,'plotId',plot,
  'loadedAt','2026-02-10','volume','10','atr','100','document','DASH-1','notes',''));
 PERFORM public.billing_rpc('contracts','save-payment',jsonb_build_object('companyId',company,'contractId',contract,'requestId',gen_random_uuid(),
  'kind','receipt','receivedAt','2026-02-15','referenceMonth','2026-02','amount','500','document','','notes',''));

 r=public.billing_rpc('summary','dashboard',jsonb_build_object('companyId',company,'from','2026-02-01','to','2026-02-28'));totals=r->'totals';
 IF r->'range'->>'dayCount'<>'28' OR r->'range'->>'from'<>'2026-02-01' OR r->'range'->>'to'<>'2026-02-28' THEN
  RAISE EXCEPTION 'Inclusive dashboard range wrong: %',r->'range';
 END IF;
 IF totals->>'contractCount'<>'1' OR totals->>'activeContractCount'<>'1' OR totals->>'loadCount'<>'1'
    OR totals->>'loadedVolume'<>'10' OR totals->>'grossAmount'<>'2000' OR totals->>'discountAmount'<>'0'
    OR totals->>'netAmount'<>'2000' OR totals->>'receivedAmount'<>'500' OR totals->>'pendingAmount'<>'1500'
    OR totals->>'farmCount'<>'1' OR totals->>'plotCount'<>'1' THEN
  RAISE EXCEPTION 'Executive totals wrong: %',totals;
 END IF;
 IF jsonb_array_length(r->'months')<>1 OR r->'months'->0->>'month'<>'2026-02'
    OR r->'months'->0->>'netAmount'<>'2000' OR jsonb_array_length(r->'contracts')<>1
    OR r->'farms'->0->>'loadedVolume'<>'10' THEN RAISE EXCEPTION 'Dashboard groups wrong: %',r; END IF;
 IF r->'planning'->>'periodName'<>'Safra painel' OR r->'planning'->>'targetAreaHa'<>'20'
    OR r->'planning'->>'plantedAreaHa'<>'5' OR r->'planning'->>'managedAreaHa'<>'4'
    OR r->'planning'->>'harvestedTons'<>'10' OR r->'planning'->>'plantingPercent'<>'25'
    OR r->'management'->0->>'areaHa'<>'4' THEN RAISE EXCEPTION 'Workspace planning projection wrong: %',r->'planning'; END IF;
 IF r->'operationalTotals'->>'averageAtr'<>'100' OR r->'operationalTotals'->>'averageLoadVolume'<>'10'
    OR r->'monthlyOperations'->0->>'loadCount'<>'1' OR r->'monthlyOperations'->0->>'averageAtr'<>'100'
    OR r->'farmPerformance'->0->>'tonsPerHa'<>'0.2' OR r->'plotPerformance'->0->>'tonsPerHa'<>'0.4'
    OR r->'contractPerformance'->0->>'deliveryPercent'<>'10' OR r->'contractPerformance'->0->>'remainingVolume'<>'90' THEN
  RAISE EXCEPTION 'Operational intelligence projection wrong: %',r;
 END IF;
 IF r->'planningPerformance'->>'periodName'<>'Safra painel'
    OR r->'planningPerformance'->'farms'->0->>'targetTons'<>'100'
    OR r->'planningPerformance'->'farms'->0->>'harvestedTons'<>'10'
    OR r->'planningPerformance'->'farms'->0->>'harvestPercent'<>'10'
    OR r->'planningPerformance'->'plots'->0->>'plantingPercent'<>'25' THEN
  RAISE EXCEPTION 'Planning performance projection wrong: %',r->'planningPerformance';
 END IF;
 IF jsonb_typeof(totals->'netAmount')<>'string' OR jsonb_typeof(r->'planning'->'plantingPercent')<>'string' THEN
  RAISE EXCEPTION 'Dashboard decimals must remain text';
 END IF;
 IF public.billing_rpc('summary','list',jsonb_build_object('companyId',company,'month','2026-02'))->'totals'->>'netAmount'<>'2000' THEN
  RAISE EXCEPTION 'Legacy monthly summary changed';
 END IF;
 IF public.billing_rpc('summary','dashboard',jsonb_build_object('companyId',company))->'range'->>'dayCount'<>'365' THEN
  RAISE EXCEPTION 'Server default is not an inclusive 365-day range';
 END IF;
 BEGIN
  PERFORM public.billing_rpc('summary','dashboard',jsonb_build_object('companyId',company,'from','2020-01-01','to','2026-01-01'));
  RAISE EXCEPTION 'Oversized dashboard range accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','62626262-6262-4262-8262-626262626262',true);
DO $$ BEGIN
 PERFORM public.billing_rpc('settings','get');
 BEGIN
  PERFORM public.billing_rpc('summary','dashboard','{"companyId":"00000000-0000-4000-8000-000000000000","from":"2026-02-01","to":"2026-02-28"}');
  RAISE EXCEPTION 'Foreign dashboard company accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
ROLLBACK;
