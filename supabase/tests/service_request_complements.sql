SAVEPOINT complements_test;
RESET ROLE;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('76000000-0000-4000-8000-000000000001','complements-owner@example.invalid',now()),
 ('76000000-0000-4000-8000-000000000002','complements-reader@example.invalid',now()),
 ('76000000-0000-4000-8000-000000000003','complements-other@example.invalid',now());
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','76000000-0000-4000-8000-000000000001',true);
SELECT public.billing_rpc('settings','get','{}');
SELECT set_config('request.jwt.claim.sub','76000000-0000-4000-8000-000000000003',true);
SELECT public.billing_rpc('settings','get','{}');
RESET ROLE;
INSERT INTO public.billing_access_profiles(id,owner_id,name,permissions) VALUES
 ('76000000-0000-4000-8000-000000000004','76000000-0000-4000-8000-000000000001','Read requests',ARRAY['requests.read']);
INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,is_owner,status) VALUES
 ('76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000002','76000000-0000-4000-8000-000000000004',false,'active');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','76000000-0000-4000-8000-000000000001',true);
DO $$ DECLARE v_person jsonb;v_input jsonb;v_request jsonb;v_approved jsonb;v_payload jsonb;v_result jsonb;v_file jsonb;v_id uuid:='76000000-0000-4000-8000-000000000010';v_bad jsonb;BEGIN
 v_person=public.billing_rpc('signatures','save','{"name":"Solicitante sem valor","role":"requester"}')->'signature';
 PERFORM public.billing_rpc('signatures','save','{"name":"Diretor geral","role":"manager","userId":"76000000-0000-4000-8000-000000000001"}');
 v_input=jsonb_build_object('requestId',v_id,'requesterSignatureId',v_person->>'id','requesterSigningMode','manual','companyName','Oficina sem orçamento','items','[{"description":"Serviço","application":"Trator"}]'::jsonb);
 v_request=public.billing_rpc('service-requests','create',v_input)->'request';
 IF v_request->'serviceValue'<>'null' OR v_request->'returnDate'<>'null' OR v_request->'attachments'<>'[]' THEN RAISE EXCEPTION 'Blank fields not nullable: %',v_request; END IF;
 IF v_request<>public.billing_rpc('service-requests','create',v_input||'{"serviceValue":"","attachmentIds":[]}')->'request' THEN RAISE EXCEPTION 'Empty value retry failed'; END IF;
 FOREACH v_bad IN ARRAY ARRAY['{"serviceValue":"-1"}'::jsonb,'{"serviceValue":"1.999"}','{"serviceValue":false}','{"serviceValue":123}','{"serviceValue":"NaN"}'] LOOP
  BEGIN PERFORM public.billing_rpc('service-requests','create',v_input||v_bad||jsonb_build_object('requestId',gen_random_uuid()));RAISE EXCEPTION 'Invalid value accepted';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 END LOOP;
 v_payload=jsonb_build_object('id',v_id,'operationId','76000000-0000-4000-8000-000000000020','expectedComplementId',null,'serviceValue','1234.56','returnDate','2026-10-05','attachmentIds','[]'::jsonb);
 BEGIN PERFORM public.billing_rpc('service-requests','complement',v_payload);RAISE EXCEPTION 'Pending request complemented';EXCEPTION WHEN check_violation THEN NULL;END;
 v_approved=public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_id,'decision','approved','managerSigningMode','manual'))->'request';
 IF NOT (v_approved->>'canComplement')::boolean THEN RAISE EXCEPTION 'Cannot complement approved request';END IF;
 v_result=public.billing_rpc('service-requests','complement',v_payload)->'request';
 IF v_result->'serviceValue'<>'null' OR v_result->'currentDetails'->>'serviceValue'<>'1234.56' OR v_result->'currentDetails'->>'returnDate'<>'2026-10-05'
  OR v_result->>'documentHash'<>v_approved->>'documentHash' OR v_result->'decision'<>v_approved->'decision' OR jsonb_array_length(v_result->'complements')<>1 THEN RAISE EXCEPTION 'Original approval lost: %',v_result; END IF;
 IF v_result<>public.billing_rpc('service-requests','complement',v_payload)->'request' THEN RAISE EXCEPTION 'Complement retry duplicated';END IF;
 BEGIN PERFORM public.billing_rpc('service-requests','complement',v_payload||'{"serviceValue":"900"}');RAISE EXCEPTION 'Conflicting retry accepted';EXCEPTION WHEN unique_violation THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('service-requests','complement',v_payload||jsonb_build_object('operationId',gen_random_uuid()));RAISE EXCEPTION 'Stale form accepted';EXCEPTION WHEN unique_violation THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('service-requests','complement',v_payload||'{"actorId":"76000000-0000-4000-8000-000000000002"}');RAISE EXCEPTION 'Forged actor accepted';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 v_file=public.billing_rpc('service-requests','prepare-upload',jsonb_build_object('requestId',v_id,'fileName','depois.png','contentType','image/png','size',100))->'file';
 -- Storage policies themselves are exercised, including immutable uploads.
 INSERT INTO storage.objects(bucket_id,name) VALUES(v_file->>'bucket',v_file->>'path');
 v_payload=v_payload||jsonb_build_object('operationId','76000000-0000-4000-8000-000000000021','expectedComplementId','76000000-0000-4000-8000-000000000020','attachmentIds',jsonb_build_array(v_file->>'id'));
 v_result=public.billing_rpc('service-requests','complement',v_payload)->'request';
 IF jsonb_array_length(v_result->'attachments')<>1 OR jsonb_array_length(v_result->'complements')<>2 OR v_result->'complements'->1->>'actorId'<>'76000000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'Complement file or audit missing';END IF;
 IF billing_private.can_upload_request_file(v_file->>'bucket',v_file->>'path') THEN RAISE EXCEPTION 'Consumed attachment writable';END IF;
 PERFORM set_config('test.complement.payload',v_payload::text,true);
 v_request=public.billing_rpc('service-requests','create',v_input||jsonb_build_object('requestId',gen_random_uuid(),'serviceValue','0','returnDate','2026-11-01'))->'request';
 IF v_request->>'serviceValue'<>'0' OR v_request->>'returnDate'<>'2026-11-01' THEN RAISE EXCEPTION 'Known zero value lost';END IF;
 PERFORM public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_request->>'id','decision','rejected','reason','Serviço dispensado','managerSigningMode','manual'));
 BEGIN PERFORM public.billing_rpc('service-requests','complement',v_payload||jsonb_build_object('id',v_request->>'id','operationId',gen_random_uuid()));RAISE EXCEPTION 'Rejected complemented';EXCEPTION WHEN check_violation THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claim.sub','76000000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.billing_service_request_complements)<>2 THEN RAISE EXCEPTION 'Reader cannot see own complements';END IF;
 BEGIN PERFORM public.billing_rpc('service-requests','complement',current_setting('test.complement.payload')::jsonb);RAISE EXCEPTION 'Read-only wrote';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN UPDATE public.billing_service_request_complements SET service_value=999;RAISE EXCEPTION 'Direct DML allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claim.sub','76000000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.billing_service_request_complements) THEN RAISE EXCEPTION 'Other workspace leak';END IF;
 BEGIN PERFORM public.billing_rpc('service-requests','complement',current_setting('test.complement.payload')::jsonb);RAISE EXCEPTION 'Cross-owner complement';EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;END;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT complements_test;
RELEASE SAVEPOINT complements_test;
