BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('91919191-9191-4191-8191-919191919191','season-owner@example.invalid',now()),
 ('92929292-9292-4292-8292-929292929292','season-other@example.invalid',now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','91919191-9191-4191-8191-919191919191',true);
DO $$
DECLARE
 r jsonb;farm uuid;plot uuid;culture uuid;subtype uuid;practice uuid;period uuid;allocation uuid;log_id uuid;
 company uuid;client uuid;contract_type uuid;contract uuid;
 request_id uuid:='93939393-9393-4393-8393-939393939393';
BEGIN
 PERFORM public.billing_rpc('settings','get');
 farm=(public.billing_rpc('farms','save','{"name":"Fazenda ciclo","areaHa":"100","city":"Cidade","state":"SP"}')->'farm'->>'id')::uuid;
 r=public.billing_rpc('plots','save',jsonb_build_object('farmId',farm,'name','Talhão ciclo','areaHa','100'));
 plot=(r->'data'->'plots'->0->>'id')::uuid;
 PERFORM public.billing_rpc('planning','set-planted',jsonb_build_object('plotId',plot,'plantedAreaHa','20','reason','Base de vinte hectares'));
 culture=(public.billing_rpc('cultures','save','{"kind":"culture","name":"Cultura ciclo"}')->>'id')::uuid;
 subtype=(public.billing_rpc('cultures','save',jsonb_build_object('kind','subtype','cultureId',culture,'name','Ciclo anual'))->>'id')::uuid;
 practice=(public.billing_rpc('cultural-practices','save',jsonb_build_object('cultureId',culture,'cultureSubtypeId',subtype,
  'category','soil-preparation','name','Adubação de plantio','description',''))->'practice'->>'id')::uuid;
 r=public.billing_rpc('planning','save-period',jsonb_build_object('name','Safra 2026/2027','startDate','2026-05-01','endDate','2027-04-30',
  'targetAreaHa','20','cultureId',culture,'cultureSubtypeId',subtype,'notes','','status','active'));
 period=(r->'period'->>'id')::uuid;
 r=public.billing_rpc('planning','save-allocation',jsonb_build_object('periodId',period,'plotId',plot,'areaHa','20','notes',''));
 allocation=(r->'allocation'->>'id')::uuid;

 company=(public.billing_rpc('companies','save','{"legalName":"Empresa safra","tradeName":"","cnpj":"","street":"","number":"","complement":"","district":"","city":"","state":"","zipCode":"","phone":"","email":"","isPrimary":true}')->'company'->>'id')::uuid;
 client=(public.billing_rpc('clients','save','{"legalName":"Cliente safra","tradeName":"","cnpj":"11222333000181","street":"","number":"","complement":"","district":"","city":"","state":"","zipCode":"","phone":"","email":""}')->'client'->>'id')::uuid;
 PERFORM public.billing_rpc('contract-types','save','{"name":"Contrato safra","stages":[]}');
 contract_type=(public.billing_rpc('contract-types','list','{}')->'types'->0->>'id')::uuid;
 PERFORM public.billing_rpc('atr','save','{"year":2026,"month":8,"monthlyGrossValue":"1","monthlyNetValue":"1","accumulatedGrossValue":"1","accumulatedNetValue":"1"}');
 contract=(public.billing_rpc('contracts','save',jsonb_build_object('title','Contrato da colheita','contractNumber','SAFRA-TESTE','companyId',company,'clientId',client,
  'typeId',contract_type,'status','Ativo','startDate','2026-05-01','endDate','2027-04-30','contractedVolume','100','value','','notes','','atrPriceType','gross','atrPeriodType','monthly'))->'contract'->>'id')::uuid;
 PERFORM public.billing_rpc('contracts','save-load',jsonb_build_object('companyId',company,'contractId',contract,'farmId',farm,'plotId',plot,
  'loadedAt','2026-09-10','volume','12','atr','1','document','AUTO-01','notes','Carga antes da meta de colheita'));
 r=public.billing_rpc('planning','list',jsonb_build_object('periodId',period));
 IF r->'periods'->0->>'harvestActualTons'<>'12' OR r->'periods'->0->>'harvestScopeCount'<>'1'
    OR jsonb_array_length(r->'harvestLoads')<>1 OR jsonb_array_length(r->'harvestPlotIds')<>1
    OR jsonb_array_length(r->'harvestComparison')<>1
    OR r->'harvestComparison'->0->>'targetAreaHa'<>'20'
    OR r->'harvestComparison'->0->>'plantedAreaHa'<>'0'
    OR r->'harvestComparison'->0->>'harvestedTons'<>'12'
    OR r->'harvestComparison'->0->>'harvestLoadCount'<>'1'
    OR jsonb_array_length(r->'harvestComparison'->0->'plots')<>1 THEN
  RAISE EXCEPTION 'Allocated plot did not enter the harvest scope automatically: %',r;
 END IF;

 r=public.billing_rpc('planning','save-field-log',jsonb_build_object('periodId',period,'plotId',plot,'kind','planting',
  'practiceId','','occurredOn','2026-05-10','areaHa','5','notes','Primeira frente','requestId',request_id));
 log_id=(r->'fieldLog'->>'id')::uuid;
 IF r->'fieldLog'->>'areaHa'<>'5' OR (SELECT planted_area_ha FROM public.billing_farm_plots WHERE id=plot)<>25
    OR (SELECT executed_area_ha FROM public.billing_planning_allocations WHERE id=allocation)<>5 THEN
  RAISE EXCEPTION 'Planting log did not move current/executed area: %',r;
 END IF;
 r=public.billing_rpc('planning','save-field-log',jsonb_build_object('periodId',period,'plotId',plot,'kind','planting',
  'practiceId','','occurredOn','2026-05-10','areaHa','5','notes','Primeira frente','requestId',request_id));
 IF r->'fieldLog'->>'id'<>log_id::text OR (SELECT count(*) FROM public.billing_planning_field_logs WHERE owner_id=auth.uid())<>1 THEN
  RAISE EXCEPTION 'Daily request retry was not idempotent';
 END IF;
 BEGIN
  PERFORM public.billing_rpc('planning','save-field-log',jsonb_build_object('periodId',period,'plotId',plot,'kind','planting',
   'practiceId','','occurredOn','2026-05-10','areaHa','6','notes','Primeira frente','requestId',request_id));
  RAISE EXCEPTION 'Daily request id reused with another payload';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 r=public.billing_rpc('planning','save-field-log',jsonb_build_object('periodId',period,'plotId',plot,'kind','management',
  'practiceId',practice,'occurredOn','2026-05-11','areaHa','10','notes','Adubação executada','requestId','94949494-9494-4494-8494-949494949494',
  'details',jsonb_build_object('operatorName','Ernande','responsibleName','Encarregado','shift','Dia','startedAt','07:00','endedAt','15:30',
   'applicationNumber','1749','serviceOrderNumber','157','applicationServiceOrderNumber','1711','laborDescription','Equipe própria',
   'equipmentCode','318073','equipmentDescription','BH 185i','implementCode','508506','implementDescription','',
   'hourMeterStart','8353,2','hourMeterEnd','8358,7','areaScope','partial','materials',jsonb_build_array(
    jsonb_build_object('code','35257','description','Adubo 14-00-18','quantity','2600','unit','kg','recommendedDose','500 kg/ha')))));
 IF r->'fieldLog'->'details'->>'operatorName'<>'Ernande' OR r->'fieldLog'->'details'->>'hourMeterStart'<>'8353.2'
    OR r->'fieldLog'->'details'->'materials'->0->>'quantity'<>'2600' THEN
  RAISE EXCEPTION 'Field bulletin details were not normalized and returned: %',r;
 END IF;
 BEGIN
  PERFORM public.billing_rpc('planning','save-field-log',jsonb_build_object('periodId',period,'plotId',plot,'kind','management',
   'practiceId',practice,'occurredOn','2026-05-11','areaHa','1','notes','Horímetro inválido','requestId',gen_random_uuid(),
   'details',jsonb_build_object('hourMeterStart','900','hourMeterEnd','800','materials','[]'::jsonb)));
  RAISE EXCEPTION 'Decreasing hour meter was accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 r=public.billing_rpc('planning','save-field-log',jsonb_build_object('periodId',period,'plotId',plot,'kind','loss',
  'practiceId','','occurredOn','2026-05-12','areaHa','3','notes','Falha de brotação','requestId','95959595-9595-4595-8595-959595959595'));
 IF (SELECT planted_area_ha FROM public.billing_farm_plots WHERE id=plot)<>22 THEN RAISE EXCEPTION 'Loss did not reduce current planted area'; END IF;
 BEGIN
  PERFORM public.billing_rpc('planning','save-harvest-goal',jsonb_build_object('periodId',period,'targetTons','100',
   'targets',jsonb_build_array(jsonb_build_object('plotId',plot,'targetTons','90')),'expectedRevision',1,'reason','Distribuição incompleta'));
  RAISE EXCEPTION 'Harvest target distribution below the general goal was accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM public.billing_rpc('planning','save-harvest-goal',jsonb_build_object('periodId',period,'targetTons','100',
  'targets',jsonb_build_array(jsonb_build_object('plotId',plot,'targetTons','100')),'expectedRevision',1,'reason','Meta inicial de colheita'));
 r=public.billing_rpc('planning','list',jsonb_build_object('periodId',period));
 IF r->'periods'->0->>'plantedExecutedAreaHa'<>'5' OR r->'periods'->0->>'plantingRemainingAreaHa'<>'15'
    OR r->'periods'->0->>'lostAreaHa'<>'3' OR r->'periods'->0->>'harvestTargetTons'<>'100'
    OR r->'periods'->0->>'harvestActualTons'<>'12' OR jsonb_array_length(r->'dailySummary')<>4 OR jsonb_array_length(r->'monthlySummary')<>2
    OR r->'farms'->0->>'plantedAreaHa'<>'22' OR r->'farms'->0->'plots'->0->>'harvestSelected'<>'true'
    OR r->'harvestComparison'->0->>'targetAreaHa'<>'20'
    OR r->'harvestComparison'->0->>'plantedAreaHa'<>'5'
    OR r->'harvestComparison'->0->>'remainingAreaHa'<>'15'
    OR r->'harvestComparison'->0->>'plantingPercent'<>'25'
    OR r->'harvestComparison'->0->>'targetTons'<>'100'
    OR r->'harvestComparison'->0->>'harvestedTons'<>'12'
    OR r->'harvestComparison'->0->>'remainingTons'<>'88'
    OR r->'harvestComparison'->0->>'harvestPercent'<>'12'
    OR r->'harvestComparison'->0->'plots'->0->>'targetTons'<>'100'
    OR r->'harvestComparison'->0->'plots'->0->>'plantingPercent'<>'25' THEN
  RAISE EXCEPTION 'Season dashboard contract wrong: %',r;
 END IF;
 r=public.billing_rpc('planning','list',jsonb_build_object('search','Safra 2026','page',1,'pageSize',1,'section','seasons'));
 IF r->'pagination'->>'total'<>'1' OR jsonb_array_length(r->'visiblePeriodIds')<>1 OR r->'pagination'->>'hasNext'<>'false' THEN
  RAISE EXCEPTION 'Season search and pagination contract wrong: %',r;
 END IF;
 r=public.billing_rpc('planning','list',jsonb_build_object('search','safra inexistente','page',9,'pageSize',10,'section','seasons'));
 IF r->'pagination'->>'total'<>'0' OR r->'pagination'->>'page'<>'1' OR jsonb_array_length(r->'visiblePeriodIds')<>0 THEN
  RAISE EXCEPTION 'Empty season search did not normalize pagination: %',r;
 END IF;
 r=public.billing_rpc('planning','list',jsonb_build_object('periodId',period,'search','Talhão ciclo','page',1,'pageSize',10,'section','areas'));
 IF r->'pagination'->>'total'<>'1' OR jsonb_array_length(r->'visibleFarmIds')<>1 THEN
  RAISE EXCEPTION 'Area search and pagination contract wrong: %',r;
 END IF;
 r=public.billing_rpc('planning','list',jsonb_build_object('periodId',period,'search','Adubação executada','page',1,'pageSize',1,'section','diario'));
 IF r->'pagination'->>'total'<>'1' OR jsonb_array_length(r->'visibleFieldLogIds')<>1 OR jsonb_array_length(r->'visibleHarvestLoadIds')<>0 THEN
  RAISE EXCEPTION 'Diary search and pagination contract wrong: %',r;
 END IF;
 r=public.billing_rpc('planning','list',jsonb_build_object('periodId',period,'search','','page',1,'pageSize',10,'section','diario',
  'dateFrom','2026-05-11','dateTo','2026-05-12'));
 IF jsonb_array_length(r->'fieldLogs')<>2 OR jsonb_array_length(r->'harvestLoads')<>0
    OR r->'pagination'->>'total'<>'2' OR jsonb_array_length(r->'dailySummary')<>2
    OR r->'diaryPeriodSummary'->>'dateFrom'<>'2026-05-11' OR r->'diaryPeriodSummary'->>'dateTo'<>'2026-05-12'
    OR r->'diaryPeriodSummary'->>'managedAreaHa'<>'10' OR r->'diaryPeriodSummary'->>'lostAreaHa'<>'3'
    OR r->'diaryPeriodSummary'->>'harvestedTons'<>'0' OR r->'diaryPeriodSummary'->>'fieldLogCount'<>'2'
    OR r->'dailySummary'->0->>'accumulatedManagedAreaHa'<>'10'
    OR r->'dailySummary'->0->>'accumulatedLostAreaHa'<>'3' THEN
  RAISE EXCEPTION 'Diary date filter, period totals or accumulated values are wrong: %',r;
 END IF;
 BEGIN
  PERFORM public.billing_rpc('planning','list',jsonb_build_object('periodId',period,'search','','page',1,'pageSize',10,'section','diario',
   'dateFrom','2026-05-12','dateTo','2026-05-11'));
  RAISE EXCEPTION 'Reversed diary date range was accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 r=public.billing_rpc('planning','list',jsonb_build_object('periodId',period,'search','Manejo realizado','page',1,'pageSize',10,'section','historico'));
 IF (r->'pagination'->>'total')::integer<1 OR jsonb_array_length(r->'visibleHistoryIds')<1 THEN
  RAISE EXCEPTION 'History search and pagination contract wrong: %',r;
 END IF;
 PERFORM public.billing_rpc('planning','void-field-log',jsonb_build_object('id',(SELECT id FROM public.billing_planning_field_logs WHERE owner_id=auth.uid() AND kind='loss'),'reason','Perda informada incorretamente'));
 IF (SELECT planted_area_ha FROM public.billing_farm_plots WHERE id=plot)<>25 THEN RAISE EXCEPTION 'Voiding loss did not restore planted area'; END IF;
 PERFORM public.billing_rpc('planning','void-field-log',jsonb_build_object('id',log_id,'reason','Plantio lançado na data errada'));
 IF (SELECT planted_area_ha FROM public.billing_farm_plots WHERE id=plot)<>20
    OR (SELECT executed_area_ha FROM public.billing_planning_allocations WHERE id=allocation)<>0 THEN
  RAISE EXCEPTION 'Voiding planting did not restore current and plan balances';
 END IF;
 r=public.billing_rpc('planning','list',jsonb_build_object('periodId',period,'search','','page',1,'pageSize',10,'section','diario'));
 IF jsonb_array_length(r->'dailySummary')<>2
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->'dailySummary') row WHERE row->>'date' IN('2026-05-10','2026-05-12'))
    OR r->'diaryPeriodSummary'->>'plantedAreaHa'<>'0' OR r->'diaryPeriodSummary'->>'lostAreaHa'<>'0'
    OR r->'diaryPeriodSummary'->>'managedAreaHa'<>'10' OR r->'diaryPeriodSummary'->>'harvestedTons'<>'12' THEN
  RAISE EXCEPTION 'Voided-only dates affected the operational summary: %',r;
 END IF;
 BEGIN
  PERFORM public.billing_rpc('planning','save-field-log',jsonb_build_object('periodId',period,'plotId',plot,'kind','loss',
   'practiceId','','occurredOn','2027-05-01','areaHa','1','notes','','requestId','96969696-9696-4696-8696-969696969696'));
  RAISE EXCEPTION 'Out-of-season daily log accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN INSERT INTO public.billing_planning_field_logs(owner_id,period_id,farm_id,plot_id,request_id,occurred_on,kind,area_ha,created_by)
  VALUES(auth.uid(),period,farm,plot,gen_random_uuid(),'2026-05-01','loss',1,auth.uid());
  RAISE EXCEPTION 'Direct field-log DML accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN INSERT INTO public.billing_planning_harvest_targets(owner_id,period_id,farm_id,plot_id,target_tons,created_by)
  VALUES(auth.uid(),period,farm,plot,100,auth.uid());
  RAISE EXCEPTION 'Direct harvest-target DML accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claim.sub','92929292-9292-4292-8292-929292929292',true);
DO $$ BEGIN
 PERFORM public.billing_rpc('settings','get');
 IF jsonb_array_length(public.billing_rpc('planning','list','{}')->'periods')<>0
    OR jsonb_array_length(public.billing_rpc('planning','list','{}')->'harvestComparison')<>0 THEN
  RAISE EXCEPTION 'Cross-owner season comparison visible';
 END IF;
END $$;
ROLLBACK;
