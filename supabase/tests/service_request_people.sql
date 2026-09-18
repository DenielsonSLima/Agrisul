SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000001',true);
DO $$
DECLARE v_legacy jsonb:=current_setting('test.people.legacy')::jsonb;v_current jsonb;v_options jsonb;v_file jsonb;
 v_person jsonb;v_other_person jsonb;v_manager jsonb;v_request jsonb;v_payload jsonb;v_history jsonb;v_path text;
BEGIN
 v_current=public.billing_rpc('service-requests','get','{"id":"72000000-0000-4000-8000-000000000020"}')->'request';
 IF (v_current-'createdBy')<>v_legacy OR v_current->'createdBy'->>'userId'<>'72000000-0000-4000-8000-000000000001'
  OR v_current->'createdBy'->>'name'<>v_legacy->'requester'->>'name' THEN
  RAISE EXCEPTION 'Migration changed legacy snapshots/time/history or failed to backfill original actor: %',v_current; END IF;
 IF EXISTS(SELECT 1 FROM public.billing_signatures WHERE role='requester' AND user_id IS NOT NULL) THEN RAISE EXCEPTION 'Legacy requester still linked to login'; END IF;
 v_options=public.billing_rpc('service-requests','options','{}');
 IF v_options ? 'requesterSignature' OR jsonb_array_length(v_options->'requesterSignatures')<>1
  OR (v_options->'requesterSignatures'->0->'userId') IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Requester options require logged-in person: %',v_options; END IF;
 v_manager=v_options->'managerSignature';
 -- Operator has no own signature and no user administration permission.
 PERFORM set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000002',true);
 BEGIN PERFORM public.billing_rpc('users','list','{}');RAISE EXCEPTION 'Operator can manage user accounts';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 v_file=public.billing_rpc('signatures','prepare-upload','{"fileName":"edmilson.png","contentType":"image/png","size":160}')->'file';
 INSERT INTO storage.objects(bucket_id,name) VALUES(v_file->>'bucket',v_file->>'path');
 v_person=public.billing_rpc('signatures','save',jsonb_build_object('name','Edmilson sem conta','role','requester','fileId',v_file->>'id'))->'signature';
 IF v_person->'userId' IS DISTINCT FROM 'null'::jsonb OR v_person->>'name'<>'Edmilson sem conta' THEN RAISE EXCEPTION 'Person incorrectly bound to operator login'; END IF;
 v_path=v_person->>'filePath';
 v_file=public.billing_rpc('signatures','prepare-upload','{"fileName":"outra-pessoa.png","contentType":"image/png","size":160}')->'file';
 INSERT INTO storage.objects(bucket_id,name) VALUES(v_file->>'bucket',v_file->>'path');
 v_other_person=public.billing_rpc('signatures','save',jsonb_build_object('name','Outra pessoa sem conta','role','requester','userId',null,'fileId',v_file->>'id'))->'signature';
 BEGIN
  PERFORM public.billing_rpc('signatures','save',jsonb_build_object('id',v_person->>'id','name','Edmilson','role','requester','userId','72000000-0000-4000-8000-000000000002'));
  RAISE EXCEPTION 'Requester accepted an operator login linkage';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 BEGIN
  PERFORM public.billing_rpc('signatures','save',jsonb_build_object('id',v_person->>'id','name','Gerente sem conta','role','manager','userId',null));
  RAISE EXCEPTION 'Manager accepted without logged-in account';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;
 BEGIN
  PERFORM public.billing_rpc('signatures','save',jsonb_build_object('id',v_person->>'id','name','Gerente externo','role','manager','userId','72000000-0000-4000-8000-000000000003'));
  RAISE EXCEPTION 'Manager accepted external account';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;
 v_options=public.billing_rpc('service-requests','options','{}');
 IF jsonb_array_length(v_options->'requesterSignatures')<>3 OR NOT (v_options->>'canCreate')::boolean OR v_options->'managerSignature' IS DISTINCT FROM 'null'::jsonb THEN
  RAISE EXCEPTION 'Operator cannot choose registered people without own signature'; END IF;
 v_file=public.billing_rpc('service-requests','prepare-upload','{"requestId":"72000000-0000-4000-8000-000000000021","fileName":"orcamento-pessoa.pdf","contentType":"application/pdf","size":500}')->'file';
 INSERT INTO storage.objects(bucket_id,name) VALUES(v_file->>'bucket',v_file->>'path');
 v_payload=jsonb_build_object('requestId','72000000-0000-4000-8000-000000000021','requesterSignatureId',v_person->>'id','companyName','Tornearia pessoa',
  'companyAddress','Rua escolhida','items',jsonb_build_array(jsonb_build_object('description','Serviço solicitado por Edmilson','application','Carregadeira')),
  'serviceValue','100.25','returnDate',null,'notes','Operador digitou para pessoa sem conta','attachmentIds',jsonb_build_array(v_file->>'id'));
 BEGIN PERFORM public.billing_rpc('service-requests','create',v_payload-'requesterSignatureId');RAISE EXCEPTION 'Missing selected requester silently used operator';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('service-requests','create',v_payload||jsonb_build_object('requesterSignatureId',v_manager->>'id'));RAISE EXCEPTION 'Manager signature accepted as requester';EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('service-requests','create',v_payload||'{"createdBy":{"userId":"72000000-0000-4000-8000-000000000001","name":"Gerente"}}');RAISE EXCEPTION 'Operator spoof accepted';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 v_request=public.billing_rpc('service-requests','create',v_payload)->'request';v_history=v_request->'history'->0;
 IF v_request->'requester'->'userId' IS DISTINCT FROM 'null'::jsonb OR v_request->'requester'->>'name'<>'Edmilson sem conta'
  OR v_request->'requester'->>'signatureId'<>v_person->>'id' OR v_request->'requester'->>'signaturePath'<>v_path
  OR v_request->'createdBy'->>'userId'<>'72000000-0000-4000-8000-000000000002' OR v_request->'createdBy'->>'name'<>'Operador Logado'
  OR v_history->>'actorId'<>'72000000-0000-4000-8000-000000000002' OR v_history->>'actorName'<>'Operador Logado' OR v_history->>'signaturePath'<>v_path THEN
  RAISE EXCEPTION 'Selected person, logged-in operator and history mixed up: %',v_request; END IF;
 IF (public.billing_rpc('service-requests','list',jsonb_build_object('requesterId',v_person->>'id'))->>'total')::integer<>1 THEN RAISE EXCEPTION 'Requester filter not keyed by signature id'; END IF;
 IF (public.billing_rpc('service-requests','list','{"requesterId":"72000000-0000-4000-8000-000000000002"}')->>'total')::integer<>0 THEN RAISE EXCEPTION 'Requester filter incorrectly matches operator user id'; END IF;
 BEGIN PERFORM public.billing_rpc('service-requests','create',v_payload||jsonb_build_object('requesterSignatureId',v_other_person->>'id'));RAISE EXCEPTION 'Retry changed selected person';EXCEPTION WHEN unique_violation THEN NULL;END;
 PERFORM public.billing_rpc('signatures','deactivate',jsonb_build_object('id',v_person->>'id'));
 IF public.billing_rpc('service-requests','create',v_payload)->'request'<>v_request THEN RAISE EXCEPTION 'Retry failed after requester deactivation'; END IF;
 v_options=public.billing_rpc('service-requests','options','{}');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_options->'requesterSignatures') s WHERE s->>'id'=v_person->>'id')
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_options->'requesters') s WHERE s->>'id'=v_person->>'id') THEN RAISE EXCEPTION 'Inactive historical person missing from filter or available for new request'; END IF;
 -- A new request cannot use the now inactive person; the previous one remains valid.
 v_file=public.billing_rpc('service-requests','prepare-upload','{"requestId":"72000000-0000-4000-8000-000000000022","fileName":"outro.pdf","contentType":"application/pdf","size":400}')->'file';
 INSERT INTO storage.objects(bucket_id,name) VALUES(v_file->>'bucket',v_file->>'path');
 BEGIN PERFORM public.billing_rpc('service-requests','create',v_payload||jsonb_build_object('requestId','72000000-0000-4000-8000-000000000022','attachmentIds',jsonb_build_array(v_file->>'id')));RAISE EXCEPTION 'Inactive requester accepted for new request';EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;
 -- Approver uses their authenticated manager signature, independent of requester.
 PERFORM set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000001',true);
 v_current=public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_request->>'id','decision','approved','reason','Aprovado pelo gerente'))->'request';
 IF v_current->'decision'->>'userId'<>'72000000-0000-4000-8000-000000000001' OR v_current->'decision'->>'signatureId'<>v_manager->>'id'
  OR v_current->'createdBy'<>v_request->'createdBy' OR v_current->'requester'<>v_request->'requester' THEN RAISE EXCEPTION 'Decision replaced requester or operator';END IF;
 BEGIN PERFORM public.billing_rpc('service-requests','create',v_payload);RAISE EXCEPTION 'Another actor reused operator idempotency key';EXCEPTION WHEN unique_violation THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000004',true);
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='billing-signatures' AND name=v_path)
  OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='billing-signatures' AND name=v_other_person->>'filePath') THEN
  RAISE EXCEPTION 'Requests reader cannot load historical and active requester PNG';END IF;
 PERFORM set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000003',true);
 IF EXISTS(SELECT 1 FROM public.billing_signatures) OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='billing-signatures') THEN RAISE EXCEPTION 'People signatures leak across workspace';END IF;
 IF jsonb_array_length(public.billing_rpc('service-requests','options','{}')->'requesterSignatures')<>0 THEN RAISE EXCEPTION 'Requester options leaked across workspace';END IF;
 v_file=public.billing_rpc('service-requests','prepare-upload','{"requestId":"72000000-0000-4000-8000-000000000023","fileName":"externo.pdf","contentType":"application/pdf","size":400}')->'file';
 INSERT INTO storage.objects(bucket_id,name) VALUES(v_file->>'bucket',v_file->>'path');
 BEGIN PERFORM public.billing_rpc('service-requests','create',v_payload||jsonb_build_object('requestId','72000000-0000-4000-8000-000000000023','requesterSignatureId',v_other_person->>'id','attachmentIds',jsonb_build_array(v_file->>'id')));RAISE EXCEPTION 'Cross-workspace requester person accepted';EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;
END $$;
RESET ROLE;
ROLLBACK;
