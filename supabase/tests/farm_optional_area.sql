-- Disposable accounts and all data are rolled back, including on remote runs.
BEGIN;
RESET ROLE;
DO $$
DECLARE actor uuid;
BEGIN
 FOR i IN 1..2 LOOP
  actor=gen_random_uuid();
  PERFORM set_config('billing.test.area_actor_'||i,actor::text,true);
  INSERT INTO auth.users(id,email,email_confirmed_at)
   VALUES(actor,'farm-area-'||actor||'@example.invalid',now());
  PERFORM billing_private.create_workspace_defaults(actor);
  INSERT INTO public.billing_memberships(owner_id,user_id,is_owner,status) VALUES(actor,actor,true,'active');
  INSERT INTO public.billing_user_settings(user_id,owner_id,name,onboarding_completed_at) VALUES(actor,actor,'Area test',now());
 END LOOP;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('billing.test.area_actor_1'),true);
DO $$
DECLARE
 input jsonb:='{"name":"Fazenda sem área","code":"005010","city":"Cuiabá","state":"MT"}';
 farm jsonb;
 result jsonb;
 invalid jsonb;
BEGIN
 farm=public.billing_rpc('farms','save',input||jsonb_build_object('areaHa','','owner_id',current_setting('billing.test.area_actor_2')))->'farm';
 PERFORM set_config('billing.test.area_farm',farm->>'id',true);
 IF farm->'areaHa'<>'null'::jsonb OR farm->>'code'<>'005010' THEN RAISE EXCEPTION 'Empty area/code not preserved: %',farm; END IF;
 IF (public.billing_rpc('farms','save',input)->'farm'->'areaHa')<>'null'::jsonb THEN RAISE EXCEPTION 'Omitted area must be optional'; END IF;
 FOREACH invalid IN ARRAY ARRAY['null'::jsonb,'"   "'::jsonb] LOOP
  result=public.billing_rpc('farms','save',input||jsonb_build_object('id',farm->>'id','areaHa',invalid));
  IF result->'farm'->'areaHa'<>'null'::jsonb THEN RAISE EXCEPTION 'Null/blank area must remain unknown'; END IF;
 END LOOP;
 result=public.billing_rpc('plots','list',jsonb_build_object('farmId',farm->>'id'))->'data';
 IF result->'totalHa'<>'null'::jsonb OR result->'availableHa'<>'null'::jsonb OR result->'canAddPlot'<>'true'::jsonb THEN RAISE EXCEPTION 'Unknown capacity must allow plots: %',result; END IF;
 result=public.billing_rpc('plots','save',jsonb_build_object('farmId',farm->>'id','name','Talhão 01','areaHa','6,123456'))->'data';
 IF result->>'usedHa'<>'6.123456' OR result->'plots'->0->'maxAreaHa'<>'null'::jsonb THEN RAISE EXCEPTION 'Unknown farm capacity/precision lost'; END IF;
 FOREACH invalid IN ARRAY ARRAY['"0"'::jsonb,'"-1"'::jsonb,'"abc"'::jsonb,'"1.0000001"'::jsonb,'"1000000000"'::jsonb,'{}'::jsonb,'[]'::jsonb] LOOP
  BEGIN
   PERFORM public.billing_rpc('farms','save',input||jsonb_build_object('id',farm->>'id','areaHa',invalid));
   RAISE EXCEPTION 'Invalid supplied farm area accepted: %',invalid;
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
 END LOOP;
 BEGIN
  PERFORM public.billing_rpc('plots','save',jsonb_build_object('farmId',farm->>'id','name','Sem área','areaHa',''));
  RAISE EXCEPTION 'Plot area must remain required';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
 BEGIN
  PERFORM public.billing_rpc('farms','save',input||jsonb_build_object('id',farm->>'id','areaHa','5'));
  RAISE EXCEPTION 'Known capacity below plots accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 result=public.billing_rpc('farms','save',input||jsonb_build_object('id',farm->>'id','areaHa','10,000001'));
 IF result->'farm'->>'areaHa'<>'10.000001' THEN RAISE EXCEPTION 'Supplied farm precision lost'; END IF;
 result=public.billing_rpc('farms','save',input||jsonb_build_object('id',farm->>'id'));
 IF result->'farm'->>'areaHa'<>'10.000001' THEN RAISE EXCEPTION 'Omitted area on update must preserve value'; END IF;
 BEGIN
  PERFORM public.billing_rpc('plots','save',jsonb_build_object('farmId',farm->>'id','name','Excesso','areaHa','5'));
  RAISE EXCEPTION 'Known farm capacity not enforced';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 PERFORM public.billing_rpc('farms','save',input||jsonb_build_object('id',farm->>'id','areaHa',''));
 result=public.billing_rpc('farms','list');
 IF result->'summary'->'totalHa'<>'null'::jsonb OR result->'summary'->>'usedHa'<>'6.123456' OR result->'summary'->'preservedHa'<>'null'::jsonb THEN RAISE EXCEPTION 'Unknown portfolio totals reported as known: %',result; END IF;
 BEGIN
  UPDATE public.billing_farms SET area_ha=NULL WHERE id=(farm->>'id')::uuid;
  RAISE EXCEPTION 'Direct writes must remain denied';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 PERFORM set_config('request.jwt.claim.sub',current_setting('billing.test.area_actor_2'),true);
 IF EXISTS(SELECT 1 FROM public.billing_farms WHERE id=(farm->>'id')::uuid) THEN RAISE EXCEPTION 'Cross-account SELECT allowed'; END IF;
 BEGIN
  PERFORM public.billing_rpc('farms','save',input||jsonb_build_object('id',farm->>'id','areaHa',''));
  RAISE EXCEPTION 'Cross-account update allowed';
 EXCEPTION WHEN no_data_found OR SQLSTATE 'P0002' THEN NULL;
 END;
 BEGIN
  PERFORM public.billing_rpc('plots','save',jsonb_build_object('farmId',farm->>'id','name','Outra conta','areaHa','1'));
  RAISE EXCEPTION 'Cross-account plot allowed';
 EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
 END;
 PERFORM set_config('request.jwt.claim.sub','',true);
 BEGIN
  PERFORM public.billing_rpc('farms','list');
  RAISE EXCEPTION 'Anonymous RPC allowed';
 EXCEPTION WHEN invalid_authorization_specification THEN NULL;
 END;
END $$;
RESET ROLE;
ROLLBACK;
