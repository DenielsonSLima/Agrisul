BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('97000000-0000-4000-8000-000000000001','photo-import-owner@example.invalid',now()),
 ('97000000-0000-4000-8000-000000000002','photo-import-other@example.invalid',now()),
 ('97000000-0000-4000-8000-000000000003','photo-import-member@example.invalid',now()),
 ('97000000-0000-4000-8000-000000000004','photo-import-reader@example.invalid',now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true);
SELECT public.billing_rpc('settings','get','{}');
INSERT INTO storage.objects(id,bucket_id,name) VALUES
 ('97000000-0000-4000-8000-000000000010','billing-material-images',
  '97000000-0000-4000-8000-000000000001/materials/97000000-0000-4000-8000-000000000010.webp'),
 ('97000000-0000-4000-8000-000000000011','billing-material-images',
  '97000000-0000-4000-8000-000000000001/materials/97000000-0000-4000-8000-000000000011.webp');

DO $$
DECLARE
 v_requester uuid;
 v_existing uuid;
 v_new uuid;
 v_quote uuid;
 v_payload jsonb;
 v_second_payload jsonb;
 v_result jsonb;
 v_replay jsonb;
 v_status jsonb;
 v_source jsonb:=jsonb_build_object(
  'kind','chat-image','label','lista-da-fazenda.jpg','sha256',repeat('A',64));
 v_request uuid:='97000000-0000-4000-8000-000000000020';
 v_image_key text:='97000000-0000-4000-8000-000000000001/materials/97000000-0000-4000-8000-000000000010.webp';
BEGIN
 v_requester=(public.billing_rpc('signatures','save',
  '{"name":"Equipe de compras","role":"requester"}')
  ->'signature'->>'id')::uuid;
 v_existing=(public.billing_rpc('materials','save',
  '{"name":"Parafuso de aço","internalCode":"MAT-PAR-1","unit":"PC","application":"Fixação"}')
  ->'material'->>'id')::uuid;
 PERFORM public.billing_rpc('material-variants','save',jsonb_build_object(
  'materialId',v_existing,'brand','Marca A','code','PAR-100'));

 v_payload=jsonb_build_object(
  'requestId',v_request,'source',v_source,
  'title','Reposição da oficina','requestDate','2026-10-05',
  'requesterSignatureId',v_requester,'notes','Aguardando fornecedores',
  'items',jsonb_build_array(
   jsonb_build_object(
    'name','Filtro hidráulico','internalCode','MAT-FIL-1',
    'unit','PC','quantity','2','application','Trator',
    'brand','MANN','code','FH-700','notes','Linha 1',
    'sourceText','2 Filtro hidráulico MANN FH-700',
    'imageKey',v_image_key,'imageName','fh-700.webp',
    'imageSourceUrl','https://images.example.invalid/fh-700.webp',
    'imageEvidenceUrl','https://fabricante.example.invalid/produtos/fh-700'),
   jsonb_build_object(
    'materialId',v_existing,'name','Parafuso de aço',
    'internalCode','MAT-PAR-1','unit','PC','quantity','1,25',
    'brand','Marca A','code','PAR-100','notes','',
    'sourceText','1,25 Parafuso de aço PAR-100')),
  'providers','[]'::jsonb);
 v_result=public.billing_rpc('quotations','import-draft',v_payload);
 v_quote=(v_result->'quote'->>'id')::uuid;
 v_new=(v_result->'items'->0->>'materialId')::uuid;
 IF v_quote IS NULL OR v_new IS NULL
  OR v_result->>'requestId'<>v_request::text
  OR v_result->'items'->0->>'createdMaterial'<>'true'
  OR v_result->'items'->1->>'createdMaterial'<>'false'
  OR v_result->'quote'->>'requester'<>'Equipe de compras'
  OR jsonb_array_length(v_result->'quote'->'items')<>2
  OR jsonb_array_length(v_result->'quote'->'providers')<>0 THEN
  RAISE EXCEPTION 'Photo import envelope, requester or optional providers invalid: %',v_result;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.billing_materials m
  WHERE m.owner_id=auth.uid() AND m.id=v_new
   AND m.image_key=v_image_key AND m.code='MAT-FIL-1')
  OR NOT EXISTS(SELECT 1 FROM public.billing_material_variants mv
   WHERE mv.owner_id=auth.uid() AND mv.material_id=v_new
    AND mv.brand='MANN' AND mv.code='FH-700')
  OR NOT EXISTS(SELECT 1 FROM public.billing_quotation_items i
   WHERE i.owner_id=auth.uid() AND i.quotation_id=v_quote
    AND i.material_id=v_existing AND i.quantity=1.25
    AND i.material_name='Parafuso de aço' AND i.material_code='MAT-PAR-1') THEN
  RAISE EXCEPTION 'Catalog photo, reference or quotation snapshots are invalid';
 END IF;
 IF (SELECT count(*) FROM public.billing_quotation_import_lines l
  JOIN public.billing_quotation_imports im
   ON im.owner_id=l.owner_id AND im.id=l.import_id
  WHERE im.owner_id=auth.uid() AND im.request_id=v_request)<>2
  OR NOT EXISTS(SELECT 1 FROM public.billing_quotation_import_lines l
   WHERE l.owner_id=auth.uid() AND l.material_id=v_new
    AND l.source_text='2 Filtro hidráulico MANN FH-700'
    AND l.image_evidence_url='https://fabricante.example.invalid/produtos/fh-700') THEN
  RAISE EXCEPTION 'Per-line import provenance is missing';
 END IF;

 v_replay=public.billing_rpc('quotations','import-draft',v_payload);
 IF v_replay IS DISTINCT FROM v_result
  OR (SELECT count(*) FROM public.billing_quotation_imports im
   WHERE im.owner_id=auth.uid() AND im.request_id=v_request)<>1
  OR (SELECT count(*) FROM public.billing_quotations q
   WHERE q.owner_id=auth.uid() AND q.id=v_quote)<>1 THEN
  RAISE EXCEPTION 'Identical retry changed the result or duplicated records';
 END IF;
 v_status=public.billing_rpc('quotations','import-status',
  jsonb_build_object('requestId',v_request));
 IF v_status->>'exists'<>'true'
  OR v_status->'requestPayload' IS DISTINCT FROM v_payload
  OR v_status->'result' IS DISTINCT FROM v_result THEN
  RAISE EXCEPTION 'Import status did not return the original payload and result';
 END IF;
 IF public.billing_rpc('quotations','import-status',jsonb_build_object(
  'requestId','97000000-0000-4000-8000-000000000099'))
   IS DISTINCT FROM '{"exists":false}'::jsonb THEN
  RAISE EXCEPTION 'Unknown import status did not return exists=false';
 END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','import-draft',
   jsonb_set(v_payload,'{title}',to_jsonb('Outro título'::text)));
  RAISE EXCEPTION 'RequestId accepted different input';
 EXCEPTION WHEN unique_violation THEN NULL; END;

 -- The exact manufacturer reference reuses the material without a photo.
 v_second_payload=jsonb_build_object(
  'requestId','97000000-0000-4000-8000-000000000021',
  'source',v_source,'title','Nova lista de filtros',
  'requestDate','2026-10-05','requesterSignatureId',v_requester,
  'items',jsonb_build_array(jsonb_build_object(
   'name','Filtro hidráulico','unit','PC','quantity','3',
   'brand','mann','code','fh-700','sourceText','3 filtros FH-700')));
 v_result=public.billing_rpc('quotations','import-draft',v_second_payload);
 IF v_result->'items'->0->>'materialId'<>v_new::text
  OR v_result->'items'->0->>'createdMaterial'<>'false'
  OR (SELECT count(*) FROM public.billing_materials m
   WHERE m.owner_id=auth.uid() AND m.id=v_new)<>1 THEN
  RAISE EXCEPTION 'Exact brand/code did not reuse material: %',v_result;
 END IF;
 PERFORM public.billing_rpc('quotations','delete',
  jsonb_build_object('id',v_result->'quote'->>'id'));
 IF NOT EXISTS(SELECT 1 FROM public.billing_quotation_imports im
  WHERE im.owner_id=auth.uid()
   AND im.request_id='97000000-0000-4000-8000-000000000021'
   AND im.quotation_id IS NULL) THEN
  RAISE EXCEPTION 'Deleted import did not retain its idempotency tombstone';
 END IF;
 v_status=public.billing_rpc('quotations','import-status',
  jsonb_build_object('requestId','97000000-0000-4000-8000-000000000021'));
 IF v_status->>'exists'<>'true'
  OR v_status->'requestPayload' IS DISTINCT FROM v_second_payload THEN
  RAISE EXCEPTION 'Deleted import lost its original status payload';
 END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','import-draft',v_second_payload);
  RAISE EXCEPTION 'Deleted import was recreated on retry';
 EXCEPTION WHEN check_violation THEN NULL; END;

 -- A weak name+unit collision is not silently treated as the same product.
 BEGIN
  PERFORM public.billing_rpc('quotations','import-draft',jsonb_build_object(
   'requestId','97000000-0000-4000-8000-000000000022',
   'source',v_source,'title','Referência duvidosa',
   'requestDate','2026-10-05','requesterSignatureId',v_requester,
   'items',jsonb_build_array(jsonb_build_object(
    'name','Filtro hidraulico','unit','PC','quantity','1',
    'brand','Outra marca','code','X-999','sourceText','Filtro X-999'))));
  RAISE EXCEPTION 'Ambiguous name and unit were accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.billing_quotation_imports
  WHERE owner_id=auth.uid()
   AND request_id='97000000-0000-4000-8000-000000000022') THEN
  RAISE EXCEPTION 'Rejected ambiguity left an import record';
 END IF;

 -- An explicit ID cannot attach a novel filter reference to a bolt merely
 -- because both products use the same unit.
 BEGIN
  PERFORM public.billing_rpc('quotations','import-draft',jsonb_build_object(
   'requestId','97000000-0000-4000-8000-000000000027',
   'source',v_source,'title','ID com nome incompatível',
   'requestDate','2026-10-05','requesterSignatureId',v_requester,
   'items',jsonb_build_array(jsonb_build_object(
    'materialId',v_existing,'name','Filtro hidráulico','unit','PC',
    'quantity','1','brand','Nova marca','code','FH-NOVO',
    'sourceText','Filtro hidráulico FH-NOVO'))));
  RAISE EXCEPTION 'New filter reference was attached to a bolt';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.billing_material_variants mv
  WHERE mv.owner_id=auth.uid() AND mv.brand='Nova marca' AND mv.code='FH-NOVO')
  OR EXISTS(SELECT 1 FROM public.billing_quotation_imports im
   WHERE im.owner_id=auth.uid()
    AND im.request_id='97000000-0000-4000-8000-000000000027') THEN
  RAISE EXCEPTION 'Rejected mismatched material left partial writes';
 END IF;

 -- Explicit product selection permits adding a new reference to that product.
 v_result=public.billing_rpc('quotations','import-draft',jsonb_build_object(
  'requestId','97000000-0000-4000-8000-000000000023',
  'source',v_source,'title','Referência selecionada',
  'requestDate','2026-10-05','requesterSignatureId',v_requester,
  'items',jsonb_build_array(jsonb_build_object(
   'materialId',v_new,'name','Filtro hidraulico','unit','PC',
   'quantity','1','brand','Outra marca','code','X-999',
   'sourceText','Filtro X-999'))));
 IF v_result->'items'->0->>'materialId'<>v_new::text
  OR NOT EXISTS(SELECT 1 FROM public.billing_material_variants mv
   WHERE mv.owner_id=auth.uid() AND mv.material_id=v_new
    AND mv.brand='Outra marca' AND mv.code='X-999') THEN
  RAISE EXCEPTION 'Explicit material choice did not add the reference';
 END IF;

 BEGIN
  PERFORM public.billing_rpc('quotations','import-draft',jsonb_build_object(
   'requestId','97000000-0000-4000-8000-000000000024',
   'source',v_source,'title','Referência conflitante',
   'requestDate','2026-10-05','requesterSignatureId',v_requester,
   'items',jsonb_build_array(jsonb_build_object(
    'materialId',v_existing,'name','Parafuso de aço','unit','PC',
    'quantity','1','brand','MANN','code','FH-700',
    'sourceText','Código de outro produto'))));
  RAISE EXCEPTION 'Conflicting explicit ID and reference were accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;

 BEGIN
  PERFORM public.billing_rpc('quotations','import-draft',jsonb_build_object(
   'requestId','97000000-0000-4000-8000-000000000025',
   'source',v_source,'title','Foto não enviada',
   'requestDate','2026-10-05','requesterSignatureId',v_requester,
   'items',jsonb_build_array(jsonb_build_object(
    'name','Correia nova','unit','PC','quantity','1',
    'brand','Marca C','code','COR-1','sourceText','Correia COR-1',
    'imageKey','97000000-0000-4000-8000-000000000001/materials/missing.webp',
    'imageName','missing.webp',
    'imageSourceUrl','https://images.example.invalid/cor-1.webp',
    'imageEvidenceUrl','https://fabricante.example.invalid/cor-1'))));
  RAISE EXCEPTION 'Missing private image object was accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.billing_quotation_imports im
  WHERE im.owner_id=auth.uid()
   AND im.request_id='97000000-0000-4000-8000-000000000025')
  OR EXISTS(SELECT 1 FROM public.billing_materials m
   WHERE m.owner_id=auth.uid() AND m.name='Correia nova') THEN
  RAISE EXCEPTION 'Missing-image failure left partial data';
 END IF;

 -- The first line creates a product, then invalid quantity on line two must
 -- roll that product, its reference and the import reservation back together.
 BEGIN
  PERFORM public.billing_rpc('quotations','import-draft',jsonb_build_object(
   'requestId','97000000-0000-4000-8000-000000000026',
   'source',v_source,'title','Lista com quantidade inválida',
   'requestDate','2026-10-05','requesterSignatureId',v_requester,
   'items',jsonb_build_array(
    jsonb_build_object(
     'name','Bomba inédita','unit','PC','quantity','1',
     'brand','Marca B','code','BOM-1','sourceText','Bomba BOM-1',
     'imageKey','97000000-0000-4000-8000-000000000001/materials/97000000-0000-4000-8000-000000000011.webp',
     'imageName','bom-1.webp',
     'imageSourceUrl','https://images.example.invalid/bom-1.webp',
     'imageEvidenceUrl','https://fabricante.example.invalid/bom-1'),
    jsonb_build_object(
     'materialId',v_existing,'name','Parafuso de aço','unit','PC',
     'quantity','0','sourceText','0 parafusos'))));
  RAISE EXCEPTION 'Invalid later line was accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.billing_materials
  WHERE owner_id=auth.uid() AND name='Bomba inédita')
  OR EXISTS(SELECT 1 FROM public.billing_material_variants
   WHERE owner_id=auth.uid() AND code='BOM-1')
  OR EXISTS(SELECT 1 FROM public.billing_quotation_imports
   WHERE owner_id=auth.uid()
    AND request_id='97000000-0000-4000-8000-000000000026') THEN
  RAISE EXCEPTION 'Later validation failure did not roll back all SQL writes';
 END IF;
 PERFORM set_config('test.photo.import.quote',v_quote::text,true);
 PERFORM set_config('test.photo.import.request',v_request::text,true);
 PERFORM set_config('test.photo.import.requester',v_requester::text,true);
 PERFORM set_config('test.photo.import.existing',v_existing::text,true);
END $$;

-- The existing Administrator profile must be able to save quotations and
-- private PDFs through the narrow quotations -> registrations aliases.
RESET ROLE;
INSERT INTO public.billing_memberships(
 owner_id,user_id,access_profile_id,is_owner,status)
SELECT '97000000-0000-4000-8000-000000000001',
 '97000000-0000-4000-8000-000000000003',p.id,false,'active'
FROM public.billing_access_profiles p
WHERE p.owner_id='97000000-0000-4000-8000-000000000001'
 AND p.name='Administrador';
INSERT INTO public.billing_memberships(
 owner_id,user_id,access_profile_id,is_owner,status)
SELECT '97000000-0000-4000-8000-000000000001',
 '97000000-0000-4000-8000-000000000004',p.id,false,'active'
FROM public.billing_access_profiles p
WHERE p.owner_id='97000000-0000-4000-8000-000000000001'
 AND p.name='Somente leitura';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000003',true);
DO $$
DECLARE
 v_requester uuid:=current_setting('test.photo.import.requester')::uuid;
 v_result jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM public.billing_quotation_imports)
  OR EXISTS(SELECT 1 FROM public.billing_quotation_import_lines) THEN
  RAISE EXCEPTION 'A different actor could read import provenance';
 END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','import-status',jsonb_build_object(
   'requestId',current_setting('test.photo.import.request')));
  RAISE EXCEPTION 'A different actor could read import status';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 v_result=public.billing_rpc('quotations','import-draft',jsonb_build_object(
  'requestId','97000000-0000-4000-8000-000000000031',
  'source',jsonb_build_object('kind','chat-image','label','member.jpg'),
  'title','Cotação do membro Administrador',
  'requestDate','2026-10-05','requesterSignatureId',v_requester,
  'items',jsonb_build_array(jsonb_build_object(
   'materialId',current_setting('test.photo.import.existing'),
   'name','Parafuso de aço','unit','PC','quantity','1',
   'sourceText','1 parafuso'))));
 IF v_result->'quote'->>'id' IS NULL
  OR NOT EXISTS(SELECT 1 FROM public.billing_quotation_imports im
  WHERE im.owner_id='97000000-0000-4000-8000-000000000001'
   AND im.request_id='97000000-0000-4000-8000-000000000031') THEN
  RAISE EXCEPTION 'Administrator member could not create a quotation';
 END IF;
END $$;

INSERT INTO storage.objects(id,bucket_id,name) VALUES(
 '97000000-0000-4000-8000-000000000041','billing-quotation-files',
 '97000000-0000-4000-8000-000000000001/quotations/mcp/admin.pdf');
DO $$ BEGIN
 IF (SELECT count(*) FROM storage.objects o
  WHERE o.bucket_id='billing-quotation-files'
   AND o.name='97000000-0000-4000-8000-000000000001/quotations/mcp/admin.pdf')<>1 THEN
  RAISE EXCEPTION 'Administrator could not read its private quotation PDF';
 END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000004',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM storage.objects o
  WHERE o.bucket_id='billing-quotation-files'
   AND o.name='97000000-0000-4000-8000-000000000001/quotations/mcp/admin.pdf')<>1
  OR jsonb_array_length(public.billing_rpc('quotations','list',
   '{"status":"open"}')->'quotes')=0 THEN
  RAISE EXCEPTION 'Read-only member lost quotation or private PDF read access';
 END IF;
 BEGIN
  INSERT INTO storage.objects(id,bucket_id,name) VALUES(
   '97000000-0000-4000-8000-000000000042','billing-quotation-files',
   '97000000-0000-4000-8000-000000000001/quotations/mcp/reader.pdf');
  RAISE EXCEPTION 'Read-only member wrote a private quotation PDF';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('quotations','import-status',jsonb_build_object(
   'requestId','97000000-0000-4000-8000-000000000031'));
  RAISE EXCEPTION 'Read-only member accessed writable import status';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- Another account sees no imported rows and cannot fetch or reuse the first
-- owner's material identifiers, even with the same requestId.
SELECT set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true);
SELECT public.billing_rpc('settings','get','{}');
DO $$
DECLARE v_quote uuid:=current_setting('test.photo.import.quote')::uuid;
BEGIN
 IF public.billing_rpc('quotations','import-status',jsonb_build_object(
  'requestId',current_setting('test.photo.import.request')))
   IS DISTINCT FROM '{"exists":false}'::jsonb THEN
  RAISE EXCEPTION 'Foreign workspace import status was revealed';
 END IF;
 IF EXISTS(SELECT 1 FROM public.billing_quotation_imports)
  OR EXISTS(SELECT 1 FROM public.billing_quotation_import_lines) THEN
  RAISE EXCEPTION 'Import provenance leaked across workspaces';
 END IF;
 IF EXISTS(SELECT 1 FROM storage.objects o
  WHERE o.bucket_id='billing-quotation-files'
   AND o.name='97000000-0000-4000-8000-000000000001/quotations/mcp/admin.pdf') THEN
  RAISE EXCEPTION 'Foreign workspace could read private quotation PDF';
 END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','get',jsonb_build_object('id',v_quote));
  RAISE EXCEPTION 'Foreign quotation was readable';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('quotations','import-draft',jsonb_build_object(
   'requestId',current_setting('test.photo.import.request'),
   'source',jsonb_build_object('kind','chat-image','label','foreign.jpg'),
   'title','Cotação com material alheio','requestDate','2026-10-05',
   'requesterSignatureId',current_setting('test.photo.import.requester'),
   'items',jsonb_build_array(jsonb_build_object(
    'materialId',current_setting('test.photo.import.existing'),
    'name','Parafuso de aço','unit','PC','quantity','1',
    'sourceText','Material de outra conta'))));
  RAISE EXCEPTION 'Foreign material/signature was accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

DO $$ BEGIN
 BEGIN
  INSERT INTO public.billing_quotation_imports(
   owner_id,request_id,actor_id,source,request_payload)
  VALUES('97000000-0000-4000-8000-000000000002',
   '97000000-0000-4000-8000-000000000040',
   '97000000-0000-4000-8000-000000000002','{}','{}');
  RAISE EXCEPTION 'Direct import DML was allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

RESET ROLE;
ROLLBACK;
