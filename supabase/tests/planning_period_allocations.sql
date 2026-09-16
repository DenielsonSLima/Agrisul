BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('81818181-8181-4181-8181-818181818181','planning-new-owner@example.invalid',now()),
 ('82828282-8282-4282-8282-828282828282','planning-new-other@example.invalid',now()),
 ('83838383-8383-4383-8383-838383838383','planning-new-reader@example.invalid',now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81818181-8181-4181-8181-818181818181',true);
DO $$
DECLARE
 r jsonb;farm uuid;plot_a uuid;plot_b uuid;culture uuid;subtype uuid;practice uuid;
 plan uuid;plan_two uuid;allocation_a uuid;allocation_b uuid;profile uuid;
BEGIN
 PERFORM public.billing_rpc('settings','get');
 farm=(public.billing_rpc('farms','save','{"name":"Fazenda do plano","areaHa":"100","city":"Cidade","state":"SP"}')->'farm'->>'id')::uuid;
 r=public.billing_rpc('plots','save',jsonb_build_object('farmId',farm,'name','Talhão A','areaHa','60'));
 SELECT (value->>'id')::uuid INTO plot_a FROM jsonb_array_elements(r->'data'->'plots') WHERE value->>'name'='Talhão A';
 r=public.billing_rpc('plots','save',jsonb_build_object('farmId',farm,'name','Talhão B','areaHa','40'));
 SELECT (value->>'id')::uuid INTO plot_b FROM jsonb_array_elements(r->'data'->'plots') WHERE value->>'name'='Talhão B';
 PERFORM public.billing_rpc('planning','set-planted',jsonb_build_object('plotId',plot_a,'plantedAreaHa','20','reason','Posição inicial'));
 PERFORM public.billing_rpc('cultures','save','{"kind":"culture","name":"Cana de açúcar"}');
 culture=(public.billing_rpc('cultures','list')->'cultures'->0->>'id')::uuid;
 PERFORM public.billing_rpc('cultures','save',jsonb_build_object('kind','subtype','cultureId',culture,'name','Cana planta'));
 subtype=(public.billing_rpc('cultures','list')->'cultures'->0->'subtypes'->0->>'id')::uuid;
 practice=(public.billing_rpc('cultural-practices','save',jsonb_build_object('cultureId',culture,'cultureSubtypeId',subtype,
  'category','soil-preparation','name','Adubação de plantio','description',''))->'practice'->>'id')::uuid;
 r=public.billing_rpc('planning','save-period',jsonb_build_object('name','Inverno 2026','startDate','2026-05-01','endDate','2026-08-31',
  'targetAreaHa','20','cultureId',culture,'cultureSubtypeId',subtype,'notes','Meta livre','status','active'));
 plan=(r->'period'->>'id')::uuid;
 IF r->'period'->>'targetAreaHa'<>'20' OR r->'period'->>'allocatedAreaHa'<>'0' OR r->'period'->>'revision'<>'1' THEN
  RAISE EXCEPTION 'Period creation contract wrong: %',r;
 END IF;
 r=public.billing_rpc('planning','save-allocation',jsonb_build_object('periodId',plan,'plotId',plot_a,'areaHa','15','notes','Primeira frente'));
 allocation_a=(r->'allocation'->>'id')::uuid;
 r=public.billing_rpc('planning','save-allocation',jsonb_build_object('periodId',plan,'plotId',plot_b,'areaHa','5','notes','Segunda frente'));
 allocation_b=(r->'allocation'->>'id')::uuid;
 PERFORM public.billing_rpc('planning','set-practices',jsonb_build_object('allocationId',allocation_a,'practiceIds',jsonb_build_array(practice),'expectedRevision',1));
 r=public.billing_rpc('planning','list',jsonb_build_object('periodId',plan));
 IF r->'periods'->0->>'allocatedAreaHa'<>'20' OR r->'periods'->0->>'remainingAreaHa'<>'0' THEN RAISE EXCEPTION 'Target totals wrong: %',r->'periods'->0; END IF;
 IF r->'farms'->0->>'plantedAreaHa'<>'20' OR r->'farms'->0->>'plannedAreaHa'<>'20' OR r->'farms'->0->>'unmappedAreaHa'<>'0' THEN RAISE EXCEPTION 'Farm planning projection wrong: %',r->'farms'->0; END IF;
 IF jsonb_array_length(r->'history')<4 OR jsonb_array_length(r->'practices')<>1 THEN RAISE EXCEPTION 'History or practices missing'; END IF;
 IF (SELECT allocation->'practiceIds' FROM jsonb_array_elements(r->'farms'->0->'plots') p, LATERAL (SELECT p->'allocation' allocation) x WHERE p->>'id'=plot_a::text)<>jsonb_build_array(practice) THEN
  RAISE EXCEPTION 'Management selection missing';
 END IF;
 BEGIN
  PERFORM public.billing_rpc('planning','save-allocation',jsonb_build_object('periodId',plan,'plotId',plot_b,'areaHa','6','notes','','id',allocation_b,'expectedRevision',1,'revisionReason','Aumentar área'));
  RAISE EXCEPTION 'Target overflow accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 r=public.billing_rpc('planning','remanejar',jsonb_build_object('allocationId',allocation_a,'targetPlotId',plot_b,'areaHa','5','expectedRevision',2,'reason','Ajuste entre talhões'));
 IF r->>'movedAreaHa'<>'5' OR r->'source'->>'areaHa'<>'10' OR r->'target'->>'areaHa'<>'10' THEN RAISE EXCEPTION 'Remanagement totals wrong: %',r; END IF;
 BEGIN
  PERFORM public.billing_rpc('planning','set-planted',jsonb_build_object('plotId',plot_a,'plantedAreaHa','55','reason','Teste de excesso'));
  RAISE EXCEPTION 'Planted plus planned overflow accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 r=public.billing_rpc('planning','save-period',jsonb_build_object('name','Verão 2026','startDate','2026-06-01','endDate','2026-09-30',
  'targetAreaHa','35','cultureId',culture,'cultureSubtypeId',subtype,'notes','','status','active'));
 plan_two=(r->'period'->>'id')::uuid;
 BEGIN
  PERFORM public.billing_rpc('planning','save-allocation',jsonb_build_object('periodId',plan_two,'plotId',plot_a,'areaHa','31','notes',''));
  RAISE EXCEPTION 'Overlapping plot capacity accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('planning','save-period',jsonb_build_object('id',plan,'name','Inverno revisado','startDate','2026-05-01','endDate','2026-08-31',
   'targetAreaHa','20','cultureId',culture,'cultureSubtypeId',subtype,'notes','','status','active','expectedRevision',99,'revisionReason','Conflito'));
  RAISE EXCEPTION 'Stale revision accepted';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 BEGIN INSERT INTO public.billing_planning_periods(owner_id,name,start_date,end_date,target_area_ha,culture_id,culture_subtype_id,created_by)
  VALUES(auth.uid(),'Direto','2026-01-01','2026-01-31',1,culture,subtype,auth.uid());RAISE EXCEPTION 'Direct planning DML accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('planning-goals','list','{}');RAISE EXCEPTION 'Legacy planning goals restored';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 RESET ROLE;
 SELECT id INTO profile FROM public.billing_access_profiles WHERE owner_id='81818181-8181-4181-8181-818181818181' AND name='Somente leitura';
 INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,is_owner,status)
  VALUES('81818181-8181-4181-8181-818181818181','83838383-8383-4383-8383-838383838383',profile,false,'active');
 SET LOCAL ROLE authenticated;
 PERFORM set_config('request.jwt.claim.sub','83838383-8383-4383-8383-838383838383',true);
 PERFORM public.billing_rpc('planning','list',jsonb_build_object('periodId',plan));
 BEGIN PERFORM public.billing_rpc('planning','set-planted',jsonb_build_object('plotId',plot_b,'plantedAreaHa','1','reason','Sem escrita'));RAISE EXCEPTION 'Reader wrote planning';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claim.sub','82828282-8282-4282-8282-828282828282',true);
DO $$ BEGIN
 PERFORM public.billing_rpc('settings','get');
 IF jsonb_array_length(public.billing_rpc('planning','list','{}')->'periods')<>0 THEN RAISE EXCEPTION 'Cross-owner periods visible'; END IF;
 BEGIN PERFORM public.billing_rpc('planning','list','{"periodId":"81818181-8181-4181-8181-818181818181"}');RAISE EXCEPTION 'Foreign identifier accepted';EXCEPTION WHEN no_data_found THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ BEGIN
 BEGIN PERFORM public.billing_rpc('planning','list','{}');RAISE EXCEPTION 'Anonymous planning allowed';EXCEPTION WHEN invalid_authorization_specification THEN NULL;END;
END $$;
ROLLBACK;
