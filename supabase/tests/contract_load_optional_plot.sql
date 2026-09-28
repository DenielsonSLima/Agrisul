BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('8b000000-0000-4000-8000-000000000001','optional-plot@example.invalid',now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','8b000000-0000-4000-8000-000000000001',true);

DO $$
DECLARE
 company uuid;client uuid;kind uuid;contract uuid;farm uuid;other_farm uuid;plot uuid;plot_two uuid;other_plot uuid;load_id uuid;
 culture uuid;subtype uuid;period uuid;
 scope jsonb;load_input jsonb;r jsonb;load jsonb;report jsonb;dashboard jsonb;agenda jsonb;diary jsonb;
 details jsonb:='{"tradeName":"","cnpj":"","street":"","number":"","complement":"","district":"","city":"","state":"","zipCode":"","phone":"","email":""}';
BEGIN
 company=(public.billing_rpc('companies','save',details||'{"legalName":"Empresa talhão opcional","isPrimary":true}')->'company'->>'id')::uuid;
 client=(public.billing_rpc('clients','save',details||'{"legalName":"Cliente talhão opcional","cnpj":"12345678000195","status":"Ativo"}')->'client'->>'id')::uuid;
 PERFORM public.billing_rpc('contract-types','save','{"name":"Tipo talhão opcional","stages":[]}');
 kind=(public.billing_rpc('contract-types','list')->'types'->0->>'id')::uuid;
 farm=(public.billing_rpc('farms','save','{"name":"Fazenda sem divisão","areaHa":"50","city":"Cidade","state":"SE"}')->'farm'->>'id')::uuid;
 other_farm=(public.billing_rpc('farms','save','{"name":"Fazenda vizinha","areaHa":"30","city":"Cidade","state":"SE"}')->'farm'->>'id')::uuid;
 plot=(public.billing_rpc('plots','save',jsonb_build_object('farmId',farm,'name','Talhão futuro','areaHa','20'))->'data'->'plots'->0->>'id')::uuid;
 plot_two=(public.billing_rpc('plots','save',jsonb_build_object('farmId',farm,'name','Talhão alternativo','areaHa','20'))->'data'->'plots'->0->>'id')::uuid;
 other_plot=(public.billing_rpc('plots','save',jsonb_build_object('farmId',other_farm,'name','Talhão de outra fazenda','areaHa','10'))->'data'->'plots'->0->>'id')::uuid;
 culture=(public.billing_rpc('cultures','save','{"kind":"culture","name":"Cultura talhão opcional"}')->>'id')::uuid;
 subtype=(public.billing_rpc('cultures','save',jsonb_build_object('kind','subtype','cultureId',culture,'name','Ciclo talhão opcional'))->>'id')::uuid;
 period=(public.billing_rpc('planning','save-period',jsonb_build_object('name','Safra talhão opcional','startDate','2026-01-01','endDate','2026-12-31',
  'targetAreaHa','40','cultureId',culture,'cultureSubtypeId',subtype,'notes','','status','active'))->'period'->>'id')::uuid;
 PERFORM public.billing_rpc('planning','save-allocation',jsonb_build_object('periodId',period,'plotId',plot,'areaHa','20','notes',''));
 PERFORM public.billing_rpc('planning','save-allocation',jsonb_build_object('periodId',period,'plotId',plot_two,'areaHa','20','notes',''));
 contract=(public.billing_rpc('contracts','save',jsonb_build_object(
  'title','Contrato com origem parcial','contractNumber','OPT-001','companyId',company,'clientId',client,'typeId',kind,
  'status','Ativo','startDate','2026-01-01','endDate','2026-12-31','contractedVolume','100',
  'value','','notes','','atrPriceType','gross','atrPeriodType','monthly'))->'contract'->>'id')::uuid;
 PERFORM public.billing_rpc('atr','save','{"year":2026,"month":9,"monthlyGrossValue":"2","monthlyNetValue":"2","accumulatedGrossValue":"2","accumulatedNetValue":"2"}');
 scope=jsonb_build_object('companyId',company,'contractId',contract);
 load_input=scope||jsonb_build_object('farmId',farm,'loadedAt','2026-09-15','volume','12.5','atr','100','document','SEM-TALHAO','notes','Origem conhecida somente até a fazenda');

 -- Omitting plotId entirely is accepted and normalized in every public projection.
 r=public.billing_rpc('contracts','save-load',load_input);
 load=r->'load';load_id=(load->>'id')::uuid;
 IF load->>'plotId'<>'' OR load->>'plotName'<>'' OR load->>'farmId'<>farm::text OR load->>'farmName'<>'Fazenda sem divisão' THEN
  RAISE EXCEPTION 'Plotless save projection is invalid: %',load;
 END IF;

 -- A plot can be assigned later and cleared again without changing the farm.
 r=public.billing_rpc('contracts','save-load',load_input||jsonb_build_object('id',load_id,'plotId',plot));
 IF r->'load'->>'plotId'<>plot::text OR r->'load'->>'plotName'<>'Talhão futuro' THEN
  RAISE EXCEPTION 'Optional plot could not be assigned: %',r;
 END IF;
 r=public.billing_rpc('contracts','save-load',load_input||jsonb_build_object('id',load_id,'plotId',''));
 IF r->'load'->>'plotId'<>'' OR r->'load'->>'plotName'<>'' THEN
  RAISE EXCEPTION 'Optional plot could not be cleared: %',r;
 END IF;

 BEGIN
  PERFORM public.billing_rpc('contracts','save-load',load_input||jsonb_build_object('id',load_id,'plotId',other_plot));
  RAISE EXCEPTION 'Plot from another farm was accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
 BEGIN
  PERFORM public.billing_rpc('contracts','save-load',load_input||jsonb_build_object('id',load_id,'farmId',gen_random_uuid(),'plotId',''));
  RAISE EXCEPTION 'Unknown required farm was accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;

 r=public.billing_rpc('contracts','get',jsonb_build_object('companyId',company,'id',contract));
 load=r->'contract'->'loads'->0;
 IF jsonb_array_length(r->'contract'->'loads')<>1 OR load->>'id'<>load_id::text
    OR load->>'plotId'<>'' OR load->>'plotName'<>'' THEN
  RAISE EXCEPTION 'Contract detail dropped or changed a plotless load: %',r;
 END IF;

 r=public.billing_rpc('contracts','list',scope||'{"view":"loads","search":"SEM-TALHAO","from":"2026-09-01","to":"2026-09-30","groupBy":"day"}');
 IF r->'summary'->>'loadCount'<>'1' OR r->'summary'->>'volume'<>'12.5' OR r->'summary'->>'farmCount'<>'1'
    OR r->'summary'->>'plotCount'<>'0' OR r->'groups'->0->'loads'->0->>'plotId'<>''
    OR r->'groups'->0->'loads'->0->>'plotName'<>'' THEN
  RAISE EXCEPTION 'Load workspace dropped a plotless load: %',r;
 END IF;

 report=public.billing_rpc('reports','list',jsonb_build_object('companyId',company,'kind','loads','search','',
  'from','2026-09-01','to','2026-09-30','farmId','','plotId',''));
 load=report->'groups'->0->'loads'->0;
 IF report->>'total'<>'1' OR report->'totals'->>'volume'<>'12.5' OR report->'totals'->>'plotCount'<>'0'
    OR report->'totals'->>'grossAmount'<>'2500' OR load->>'plotId'<>'' OR load->>'plotName'<>''
    OR report->'origins'->0->'plots'<>'[]'::jsonb THEN
  RAISE EXCEPTION 'Detailed report dropped or changed a plotless load: %',report;
 END IF;

 agenda=public.billing_rpc('agenda','list',jsonb_build_object('companyId',company,'month','2026-09','kind','load'));
 IF agenda->>'eventCount'<>'1' OR NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(agenda->'days') day CROSS JOIN LATERAL jsonb_array_elements(day->'events') event
  WHERE event->>'id'='load:'||load_id::text AND strpos(event->>'detail','Fazenda sem divisão')>0
 ) THEN RAISE EXCEPTION 'Agenda dropped or obscured a plotless load: %',agenda; END IF;

 diary=public.billing_rpc('planning','list',jsonb_build_object('periodId',period,'section','diario','search','',
  'page','1','pageSize','10','dateFrom','2026-09-01','dateTo','2026-09-30'));
 IF jsonb_array_length(diary->'harvestLoads')<>1 OR diary->'harvestLoads'->0->>'id'<>load_id::text
    OR diary->'harvestLoads'->0->>'plotId'<>'' OR diary->'harvestLoads'->0->>'plotName'<>''
    OR diary->'diaryPeriodSummary'->>'harvestedTons'<>'12.5' OR diary->'diaryPeriodSummary'->>'loadCount'<>'1'
    OR diary->'dailySummary'->0->>'date'<>'2026-09-15' OR diary->'dailySummary'->0->>'harvestedTons'<>'12.5'
    OR diary->'dailySummary'->0->>'loadCount'<>'1' OR diary->'monthlySummary'->0->>'month'<>'2026-09'
    OR diary->'monthlySummary'->0->>'harvestedTons'<>'12.5' OR diary->'monthlySummary'->0->>'loadCount'<>'1'
    OR (diary->'visibleHarvestLoadIds'->>0)<>load_id::text THEN
  RAISE EXCEPTION 'Planning diary dropped, duplicated or changed a farm-scoped plotless load: %',diary;
 END IF;

 dashboard=public.billing_rpc('summary','dashboard',jsonb_build_object('companyId',company,'from','2026-09-01','to','2026-09-30'));
 IF dashboard->'totals'->>'loadCount'<>'1' OR dashboard->'totals'->>'loadedVolume'<>'12.5'
    OR dashboard->'totals'->>'plotCount'<>'0' OR dashboard->'farms'->0->>'loadCount'<>'1'
    OR dashboard->'operationalTotals'->>'loadCount'<>'1' OR dashboard->'operationalTotals'->>'loadedVolume'<>'12.5'
    OR dashboard->'farmPerformance'->0->>'loadCount'<>'1' OR dashboard->'plotPerformance'<>'[]'::jsonb THEN
  RAISE EXCEPTION 'Executive totals dropped or attributed a plotless load: %',dashboard;
 END IF;

 IF EXISTS(SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='billing_contract_loads' AND column_name='plot_id' AND is_nullable<>'YES') THEN
  RAISE EXCEPTION 'billing_contract_loads.plot_id is still required';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint c
  WHERE c.conrelid='public.billing_contract_loads'::regclass AND c.contype='f'
   AND pg_get_constraintdef(c.oid) LIKE 'FOREIGN KEY (owner_id, farm_id, plot_id)%billing_farm_plots%') THEN
  RAISE EXCEPTION 'Composite owner/farm/plot foreign key was lost';
 END IF;
END $$;

RESET ROLE;
DO $$
DECLARE v_definer boolean;v_config text[];
BEGIN
 SELECT p.prosecdef,p.proconfig INTO v_definer,v_config FROM pg_proc p
 WHERE p.oid='billing_private.contracts_dispatch(text,jsonb)'::regprocedure;
 IF NOT v_definer OR NOT EXISTS(SELECT 1 FROM unnest(v_config) setting WHERE setting LIKE 'search_path=%')
    OR has_function_privilege('authenticated','billing_private.present_contract_load(public.billing_contract_loads)','EXECUTE')
    OR has_function_privilege('authenticated','billing_private.contract_loads_list(jsonb)','EXECUTE')
    OR has_table_privilege('authenticated','public.billing_contract_loads','INSERT')
    OR has_table_privilege('authenticated','public.billing_contract_loads','UPDATE')
    OR has_table_privilege('authenticated','public.billing_contract_loads','DELETE') THEN
  RAISE EXCEPTION 'Optional plot migration weakened dispatcher or table security';
 END IF;
END $$;
ROLLBACK;
