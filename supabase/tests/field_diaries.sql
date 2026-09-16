-- Independent local/ephemeral fixtures. Every record and auth identity rolls back.
BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('88888888-8888-4888-8888-888888888881','field-diaries-one@example.invalid'),
 ('99999999-9999-4999-8999-999999999991','field-diaries-two@example.invalid');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999991',true);
DO $$ DECLARE r jsonb;farm uuid;plot uuid;entry uuid;BEGIN
 PERFORM public.billing_rpc('settings','get');
 r=public.billing_rpc('farms','save','{"name":"Fazenda de outro proprietário","areaHa":"10","city":"Japoatã","state":"SE"}');
 farm=(r->'farm'->>'id')::uuid;
 r=public.billing_rpc('plots','save',jsonb_build_object('farmId',farm,'name','Talhão externo','areaHa','10'));
 plot=(r->'data'->'plots'->0->>'id')::uuid;
 r=public.billing_rpc('planning','save',jsonb_build_object('module','plantio','farmId',farm,'plotId',plot,
  'activityType','Plantio externo','plannedStartDate','2026-09-01','plannedEndDate','2026-09-30',
  'areaHa','10','status','planejado','notes',''));
 entry=(r->'entry'->>'id')::uuid;
 r=public.billing_rpc('planning-executions','save',jsonb_build_object('entryId',entry,'performedOn','2026-09-01',
  'areaHa','3','productionTons','30','cost','90','notes','Diário externo','requestId',gen_random_uuid(),
  'crewName','Turma Externa','lotReference','Lote externo','responsibleName','Responsável externo',
  'season','2026/2027','workMode','manual','executionStructure','terceirizada'));
 PERFORM set_config('diaries.test.other_farm',farm::text,true);
 PERFORM set_config('diaries.test.other_plot',plot::text,true);
 PERFORM set_config('diaries.test.other_entry',entry::text,true);
 PERFORM set_config('diaries.test.other_execution',r->'execution'->>'id',true);
END $$;

SELECT set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888881',true);
DO $$
DECLARE
 r jsonb;g jsonb;p jsonb;entry_input jsonb;execution_input jsonb;goal_input jsonb;changes jsonb;
 farm_a uuid;farm_b uuid;plot_a uuid;plot_a2 uuid;plot_b uuid;entry_a uuid;entry_b uuid;entry_c uuid;legacy_entry uuid;
 goal_month uuid;goal_week uuid;execution_a1 uuid;execution_a2 uuid;legacy_execution uuid;
 request_a1 uuid:=gen_random_uuid();metadata_key text;changed_value text;before_count integer;
BEGIN
 PERFORM public.billing_rpc('settings','get');
 r=public.billing_rpc('farms','save','{"name":"Fazenda Alfa","areaHa":"20","city":"Japoatã","state":"SE"}');farm_a=(r->'farm'->>'id')::uuid;
 r=public.billing_rpc('plots','save',jsonb_build_object('farmId',farm_a,'name','Talhão Alfa 1','areaHa','10'));plot_a=(r->'data'->'plots'->0->>'id')::uuid;
 r=public.billing_rpc('plots','save',jsonb_build_object('farmId',farm_a,'name','Talhão Alfa 2','areaHa','10'));
 SELECT (value->>'id')::uuid INTO plot_a2 FROM jsonb_array_elements(r->'data'->'plots') WHERE value->>'name'='Talhão Alfa 2';
 r=public.billing_rpc('farms','save','{"name":"Fazenda Beta","areaHa":"10","city":"Japoatã","state":"SE"}');farm_b=(r->'farm'->>'id')::uuid;
 r=public.billing_rpc('plots','save',jsonb_build_object('farmId',farm_b,'name','Talhão Beta 1','areaHa','10'));plot_b=(r->'data'->'plots'->0->>'id')::uuid;
 entry_input=jsonb_build_object('module','plantio','farmId',farm_a,'plotId',plot_a,'activityType','Plantio em campo',
  'plannedStartDate','2026-09-01','plannedEndDate','2026-09-30','areaHa','10','status','planejado',
  'estimatedCost','100','actualCost','0','expectedProductionTons','100','actualProductionTons','0','notes','Diário detalhado');
 r=public.billing_rpc('planning','save',entry_input);entry_a=(r->'entry'->>'id')::uuid;
 r=public.billing_rpc('planning','save',entry_input||jsonb_build_object('farmId',farm_b,'plotId',plot_b));entry_b=(r->'entry'->>'id')::uuid;
 r=public.billing_rpc('planning','save',entry_input||jsonb_build_object('module','manejo-do-canavial','plotId',plot_a2,'activityType','Adubação'));entry_c=(r->'entry'->>'id')::uuid;
 r=public.billing_rpc('planning','save',entry_input||jsonb_build_object('activityType','Compatibilidade de apontamento legado'));legacy_entry=(r->'entry'->>'id')::uuid;

 -- The same activity belongs to two independent goals. Group totals must not
 -- multiply execution rows by the number of linked goals.
 goal_input=jsonb_build_object('title','Diário mensal','module','plantio','periodType','mensal',
  'startDate','2026-09-01','endDate','2026-09-30','targetQuantity','8','unit','ha','season','2026/2027',
  'status','ativo','notes','','entryIds',jsonb_build_array(entry_a));
 r=public.billing_rpc('planning-goals','save',goal_input);goal_month=(r->'goal'->>'id')::uuid;
 r=public.billing_rpc('planning-goals','save',goal_input||jsonb_build_object('title','Diário semanal','periodType','semanal','endDate','2026-09-07'));
 goal_week=(r->'goal'->>'id')::uuid;

 execution_input=jsonb_build_object('entryId',entry_a,'performedOn','2026-09-01','areaHa','3.123456',
  'productionTons','31.234567','cost','12.345678','notes','Primeiro trecho','requestId',request_a1,
  'crewName','Turma Alfa','lotReference','Lote 01','responsibleName','João de Campo',
  'season','2026/2027','workMode','manual','executionStructure','terceirizada');
 r=public.billing_rpc('planning-executions','save',execution_input);execution_a1=(r->'execution'->>'id')::uuid;g=r->'execution';
 IF g->>'farmId' IS DISTINCT FROM farm_a::text OR g->>'plotId' IS DISTINCT FROM plot_a::text
  OR g->>'crewName' IS DISTINCT FROM 'Turma Alfa' OR g->>'lotReference' IS DISTINCT FROM 'Lote 01'
  OR g->>'responsibleName' IS DISTINCT FROM 'João de Campo' OR g->>'season' IS DISTINCT FROM '2026/2027'
  OR g->>'workMode' IS DISTINCT FROM 'manual' OR g->>'executionStructure' IS DISTINCT FROM 'terceirizada' THEN
  RAISE EXCEPTION 'Diary presenter lost identifiers or operational metadata';
 END IF;
 r=public.billing_rpc('planning-executions','save',execution_input);
 IF (r->'execution'->>'id')::uuid IS DISTINCT FROM execution_a1 THEN RAISE EXCEPTION 'Exact diary retry created a duplicate'; END IF;
 changes='{"crewName":"Outra turma","lotReference":"Outro lote","responsibleName":"Outro responsável","season":"2027/2028","workMode":"semimecanizado","executionStructure":"propria"}';
 FOR metadata_key,changed_value IN SELECT key,value FROM jsonb_each_text(changes) LOOP
  BEGIN
   PERFORM public.billing_rpc('planning-executions','save',execution_input||jsonb_build_object(metadata_key,changed_value));
   RAISE EXCEPTION 'Diary retry accepted changed metadata: %',metadata_key;
  EXCEPTION WHEN unique_violation THEN NULL;END;
 END LOOP;
 r=public.billing_rpc('planning-executions','save',execution_input||jsonb_build_object('performedOn','2026-09-02',
  'areaHa','2.000001','productionTons','20.000001','cost','8.000001','notes','Segundo trecho',
  'lotReference','Lote 02','responsibleName','Maria de Campo','requestId',gen_random_uuid()));
 execution_a2=(r->'execution'->>'id')::uuid;
 PERFORM public.billing_rpc('planning-executions','save',execution_input||jsonb_build_object('entryId',entry_b,'areaHa','1',
  'productionTons','10','cost','4','notes','Outra fazenda, mesma turma','lotReference','Lote 03','requestId',gen_random_uuid()));
 PERFORM public.billing_rpc('planning-executions','save',execution_input||jsonb_build_object('entryId',entry_b,'performedOn','2026-09-03',
  'areaHa','0.5','productionTons','5','cost','2','notes','Modalidade mecanizada','lotReference','Lote 04',
  'workMode','mecanizado','executionStructure','propria','requestId',gen_random_uuid()));
 PERFORM public.billing_rpc('planning-executions','save',execution_input||jsonb_build_object('entryId',entry_b,'performedOn','2026-09-04',
  'areaHa','0.25','productionTons','2.5','cost','1','notes','Outra safra','lotReference','Lote 05',
  'season','2027/2028','requestId',gen_random_uuid()));
 PERFORM public.billing_rpc('planning-executions','save',execution_input||jsonb_build_object('entryId',entry_c,'performedOn','2026-09-05',
  'areaHa','0.75','productionTons','0','cost','3','notes','Manejo em outro talhão','lotReference','Gleba Norte',
  'crewName','Turma Beta','responsibleName','Paulo de Campo','requestId',gen_random_uuid()));

 r=public.billing_rpc('planning-executions','list','{}');
 IF jsonb_array_length(r->'executions')<>6 OR jsonb_array_length(r->'groups')<>4 OR jsonb_array_length(r->'entries')<>4
  OR r->'summary'->>'executionCount' IS DISTINCT FROM '6' OR r->'summary'->>'areaHa' IS DISTINCT FROM '7.623457'
  OR r->'summary'->>'productionTons' IS DISTINCT FROM '68.734568' OR r->'summary'->>'cost' IS DISTINCT FROM '30.345679' THEN
  RAISE EXCEPTION 'Detailed diaries did not produce exact distinct summary/group totals';
 END IF;
 SELECT value INTO g FROM jsonb_array_elements(r->'groups') WHERE value->>'module'='plantio' AND value->>'activityType'='Plantio em campo'
  AND value->>'season'='2026/2027' AND value->>'crewName'='Turma Alfa' AND value->>'workMode'='manual' AND value->>'executionStructure'='terceirizada';
 IF g IS NULL OR g->>'executionCount' IS DISTINCT FROM '3' OR g->>'areaHa' IS DISTINCT FROM '6.123457'
  OR g->>'productionTons' IS DISTINCT FROM '61.234568' OR g->>'cost' IS DISTINCT FROM '24.345679' THEN
  RAISE EXCEPTION 'Groups duplicated goals or incorrectly split by farm/lot/responsible';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'groups') x WHERE jsonb_typeof(x->'areaHa')<>'string'
  OR jsonb_typeof(x->'productionTons')<>'string' OR jsonb_typeof(x->'cost')<>'string') THEN
  RAISE EXCEPTION 'Group decimal values were not returned as strings';
 END IF;
 r=public.billing_rpc('planning-goals','list','{}');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'goals') x
  WHERE x->>'id' IN(goal_month::text,goal_week::text) AND x->>'actualQuantity'<>'5.123457') THEN
  RAISE EXCEPTION 'Diary metadata changed execution-to-goal totals';
 END IF;

 r=public.billing_rpc('planning-executions','list',jsonb_build_object('farmId',farm_a));
 IF r->'summary'->>'executionCount' IS DISTINCT FROM '3' OR r->'summary'->>'areaHa' IS DISTINCT FROM '5.873457'
  OR jsonb_array_length(r->'groups')<>2 OR jsonb_array_length(r->'entries')<>4 THEN RAISE EXCEPTION 'Farm filter failed or reduced editor options'; END IF;
 r=public.billing_rpc('planning-executions','list',jsonb_build_object('plotId',plot_a));
 IF r->'summary'->>'executionCount' IS DISTINCT FROM '2' OR r->'summary'->>'areaHa' IS DISTINCT FROM '5.123457'
  OR jsonb_array_length(r->'groups')<>1 THEN RAISE EXCEPTION 'Plot filter failed'; END IF;
 r=public.billing_rpc('planning-executions','list','{"crewName":"aLf"}');
 IF r->'summary'->>'executionCount' IS DISTINCT FROM '5' OR r->'summary'->>'areaHa' IS DISTINCT FROM '6.873457' THEN RAISE EXCEPTION 'Crew partial case-insensitive filter failed'; END IF;
 r=public.billing_rpc('planning-executions','list','{"lotReference":"02"}');
 IF r->'summary'->>'executionCount' IS DISTINCT FROM '1' OR r->'summary'->>'areaHa' IS DISTINCT FROM '2.000001' THEN RAISE EXCEPTION 'Lot partial filter failed'; END IF;
 r=public.billing_rpc('planning-executions','list','{"season":"2026"}');
 IF r->'summary'->>'executionCount' IS DISTINCT FROM '5' OR r->'summary'->>'areaHa' IS DISTINCT FROM '7.373457' THEN RAISE EXCEPTION 'Season partial filter failed'; END IF;
 r=public.billing_rpc('planning-executions','list','{"workMode":"manual"}');
 IF r->'summary'->>'executionCount' IS DISTINCT FROM '5' THEN RAISE EXCEPTION 'Work-mode exact filter failed'; END IF;
 r=public.billing_rpc('planning-executions','list','{"executionStructure":"propria"}');
 IF r->'summary'->>'executionCount' IS DISTINCT FROM '1' OR r->'summary'->>'areaHa' IS DISTINCT FROM '0.5' THEN RAISE EXCEPTION 'Execution-structure filter failed'; END IF;
 r=public.billing_rpc('planning-executions','list','{"search":"MARIA"}');
 IF r->'summary'->>'executionCount' IS DISTINCT FROM '1' OR (r->'executions'->0->>'id')::uuid IS DISTINCT FROM execution_a2 THEN RAISE EXCEPTION 'Search did not include responsible metadata'; END IF;
 r=public.billing_rpc('planning-executions','list',jsonb_build_object('farmId',farm_a,'plotId',plot_a,'entryId',entry_a,
  'module','plantio','dateFrom','2026-09-02','dateTo','2026-09-02','crewName','ALFA','lotReference','02',
  'season','2026','workMode','manual','executionStructure','terceirizada'));
 IF r->'summary'->>'executionCount' IS DISTINCT FROM '1' OR r->'summary'->>'areaHa' IS DISTINCT FROM '2.000001'
  OR r->'groups'->0->>'areaHa' IS DISTINCT FROM '2.000001' THEN RAISE EXCEPTION 'Combined legacy/new filters diverged from group totals'; END IF;

 -- Supplied crew names are required; legacy callers which omit the key keep
 -- working. Length limits and enums are enforced by the RPC, not only the form.
 changes=jsonb_build_array(jsonb_build_object('crewName',''),jsonb_build_object('crewName','A'),
  jsonb_build_object('crewName',NULL),jsonb_build_object('crewName','  '),jsonb_build_object('crewName',repeat('a',101)),
  jsonb_build_object('lotReference',repeat('a',101)),jsonb_build_object('responsibleName',repeat('a',121)),
  jsonb_build_object('season',repeat('a',81)),jsonb_build_object('workMode','MANUAL'),jsonb_build_object('executionStructure','externa'));
 FOR p IN SELECT value FROM jsonb_array_elements(changes) LOOP
  BEGIN
   PERFORM public.billing_rpc('planning-executions','save',execution_input||jsonb_build_object('areaHa','0.01','requestId',gen_random_uuid())||p);
   RAISE EXCEPTION 'Invalid diary metadata accepted: %',p;
  EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 END LOOP;
 BEGIN
  PERFORM public.billing_rpc('planning-executions','list','{"workMode":"man"}');RAISE EXCEPTION 'Partial work-mode enum accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN
  PERFORM public.billing_rpc('planning-executions','list','{"executionStructure":"terc"}');RAISE EXCEPTION 'Partial execution-structure enum accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;END;

 p=jsonb_build_object('entryId',legacy_entry,'performedOn','2026-09-06','areaHa','0.1','productionTons','0','cost','0',
  'notes','Compatibilidade sem turma','requestId',gen_random_uuid());
 r=public.billing_rpc('planning-executions','save',p);legacy_execution=(r->'execution'->>'id')::uuid;g=r->'execution';
 IF g->>'crewName' IS DISTINCT FROM '' OR g->>'lotReference' IS DISTINCT FROM '' OR g->>'responsibleName' IS DISTINCT FROM ''
  OR g->>'season' IS DISTINCT FROM '' OR g->>'workMode' IS DISTINCT FROM '' OR g->>'executionStructure' IS DISTINCT FROM '' THEN
  RAISE EXCEPTION 'Legacy execution payload did not receive empty metadata defaults';
 END IF;
 r=public.billing_rpc('planning-executions','save',p);
 IF (r->'execution'->>'id')::uuid IS DISTINCT FROM legacy_execution THEN RAISE EXCEPTION 'Legacy retry duplicated execution'; END IF;
 PERFORM public.billing_rpc('planning-executions','void',jsonb_build_object('id',legacy_execution,'reason','Anulação do teste legado'));

 r=public.billing_rpc('planning-executions','void',jsonb_build_object('id',execution_a1,'reason','Correção da área do diário'));
 IF r->'execution'->>'crewName' IS DISTINCT FROM 'Turma Alfa' OR r->'execution'->>'responsibleName' IS DISTINCT FROM 'João de Campo'
  OR r->'execution'->>'voidedAt' IS NULL THEN RAISE EXCEPTION 'Void lost diary metadata'; END IF;
 r=public.billing_rpc('planning-executions','save',execution_input);
 IF (r->'execution'->>'id')::uuid IS DISTINCT FROM execution_a1 OR r->'execution'->>'voidedAt' IS NULL THEN RAISE EXCEPTION 'Diary retry resurrected a voided record'; END IF;
 r=public.billing_rpc('planning-executions','list',jsonb_build_object('entryId',entry_a));
 IF jsonb_array_length(r->'executions')<>2 OR r->'summary'->>'executionCount' IS DISTINCT FROM '1'
  OR r->'summary'->>'areaHa' IS DISTINCT FROM '2.000001' OR jsonb_array_length(r->'groups')<>1
  OR r->'groups'->0->>'areaHa' IS DISTINCT FROM '2.000001' THEN RAISE EXCEPTION 'Diary void did not recalculate partial area/group from same activity'; END IF;
 r=public.billing_rpc('planning-goals','list','{}');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'goals') x
  WHERE x->>'id' IN(goal_month::text,goal_week::text) AND x->>'actualQuantity'<>'2.000001') THEN RAISE EXCEPTION 'Voided diary still contributes to goals'; END IF;
 r=public.billing_rpc('planning-executions','list','{}');
 IF r->'summary'->>'executionCount' IS DISTINCT FROM '5' OR r->'summary'->>'areaHa' IS DISTINCT FROM '4.500001'
  OR r->'summary'->>'productionTons' IS DISTINCT FROM '37.500001' OR r->'summary'->>'cost' IS DISTINCT FROM '18.000001'
  OR jsonb_array_length(r->'groups')<>4 THEN RAISE EXCEPTION 'Global diary totals include voided executions'; END IF;

 r=public.billing_rpc('planning-executions','list',jsonb_build_object('farmId',current_setting('diaries.test.other_farm')));
 IF jsonb_array_length(r->'executions')<>0 OR jsonb_array_length(r->'groups')<>0 OR r->'summary'->>'areaHa' IS DISTINCT FROM '0'
  OR jsonb_array_length(r->'entries')<>4 THEN RAISE EXCEPTION 'Cross-owner farm filter exposed diary data/options'; END IF;
 r=public.billing_rpc('planning-executions','list',jsonb_build_object('plotId',current_setting('diaries.test.other_plot')));
 IF jsonb_array_length(r->'executions')<>0 OR jsonb_array_length(r->'groups')<>0 THEN RAISE EXCEPTION 'Cross-owner plot filter exposed diary data'; END IF;
 BEGIN
  PERFORM public.billing_rpc('planning-executions','save',execution_input||jsonb_build_object('entryId',current_setting('diaries.test.other_entry'),'requestId',gen_random_uuid()));
  RAISE EXCEPTION 'Cross-owner detailed execution accepted';
 EXCEPTION WHEN no_data_found THEN NULL;END;
 BEGIN
  PERFORM public.billing_rpc('planning-executions','save',execution_input||jsonb_build_object('ownerId',current_setting('request.jwt.claim.sub'),'requestId',gen_random_uuid()));
  RAISE EXCEPTION 'Owner override field accepted in diary payload';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN
  UPDATE public.billing_planning_executions SET crew_name='Alteração direta';RAISE EXCEPTION 'Direct diary metadata DML accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM set_config('diaries.test.farm',farm_a::text,true);
 PERFORM set_config('diaries.test.execution',execution_a2::text,true);
END $$;

SELECT set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999991',true);
DO $$ DECLARE r jsonb;BEGIN
 r=public.billing_rpc('planning-executions','list','{}');
 IF jsonb_array_length(r->'executions')<>1 OR jsonb_array_length(r->'groups')<>1 OR r->'summary'->>'areaHa' IS DISTINCT FROM '3'
  OR r->'groups'->0->>'crewName' IS DISTINCT FROM 'Turma Externa' OR jsonb_array_length(r->'entries')<>1 THEN
  RAISE EXCEPTION 'Detailed diary groups leaked another owner';
 END IF;
 r=public.billing_rpc('planning-executions','list',jsonb_build_object('farmId',current_setting('diaries.test.farm')));
 IF jsonb_array_length(r->'executions')<>0 OR jsonb_array_length(r->'groups')<>0 OR r->'summary'->>'areaHa' IS DISTINCT FROM '0' THEN
  RAISE EXCEPTION 'Reverse cross-owner farm filter leaked diary totals';
 END IF;
 BEGIN
  PERFORM public.billing_rpc('planning-executions','void',jsonb_build_object('id',current_setting('diaries.test.execution'),'reason','Tentativa de outra conta'));
  RAISE EXCEPTION 'Cross-owner diary void accepted';
 EXCEPTION WHEN no_data_found THEN NULL;END;
 IF (SELECT count(*) FROM public.billing_planning_executions)<>1 THEN RAISE EXCEPTION 'Diary SELECT bypassed RLS'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
