BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('71000000-0000-4000-8000-000000000001','request-owner@example.invalid',now()),
 ('71000000-0000-4000-8000-000000000002','request-creator@example.invalid',now()),
 ('71000000-0000-4000-8000-000000000003','request-manager@example.invalid',now()),
 ('71000000-0000-4000-8000-000000000004','request-outsider@example.invalid',now()),
 ('71000000-0000-4000-8000-000000000005','request-reader@example.invalid',now());
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
SELECT public.billing_rpc('settings','get','{}');
SELECT set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
SELECT public.billing_rpc('settings','get','{}');
RESET ROLE;
INSERT INTO public.billing_access_profiles(id,owner_id,name,permissions) VALUES
 ('71000000-0000-4000-8000-000000000011','71000000-0000-4000-8000-000000000001','Solicitante',ARRAY['requests.read','requests.write','registrations.read']),
 ('71000000-0000-4000-8000-000000000012','71000000-0000-4000-8000-000000000001','Gerente',ARRAY['requests.read','requests.approve']),
 ('71000000-0000-4000-8000-000000000013','71000000-0000-4000-8000-000000000001','Consulta solicitações',ARRAY['requests.read']);
INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,status) VALUES
 ('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000011','active'),
 ('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000012','active'),
 ('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000005','71000000-0000-4000-8000-000000000013','active');
INSERT INTO public.billing_user_settings(user_id,owner_id,name) VALUES
 ('71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000001','Solicitante Logado'),
 ('71000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000001','Gerente Logado'),
 ('71000000-0000-4000-8000-000000000005','71000000-0000-4000-8000-000000000001','Leitor');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
DO $$
DECLARE v_result jsonb;v_file jsonb;v_signature jsonb;v_user text;v_role text;v_request jsonb;v_payload jsonb;v_approved jsonb;v_rejected jsonb;
 v_original_path text;v_pending_file jsonb;v_count integer;
BEGIN
 -- Defaults and profile RPC accept the new catalog without granting unauthorized delegation.
 BEGIN PERFORM public.billing_rpc('signatures',null,'{}');RAISE EXCEPTION 'Null signature action accepted';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('service-requests',null,'{}');RAISE EXCEPTION 'Null request action accepted';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 IF NOT EXISTS(SELECT 1 FROM public.billing_access_profiles WHERE name='Administrador' AND 'requests.approve'=ANY(permissions)) THEN
  RAISE EXCEPTION 'New workspace administrator lacks request approval'; END IF;
 v_result=public.billing_rpc('access-profiles','save','{"name":"Gestão assinaturas","description":"Cadastro restrito","permissions":["signatures.manage"]}');
 BEGIN
  PERFORM public.billing_rpc('access-profiles','save','{"name":"Aprovação inválida","description":"","permissions":["requests.approve"]}');
  RAISE EXCEPTION 'Approval without read permission accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 v_result=public.billing_rpc('signatures','options','{}');
 IF jsonb_array_length(v_result->'users')<>4 OR NOT (v_result->>'canManage')::boolean THEN RAISE EXCEPTION 'Workspace signature options leak or omit members: %',v_result; END IF;
 BEGIN
  PERFORM public.billing_rpc('signatures','prepare-upload','{"fileName":"bad.svg","contentType":"image/svg+xml","size":200}');
  RAISE EXCEPTION 'Non-PNG signature accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('signatures','prepare-upload','{"fileName":"big.png","contentType":"image/png","size":3145729}');
  RAISE EXCEPTION 'Oversized signature accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 FOREACH v_user IN ARRAY ARRAY['71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003'] LOOP
  FOREACH v_role IN ARRAY ARRAY['requester','manager'] LOOP
   v_file=public.billing_rpc('signatures','prepare-upload','{"fileName":"assinatura.png","contentType":"image/png","size":120}') -> 'file';
   BEGIN
    PERFORM public.billing_rpc('signatures','save',jsonb_build_object('name','Assinante '||right(v_user,1),'userId',v_user,'role',v_role,'fileId',v_file->>'id'));
    RAISE EXCEPTION 'Signature saved before upload';
   EXCEPTION WHEN SQLSTATE '23514' THEN NULL; END;
   INSERT INTO storage.objects(bucket_id,name) VALUES(v_file->>'bucket',v_file->>'path');
   v_signature=public.billing_rpc('signatures','save',jsonb_build_object('name','Assinante '||right(v_user,1),'userId',v_user,'role',v_role,'fileId',v_file->>'id'))->'signature';
   IF v_signature->>'filePath'<>v_file->>'path' OR v_signature->>'userId'<>v_user THEN RAISE EXCEPTION 'Signature linkage mismatch'; END IF;
   UPDATE storage.objects SET name=name||'.changed' WHERE bucket_id=v_file->>'bucket' AND name=v_file->>'path';
   GET DIAGNOSTICS v_count=ROW_COUNT;
   IF v_count<>0 THEN RAISE EXCEPTION 'Immutable signature object updated'; END IF;
   DELETE FROM storage.objects WHERE bucket_id=v_file->>'bucket' AND name=v_file->>'path';
   GET DIAGNOSTICS v_count=ROW_COUNT;
   IF v_count<>0 THEN RAISE EXCEPTION 'Immutable signature object deleted'; END IF;
  END LOOP;
 END LOOP;
 v_file=public.billing_rpc('signatures','prepare-upload','{"fileName":"other.png","contentType":"image/png","size":120}') -> 'file';
 INSERT INTO storage.objects(bucket_id,name) VALUES(v_file->>'bucket',v_file->>'path');
 BEGIN
  PERFORM public.billing_rpc('signatures','save',jsonb_build_object('name','Conta externa','userId','71000000-0000-4000-8000-000000000004','role','requester','fileId',v_file->>'id'));
  RAISE EXCEPTION 'External user signature accepted';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('signatures','save',jsonb_build_object('name','Duplicado','userId','71000000-0000-4000-8000-000000000002','role','requester','fileId',v_file->>'id'));
  RAISE EXCEPTION 'Duplicate active signature accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;

 PERFORM set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
 v_result=public.billing_rpc('service-requests','options','{}');
 IF NOT (v_result->>'canCreate')::boolean OR (v_result->>'canDecide')::boolean OR v_result->'requesterSignature'->>'userId'<>'71000000-0000-4000-8000-000000000002' THEN
  RAISE EXCEPTION 'Creator capabilities or own signature incorrect: %',v_result; END IF;
 IF (public.billing_rpc('signatures','options','{}')->>'canManage')::boolean THEN RAISE EXCEPTION 'Registration reader can manage signatures'; END IF;
 BEGIN
  PERFORM public.billing_rpc('users','list','{}');RAISE EXCEPTION 'Creator can administer users';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('signatures','deactivate',jsonb_build_object('id',v_signature->>'id'));RAISE EXCEPTION 'Creator can disable signatures';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
 BEGIN
  INSERT INTO public.billing_service_request_events(owner_id,request_id,action,actor_id,actor_name,signature_path)
   VALUES('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000020','created','71000000-0000-4000-8000-000000000002','Spoof','bad');
  RAISE EXCEPTION 'Direct audit write accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO storage.objects(bucket_id,name) VALUES('billing-request-files','arbitrary/unreserved.pdf');RAISE EXCEPTION 'Unreserved upload accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 v_file=public.billing_rpc('service-requests','prepare-upload','{"requestId":"71000000-0000-4000-8000-000000000020","fileName":"orcamento.pdf","contentType":"application/pdf","size":1500}')->'file';
 v_pending_file=public.billing_rpc('service-requests','prepare-upload','{"requestId":"71000000-0000-4000-8000-000000000020","fileName":"nao-usado.pdf","contentType":"application/pdf","size":800}')->'file';
 v_payload=jsonb_build_object('requestId','71000000-0000-4000-8000-000000000020','companyName','Tornearia Propriá','companyAddress','Rua das Flores, 10',
  'items',jsonb_build_array(jsonb_build_object('description','Confeccionar duas mangueiras hidráulicas','application','Carregadeira BM100 220/221')),
  'serviceValue','1430.00','returnDate','2026-09-30','notes','Orçamento anexo','attachmentIds',jsonb_build_array(v_file->>'id'));
 BEGIN
  PERFORM public.billing_rpc('service-requests','create',v_payload);RAISE EXCEPTION 'Budget without completed upload accepted';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('service-requests','create',v_payload||'{"ownerId":"71000000-0000-4000-8000-000000000004"}');RAISE EXCEPTION 'Owner spoof accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('service-requests','create',v_payload||'{"requesterId":"71000000-0000-4000-8000-000000000003"}');RAISE EXCEPTION 'Requester spoof accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('service-requests','create',v_payload||'{"serviceValue":"1430.001"}');RAISE EXCEPTION 'Fractional cents accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('service-requests','create',v_payload||'{"attachmentIds":[]}');RAISE EXCEPTION 'Missing budget accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 INSERT INTO storage.objects(bucket_id,name) VALUES(v_file->>'bucket',v_file->>'path');
 v_request=public.billing_rpc('service-requests','create',v_payload)->'request';
 v_original_path=v_request->'requester'->>'signaturePath';
 IF v_request->>'status'<>'pending' OR v_request->>'serviceValue'<>'1430' OR (v_request->>'number')::integer<>1
  OR v_request->'requester'->>'userId'<>'71000000-0000-4000-8000-000000000002' OR jsonb_array_length(v_request->'history')<>1
  OR extract(milliseconds FROM (v_request->>'createdAt')::timestamptz)::integer % 1000<>0 OR (v_request->>'canDecide')::boolean THEN
  RAISE EXCEPTION 'Invalid created request: %',v_request; END IF;
 IF public.billing_rpc('service-requests','create',v_payload)->'request'<>v_request THEN RAISE EXCEPTION 'Idempotent create changed data'; END IF;
 BEGIN
  PERFORM public.billing_rpc('service-requests','create',v_payload||'{"serviceValue":"1400"}');RAISE EXCEPTION 'Changed idempotent payload accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
  INSERT INTO storage.objects(bucket_id,name) VALUES(v_pending_file->>'bucket',v_pending_file->>'path');RAISE EXCEPTION 'New attachment uploaded after submission';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('service-requests','prepare-upload','{"requestId":"71000000-0000-4000-8000-000000000020","fileName":"extra.pdf","contentType":"application/pdf","size":10}');
  RAISE EXCEPTION 'Post-submission reservation accepted';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL; END;
 UPDATE storage.objects SET name=name||'.changed' WHERE bucket_id=v_file->>'bucket' AND name=v_file->>'path';
 GET DIAGNOSTICS v_count=ROW_COUNT;IF v_count<>0 THEN RAISE EXCEPTION 'Budget modified after submission'; END IF;
 DELETE FROM storage.objects WHERE bucket_id=v_file->>'bucket' AND name=v_file->>'path';
 GET DIAGNOSTICS v_count=ROW_COUNT;IF v_count<>0 THEN RAISE EXCEPTION 'Budget deleted after submission'; END IF;
 BEGIN
  PERFORM public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_request->>'id','decision','approved','reason',''));RAISE EXCEPTION 'Requester approved without permission';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;

 -- Separate manager sees requests without access to user administration.
 PERFORM set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000003',true);
 v_signature=public.billing_rpc('service-requests','options','{}')->'managerSignature';
 PERFORM set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
 PERFORM public.billing_rpc('signatures','deactivate',jsonb_build_object('id',v_signature->>'id'));
 PERFORM set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000003',true);
 IF (public.billing_rpc('service-requests','get',jsonb_build_object('id',v_request->>'id'))->'request'->>'canDecide')::boolean THEN RAISE EXCEPTION 'Inactive signature still authorizes decision'; END IF;
 BEGIN
  PERFORM public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_request->>'id','decision','approved','reason',''));RAISE EXCEPTION 'Manager decided using inactive signature';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
 PERFORM public.billing_rpc('signatures','save',jsonb_build_object('id',v_signature->>'id','name','Assinante 3','userId','71000000-0000-4000-8000-000000000003','role','manager'));
 PERFORM set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000003',true);
 IF NOT (public.billing_rpc('service-requests','get',jsonb_build_object('id',v_request->>'id'))->'request'->>'canDecide')::boolean THEN RAISE EXCEPTION 'Manager cannot decide'; END IF;
 BEGIN
  PERFORM public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_request->>'id','decision','rejected','reason',''));RAISE EXCEPTION 'Reasonless rejection accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_request->>'id','decision','approved','reason','','decidedAt','2000-01-01'));RAISE EXCEPTION 'Decision timestamp spoof accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 v_approved=public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_request->>'id','decision','approved','reason','Conferido'))->'request';
 IF v_approved->>'status'<>'approved' OR v_approved->'decision'->>'userId'<>'71000000-0000-4000-8000-000000000003'
  OR v_approved->'decision'->>'name'<>'Assinante 3' OR jsonb_array_length(v_approved->'history')<>2 OR (v_approved->>'canDecide')::boolean THEN
  RAISE EXCEPTION 'Manager decision snapshot incorrect: %',v_approved; END IF;
 IF public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_request->>'id','decision','approved','reason','Conferido'))->'request'<>v_approved THEN
  RAISE EXCEPTION 'Idempotent decision duplicated history'; END IF;
 BEGIN
  PERFORM public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_request->>'id','decision','rejected','reason','Outra decisão'));RAISE EXCEPTION 'Final decision replaced';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 v_result=public.billing_rpc('service-requests','list',jsonb_build_object('tab','finished','search','mangueiras','page',1,'pageSize',1,
  'dateFrom',(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date::text,'dateTo',(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date::text,'requesterId','71000000-0000-4000-8000-000000000002'));
 IF (v_result->>'total')::integer<>1 OR (v_result->'counts'->>'finished')::integer<>1 OR (v_result->'counts'->>'pending')::integer<>0 THEN
  RAISE EXCEPTION 'Server pagination/search/date/requester filters wrong: %',v_result; END IF;
 v_result=public.billing_rpc('service-requests','list','{"tab":"finished","page":2,"pageSize":1}');
 IF jsonb_array_length(v_result->'items')<>1 OR (v_result->>'page')::integer<>1 THEN RAISE EXCEPTION 'Empty page did not return to last available page'; END IF;

 -- Historical evidence survives replacing and deactivating the registered PNG.
 PERFORM set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
 v_signature=public.billing_rpc('service-requests','options','{}')->'requesterSignature';
 v_file=public.billing_rpc('signatures','prepare-upload','{"fileName":"assinatura-nova.png","contentType":"image/png","size":125}')->'file';
 INSERT INTO storage.objects(bucket_id,name) VALUES(v_file->>'bucket',v_file->>'path');
 v_signature=public.billing_rpc('signatures','save',jsonb_build_object('id',v_request->'requester'->>'signatureId','name','Nome atualizado','userId','71000000-0000-4000-8000-000000000002','role','requester','fileId',v_file->>'id'))->'signature';
 PERFORM public.billing_rpc('signatures','deactivate',jsonb_build_object('id',v_signature->>'id'));
 v_result=public.billing_rpc('service-requests','get',jsonb_build_object('id',v_request->>'id'))->'request';
 IF v_result->'requester'->>'name'<>'Assinante 2' OR v_result->'requester'->>'signaturePath'<>v_original_path THEN RAISE EXCEPTION 'Historic signature changed'; END IF;
 PERFORM public.billing_rpc('signatures','save',jsonb_build_object('id',v_signature->>'id','name','Nome atualizado','userId','71000000-0000-4000-8000-000000000002','role','requester','active',true));
 BEGIN
  PERFORM public.billing_rpc('service-requests','create',v_payload);RAISE EXCEPTION 'Another actor reused the requester idempotency key';
 EXCEPTION WHEN unique_violation THEN NULL; END;

 -- Product decision: a permitted manager can decide their own request.
 v_file=public.billing_rpc('service-requests','prepare-upload','{"requestId":"71000000-0000-4000-8000-000000000021","fileName":"orcamento2.jpg","contentType":"image/jpeg","size":400}')->'file';
 INSERT INTO storage.objects(bucket_id,name) VALUES(v_file->>'bucket',v_file->>'path');
 v_payload=v_payload||jsonb_build_object('requestId','71000000-0000-4000-8000-000000000021','attachmentIds',jsonb_build_array(v_file->>'id'),'serviceValue','0');
 v_request=public.billing_rpc('service-requests','create',v_payload)->'request';
 v_rejected=public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_request->>'id','decision','rejected','reason','Orçamento será refeito'))->'request';
 IF v_rejected->>'status'<>'rejected' OR v_rejected->'decision'->>'userId'<>v_rejected->'requester'->>'userId' THEN RAISE EXCEPTION 'Manager cannot decide own request'; END IF;

 -- Other workspaces cannot read files, details, audit rows or make decisions.
 PERFORM set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
 IF (public.billing_rpc('service-requests','list','{"tab":"finished"}')->>'total')::integer<>0 THEN RAISE EXCEPTION 'Cross-workspace list leak'; END IF;
 IF EXISTS(SELECT 1 FROM public.billing_service_request_events) OR EXISTS(SELECT 1 FROM public.billing_signatures) THEN RAISE EXCEPTION 'Cross-workspace table leak'; END IF;
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id IN ('billing-signatures','billing-request-files')) THEN RAISE EXCEPTION 'Cross-workspace Storage leak'; END IF;
 BEGIN
  PERFORM public.billing_rpc('service-requests','get',jsonb_build_object('id',v_request->>'id'));RAISE EXCEPTION 'Cross-workspace detail leaked';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_request->>'id','decision','approved','reason',''));RAISE EXCEPTION 'Cross-workspace decision accepted';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000005',true);
 IF (public.billing_rpc('service-requests','list','{"tab":"finished"}')->>'total')::integer<>2 THEN RAISE EXCEPTION 'Workspace reader cannot see final requests'; END IF;
 BEGIN
  PERFORM public.billing_rpc('service-requests','prepare-upload','{"requestId":"71000000-0000-4000-8000-000000000023","fileName":"bad.pdf","contentType":"application/pdf","size":40}');RAISE EXCEPTION 'Reader uploaded budget';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE name=v_original_path) THEN RAISE EXCEPTION 'Reader cannot access historic signature'; END IF;
 PERFORM set_config('request.jwt.claim.sub','',true);
 BEGIN PERFORM public.billing_rpc('service-requests','list','{}');RAISE EXCEPTION 'Anonymous RPC allowed';EXCEPTION WHEN SQLSTATE '28000' THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.billing_memberships SET status='disabled' WHERE user_id='71000000-0000-4000-8000-000000000003';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000003',true);
DO $$
BEGIN
 BEGIN PERFORM public.billing_rpc('service-requests','options','{}');RAISE EXCEPTION 'Disabled actor accessed requests';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 IF EXISTS(SELECT 1 FROM public.billing_service_requests) OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id IN ('billing-signatures','billing-request-files')) THEN
  RAISE EXCEPTION 'Disabled actor retained table or Storage access'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
