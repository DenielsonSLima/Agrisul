SAVEPOINT providers_test;
RESET ROLE;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('75000000-0000-4000-8000-000000000001','provider-owner@example.invalid',now()),
 ('75000000-0000-4000-8000-000000000002','provider-member@example.invalid',now()),
 ('75000000-0000-4000-8000-000000000003','provider-other@example.invalid',now());
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','75000000-0000-4000-8000-000000000001',true);
SELECT public.billing_rpc('settings','get','{}');
SELECT set_config('request.jwt.claim.sub','75000000-0000-4000-8000-000000000003',true);
SELECT public.billing_rpc('settings','get','{}');
RESET ROLE;
INSERT INTO public.billing_access_profiles(id,owner_id,name,permissions) VALUES
 ('75000000-0000-4000-8000-000000000004','75000000-0000-4000-8000-000000000001','Request operator',ARRAY['requests.read','requests.write']);
INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,is_owner,status) VALUES
 ('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000002','75000000-0000-4000-8000-000000000004',false,'active');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','75000000-0000-4000-8000-000000000001',true);
DO $$ DECLARE v_input jsonb;v_provider jsonb;v_person jsonb;v_request jsonb;v_request_input jsonb;v_changed jsonb; BEGIN
 v_input='{"documentType":"CPF","document":"529.982.247-25","legalName":"Prestador pessoa física","tradeName":"Oficina","street":"Rua da oficina","number":"10","complement":"Galpão","district":"Centro","city":"Japoatã","state":"se","zipCode":"49950-000","phone":"79999999999","email":"oficina@example.invalid"}';
 v_provider=public.billing_rpc('service-providers','save',v_input)->'provider';
 IF v_provider->>'document'<>'52998224725' OR v_provider->>'state'<>'SE' OR v_provider->>'zipCode'<>'49950000' OR v_provider->>'address' NOT LIKE '%Rua da oficina, 10%Japoatã / SE%' THEN RAISE EXCEPTION 'Provider normalization failed: %',v_provider; END IF;
 PERFORM set_config('test.provider.id',v_provider->>'id',true);PERFORM set_config('test.provider.input',v_input::text,true);
 BEGIN PERFORM public.billing_rpc('service-providers','save',v_input);RAISE EXCEPTION 'Duplicate CPF accepted';EXCEPTION WHEN unique_violation THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('service-providers','save',v_input||'{"document":"52998224726"}');RAISE EXCEPTION 'Invalid CPF accepted';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('service-providers','save',v_input||'{"document":"11111111111"}');RAISE EXCEPTION 'Repeated CPF accepted';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('service-providers','save',v_input||'{"documentType":"CNPJ","document":"04773159000524"}');RAISE EXCEPTION 'Invalid CNPJ accepted';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('service-providers','save',v_input||'{"owner_id":"75000000-0000-4000-8000-000000000003"}');RAISE EXCEPTION 'Owner payload accepted';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 PERFORM public.billing_rpc('service-providers','save',v_input||'{"documentType":"CNPJ","document":"04.773.159/0005-23"}');
 PERFORM public.billing_rpc('service-providers','save',v_input||'{"documentType":"CNPJ","document":"12.ABC.345/01DE-35"}');
 IF jsonb_array_length(public.billing_rpc('service-providers','list','{}')->'providers')<>3 THEN RAISE EXCEPTION 'Provider listing incorrect'; END IF;
 v_person=public.billing_rpc('signatures','save','{"name":"Solicitante teste prestador","role":"requester"}')->'signature';
 PERFORM public.billing_rpc('signatures','save','{"name":"Diretor teste prestador","role":"manager","userId":"75000000-0000-4000-8000-000000000001"}');
 v_request_input=jsonb_build_object('requestId','75000000-0000-4000-8000-000000000010','providerId',v_provider->>'id','requesterSignatureId',v_person->>'id','requesterSigningMode','manual',
  'companyName','Forged browser name','companyAddress','Forged address','items','[{"description":"Serviço no motor","application":"Trator"}]'::jsonb,'serviceValue','123.45','returnDate',null,'notes','','attachmentIds','[]'::jsonb);
 v_request=public.billing_rpc('service-requests','create',v_request_input)->'request';
 IF v_request->>'providerId'<>v_provider->>'id' OR v_request->'provider'<>v_provider OR v_request->>'companyName'<>v_provider->>'legalName' OR v_request->>'companyAddress'<>v_provider->>'address' THEN RAISE EXCEPTION 'Request did not use server provider snapshot: %',v_request; END IF;
 v_changed=public.billing_rpc('service-providers','save',v_input||jsonb_build_object('id',v_provider->>'id','legalName','Nome alterado depois','street','Rua nova'))->'provider';
 IF public.billing_rpc('service-requests','create',v_request_input)->'request'<>v_request THEN RAISE EXCEPTION 'Retry changed provider snapshot or hash'; END IF;
 IF public.billing_rpc('service-requests','get',jsonb_build_object('id',v_request->>'id'))->'request'<>v_request THEN RAISE EXCEPTION 'Registry edit changed old document'; END IF;
 v_changed=public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_request->>'id','decision','approved','managerSigningMode','manual'))->'request';
 IF v_changed->>'documentHash'<>v_request->>'documentHash' OR v_changed->'provider'<>v_request->'provider' THEN RAISE EXCEPTION 'Decision changed provider evidence'; END IF;
 PERFORM set_config('test.provider.request',v_request_input::text,true);
END $$;
SELECT set_config('request.jwt.claim.sub','75000000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 IF jsonb_array_length(public.billing_rpc('service-providers','options','{}')->'providers')<>3 OR (public.billing_rpc('service-providers','list','{}')->>'canManage')::boolean THEN RAISE EXCEPTION 'Request-only permissions incorrect'; END IF;
 BEGIN PERFORM public.billing_rpc('service-providers','save',current_setting('test.provider.input')::jsonb);RAISE EXCEPTION 'Request operator wrote provider';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN UPDATE public.billing_service_providers SET legal_name='Direct write';RAISE EXCEPTION 'Direct DML accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 IF (SELECT count(*) FROM public.billing_service_providers)<>3 THEN RAISE EXCEPTION 'Provider RLS does not allow own request reader'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','75000000-0000-4000-8000-000000000003',true);
DO $$ DECLARE v_person jsonb; BEGIN
 IF EXISTS(SELECT 1 FROM public.billing_service_providers) OR jsonb_array_length(public.billing_rpc('service-providers','list','{}')->'providers')<>0 THEN RAISE EXCEPTION 'Provider data leaked across workspaces'; END IF;
 BEGIN PERFORM public.billing_rpc('service-providers','get',jsonb_build_object('id',current_setting('test.provider.id')));RAISE EXCEPTION 'Foreign provider read';EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('service-providers','save',current_setting('test.provider.input')::jsonb||jsonb_build_object('id',current_setting('test.provider.id')));RAISE EXCEPTION 'Foreign provider edit';EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;END;
 v_person=public.billing_rpc('signatures','save','{"name":"Solicitante outro espaço","role":"requester"}')->'signature';
 BEGIN PERFORM public.billing_rpc('service-requests','create',current_setting('test.provider.request')::jsonb||jsonb_build_object('requestId',gen_random_uuid(),'requesterSignatureId',v_person->>'id'));RAISE EXCEPTION 'Foreign provider request accepted';EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;
 PERFORM public.billing_rpc('service-providers','save',current_setting('test.provider.input')::jsonb);
END $$;
RESET ROLE;
DO $$ DECLARE v_request public.billing_service_requests; BEGIN
 FOR v_request IN SELECT * FROM public.billing_service_requests LOOP
  IF billing_private.request_document_hash(v_request)<>v_request.document_hash THEN RAISE EXCEPTION 'Provider migration changed legacy hash'; END IF;
 END LOOP;
 BEGIN UPDATE public.billing_service_requests SET provider_snapshot=jsonb_set(provider_snapshot,'{legalName}','"Forged snapshot"') WHERE id='75000000-0000-4000-8000-000000000010';RAISE EXCEPTION 'Provider snapshot changed';EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;
END $$;
ROLLBACK TO SAVEPOINT providers_test;
RELEASE SAVEPOINT providers_test;
