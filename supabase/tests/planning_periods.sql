-- Local/ephemeral database only. Every fixture, including auth users, rolls back.
BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('55555555-5555-4555-8555-555555555551','planning-periods-one@example.invalid'),
 ('66666666-6666-4666-8666-666666666661','planning-periods-two@example.invalid');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555551',true);
DO $$
DECLARE
 r jsonb;g jsonb;input jsonb;execution_input jsonb;entry_input jsonb;revision_input jsonb;
 farm uuid;plot uuid;entry uuid;baseline_entry uuid;other_module uuid;
 weekly uuid;monthly uuid;zero_goal uuid;tons_goal uuid;empty_goal uuid;execution1 uuid;execution2 uuid;baseline_execution uuid;
 request1 uuid:=gen_random_uuid();table_name text;period text;reader uuid;old_date date;
BEGIN
 PERFORM public.billing_rpc('settings','get');
 r=public.billing_rpc('farms','save','{"name":"Períodos independentes","areaHa":"30","city":"Japoatã","state":"SE"}');
 farm=(r->'farm'->>'id')::uuid;
 r=public.billing_rpc('plots','save',jsonb_build_object('farmId',farm,'name','Talhão principal','areaHa','10'));
 plot=(r->'data'->'plots'->0->>'id')::uuid;
 entry_input=jsonb_build_object('module','plantio','farmId',farm,'plotId',plot,'activityType','Plantio por apontamento',
  'plannedStartDate','2026-09-01','plannedEndDate','2026-09-30','areaHa','10','status','planejado',
  'estimatedCost','1000','actualCost','0','expectedProductionTons','100','actualProductionTons','0','notes','Equipe de teste');
 r=public.billing_rpc('planning','save',entry_input);entry=(r->'entry'->>'id')::uuid;
 IF r->'entry'->>'executedAreaHa' IS DISTINCT FROM '0' OR (r->'entry'->>'actualsFromExecutions')::boolean IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'New plan invented an execution';
 END IF;
 r=public.billing_rpc('planning','save',entry_input||jsonb_build_object('activityType','Atividade legada',
  'status','concluido','actualDate','2026-08-31','actualCost','50','actualProductionTons','10'));
 baseline_entry=(r->'entry'->>'id')::uuid;
 IF r->'entry'->>'executedAreaHa' IS DISTINCT FROM '0' OR r->'entry'->>'remainingAreaHa' IS DISTINCT FROM '10' THEN
  RAISE EXCEPTION 'Legacy completion status was converted to measured hectares';
 END IF;
 r=public.billing_rpc('planning','save',entry_input||jsonb_build_object('module','colheita','activityType','Outra modalidade'));
 other_module=(r->'entry'->>'id')::uuid;

 input=jsonb_build_object('title','Meta semanal independente','module','plantio','periodType','semanal',
  'startDate','2026-09-01','endDate','2026-09-07','targetQuantity','2','unit','ha','season','2026/2027',
  'status','ativo','notes','','entryIds',jsonb_build_array(entry));
 r=public.billing_rpc('planning-goals','save',input);weekly=(r->'goal'->>'id')::uuid;
 IF r->'goal'->>'revision' IS DISTINCT FROM '1' OR r->'goal'->>'actualQuantity' IS DISTINCT FROM '0' THEN
  RAISE EXCEPTION 'Goal creation contract invalid';
 END IF;
 r=public.billing_rpc('planning-goals','save',input||jsonb_build_object('title','Meta mensal independente','periodType','mensal','endDate','2026-09-30','targetQuantity','4'));
 monthly=(r->'goal'->>'id')::uuid;
 r=public.billing_rpc('planning-goals','save',input||jsonb_build_object('title','Meta semestral independente','periodType','semestral','startDate','2026-07-01','endDate','2026-12-31','targetQuantity','100'));
 r=public.billing_rpc('planning-goals','save',input||jsonb_build_object('title','Meta zero','periodType','personalizado','startDate','2026-09-03','endDate','2026-09-03','targetQuantity','0'));
 zero_goal=(r->'goal'->>'id')::uuid;
 IF r->'goal'->'completionPercent' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Zero target percentage is not null'; END IF;
 r=public.billing_rpc('planning-goals','save',input||jsonb_build_object('title','Meta em toneladas','periodType','mensal','endDate','2026-09-30','unit','t','targetQuantity','25'));
 tons_goal=(r->'goal'->>'id')::uuid;
 r=public.billing_rpc('planning-goals','save',input||jsonb_build_object('title','Vários vínculos','periodType','mensal','endDate','2026-09-30',
  'entryIds',jsonb_build_array(entry,baseline_entry)));
 IF r->'goal'->>'entryCount' IS DISTINCT FROM '2' OR r->'goal'->>'actualQuantity' IS DISTINCT FROM '0' THEN
  RAISE EXCEPTION 'Many-to-many links or exclusion of legacy baseline failed';
 END IF;

 -- A period type labels a user-selected range. No parent or fixed calendar
 -- duration is required, including for fortnightly/semester/custom goals.
 FOREACH period IN ARRAY ARRAY['diario','quinzenal','bimestral','trimestral','anual','safra','personalizado'] LOOP
  r=public.billing_rpc('planning-goals','save',input||jsonb_build_object('title','Período livre '||period,
   'periodType',period,'startDate','2026-09-02','endDate','2026-09-19','entryIds','[]'::jsonb));
  IF r->'goal'->>'periodType' IS DISTINCT FROM period THEN RAISE EXCEPTION 'Independent period type rejected'; END IF;
  PERFORM public.billing_rpc('planning-goals','delete',jsonb_build_object('id',r->'goal'->>'id','expectedRevision',1));
 END LOOP;
 BEGIN
  PERFORM public.billing_rpc('planning-goals','save',input||jsonb_build_object('entryIds',jsonb_build_array(entry,entry)));
  RAISE EXCEPTION 'Duplicate goal link accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('planning-goals','save',input||jsonb_build_object('entryIds',jsonb_build_array(other_module)));
  RAISE EXCEPTION 'Cross-module goal link accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('planning-goals','save',input||jsonb_build_object('startDate','2026-02-30'));
  RAISE EXCEPTION 'Impossible goal date accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('planning-goals','save',input||jsonb_build_object('targetQuantity','-1'));
  RAISE EXCEPTION 'Negative goal accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

 execution_input=jsonb_build_object('entryId',entry,'performedOn','2026-09-03','areaHa','3','productionTons','30','cost','120','notes','Primeiro trecho','requestId',request1);
 r=public.billing_rpc('planning-executions','save',execution_input);execution1=(r->'execution'->>'id')::uuid;
 IF r->'execution'->>'createdBy' IS DISTINCT FROM auth.uid()::text THEN RAISE EXCEPTION 'Execution author was not taken from auth.uid'; END IF;
 r=public.billing_rpc('planning-executions','save',execution_input);
 IF (r->'execution'->>'id')::uuid IS DISTINCT FROM execution1 THEN RAISE EXCEPTION 'Idempotent retry created a second execution'; END IF;
 BEGIN
  PERFORM public.billing_rpc('planning-executions','save',execution_input||jsonb_build_object('areaHa','4'));
  RAISE EXCEPTION 'Request identifier reused with changed payload';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 r=public.billing_rpc('planning-executions','save',execution_input||jsonb_build_object('performedOn','2026-09-10','areaHa','2','productionTons','20','cost','80','notes','Segundo trecho','requestId',gen_random_uuid()));
 execution2=(r->'execution'->>'id')::uuid;
 r=public.billing_rpc('planning-executions','list',jsonb_build_object('entryId',entry));
 IF r->'summary'->>'areaHa' IS DISTINCT FROM '5' OR r->'summary'->>'executionCount' IS DISTINCT FROM '2'
  OR r->'summary'->>'productionTons' IS DISTINCT FROM '50' OR r->'summary'->>'cost' IS DISTINCT FROM '200' THEN
  RAISE EXCEPTION 'Partial execution 3+2 totals failed';
 END IF;
 r=public.billing_rpc('planning','list','{"search":"Plantio por apontamento"}');
 g=r->'entries'->0;
 IF g->>'executedAreaHa' IS DISTINCT FROM '5' OR g->>'remainingAreaHa' IS DISTINCT FROM '5' OR g->>'status' IS DISTINCT FROM 'em-andamento'
  OR g->>'actualCost' IS DISTINCT FROM '200' OR r->'kpis'->>'completedAreaHa' IS DISTINCT FROM '5' OR r->'kpis'->>'completionPercent' IS DISTINCT FROM '50' THEN
  RAISE EXCEPTION 'Planning partial execution integration failed';
 END IF;
 r=public.billing_rpc('planning-goals','list','{"module":"plantio"}');
 IF r ? 'summary' OR jsonb_array_length(r->'entries')<>3 THEN RAISE EXCEPTION 'Goal list summed overlapping targets or constrained form options'; END IF;
 SELECT value INTO g FROM jsonb_array_elements(r->'goals') WHERE value->>'id'=weekly::text;
 IF g->>'actualQuantity' IS DISTINCT FROM '3' OR g->>'remainingQuantity' IS DISTINCT FROM '0'
  OR g->>'differenceQuantity' IS DISTINCT FROM '1' OR g->>'completionPercent' IS DISTINCT FROM '150' THEN
  RAISE EXCEPTION 'Weekly goal date boundary or allowed target overrun failed';
 END IF;
 SELECT value INTO g FROM jsonb_array_elements(r->'goals') WHERE value->>'id'=monthly::text;
 IF g->>'actualQuantity' IS DISTINCT FROM '5' OR g->>'completionPercent' IS DISTINCT FROM '125' THEN
  RAISE EXCEPTION 'Monthly period did not independently include both executions';
 END IF;
 SELECT value INTO g FROM jsonb_array_elements(r->'goals') WHERE value->>'id'=zero_goal::text;
 IF g->>'actualQuantity' IS DISTINCT FROM '3' OR g->'completionPercent' IS DISTINCT FROM 'null'::jsonb THEN
  RAISE EXCEPTION 'Zero target with actual execution divided by zero';
 END IF;
 SELECT value INTO g FROM jsonb_array_elements(r->'goals') WHERE value->>'id'=tons_goal::text;
 IF g->>'actualQuantity' IS DISTINCT FROM '50' OR g->>'unit' IS DISTINCT FROM 't' THEN RAISE EXCEPTION 'Tonnage goal used hectares'; END IF;

 BEGIN
  PERFORM public.billing_rpc('planning-executions','save',execution_input||jsonb_build_object('areaHa','5.000001','requestId',gen_random_uuid()));
  RAISE EXCEPTION 'Activity capacity overrun accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('planning-executions','save',execution_input||jsonb_build_object('areaHa','0','requestId',gen_random_uuid()));
  RAISE EXCEPTION 'Zero execution area accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('plots','save',jsonb_build_object('id',plot,'farmId',farm,'name','Talhão principal','areaHa','9'));
  RAISE EXCEPTION 'Plot shrunk below linked activity capacity';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('planning','delete',jsonb_build_object('id',entry));
  RAISE EXCEPTION 'Activity with goals/executions deleted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('plots','delete',jsonb_build_object('id',plot,'farmId',farm));
  RAISE EXCEPTION 'Plot cascade destroyed execution history';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('planning','save',entry_input||jsonb_build_object('id',entry,'actualCost','500'));
  RAISE EXCEPTION 'Manual override of execution-derived actuals accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 entry_input=(entry_input-ARRAY['status','actualDate','actualCost','actualProductionTons'])||jsonb_build_object('id',entry);
 BEGIN
  PERFORM public.billing_rpc('planning','save',entry_input||jsonb_build_object('areaHa','4'));
  RAISE EXCEPTION 'Plan shrunk below executed area';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('planning','save',entry_input||jsonb_build_object('activityType','Identidade alterada'));
  RAISE EXCEPTION 'Executed operation identity changed';
 EXCEPTION WHEN check_violation THEN NULL; END;
 r=public.billing_rpc('planning','save',entry_input||jsonb_build_object('notes','Reprogramação preserva realizados','plannedEndDate','2026-10-02'));
 IF r->'entry'->>'actualCost' IS DISTINCT FROM '200' OR r->'entry'->>'actualProductionTons' IS DISTINCT FROM '50'
  OR r->'entry'->>'status' IS DISTINCT FROM 'em-andamento' THEN RAISE EXCEPTION 'Plan edit erased ledger-derived actuals'; END IF;

 revision_input=input||jsonb_build_object('id',weekly,'expectedRevision',1,'targetQuantity','4','revisionReason','Revisão do período');
 r=public.billing_rpc('planning-goals','save',revision_input);
 IF r->'goal'->>'revision' IS DISTINCT FROM '2' OR r->'goal'->>'remainingQuantity' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Goal revision not applied'; END IF;
 BEGIN
  PERFORM public.billing_rpc('planning-goals','save',revision_input);
  RAISE EXCEPTION 'Stale goal revision overwrote newer state';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('planning-goals','delete',jsonb_build_object('id',weekly,'expectedRevision',1));
  RAISE EXCEPTION 'Stale goal delete accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 r=public.billing_rpc('planning-goals','history',jsonb_build_object('id',weekly));
 IF jsonb_array_length(r->'revisions')<>2 OR r->'revisions'->0->>'revision' IS DISTINCT FROM '2'
  OR r->'revisions'->1->'snapshot'->>'targetQuantity' IS DISTINCT FROM '2'
  OR r->'revisions'->0->>'createdAt' IS NULL OR r->'revisions'->0->'snapshot'->>'revisionReason' IS DISTINCT FROM 'Revisão do período' THEN
  RAISE EXCEPTION 'Goal revision audit lost previous target or camelCase snapshot';
 END IF;
 -- Even if a later revision removes all links, a goal with execution history
 -- must be cancelled rather than deleted.
 r=public.billing_rpc('planning-goals','save',revision_input||jsonb_build_object('expectedRevision',2,'entryIds','[]'::jsonb,'revisionReason','Desvinculação revisada'));
 BEGIN
  PERFORM public.billing_rpc('planning-goals','delete',jsonb_build_object('id',weekly,'expectedRevision',3));
  RAISE EXCEPTION 'Unlinking allowed deletion of historically executed goal';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 r=public.billing_rpc('planning-goals','save',revision_input||jsonb_build_object('expectedRevision',3,'status','cancelado','revisionReason','Cancelamento justificado'));
 IF r->'goal'->>'status' IS DISTINCT FROM 'cancelado' OR r->'goal'->>'revision' IS DISTINCT FROM '4' THEN
  RAISE EXCEPTION 'Goal cancellation lost revision history';
 END IF;

 r=public.billing_rpc('planning-executions','void',jsonb_build_object('id',execution1,'reason','Correção de lançamento'));
 IF r->'execution'->>'voidedAt' IS NULL OR r->'execution'->>'voidReason' IS DISTINCT FROM 'Correção de lançamento' THEN
  RAISE EXCEPTION 'Execution void lost audit information';
 END IF;
 PERFORM public.billing_rpc('planning-executions','void',jsonb_build_object('id',execution1,'reason','Correção de lançamento'));
 r=public.billing_rpc('planning-executions','save',execution_input);
 IF (r->'execution'->>'id')::uuid IS DISTINCT FROM execution1 OR r->'execution'->>'voidedAt' IS NULL THEN
  RAISE EXCEPTION 'Retry resurrected a voided execution';
 END IF;
 r=public.billing_rpc('planning-executions','list',jsonb_build_object('entryId',entry,'dateFrom','2026-09-01','dateTo','2026-09-30'));
 IF jsonb_array_length(r->'executions')<>2 OR r->'summary'->>'executionCount' IS DISTINCT FROM '1'
  OR r->'summary'->>'areaHa' IS DISTINCT FROM '2' OR r->'summary'->>'productionTons' IS DISTINCT FROM '20'
  OR r->'summary'->>'cost' IS DISTINCT FROM '80' OR jsonb_array_length(r->'entries')<>3 THEN
  RAISE EXCEPTION 'Void did not recalculate valid-only summary while preserving audit/options';
 END IF;
 r=public.billing_rpc('planning-goals','list','{"periodType":"mensal"}');
 SELECT value INTO g FROM jsonb_array_elements(r->'goals') WHERE value->>'id'=monthly::text;
 IF g->>'actualQuantity' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'Goal still counts a voided execution'; END IF;

 -- Preserve legacy cost/tonnage without fabricating legacy area or including
 -- those undated tonnes in a goal or the measured execution yield.
 r=public.billing_rpc('planning-executions','save',jsonb_build_object('entryId',baseline_entry,'performedOn','2026-09-04',
  'areaHa','1','productionTons','3','cost','20','notes','Adoção com saldo legado','requestId',gen_random_uuid()));
 baseline_execution=(r->'execution'->>'id')::uuid;
 r=public.billing_rpc('planning','list','{"search":"Atividade legada"}');g=r->'entries'->0;
 IF g->>'actualCost' IS DISTINCT FROM '70' OR g->>'actualProductionTons' IS DISTINCT FROM '13'
  OR g->>'legacyActualCost' IS DISTINCT FROM '50' OR g->>'legacyActualProductionTons' IS DISTINCT FROM '10'
  OR g->>'executedAreaHa' IS DISTINCT FROM '1' OR r->'kpis'->>'yieldTonsPerHa' IS DISTINCT FROM '3' THEN
  RAISE EXCEPTION 'Legacy baseline was lost, double-counted or used as measured yield';
 END IF;
 PERFORM public.billing_rpc('planning-executions','void',jsonb_build_object('id',baseline_execution,'reason','Reversão da adoção parcial'));
 r=public.billing_rpc('planning','list','{"search":"Atividade legada"}');g=r->'entries'->0;
 IF g->>'actualCost' IS DISTINCT FROM '50' OR g->>'actualProductionTons' IS DISTINCT FROM '10'
  OR g->>'actualDate' IS DISTINCT FROM '2026-08-31' OR g->>'status' IS DISTINCT FROM 'concluido'
  OR g->>'executedAreaHa' IS DISTINCT FROM '0' OR (g->>'actualsFromExecutions')::boolean IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Voiding all measured execution failed to preserve legacy state';
 END IF;

 FOREACH table_name IN ARRAY ARRAY['billing_planning_goals','billing_planning_goal_entries','billing_planning_goal_revisions','billing_planning_executions'] LOOP
  BEGIN EXECUTE format('INSERT INTO public.%I DEFAULT VALUES',table_name);RAISE EXCEPTION 'Direct INSERT accepted on %',table_name;
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  BEGIN EXECUTE format('UPDATE public.%I SET owner_id=owner_id',table_name);RAISE EXCEPTION 'Direct UPDATE accepted on %',table_name;
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  BEGIN EXECUTE format('DELETE FROM public.%I',table_name);RAISE EXCEPTION 'Direct DELETE accepted on %',table_name;
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 END LOOP;
 BEGIN
  PERFORM public.billing_rpc('planning-executions','save',execution_input||jsonb_build_object('ownerId',auth.uid()));
  RAISE EXCEPTION 'Unknown execution owner field accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN
  PERFORM public.billing_rpc('planning-goals','save',input||jsonb_build_object('owner_id',auth.uid()));
  RAISE EXCEPTION 'Unknown goal owner field accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN
  PERFORM billing_private.planning_dispatch_before_executions('list','{}');
  RAISE EXCEPTION 'Legacy private dispatcher remained callable';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;

 PERFORM set_config('planning.test.entry',entry::text,true);
 PERFORM set_config('planning.test.goal',weekly::text,true);
 PERFORM set_config('planning.test.execution',execution2::text,true);
 r=public.billing_rpc('access-profiles','list');
 SELECT (value->>'id')::uuid INTO reader FROM jsonb_array_elements(r->'profiles') WHERE value->>'name'='Somente leitura';
 PERFORM public.billing_rpc('users','invite',jsonb_build_object('email','planning-periods-reader@example.invalid','accessProfileId',reader));
END $$;

SELECT set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666661',true);
DO $$ DECLARE r jsonb;entry uuid:=current_setting('planning.test.entry')::uuid;goal uuid:=current_setting('planning.test.goal')::uuid;
 execution uuid:=current_setting('planning.test.execution')::uuid;table_name text;n integer;
BEGIN
 PERFORM public.billing_rpc('settings','get');
 r=public.billing_rpc('planning-goals','list','{}');
 IF jsonb_array_length(r->'goals')<>0 OR jsonb_array_length(r->'entries')<>0 THEN RAISE EXCEPTION 'Goal RPC leaked other owner data'; END IF;
 r=public.billing_rpc('planning-executions','list','{}');
 IF jsonb_array_length(r->'executions')<>0 OR jsonb_array_length(r->'entries')<>0 OR r->'summary'->>'areaHa' IS DISTINCT FROM '0' THEN
  RAISE EXCEPTION 'Execution RPC leaked other owner data';
 END IF;
 FOREACH table_name IN ARRAY ARRAY['billing_planning_goals','billing_planning_goal_entries','billing_planning_goal_revisions','billing_planning_executions'] LOOP
  EXECUTE format('SELECT count(*) FROM public.%I',table_name) INTO n;
  IF n<>0 THEN RAISE EXCEPTION 'RLS leaked table %',table_name;END IF;
 END LOOP;
 BEGIN
  PERFORM public.billing_rpc('planning-goals','history',jsonb_build_object('id',goal));
  RAISE EXCEPTION 'Cross-owner goal history accepted';
 EXCEPTION WHEN no_data_found THEN NULL;END;
 BEGIN
  PERFORM public.billing_rpc('planning-goals','delete',jsonb_build_object('id',goal,'expectedRevision',4));
  RAISE EXCEPTION 'Cross-owner goal delete accepted';
 EXCEPTION WHEN no_data_found THEN NULL;END;
 BEGIN
  PERFORM public.billing_rpc('planning-goals','save',jsonb_build_object('title','Vínculo cruzado','module','plantio','periodType','semanal',
   'startDate','2026-09-01','endDate','2026-09-07','targetQuantity','10','unit','ha','status','ativo','entryIds',jsonb_build_array(entry)));
  RAISE EXCEPTION 'Cross-owner entry linked to goal';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN
  PERFORM public.billing_rpc('planning-executions','save',jsonb_build_object('entryId',entry,'performedOn','2026-09-03','areaHa','1',
   'productionTons','0','cost','0','notes','','requestId',gen_random_uuid()));
  RAISE EXCEPTION 'Cross-owner execution accepted';
 EXCEPTION WHEN no_data_found THEN NULL;END;
 BEGIN
  PERFORM public.billing_rpc('planning-executions','void',jsonb_build_object('id',execution,'reason','Tentativa de outro espaço'));
  RAISE EXCEPTION 'Cross-owner execution void accepted';
 EXCEPTION WHEN no_data_found THEN NULL;END;
END $$;

RESET ROLE;
INSERT INTO auth.users(id,email,email_confirmed_at)
 VALUES('77777777-7777-4777-8777-777777777771','planning-periods-reader@example.invalid',now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777771',true);
DO $$ DECLARE r jsonb;BEGIN
 PERFORM public.billing_rpc('settings','get');
 r=public.billing_rpc('planning-goals','list','{}');
 IF jsonb_array_length(r->'goals')=0 OR (r->>'canWrite')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'Read-only goal access invalid';END IF;
 r=public.billing_rpc('planning-executions','list','{}');
 IF jsonb_array_length(r->'executions')=0 OR (r->>'canWrite')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'Read-only execution access invalid';END IF;
 BEGIN PERFORM public.billing_rpc('planning-goals','save','{}');RAISE EXCEPTION 'Reader wrote goals';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('planning-executions','save','{}');RAISE EXCEPTION 'Reader wrote executions';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('planning-executions','void','{}');RAISE EXCEPTION 'Reader voided execution';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ BEGIN
 BEGIN PERFORM public.billing_rpc('planning-goals','list','{}');RAISE EXCEPTION 'Missing session accessed goals';EXCEPTION WHEN invalid_authorization_specification THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('planning-executions','list','{}');RAISE EXCEPTION 'Missing session accessed executions';EXCEPTION WHEN invalid_authorization_specification THEN NULL;END;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.billing_rpc('planning-goals','list','{}');RAISE EXCEPTION 'Anonymous goal RPC accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM 1 FROM public.billing_planning_executions;RAISE EXCEPTION 'Anonymous execution SELECT accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
ROLLBACK;
