-- Run as postgres against local/temporary Supabase; all fixtures roll back.
BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('11111111-1111-4111-8111-111111111111','billing-one@example.invalid'),
 ('22222222-2222-4222-8222-222222222222','billing-two@example.invalid');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
DO $$
DECLARE farm uuid; plot uuid; other uuid; planning uuid; planning_delete uuid; r jsonb; company1 uuid; company2 uuid; culture uuid; subtype uuid; client_id uuid; type_id uuid; contract_id uuid; load_id uuid; missing_load_id uuid; table_name text; i integer;
BEGIN
 r=public.billing_rpc('settings','get'); IF length(r->'settings'->>'name')=0 OR length(r->'settings'->>'company')=0 OR r->'settings'->>'workspaceId'<>'11111111-1111-4111-8111-111111111111' THEN RAISE EXCEPTION 'Initial profile/workspace presentation is invalid'; END IF;
 r=public.billing_rpc('farms','save','{"name":"Fazenda teste","areaHa":"1.000001","city":"Itabaiana","state":"SE"}'); farm=(r->'farm'->>'id')::uuid;
 r=public.billing_rpc('plots','save',jsonb_build_object('farmId',farm,'name','Talhão A','areaHa','0.333333'));
 plot=(r->'data'->'plots'->0->>'id')::uuid;
 r=public.billing_rpc('plots','save',jsonb_build_object('farmId',farm,'name','Talhão B','areaHa','0.666668'));
 SELECT (value->>'id')::uuid INTO other FROM jsonb_array_elements(r->'data'->'plots') WHERE value->>'name'='Talhão B';
 IF (r->'data'->>'availableUnits')::bigint<>0 OR r->'data'->>'availableHa'<>'0' OR (r->'data'->>'usedPercent')::numeric<>100 OR (r->'data'->>'canAddPlot')::boolean THEN RAISE EXCEPTION 'Exact area calculation failed'; END IF;
 BEGIN
  PERFORM public.billing_rpc('plots','save',jsonb_build_object('farmId',farm,'name','Overflow','areaHa','0.000001'));
  RAISE EXCEPTION 'Overflow plot was accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('farms','save',jsonb_build_object('id',farm,'name','Fazenda teste','areaHa','1','city','Itabaiana','state','SE'));
  RAISE EXCEPTION 'Shrinking farm below plots was accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 r=public.billing_rpc('plots','delete',jsonb_build_object('farmId',farm,'id',plot));
 IF r->'data'->>'availableHa'<>'0.333333' THEN RAISE EXCEPTION 'Delete did not recalculate capacity'; END IF;
 r=public.billing_rpc('farms','list');
 IF (r->'farms'->0->>'plotCount')::integer<>1 OR r->'farms'->0->>'totalHa'<>'1.000001' OR r->'farms'->0->>'usedHa'<>'0.666668' OR r->'farms'->0->>'preservedHa'<>'0.333333' THEN RAISE EXCEPTION 'Farm card summary was not calculated by the RPC'; END IF;
 IF (r->'summary'->>'farmCount')::integer<>1 OR (r->'summary'->>'plotCount')::integer<>1 OR r->'summary'->>'preservedHa'<>'0.333333' THEN RAISE EXCEPTION 'Farm portfolio summary was not calculated by the RPC'; END IF;
 r=public.billing_rpc('planning','save',jsonb_build_object(
  'module','plantio','farmId',farm,'plotId',other,'activityType','Plantio mecanizado',
  'plannedStartDate','2026-09-10','plannedEndDate','2026-09-20','areaHa','0.5',
  'status','em-andamento','estimatedCost','1000.5','actualCost','250',
  'expectedProductionTons','60','actualProductionTons','0','notes','Equipe Alfa'
 ));
 planning=(r->'entry'->>'id')::uuid;
 IF r->'entry'->>'farmName'<>'Fazenda teste' OR r->'entry'->>'plotName'<>'Talhão B'
  OR r->'entry'->>'activityType'<>'Plantio mecanizado' OR r->'entry'->>'plannedStartDate'<>'2026-09-10'
  OR r->'entry'->>'areaHa'<>'0.5' OR r->'entry'->>'estimatedCost'<>'1000.5' THEN
  RAISE EXCEPTION 'Planning save envelope invalid';
 END IF;
 r=public.billing_rpc('planning','list','{"module":"plantio","search":"Equipe Alfa","dateFrom":"2026-09-15","dateTo":"2026-09-15","status":"em-andamento"}');
 IF jsonb_array_length(r->'groups')<>1 OR jsonb_array_length(r->'entries')<>1
  OR r->'groups'->0->>'totalAreaHa'<>'0.5' OR (r->'summary'->>'entryCount')::integer<>1
  OR r->'summary'->>'totalAreaHa'<>'0.5' OR r->'kpis'->>'plannedAreaHa'<>'0.5'
  OR r->'kpis'->>'estimatedCost'<>'1000.5' OR r->'filters'->>'dateFrom'<>'2026-09-15' THEN
  RAISE EXCEPTION 'Planning filters, grouping or KPIs invalid';
 END IF;
 -- A different operation may use the same plot and full plot area in the same
 -- period; successive agricultural stages do not consume cumulative capacity.
 r=public.billing_rpc('planning','save',jsonb_build_object(
  'module','manejo-do-canavial','farmId',farm,'plotId',other,'activityType','Adubação de cobertura',
  'plannedStartDate','2026-09-10','plannedEndDate','2026-09-20','areaHa','0.666668',
  'status','planejado','estimatedCost','500','notes','Equipe Beta'
 ));
 BEGIN
  PERFORM public.billing_rpc('planning','save',jsonb_build_object(
   'module','plantio','farmId',farm,'plotId',other,'activityType','Plantio mecanizado',
   'plannedStartDate','2026-09-10','plannedEndDate','2026-09-20','areaHa','0.2','status','planejado'
  ));
  RAISE EXCEPTION 'Exact duplicate planning operation/window accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('planning','save',jsonb_build_object(
   'module','preparacao-de-solo','farmId',farm,'plotId',other,'activityType','Gradagem',
   'plannedStartDate','2026-09-01','plannedEndDate','2026-09-02','areaHa','0.666669','status','planejado'
  ));
  RAISE EXCEPTION 'Planning area larger than plot accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('planning','save',jsonb_build_object(
   'module','colheita','farmId',farm,'plotId',other,'activityType','Colheita mecanizada',
   'plannedStartDate','2026-10-03','plannedEndDate','2026-10-02','areaHa','0.5','status','planejado'
  ));
  RAISE EXCEPTION 'Planning reversed date range accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('planning','list','{"dateFrom":"2026-02-30"}');
  RAISE EXCEPTION 'Planning invalid calendar date accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 r=public.billing_rpc('planning','save',jsonb_build_object(
  'module','colheita','farmId',farm,'plotId',other,'activityType','Colheita mecanizada',
  'plannedStartDate','2026-10-01','plannedEndDate','2026-10-05','actualDate','2026-10-04',
  'areaHa','0.5','status','concluido','estimatedCost','300','actualCost','320',
 'expectedProductionTons','60','actualProductionTons','55','notes','Frente 1'
 ));
 planning_delete=(r->'entry'->>'id')::uuid;
 r=public.billing_rpc('planning','list','{"module":"colheita","status":"concluido","dateFrom":"2026-10-03","dateTo":"2026-10-03"}');
 IF jsonb_array_length(r->'entries')<>1 OR r->'summary'->>'completedAreaHa'<>'0.5'
  OR r->'kpis'->>'completionPercent'<>'100' OR r->'kpis'->>'yieldTonsPerHa'<>'110'
  OR r->'kpis'->>'actualProductionTons'<>'55' THEN RAISE EXCEPTION 'Harvest KPIs invalid'; END IF;
 r=public.billing_rpc('planning','list','{}');
 IF jsonb_array_length(r->'entries')<>3 OR (r->'summary'->>'entryCount')::integer<>3
 OR jsonb_array_length(r->'farms')<>1 OR jsonb_array_length(r->'farms'->0->'plots')<>1 THEN
  RAISE EXCEPTION 'Planning overview or farm catalog invalid';
 END IF;
 r=public.billing_rpc('planning','delete',jsonb_build_object('id',planning_delete));
 IF (r->>'deleted')::boolean IS NOT TRUE OR (r->>'id')::uuid<>planning_delete THEN
  RAISE EXCEPTION 'Planning delete envelope invalid';
 END IF;
 r=public.billing_rpc('planning','save',jsonb_build_object(
  'id',planning,'module','plantio','farmId',farm,'plotId',other,'activityType','Plantio mecanizado',
  'plannedStartDate','2026-09-10','plannedEndDate','2026-09-20','areaHa','0.6',
  'status','em-andamento','estimatedCost','1000.5','actualCost','250',
  'expectedProductionTons','60','actualProductionTons','0','notes','Equipe Alfa'
 ));
 IF r->'entry'->>'areaHa'<>'0.6' THEN RAISE EXCEPTION 'Planning update failed'; END IF;
 BEGIN
  PERFORM public.billing_rpc('atr','save','{"year":2026,"month":9,"monthlyGrossValue":"0.0000001","monthlyNetValue":"1.2","accumulatedGrossValue":"1.3","accumulatedNetValue":"1.2"}');
  RAISE EXCEPTION 'ATR rounding accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 r=public.billing_rpc('atr','save','{"year":2026,"month":8,"monthlyGrossValue":"1,253367","monthlyNetValue":"1,234567","accumulatedGrossValue":"1,217020","accumulatedNetValue":"1,198765"}');
 IF r->'record'->>'monthlyGrossValue'<>'1.253367' OR r->'record'->>'monthlyNetValue'<>'1.234567' OR r->'record'->>'accumulatedGrossValue'<>'1.21702' OR r->'record'->>'accumulatedNetValue'<>'1.198765' OR r->'record' ? 'monthlyValue' THEN RAISE EXCEPTION 'ATR four-quotation envelope invalid'; END IF;
 BEGIN
  PERFORM public.billing_rpc('atr','save','{"year":2026,"month":10,"monthlyNetValue":"1.2"}');
  RAISE EXCEPTION 'ATR without accumulated quotation accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
 PERFORM public.billing_rpc('atr','save','{"year":2026,"month":8,"monthlyGrossValue":"2.1","monthlyNetValue":"2","accumulatedGrossValue":"2.2","accumulatedNetValue":"2.1"}');
  RAISE EXCEPTION 'Duplicate ATR accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 FOR i IN 1..12 LOOP
  PERFORM public.billing_rpc('atr','save',jsonb_build_object('year',2025,'month',i,'monthlyGrossValue','1.3','monthlyNetValue','1.'||lpad(i::text,2,'0'),'accumulatedGrossValue','1.3','accumulatedNetValue','1.2'));
 END LOOP;
 r=public.billing_rpc('atr','list','{"page":1,"pageSize":12}');
 IF jsonb_array_length(r->'records')<>12
  OR (r->'pagination'->>'total')::integer<>13
  OR (r->'pagination'->>'totalPages')::integer<>2
  OR (r->'pagination'->>'hasNext')::boolean IS NOT TRUE
  OR r->'records'->0->>'year'<>'2026'
  OR r->'records'->0->>'month'<>'8'
  OR r->'records'->11->>'month'<>'2' THEN
  RAISE EXCEPTION 'ATR latest-page pagination failed';
 END IF;
 r=public.billing_rpc('atr','list','{"page":2,"pageSize":12}');
 IF jsonb_array_length(r->'records')<>1
  OR (r->'pagination'->>'page')::integer<>2
  OR (r->'pagination'->>'hasPrevious')::boolean IS NOT TRUE
  OR (r->'pagination'->>'hasNext')::boolean IS NOT FALSE
  OR r->'records'->0->>'year'<>'2025'
  OR r->'records'->0->>'month'<>'1' THEN
  RAISE EXCEPTION 'ATR older-page pagination failed';
 END IF;
 BEGIN
  PERFORM public.billing_rpc('atr','list','{"page":1,"pageSize":101}');
  RAISE EXCEPTION 'Oversized ATR page accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 r=public.billing_rpc('companies','save','{"legalName":"Empresa A","tradeName":"","cnpj":"","street":"","number":"","complement":"","district":"","city":"","state":"","zipCode":"","phone":"","email":"","isPrimary":false}'); company1=(r->>'id')::uuid;
 r=public.billing_rpc('companies','save','{"legalName":"Empresa B","tradeName":"","cnpj":"","street":"","number":"","complement":"","district":"","city":"","state":"","zipCode":"","phone":"","email":"","isPrimary":true}'); company2=(r->>'id')::uuid;
 r=public.billing_rpc('companies','list');
 IF jsonb_array_length(r->'companies')<>2 OR r->'companies'->0->>'id'<>company2::text THEN RAISE EXCEPTION 'Primary company transition failed'; END IF;
 INSERT INTO storage.objects(bucket_id,name) VALUES('billing-company-logos','11111111-1111-4111-8111-111111111111/companies/test-logo.png');
 r=public.billing_rpc('companies','save',jsonb_build_object('id',company1,'legalName','Empresa A','tradeName','','cnpj','','street','','number','','complement','','district','','city','','state','','zipCode','','phone','','email','','isPrimary',false,'logoKey','11111111-1111-4111-8111-111111111111/companies/test-logo.png','logoName','Logo.png'));
 IF r->'company'->>'logoKey'<>'11111111-1111-4111-8111-111111111111/companies/test-logo.png' OR r->>'previousLogoKey' IS NOT NULL THEN RAISE EXCEPTION 'Company logo was not saved'; END IF;
 r=public.billing_rpc('companies','list');
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'companies') c WHERE c->>'id'=company1::text AND c->>'logoName'='Logo.png') THEN RAISE EXCEPTION 'Company logo missing from list'; END IF;
 BEGIN
  PERFORM public.billing_rpc('companies','save',jsonb_build_object('id',company1,'legalName','Empresa A','tradeName','','cnpj','','street','','number','','complement','','district','','city','','state','','zipCode','','phone','','email','','isPrimary',false,'logoKey','22222222-2222-4222-8222-222222222222/forged.png','logoName','Forjada.png'));
  RAISE EXCEPTION 'Foreign company logo accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 r=public.billing_rpc('cultures','save','{"kind":"culture","name":"Cana-de-açúcar"}'); culture=(r->>'id')::uuid;
 r=public.billing_rpc('cultures','save',jsonb_build_object('kind','subtype','cultureId',culture,'name','Cana planta')); subtype=(r->>'id')::uuid;
 r=public.billing_rpc('cultures','list'); IF jsonb_array_length(r->'cultures'->0->'subtypes')<>1 THEN RAISE EXCEPTION 'Subtype missing'; END IF;
 BEGIN
  PERFORM public.billing_rpc('cultures','save','{"kind":"culture","name":"CANA-DE-ACUCAR"}');
  RAISE EXCEPTION 'Normalized duplicate culture accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 PERFORM public.billing_rpc('contract-types','save','{"name":"Contrato teste","stages":[{"id":"etapa-1","name":"Plantio"}]}');
 BEGIN
  PERFORM public.billing_rpc('contract-types','save','{"name":"Contrato inválido","stages":[{"id":"e1","name":"A"},{"id":"e1","name":"B"}]}');
  RAISE EXCEPTION 'Duplicate stage IDs accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 r=public.billing_rpc('cultural-practices','save',jsonb_build_object('cultureId',culture,'cultureSubtypeId',subtype,'category','soil-preparation','name','Adubação de plantio','description','Descrição'));
 IF r->'practice'->>'cultureName'<>'Cana-de-açúcar' OR r->'practice'->>'cultureSubtypeName'<>'Cana planta' THEN RAISE EXCEPTION 'Management context presentation failed'; END IF;
 PERFORM public.billing_rpc('cultural-practices','save',jsonb_build_object('cultureId',culture,'cultureSubtypeId',subtype,'category','cultural-practices','name','Controle de plantas daninhas','description',''));
 BEGIN
  PERFORM public.billing_rpc('cultural-practices','save',jsonb_build_object('cultureId',culture,'cultureSubtypeId',subtype,'category','ratoon-management','name','Controle de plantas daninhas','description',''));
  RAISE EXCEPTION 'Legacy ratoon management category was accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 r=public.billing_rpc('cultural-practices','list',jsonb_build_object('cultureId',culture,'cultureSubtypeId',subtype));
 IF jsonb_array_length(r->'practices')<>2 OR jsonb_array_length(r->'catalog')<>16 THEN RAISE EXCEPTION 'Filtered management list or catalog failed'; END IF;
 BEGIN
  PERFORM public.billing_rpc('cultural-practices','save',jsonb_build_object('cultureId',culture,'cultureSubtypeId',subtype,'category','soil-preparation','name','Irrigação','description',''));
  RAISE EXCEPTION 'Operation was accepted in the wrong management category';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('cultural-practices','save',jsonb_build_object('cultureId',culture,'cultureSubtypeId',subtype,'category','soil-preparation','name','Adubação de plantio','description','Duplicado'));
  RAISE EXCEPTION 'Duplicate management operation accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 r=public.billing_rpc('cultural-practices','bootstrap-sugarcane','{}');
 IF r->'culture'->>'id'<>culture::text
  OR r->'focus'->>'cultureSubtypeId'<>subtype::text
  OR (r->'created'->>'cultures')::integer<>0
  OR (r->'created'->>'subtypes')::integer<>1
  OR (r->'created'->>'practices')::integer<>18
  OR (r->>'totalPractices')::integer<>20 THEN
  RAISE EXCEPTION 'Sugarcane bootstrap did not reuse and complete the existing context: %',r;
 END IF;
 SELECT count(*) INTO i FROM public.billing_cultural_practices
  WHERE owner_id=auth.uid() AND culture_id=culture AND culture_subtype_id=subtype
   AND category IN('soil-preparation','cultural-practices');
 IF i<>12 THEN RAISE EXCEPTION 'Cana planta bootstrap distribution is invalid: %',i; END IF;
 SELECT count(*) INTO i FROM public.billing_cultural_practices
  WHERE owner_id=auth.uid() AND culture_id=culture
   AND culture_subtype_id=(SELECT id FROM public.billing_culture_subtypes WHERE owner_id=auth.uid() AND culture_id=culture AND name='Cana soca');
 IF i<>8 THEN RAISE EXCEPTION 'Cana soca bootstrap distribution is invalid: %',i; END IF;
 IF EXISTS(SELECT 1 FROM public.billing_cultural_practices
  WHERE owner_id=auth.uid() AND (category='ratoon-management' OR name='Controle de pragas/doenças')) THEN
  RAISE EXCEPTION 'Legacy management category or combined pest/disease operation survived';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.billing_cultural_practices
  WHERE owner_id=auth.uid() AND culture_id=culture AND culture_subtype_id=subtype
   AND category='soil-preparation' AND name='Adubação de plantio' AND description='Descrição') THEN
  RAISE EXCEPTION 'Sugarcane bootstrap overwrote an existing management description';
 END IF;
 r=public.billing_rpc('cultural-practices','bootstrap-sugarcane','{}');
 IF (r->'created'->>'cultures')::integer<>0 OR (r->'created'->>'subtypes')::integer<>0
  OR (r->'created'->>'practices')::integer<>0 OR (r->>'totalPractices')::integer<>20 THEN
  RAISE EXCEPTION 'Sugarcane bootstrap is not idempotent: %',r;
 END IF;
 BEGIN
  PERFORM public.billing_rpc('cultural-practices','bootstrap-sugarcane','{"ownerId":"22222222-2222-4222-8222-222222222222"}');
  RAISE EXCEPTION 'Sugarcane bootstrap accepted an owner override';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 r=public.billing_rpc('settings','save','{"name":"Pessoa A","company":"Empresa A","email":"forged@example.invalid","compact":true}');
 IF r->'settings'->>'email'<>'billing-one@example.invalid' THEN RAISE EXCEPTION 'Profile allowed email forgery'; END IF;
 INSERT INTO storage.objects(bucket_id,name) VALUES
  ('billing-watermarks','11111111-1111-4111-8111-111111111111/portrait/retrato.png'),
  ('billing-watermarks','11111111-1111-4111-8111-111111111111/landscape/paisagem.png');
 r=public.billing_rpc('watermark','save','{"orientation":"portrait","opacity":35,"size":80,"portraitImageKey":"11111111-1111-4111-8111-111111111111/portrait/retrato.png","portraitImageName":"Retrato.png"}');
 r=public.billing_rpc('watermark','save','{"orientation":"landscape","opacity":35,"size":80,"landscapeImageKey":"11111111-1111-4111-8111-111111111111/landscape/paisagem.png","landscapeImageName":"Paisagem.png"}');
 r=public.billing_rpc('watermark','get','{}');
 IF r->'settings'->>'orientation'<>'landscape' OR r->'settings'->>'portraitImageName'<>'Retrato.png' OR r->'settings'->>'landscapeImageName'<>'Paisagem.png' THEN RAISE EXCEPTION 'Independent watermark images did not survive sequential saves'; END IF;
 BEGIN
  PERFORM public.billing_rpc('watermark','save','{"orientation":"portrait","opacity":15,"size":60,"imageKey":"22222222-2222-4222-8222-222222222222/forged.png"}');
  RAISE EXCEPTION 'Foreign watermark accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  INSERT INTO public.billing_farms(name,area_ha,city,state) VALUES('Bypass',99,'Itabaiana','SE');
  RAISE EXCEPTION 'Direct browser INSERT accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('settings','save','{}');
  RAISE EXCEPTION 'Missing profile name/company accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  UPDATE public.billing_farms SET area_ha=99;
  RAISE EXCEPTION 'Direct browser UPDATE accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  DELETE FROM public.billing_farms;
  RAISE EXCEPTION 'Direct browser DELETE accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 FOREACH table_name IN ARRAY ARRAY['billing_companies','billing_clients','billing_atr_records','billing_farms','billing_farm_plots','billing_planning_entries','billing_contract_types','billing_cultures','billing_culture_subtypes','billing_cultural_practices','billing_profiles','billing_watermarks','billing_contracts','billing_contract_loads','billing_access_profiles','billing_memberships','billing_invitations','billing_user_settings','billing_report_headers'] LOOP
  IF has_table_privilege('authenticated','public.'||table_name,'INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Direct write grant exists: %',table_name; END IF;
  IF NOT has_table_privilege('authenticated','public.'||table_name,'SELECT') THEN RAISE EXCEPTION 'Missing Realtime read grant: %',table_name; END IF;
 END LOOP;
 r=public.billing_rpc('clients','save','{"legalName":"Cliente teste","tradeName":"","cnpj":"11.222.333/0001-81","street":"","number":"","complement":"","district":"","city":"","state":"se","zipCode":"","phone":"","email":""}');
 client_id=(r->'client'->>'id')::uuid;
 IF r->'client'->>'cnpj'<>'11222333000181' OR r->'client'->>'state'<>'SE' THEN RAISE EXCEPTION 'Client normalization failed'; END IF;
 r=public.billing_rpc('contract-types','list'); type_id=(r->'types'->0->>'id')::uuid;
 r=public.billing_rpc('contracts','save',jsonb_build_object('title','Contrato agrícola','contractNumber','  CTR-2026/001  ','companyId',company2,'clientId',client_id,'typeId',type_id,'status','Rascunho','startDate','2026-09-01','endDate','2026-12-01','contractedVolume','1000.125','atrPriceType','gross','atrPeriodType','monthly','value','123.45','notes',''));
 contract_id=(r->'contract'->>'id')::uuid;
 IF r->'contract'->>'status'<>'Ativo' OR r->'contract'->>'contractNumber'<>'CTR-2026/001' OR r->'contract'->>'value'<>'123.45' OR r->'contract'->>'contractedVolume'<>'1000.125' OR r->'contract'->>'atrPriceType'<>'gross' OR r->'contract'->>'atrPeriodType'<>'monthly' OR r->'contract'->>'billingAmount'<>'0' OR (r->'contract'->>'billingPending')::boolean OR r->'contract'->>'companyName'<>'Empresa B' OR r->'contract'->>'clientName'<>'Cliente teste' OR r->'contract'->'stages'->0->>'name'<>'Plantio' THEN RAISE EXCEPTION 'Contract activation/number/ATR/presentation/snapshot failed'; END IF;
 r=public.billing_rpc('contracts','save-load',jsonb_build_object('companyId',company2,'contractId',contract_id,'loadedAt','2026-09-10','farmId',farm,'plotId',other,'volume','100.125','atr','121.500000','document','ROM-1','notes',''));
 load_id=(r->'load'->>'id')::uuid;
 IF r->'load'->>'farmName'<>'Fazenda teste' OR r->'load'->>'plotName'<>'Talhão B' OR r->'load'->>'volume'<>'100.125' THEN RAISE EXCEPTION 'Contract load presentation failed'; END IF;
 r=public.billing_rpc('contracts','get',jsonb_build_object('companyId',company2,'id',contract_id));
 IF r->'contract'->>'loadedVolume'<>'100.125' OR r->'contract'->>'remainingVolume'<>'900' OR r->'contract'->>'averageAtr'<>'121.5' OR r->'contract'->>'billingAmount'<>'15247.44' OR (r->'contract'->>'billingPending')::boolean OR jsonb_array_length(r->'contract'->'loads')<>1 THEN RAISE EXCEPTION 'Contract load totals/ATR/billing failed'; END IF;
 IF jsonb_array_length(r->'contract'->'monthlySummary'->'months')<>1 OR r->'contract'->'monthlySummary'->'months'->0->>'month'<>'2026-09' OR r->'contract'->'monthlySummary'->'months'->0->>'loadedVolume'<>'100.125' OR r->'contract'->'monthlySummary'->'months'->0->>'averageLoadAtr'<>'121.5' OR r->'contract'->'monthlySummary'->'months'->0->>'atrQuote'<>'1.253367' OR r->'contract'->'monthlySummary'->'months'->0->>'billingAmount'<>'15247.44' OR (r->'contract'->'monthlySummary'->'months'->0->>'expensesPending')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Contract monthly summary failed'; END IF;
 r=public.billing_rpc('contracts','save-load',jsonb_build_object('companyId',company2,'contractId',contract_id,'loadedAt','2026-11-10','farmId',farm,'plotId',other,'volume','1','atr','100','document','','notes',''));
 missing_load_id=(r->'load'->>'id')::uuid;
 r=public.billing_rpc('contracts','get',jsonb_build_object('companyId',company2,'id',contract_id));
 IF (r->'contract'->>'billingPending')::boolean IS NOT TRUE OR r->'contract'->>'billingAmount'<>'' THEN RAISE EXCEPTION 'Contract exposed a partial billing total without an ATR quotation'; END IF;
 IF jsonb_array_length(r->'contract'->'monthlySummary'->'months')<>2 OR r->'contract'->'monthlySummary'->'months'->1->>'month'<>'2026-11' OR (r->'contract'->'monthlySummary'->'months'->1->>'billingPending')::boolean IS NOT TRUE OR r->'contract'->'monthlySummary'->'months'->1->>'billingAmount'<>'' OR (r->'contract'->'monthlySummary'->'totals'->>'pendingQuoteMonths')::integer<>1 THEN RAISE EXCEPTION 'Missing monthly ATR quotation did not remain pending'; END IF;
 PERFORM public.billing_rpc('contracts','delete-load',jsonb_build_object('companyId',company2,'contractId',contract_id,'id',missing_load_id));
 r=public.billing_rpc('contracts','list',jsonb_build_object('companyId',company2,'bucket','open','search','Empresa B','from','2026-09-01','to','2026-09-01'));
 IF jsonb_array_length(r->'contracts')<>1 OR (r->'counts'->>'open')::integer<>1 OR (r->>'total')::integer<>1 THEN RAISE EXCEPTION 'Contract list filters/counts failed'; END IF;
 r=public.billing_rpc('contracts','list',jsonb_build_object('companyId',company1,'bucket','open','search','','from','','to',''));
 IF jsonb_array_length(r->'contracts')<>0 OR (r->'counts'->>'open')::integer<>0 THEN RAISE EXCEPTION 'Contract company isolation failed'; END IF;
 BEGIN
  PERFORM public.billing_rpc('contracts','list',jsonb_build_object('companyId',company2,'bucket','invalid','search','','from','','to',''));
  RAISE EXCEPTION 'Invalid company-scoped contract bucket was accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('contracts','get',jsonb_build_object('companyId',company1,'id',contract_id));
  RAISE EXCEPTION 'Contract detail crossed the active company';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('contracts','save',jsonb_build_object('id',contract_id,'title','Contrato movido','companyId',company1,'clientId',client_id,'typeId',type_id,'status','Ativo','startDate','2026-09-01','endDate','','contractedVolume','1000.125','atrPriceType','gross','atrPeriodType','monthly','value','','notes',''));
  RAISE EXCEPTION 'Existing contract moved between company contexts';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 r=public.billing_rpc('contracts','save-load',jsonb_build_object('companyId',company2,'contractId',contract_id,'loadedAt','2026-09-11','farmId',farm,'plotId',other,'volume','901','atr','100','document','EXCEDENTE','notes',''));
 missing_load_id=(r->'load'->>'id')::uuid;
 r=public.billing_rpc('contracts','get',jsonb_build_object('companyId',company2,'id',contract_id));
 IF r->'contract'->>'loadedVolume'<>'1001.125' OR r->'contract'->>'remainingVolume'<>'0'
  OR r->'contract'->'financialSummary'->'totals'->>'loadedVolume'<>'1001.125' THEN
  RAISE EXCEPTION 'Contract excess volume was not accepted or calculated: %',r;
 END IF;
 r=public.billing_rpc('contracts','save',jsonb_build_object('id',contract_id,'title','Contrato excedido','companyId',company2,'clientId',client_id,'typeId',type_id,'status','Ativo','startDate','2026-09-01','endDate','2026-12-01','contractedVolume','1000.125','atrPriceType','gross','atrPeriodType','monthly','value','123.45','notes',''));
 IF r->'contract'->>'contractedVolume'<>'1000.125' OR r->'contract'->>'loadedVolume'<>'1001.125' THEN
  RAISE EXCEPTION 'Contract edit failed after accepted excess volume: %',r;
 END IF;
 PERFORM public.billing_rpc('contracts','delete-load',jsonb_build_object('companyId',company2,'contractId',contract_id,'id',missing_load_id));
 PERFORM public.billing_rpc('contracts','delete-load',jsonb_build_object('companyId',company2,'contractId',contract_id,'id',load_id));
 r=public.billing_rpc('contracts','get',jsonb_build_object('companyId',company2,'id',contract_id));
 IF r->'contract'->>'loadedVolume'<>'0' OR r->'contract'->>'remainingVolume'<>'1000.125' OR jsonb_array_length(r->'contract'->'loads')<>0 THEN RAISE EXCEPTION 'Contract load delete did not recalculate totals'; END IF;
 PERFORM public.billing_rpc('contract-types','save',jsonb_build_object('id',type_id,'name','Tipo renomeado','stages',jsonb_build_array(jsonb_build_object('id','e2','name','Colheita'))));
 r=public.billing_rpc('contracts','save',jsonb_build_object('id',contract_id,'title','Contrato editado','companyId',company2,'clientId',client_id,'typeId',type_id,'status','Ativo','startDate','2026-09-01','endDate','','contractedVolume','1000.125','atrPriceType','net','atrPeriodType','accumulated','value','','notes',''));
 IF r->'contract'->>'typeName'<>'Contrato teste' OR r->'contract'->'stages'->0->>'name'<>'Plantio' OR r->'contract'->>'contractNumber'<>'CTR-2026/001' OR r->'contract'->>'atrPriceType'<>'net' OR r->'contract'->>'atrPeriodType'<>'accumulated' OR r->'contract'->>'value'<>'' OR r->'contract'->>'startDate'<>'2026-09-01' THEN RAISE EXCEPTION 'Contract edit failed to preserve original number, type/stages snapshot or ATR criterion'; END IF;
 BEGIN
  PERFORM public.billing_rpc('contracts','save',jsonb_build_object('id',contract_id,'title','Contrato editado','companyId',company2,'clientId',client_id,'typeId',type_id,'status','Rascunho','startDate','2026-09-01','endDate','','contractedVolume','1000.125','value','','notes',''));
  RAISE EXCEPTION 'Draft status was accepted while editing a contract';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('contracts','save',jsonb_build_object('id',contract_id,'title','Contrato editado','contractNumber',repeat('X',101),'companyId',company2,'clientId',client_id,'typeId',type_id,'status','Ativo','startDate','2026-09-01','endDate','','contractedVolume','1000.125','value','','notes',''));
  RAISE EXCEPTION 'Oversized optional contract number was accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('clients','delete',jsonb_build_object('id',client_id));
  RAISE EXCEPTION 'Referenced contract client deletion accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('contracts','save',jsonb_build_object('title','Contrato inválido','companyId',company2,'clientId',client_id,'typeId',type_id,'status','Ativo','startDate','2026-02-30','endDate','','contractedVolume','1','value','1','notes',''));
  RAISE EXCEPTION 'Invalid calendar date accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('contracts','save',jsonb_build_object('title','Contrato inválido','companyId',company2,'clientId',client_id,'typeId',type_id,'status','Ativo','startDate','2026-09-01','endDate','','contractedVolume','1','value','1.001','notes',''));
  RAISE EXCEPTION 'Contract value >2 decimals accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 -- Another authenticated owner sees no rows and cannot edit the first owner's IDs.
 PERFORM set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 BEGIN
  PERFORM public.billing_rpc('contracts','save',jsonb_build_object('title','Cross-tenant contract','companyId',company2,'clientId',client_id,'typeId',type_id,'status','Ativo','startDate','2026-09-01','contractedVolume','1'));
  RAISE EXCEPTION 'Cross-tenant contract references accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.billing_farms) THEN RAISE EXCEPTION 'RLS leaked another owner farm'; END IF;
 r=public.billing_rpc('farms','list'); IF jsonb_array_length(r->'farms')<>0 THEN RAISE EXCEPTION 'RPC leaked another owner farm'; END IF;
 r=public.billing_rpc('planning','list','{"module":"plantio"}'); IF jsonb_array_length(r->'groups')<>0 THEN RAISE EXCEPTION 'RPC leaked another owner planning entry'; END IF;
 BEGIN
  PERFORM public.billing_rpc('planning','save',jsonb_build_object(
   'module','plantio','farmId',farm,'plotId',other,'activityType','Plantio estrangeiro',
   'plannedStartDate','2026-09-10','plannedEndDate','2026-09-20','areaHa','0.1','status','planejado'
  ));
  RAISE EXCEPTION 'Cross-tenant planning references accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('planning','delete',jsonb_build_object('id',planning));
  RAISE EXCEPTION 'Cross-tenant planning delete accepted';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('farms','get',jsonb_build_object('id',farm));
  RAISE EXCEPTION 'Foreign farm get accepted';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('farms','delete',jsonb_build_object('id',farm));
  RAISE EXCEPTION 'Foreign farm delete accepted';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('cultures','save',jsonb_build_object('kind','subtype','cultureId',culture,'name','Foreign'));
  RAISE EXCEPTION 'Foreign culture reference accepted';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('cultural-practices','save',jsonb_build_object('cultureId',culture,'cultureSubtypeId',subtype,'category','soil-preparation','name','Plantio','description',''));
  RAISE EXCEPTION 'Cross-tenant management references accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 r=public.billing_rpc('cultural-practices','bootstrap-sugarcane','{}');
 IF (r->'created'->>'cultures')::integer<>1 OR (r->'created'->>'subtypes')::integer<>2
  OR (r->'created'->>'practices')::integer<>20 OR (r->>'totalPractices')::integer<>20 THEN
  RAISE EXCEPTION 'Sugarcane bootstrap did not isolate the second owner: %',r;
 END IF;
 -- ownerId/owner_id fields are ignored: the trusted identity is auth.uid().
 r=public.billing_rpc('farms','save','{"name":"Owner B","areaHa":"2","city":"Itabaiana","state":"SE","owner_id":"11111111-1111-4111-8111-111111111111"}');
 IF NOT EXISTS(SELECT 1 FROM public.billing_farms WHERE id=(r->'farm'->>'id')::uuid AND owner_id=auth.uid()) THEN RAISE EXCEPTION 'Owner override accepted'; END IF;
END $$;
-- Workspace RBAC, pending invitation activation and report-header contracts.
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
DO $$
DECLARE r jsonb;reader uuid;custom_profile uuid;
BEGIN
 r=public.billing_rpc('access-profiles','list');
 SELECT (value->>'id')::uuid INTO reader FROM jsonb_array_elements(r->'profiles') WHERE value->>'name'='Somente leitura';
 IF reader IS NULL THEN RAISE EXCEPTION 'Default read profile missing'; END IF;
 r=public.billing_rpc('access-profiles','save','{"name":"Operador de relatórios","description":"Emite relatórios","permissions":["companies.read","watermarks.read","report-headers.read"]}');
 custom_profile=(r->'profile'->>'id')::uuid;
 IF r->'profile'->>'name'<>'Operador de relatórios' OR (r->'profile'->>'userCount')::integer<>0 THEN RAISE EXCEPTION 'Access-profile envelope invalid'; END IF;
 PERFORM public.billing_rpc('access-profiles','delete',jsonb_build_object('id',custom_profile));
 r=public.billing_rpc('users','invite',jsonb_build_object('email',' invited.member@example.invalid ','accessProfileId',reader));
 IF r->'user'->>'status'<>'pending' OR r->'user'->>'email'<>'invited.member@example.invalid' THEN RAISE EXCEPTION 'Pending invitation envelope invalid'; END IF;
 r=public.billing_rpc('report-headers','save','{"orientation":"landscape","defaultCompanyId":null,"portrait":{"variant":"detailed","logoAlignment":"left","showCnpj":true,"showContact":false},"landscape":{"variant":"compact","logoAlignment":"center","showCnpj":false,"showContact":true}}');
 IF r->'settings'->>'orientation'<>'landscape' OR r->'settings'->'portrait'->>'variant'<>'detailed' OR r->'settings'->'landscape'->>'logoAlignment'<>'center' THEN RAISE EXCEPTION 'Report-header save envelope invalid'; END IF;
 r=public.billing_rpc('report-headers','get');
 IF r->'settings'->>'defaultCompanyId' IS NOT NULL OR r->'settings'->>'updatedAt' IS NULL THEN RAISE EXCEPTION 'Report-header get envelope invalid'; END IF;
END $$;
RESET ROLE;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('33333333-3333-4333-8333-333333333333','invited.member@example.invalid',now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
DO $$
DECLARE r jsonb;planning uuid;
BEGIN
 r=public.billing_rpc('settings','get');
 IF r->'settings'->>'role'<>'member' THEN RAISE EXCEPTION 'Pending invitation was not activated'; END IF;
 r=public.billing_rpc('farms','list');
 IF jsonb_array_length(r->'farms')=0 THEN RAISE EXCEPTION 'Member did not enter inviter workspace'; END IF;
 r=public.billing_rpc('planning','list','{"module":"plantio"}');
 IF jsonb_array_length(r->'groups')=0 THEN RAISE EXCEPTION 'Read-only member did not see workspace planning'; END IF;
 planning=(r->'groups'->0->'entries'->0->>'id')::uuid;
 BEGIN
  PERFORM public.billing_rpc('planning','delete',jsonb_build_object('module','plantio','id',planning));
  RAISE EXCEPTION 'Read-only member deleted planning data';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('farms','save','{"name":"Forbidden","areaHa":"1","city":"Itabaiana","state":"SE"}');
  RAISE EXCEPTION 'Read-only member wrote registration data';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('cultural-practices','bootstrap-sugarcane','{}');
  RAISE EXCEPTION 'Read-only member bootstrapped sugarcane management';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('users','list');
  RAISE EXCEPTION 'Read-only member listed workspace users';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 r=public.billing_rpc('report-headers','get');
 IF r->'settings'->>'orientation'<>'landscape' THEN RAISE EXCEPTION 'Member did not consume shared report header'; END IF;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.billing_rpc('farms','list'); RAISE EXCEPTION 'Anonymous RPC accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM public.billing_farms; RAISE EXCEPTION 'Anonymous SELECT accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
