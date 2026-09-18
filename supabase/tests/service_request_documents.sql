SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000001',true);
DO $$
DECLARE v_legacy jsonb:=current_setting('test.manual.legacy')::jsonb;v_current jsonb;v_default jsonb;v_template jsonb;v_layout jsonb;v_changed jsonb;
 v_person jsonb;v_png_person jsonb;v_manager jsonb;v_file jsonb;v_payload jsonb;v_manual jsonb;v_registered jsonb;v_with_png_manual jsonb;v_decided jsonb;v_hash text;
BEGIN
 v_current=public.billing_rpc('service-requests','get','{"id":"72000000-0000-4000-8000-000000000020"}')->'request';
 IF ((v_current->'requester')-'signingMode'-'signatureHash')<>v_legacy->'requester'
  OR ((v_current->'decision')-'signingMode'-'signatureHash')<>v_legacy->'decision'
  OR v_current->>'createdAt'<>v_legacy->>'createdAt' OR v_current->'createdBy'<>v_legacy->'createdBy'
  OR v_current->'requester'->>'signingMode'<>'registered' OR v_current->'template'->>'version'<>'0'
  OR v_current->>'documentHash'!~'^[a-f0-9]{64}$' OR v_current->'decision'->>'signatureHash'!~'^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'Legacy record changed or gained invalid evidence: %',v_current; END IF;
 v_default=public.billing_rpc('document-templates','get','{"key":"service-request"}')->'template';
 IF v_default->>'version'<>'0' OR jsonb_array_length(public.billing_rpc('document-templates','list','{}')->'items')<>1 THEN RAISE EXCEPTION 'Default model missing'; END IF;
 v_layout=v_default->'layout';
 v_template=public.billing_rpc('document-templates','save',jsonb_build_object('key','service-request','name','Modelo aprovado v1','layout',v_layout,'expectedVersion',0))->'template';
 IF v_template->>'version'<>'1' OR v_template->'layout'<>v_layout THEN RAISE EXCEPTION 'Template persistence failed'; END IF;
 BEGIN PERFORM public.billing_rpc('document-templates','save',jsonb_build_object('key','service-request','name','Overwrite','layout',v_layout,'expectedVersion',0));RAISE EXCEPTION 'Stale model overwrote current version';EXCEPTION WHEN serialization_failure THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('document-templates','save',jsonb_build_object('key','service-request','name','Missing version','layout',v_layout));RAISE EXCEPTION 'Missing optimistic version accepted';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 v_changed=jsonb_set(v_layout,'{blocks,0,x}','210');
 BEGIN PERFORM public.billing_rpc('document-templates','save',jsonb_build_object('key','service-request','name','Outside bounds','layout',v_changed,'expectedVersion',1));RAISE EXCEPTION 'Out-of-page layout saved';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 v_changed=jsonb_set(v_layout,'{blocks,0,fontSize}','4');
 BEGIN PERFORM public.billing_rpc('document-templates','save',jsonb_build_object('key','service-request','name','Tiny font','layout',v_changed,'expectedVersion',1));RAISE EXCEPTION 'Invalid font saved';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 v_changed=jsonb_set(v_layout,'{blocks,0,script}','"alert(1)"');
 BEGIN PERFORM public.billing_rpc('document-templates','save',jsonb_build_object('key','service-request','name','Unknown field','layout',v_changed,'expectedVersion',1));RAISE EXCEPTION 'Unknown layout key saved';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 v_changed=jsonb_set(v_layout,'{blocks,1,id}',v_layout->'blocks'->0->'id');
 BEGIN PERFORM public.billing_rpc('document-templates','save',jsonb_build_object('key','service-request','name','Repeated id','layout',v_changed,'expectedVersion',1));RAISE EXCEPTION 'Repeated block id saved';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 v_changed=jsonb_set(v_layout,'{blocks,2,field}','"ownerSecrets"');
 BEGIN PERFORM public.billing_rpc('document-templates','save',jsonb_build_object('key','service-request','name','Private field','layout',v_changed,'expectedVersion',1));RAISE EXCEPTION 'Unknown data field saved';EXCEPTION WHEN SQLSTATE '22023' THEN NULL;END;
 -- The operator registers a person using only their name, without login or PNG.
 PERFORM set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000002',true);
 v_person=public.billing_rpc('signatures','save','{"name":"Solicitante manuscrito","role":"requester"}')->'signature';
 IF v_person->'fileId' IS DISTINCT FROM 'null'::jsonb OR v_person->'filePath' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'PNG-less person did not save'; END IF;
 v_payload=jsonb_build_object('requestId','72000000-0000-4000-8000-000000000031','requesterSignatureId',v_person->>'id','companyName','Fornecedor sem orçamento',
  'companyAddress','','items',jsonb_build_array(jsonb_build_object('description','Serviço ainda sem orçamento','application','Equipamento')),'serviceValue','0','returnDate',null,'notes','','attachmentIds','[]'::jsonb);
 BEGIN PERFORM public.billing_rpc('service-requests','create',v_payload||'{"requesterSigningMode":"registered"}');RAISE EXCEPTION 'Registered signature accepted without PNG';EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;
 v_manual=public.billing_rpc('service-requests','create',v_payload)->'request';
 IF v_manual->'requester'->>'signingMode'<>'manual' OR v_manual->'requester'->'signaturePath' IS DISTINCT FROM 'null'::jsonb
  OR v_manual->'requester'->'signatureHash' IS DISTINCT FROM 'null'::jsonb OR jsonb_array_length(v_manual->'attachments')<>0
  OR v_manual->'template'->>'version'<>'1' OR v_manual->>'documentHash'!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Manual request or template snapshot incorrect: %',v_manual; END IF;
 IF public.billing_rpc('service-requests','create',v_payload)->'request'<>v_manual THEN RAISE EXCEPTION 'Manual retry changed snapshot'; END IF;
 BEGIN PERFORM public.billing_rpc('service-requests','create',v_payload||'{"requesterSigningMode":"registered"}');RAISE EXCEPTION 'Retry replaced manual mode';EXCEPTION WHEN unique_violation THEN NULL;END;
 v_file=public.billing_rpc('signatures','prepare-upload','{"fileName":"posterior.png","contentType":"image/png","size":180}')->'file';
 INSERT INTO storage.objects(bucket_id,name) VALUES(v_file->>'bucket',v_file->>'path');
 v_png_person=public.billing_rpc('signatures','save',jsonb_build_object('id',v_person->>'id','name','Pessoa agora com PNG','role','requester','fileId',v_file->>'id'))->'signature';
 IF public.billing_rpc('service-requests','get',jsonb_build_object('id',v_manual->>'id'))->'request'<>v_manual
  OR public.billing_rpc('service-requests','create',v_payload)->'request'<>v_manual THEN RAISE EXCEPTION 'Adding PNG changed old manual evidence'; END IF;
 v_registered=public.billing_rpc('service-requests','create',v_payload||'{"requestId":"72000000-0000-4000-8000-000000000032","requesterSigningMode":"registered"}')->'request';
 IF v_registered->'requester'->>'signaturePath'<>v_file->>'path' OR v_registered->'requester'->>'signatureHash'!~'^[a-f0-9]{64}$'
  OR v_registered->'history'->0->>'signatureHash'<>v_registered->'requester'->>'signatureHash' THEN RAISE EXCEPTION 'Registered requester hash missing'; END IF;
 v_with_png_manual=public.billing_rpc('service-requests','create',v_payload||'{"requestId":"72000000-0000-4000-8000-000000000033","requesterSigningMode":"manual"}')->'request';
 IF v_with_png_manual->'requester'->'signaturePath' IS DISTINCT FROM 'null'::jsonb OR v_with_png_manual->'requester'->'signatureHash' IS DISTINCT FROM 'null'::jsonb THEN
  RAISE EXCEPTION 'Manual choice automatically inserted existing PNG'; END IF;
 BEGIN PERFORM public.billing_rpc('document-templates','save',jsonb_build_object('key','service-request','name','Unprivileged model','layout',v_layout,'expectedVersion',1));RAISE EXCEPTION 'Operator changed document model without permission';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 -- Manager account remains mandatory; its PNG is optional.
 PERFORM set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000001',true);
 v_manager=public.billing_rpc('service-requests','options','{}')->'managerSignature';
 v_hash=v_registered->>'documentHash';
 v_decided=public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_registered->>'id','decision','approved','reason','','managerSigningMode','registered'))->'request';
 IF v_decided->>'documentHash'<>v_hash OR v_decided->'decision'->>'signatureHash'!~'^[a-f0-9]{64}$'
  OR v_decided->'decision'->>'signatureHash'=v_decided->'requester'->>'signatureHash' THEN RAISE EXCEPTION 'Decision changed permanent QR hash or reused requester hash'; END IF;
 BEGIN PERFORM public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_registered->>'id','decision','approved','reason','','managerSigningMode','manual'));RAISE EXCEPTION 'Decision retry changed signing mode';EXCEPTION WHEN serialization_failure THEN NULL;END;
 v_decided=public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_with_png_manual->>'id','decision','approved','reason','','managerSigningMode','manual'))->'request';
 IF v_decided->'decision'->'signaturePath' IS DISTINCT FROM 'null'::jsonb OR v_decided->'decision'->'signatureHash' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Director manual mode used registered PNG'; END IF;
 PERFORM public.billing_rpc('signatures','save',jsonb_build_object('id',v_manager->>'id','name','Diretor sem PNG','role','manager','userId','72000000-0000-4000-8000-000000000001','fileId',null));
 BEGIN PERFORM public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_manual->>'id','decision','approved','reason','','managerSigningMode','registered'));RAISE EXCEPTION 'Registered director decision accepted without PNG';EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;
 v_decided=public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_manual->>'id','decision','rejected','reason','Conferir orçamento'))->'request';
 IF v_decided->'decision'->>'signingMode'<>'manual' OR v_decided->'decision'->>'userId'<>'72000000-0000-4000-8000-000000000001'
  OR v_decided->>'documentHash'<>v_manual->>'documentHash' THEN RAISE EXCEPTION 'Manual director decision lost account or immutable hash'; END IF;
 v_changed=jsonb_set(v_layout,'{blocks,1,text}','"MODELO ALTERADO POSTERIORMENTE"');
 v_template=public.billing_rpc('document-templates','save',jsonb_build_object('key','service-request','name','Modelo novo v2','layout',v_changed,'expectedVersion',1))->'template';
 IF v_template->>'version'<>'2' OR public.billing_rpc('service-requests','get',jsonb_build_object('id',v_manual->>'id'))->'request'->'template'<>v_manual->'template' THEN
  RAISE EXCEPTION 'Template edit changed old document snapshot'; END IF;
 v_current=public.billing_rpc('service-requests','create',v_payload||'{"requestId":"72000000-0000-4000-8000-000000000034","requesterSigningMode":"manual"}')->'request';
 IF v_current->'template'->>'version'<>'2' OR v_current->'template'->'layout'<>v_changed THEN RAISE EXCEPTION 'New request did not snapshot latest model'; END IF;
 PERFORM set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000003',true);
 IF (public.billing_rpc('document-templates','get','{"key":"service-request"}')->'template'->>'version')<>'0' OR EXISTS(SELECT 1 FROM public.billing_document_templates) THEN RAISE EXCEPTION 'Cross-workspace template leak'; END IF;
 BEGIN PERFORM public.billing_rpc('service-requests','get',jsonb_build_object('id',v_manual->>'id'));RAISE EXCEPTION 'Hash-enabled request leaked across workspace';EXCEPTION WHEN no_data_found THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub','',true);
 BEGIN PERFORM public.billing_rpc('document-templates','list','{}');RAISE EXCEPTION 'Anonymous model access';EXCEPTION WHEN SQLSTATE '28000' THEN NULL;END;
END $$;
RESET ROLE;
DO $$
DECLARE v_request public.billing_service_requests;
BEGIN
 FOR v_request IN SELECT * FROM public.billing_service_requests WHERE owner_id='72000000-0000-4000-8000-000000000001' LOOP
  IF billing_private.request_document_hash(v_request)<>v_request.document_hash OR billing_private.request_signer_hash(v_request,'requester') IS DISTINCT FROM v_request.requester_signature_hash
   OR billing_private.request_signer_hash(v_request,'manager') IS DISTINCT FROM v_request.decision_signature_hash THEN RAISE EXCEPTION 'Stored audit digest differs from server recomputation'; END IF;
 END LOOP;
 BEGIN UPDATE public.billing_service_requests SET notes='Altered after issuance' WHERE id='72000000-0000-4000-8000-000000000031';RAISE EXCEPTION 'Issued contents modified';EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;
 BEGIN UPDATE public.billing_service_requests SET decision_reason='Changed final reason' WHERE id='72000000-0000-4000-8000-000000000031';RAISE EXCEPTION 'Final decision evidence modified';EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;
END $$;
ROLLBACK;
