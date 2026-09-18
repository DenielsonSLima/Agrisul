SAVEPOINT execution_status_test;
RESET ROLE;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('78000000-0000-4000-8000-000000000001','execution-owner@example.invalid',now()),
 ('78000000-0000-4000-8000-000000000002','execution-reader@example.invalid',now()),
 ('78000000-0000-4000-8000-000000000003','execution-other@example.invalid',now());
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000001',true);
SELECT public.billing_rpc('settings','get','{}');
SELECT set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000003',true);
SELECT public.billing_rpc('settings','get','{}');
RESET ROLE;
INSERT INTO public.billing_access_profiles(id,owner_id,name,permissions) VALUES
 ('78000000-0000-4000-8000-000000000004','78000000-0000-4000-8000-000000000001','Read services',ARRAY['requests.read']);
INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,is_owner,status) VALUES
 ('78000000-0000-4000-8000-000000000001','78000000-0000-4000-8000-000000000002','78000000-0000-4000-8000-000000000004',false,'active');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000001',true);
DO $$ DECLARE v_person jsonb;v_input jsonb;v_open jsonb;v_progress jsonb;v_finished jsonb;v_list jsonb;v_rejected jsonb;v_signature jsonb;
BEGIN
 v_person=public.billing_rpc('signatures','save','{"name":"Pessoa solicitante","role":"requester"}')->'signature';
 v_signature=public.billing_rpc('signatures','prepare-upload','{"fileName":"diretor.png","contentType":"image/png","size":100}')->'file';
 INSERT INTO storage.objects(bucket_id,name) VALUES(v_signature->>'bucket',v_signature->>'path');
 PERFORM public.billing_rpc('signatures','save',jsonb_build_object('name','Diretor','role','manager','userId','78000000-0000-4000-8000-000000000001','fileId',v_signature->>'id'));
 v_input=jsonb_build_object('requestId',gen_random_uuid(),'requesterSignatureId',v_person->>'id','requesterSigningMode','manual','companyName','Oficina de execução','items','[{"description":"Manutenção","application":"Trator"}]'::jsonb);
 v_open=public.billing_rpc('service-requests','create',v_input)->'request';
 IF v_open->>'workflowStatus'<>'open' OR (v_open->>'canComplete')::boolean THEN RAISE EXCEPTION 'Invalid initial execution state';END IF;
 BEGIN PERFORM public.billing_rpc('service-requests','complete',jsonb_build_object('id',v_open->>'id'));RAISE EXCEPTION 'Unapproved service completed';EXCEPTION WHEN check_violation THEN NULL;END;
 v_progress=public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_open->>'id','decision','approved'))->'request';
 IF v_progress->>'workflowStatus'<>'in_progress' OR NOT (v_progress->>'canComplete')::boolean THEN RAISE EXCEPTION 'Approval did not start execution';END IF;
 v_list=public.billing_rpc('service-requests','list','{"tab":"in_progress"}');
 IF v_list->>'total'<>'1' OR v_list->'counts'->>'inProgress'<>'1' OR v_list->'counts'->>'finished'<>'0' THEN RAISE EXCEPTION 'Execution list totals wrong';END IF;
 IF public.billing_rpc('service-requests','list','{"tab":"finished"}')->>'total'<>'0' THEN RAISE EXCEPTION 'Approval classified as completion';END IF;
 v_finished=public.billing_rpc('service-requests','complete',jsonb_build_object('id',v_open->>'id'))->'request';
 IF v_finished->>'workflowStatus'<>'finished' OR (v_finished->>'canComplete')::boolean
  OR v_finished->'completion'->>'userId'<>'78000000-0000-4000-8000-000000000001' OR v_finished->'completion'->>'at' IS NULL
  OR v_finished->>'status'<>'approved' OR v_finished->'decision'<>v_progress->'decision' OR v_finished->>'documentHash'<>v_progress->>'documentHash'
  OR v_finished->'requester'<>v_open->'requester' OR v_finished->'template'<>v_open->'template' THEN RAISE EXCEPTION 'Completion changed original evidence';END IF;
 IF v_finished<>public.billing_rpc('service-requests','complete',jsonb_build_object('id',v_open->>'id'))->'request' THEN RAISE EXCEPTION 'Completion retry changed event';END IF;
 IF (SELECT count(*) FROM public.billing_service_request_events WHERE request_id=(v_open->>'id')::uuid AND action='completed')<>1 THEN RAISE EXCEPTION 'Duplicate completion event';END IF;
 BEGIN PERFORM public.billing_rpc('service-requests','complete',jsonb_build_object('id',v_open->>'id','completedBy','78000000-0000-4000-8000-000000000002'));RAISE EXCEPTION 'Forged actor accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 v_rejected=public.billing_rpc('service-requests','create',v_input||jsonb_build_object('requestId',gen_random_uuid()))->'request';
 v_rejected=public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_rejected->>'id','decision','rejected','reason','Dispensado'))->'request';
 IF v_rejected->>'workflowStatus'<>'rejected' THEN RAISE EXCEPTION 'Rejection lost';END IF;
 BEGIN PERFORM public.billing_rpc('service-requests','complete',jsonb_build_object('id',v_rejected->>'id'));RAISE EXCEPTION 'Rejected service completed';EXCEPTION WHEN check_violation THEN NULL;END;
 v_list=public.billing_rpc('service-requests','list','{"tab":"finished","pageSize":1,"page":20}');
 IF v_list->>'total'<>'2' OR v_list->>'page'<>'2' OR jsonb_array_length(v_list->'items')<>1 OR v_list->'counts'->>'inProgress'<>'0' THEN RAISE EXCEPTION 'Finished pagination incorrect';END IF;
 v_list=public.billing_rpc('service-requests','list',jsonb_build_object('tab','finished','requesterId',v_person->>'id','search','Manutenção'));
 IF v_list->>'total'<>'2' THEN RAISE EXCEPTION 'Filters lost';END IF;
 PERFORM set_config('test.execution.id',v_open->>'id',true);
END $$;
SELECT set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 BEGIN PERFORM public.billing_rpc('service-requests','complete',jsonb_build_object('id',current_setting('test.execution.id')));RAISE EXCEPTION 'Reader completed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN UPDATE public.billing_service_requests SET completed_at=NULL;RAISE EXCEPTION 'Direct DML allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
 IF public.billing_rpc('service-requests','list','{"tab":"finished"}')->>'total'<>'0' THEN RAISE EXCEPTION 'Cross-workspace list';END IF;
 BEGIN PERFORM public.billing_rpc('service-requests','complete',jsonb_build_object('id',current_setting('test.execution.id')));RAISE EXCEPTION 'Cross-workspace completion';EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;END;
END $$;
RESET ROLE;
DO $$ BEGIN
 BEGIN UPDATE public.billing_service_requests SET completed_at=NULL,completed_by=NULL,completed_by_name=NULL WHERE id=current_setting('test.execution.id')::uuid;RAISE EXCEPTION 'Completion evidence modified';EXCEPTION WHEN check_violation THEN NULL;END;
END $$;
ROLLBACK TO SAVEPOINT execution_status_test;
RELEASE SAVEPOINT execution_status_test;
