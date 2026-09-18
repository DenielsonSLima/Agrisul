SAVEPOINT pending_complements_test;
RESET ROLE;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('77000000-0000-4000-8000-000000000001','pending-owner@example.invalid',now()),
 ('77000000-0000-4000-8000-000000000002','pending-reader@example.invalid',now()),
 ('77000000-0000-4000-8000-000000000003','pending-other@example.invalid',now());
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','77000000-0000-4000-8000-000000000001',true);
SELECT public.billing_rpc('settings','get','{}');
SELECT set_config('request.jwt.claim.sub','77000000-0000-4000-8000-000000000003',true);
SELECT public.billing_rpc('settings','get','{}');
RESET ROLE;
INSERT INTO public.billing_access_profiles(id,owner_id,name,permissions) VALUES
 ('77000000-0000-4000-8000-000000000004','77000000-0000-4000-8000-000000000001','Read requests',ARRAY['requests.read']);
INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,is_owner,status) VALUES
 ('77000000-0000-4000-8000-000000000001','77000000-0000-4000-8000-000000000002','77000000-0000-4000-8000-000000000004',false,'active');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','77000000-0000-4000-8000-000000000001',true);
DO $$ DECLARE v_person jsonb;v_input jsonb;v_original jsonb;v_result jsonb;v_approved jsonb;v_file jsonb;v_signature jsonb;
 v_payload jsonb;v_id uuid:='77000000-0000-4000-8000-000000000010';
BEGIN
 v_person=public.billing_rpc('signatures','save','{"name":"Solicitante","role":"requester"}')->'signature';
 v_signature=public.billing_rpc('signatures','prepare-upload','{"fileName":"diretor.png","contentType":"image/png","size":100}')->'file';
 INSERT INTO storage.objects(bucket_id,name) VALUES(v_signature->>'bucket',v_signature->>'path');
 PERFORM public.billing_rpc('signatures','save',jsonb_build_object('name','Diretor','role','manager','userId','77000000-0000-4000-8000-000000000001','fileId',v_signature->>'id'));
 v_input=jsonb_build_object('requestId',v_id,'requesterSignatureId',v_person->>'id','requesterSigningMode','manual','companyName','Oficina','items','[{"description":"Manutenção","application":"Trator"}]'::jsonb);
 v_original=public.billing_rpc('service-requests','create',v_input)->'request';
 IF NOT (v_original->>'canComplement')::boolean THEN RAISE EXCEPTION 'Pending request cannot be complemented'; END IF;
 v_file=public.billing_rpc('service-requests','prepare-upload',jsonb_build_object('requestId',v_id,'fileName','orcamento.pdf','contentType','application/pdf','size',100))->'file';
 INSERT INTO storage.objects(bucket_id,name) VALUES(v_file->>'bucket',v_file->>'path');
 v_payload=jsonb_build_object('id',v_id,'operationId','77000000-0000-4000-8000-000000000020','expectedComplementId',null,'serviceValue','1500.25','returnDate','2026-10-05','attachmentIds',jsonb_build_array(v_file->>'id'));
 v_result=public.billing_rpc('service-requests','complement',v_payload)->'request';
 IF v_result->>'status'<>'pending' OR v_result->'currentDetails'->>'serviceValue'<>'1500.25' OR jsonb_array_length(v_result->'attachments')<>1
  OR v_result->'complements'->0->>'recordedStatus'<>'pending' OR v_result->>'documentHash'<>v_original->>'documentHash'
  OR v_result->'template'<>v_original->'template' OR v_result->'requester'<>v_original->'requester' OR v_result->'serviceValue'<>'null' THEN
  RAISE EXCEPTION 'Pending complement lost data or rewrote original: %',v_result; END IF;
 IF v_result<>public.billing_rpc('service-requests','complement',v_payload)->'request' THEN RAISE EXCEPTION 'Retry duplicated complement';END IF;
 BEGIN PERFORM public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_id,'decision','approved','expectedComplementId',null));RAISE EXCEPTION 'Stale approval accepted';EXCEPTION WHEN unique_violation THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('service-requests','complement',v_payload||jsonb_build_object('operationId',gen_random_uuid()));RAISE EXCEPTION 'Stale complement accepted';EXCEPTION WHEN unique_violation THEN NULL;END;
 v_approved=public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_id,'decision','approved','expectedComplementId',v_payload->>'operationId'))->'request';
 IF v_approved->>'decisionComplementHash'<>v_result->'complements'->0->>'hash' THEN RAISE EXCEPTION 'Decision not tied to reviewed complement'; END IF;
 PERFORM set_config('test.pending.approved',v_approved::text,true);
 v_payload=v_payload||jsonb_build_object('operationId','77000000-0000-4000-8000-000000000021','expectedComplementId',v_payload->>'operationId','serviceValue','1700','attachmentIds','[]'::jsonb);
 v_result=public.billing_rpc('service-requests','complement',v_payload)->'request';
 IF v_result->'complements'->1->>'recordedStatus'<>'approved' OR v_result->'decision'<>v_approved->'decision'
  OR v_result->>'decisionComplementHash'<>v_approved->>'decisionComplementHash' THEN RAISE EXCEPTION 'Later addition rewrote approval';END IF;
 PERFORM set_config('test.pending.payload',v_payload::text,true);
 PERFORM set_config('test.pending.original',v_original::text,true);
 v_result=public.billing_rpc('service-requests','create',v_input||jsonb_build_object('requestId',gen_random_uuid()))->'request';
 v_result=public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_result->>'id','decision','rejected','reason','Serviço dispensado'))->'request';
 IF (v_result->>'canComplement')::boolean THEN RAISE EXCEPTION 'Rejected complement enabled';END IF;
 BEGIN PERFORM public.billing_rpc('service-requests','complement',v_payload||jsonb_build_object('id',v_result->>'id','operationId',gen_random_uuid()));RAISE EXCEPTION 'Rejected complement accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('service-requests','prepare-upload',jsonb_build_object('requestId',v_result->>'id','fileName','extra.pdf','contentType','application/pdf','size',100));RAISE EXCEPTION 'Rejected upload accepted';EXCEPTION WHEN check_violation THEN NULL;END;
END $$;
RESET ROLE;
DO $$ DECLARE v_row public.billing_service_requests;v_expected_hash text;v_approved jsonb:=current_setting('test.pending.approved')::jsonb;
BEGIN
 SELECT * INTO v_row FROM public.billing_service_requests WHERE id=(v_approved->>'id')::uuid;
 v_expected_hash=billing_private.request_signer_hash(v_row,'manager');
 IF v_expected_hash<>v_approved->'decision'->>'signatureHash' THEN RAISE EXCEPTION 'Incorrect decision signature hash';END IF;
 v_row.decision_complement_hash=NULL;
 IF v_expected_hash=billing_private.request_signer_hash(v_row,'manager') THEN RAISE EXCEPTION 'Complement is not covered by director hash';END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','77000000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 IF (public.billing_rpc('service-requests','get',jsonb_build_object('id',current_setting('test.pending.payload')::jsonb->>'id'))->'request'->>'canComplement')::boolean THEN RAISE EXCEPTION 'Reader allowed to complement';END IF;
 BEGIN PERFORM public.billing_rpc('service-requests','complement',current_setting('test.pending.payload')::jsonb);RAISE EXCEPTION 'Reader wrote';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN UPDATE public.billing_service_request_complements SET service_value=999;RAISE EXCEPTION 'Direct DML allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claim.sub','77000000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.billing_service_request_complements) THEN RAISE EXCEPTION 'Workspace leak';END IF;
 BEGIN PERFORM public.billing_rpc('service-requests','complement',current_setting('test.pending.payload')::jsonb);RAISE EXCEPTION 'Cross owner accepted';EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;END;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT pending_complements_test;
RELEASE SAVEPOINT pending_complements_test;
