BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('9b000000-0000-4000-8000-000000000001','quotation-permission-owner@example.invalid',now()),
 ('9b000000-0000-4000-8000-000000000002','quotation-permission-writer@example.invalid',now()),
 ('9b000000-0000-4000-8000-000000000003','quotation-permission-reader@example.invalid',now()),
 ('9b000000-0000-4000-8000-000000000004','quotation-permission-outsider@example.invalid',now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','9b000000-0000-4000-8000-000000000001',true);
SELECT public.billing_rpc('settings','get','{}');
DO $$
DECLARE r jsonb;
BEGIN
 r=public.billing_rpc('signatures','save','{"name":"Solicitante da regressão","role":"requester"}');
 PERFORM set_config('test.quotation_permissions.requester',r->'signature'->>'id',true);
 r=public.billing_rpc('materials','save','{"name":"Retentor de regressão","internalCode":"PERMISSION-001","unit":"PC","application":"Trator"}');
 PERFORM set_config('test.quotation_permissions.material',r->'material'->>'id',true);
END $$;

RESET ROLE;
INSERT INTO public.billing_access_profiles(id,owner_id,name,permissions) VALUES
 ('9b000000-0000-4000-8000-000000000040','9b000000-0000-4000-8000-000000000001','Escritor de cotações',ARRAY['registrations.read','registrations.write']),
 ('9b000000-0000-4000-8000-000000000041','9b000000-0000-4000-8000-000000000001','Leitor de cotações',ARRAY['registrations.read']);
INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,is_owner,status) VALUES
 ('9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000002','9b000000-0000-4000-8000-000000000040',false,'active'),
 ('9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000003','9b000000-0000-4000-8000-000000000041',false,'active');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','9b000000-0000-4000-8000-000000000002',true);
DO $$
DECLARE
 r jsonb;
 payload jsonb;
 quote_id uuid;
 pdf_path text:='9b000000-0000-4000-8000-000000000001/quotations/permission-draft.pdf';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.billing_memberships WHERE user_id=auth.uid() AND NOT is_owner) THEN
  RAISE EXCEPTION 'Quotation writer fixture must not be an owner';
 END IF;
 payload=jsonb_build_object(
  'title','Cotação criada por membro','number','PERMISSION-NO-PDF','requestDate','2026-10-05',
  'requester','Ignorado','requesterSignatureId',current_setting('test.quotation_permissions.requester'),
  'notes','','items',jsonb_build_array(jsonb_build_object(
   'id','9b000000-0000-4000-8000-000000000010',
   'materialId',current_setting('test.quotation_permissions.material'),'quantity','2','notes','')),
  'providers','[]'::jsonb);
 PERFORM set_config('test.quotation_permissions.payload',payload::text,true);
 r=public.billing_rpc('quotations','save',payload);
 quote_id=(r->'quote'->>'id')::uuid;
 PERFORM set_config('test.quotation_permissions.quote',quote_id::text,true);
 IF r->'quote'->>'status'<>'open' OR r->'quote'->>'requester'<>'Solicitante da regressão'
  OR r->'quote'->'providers'<>'[]'::jsonb OR r->'quote'->'attachmentKey'<>'null'::jsonb
  OR r->'quote'->'items'->0->>'quantity'<>'2'
  OR NOT EXISTS(SELECT 1 FROM public.billing_quotations WHERE id=quote_id
   AND owner_id='9b000000-0000-4000-8000-000000000001') THEN
  RAISE EXCEPTION 'Non-owner registration writer could not create a provider-less quotation: %',r;
 END IF;
 r=public.billing_rpc('quotations','update-item-quantity',jsonb_build_object(
  'id',quote_id,'quotationItemId','9b000000-0000-4000-8000-000000000010','quantity','3.125'));
 IF r->'quote'->'items'->0->>'quantity'<>'3.125' THEN
  RAISE EXCEPTION 'Non-owner registration writer could not update quantity: %',r;
 END IF;

 INSERT INTO storage.objects(bucket_id,name) VALUES('billing-quotation-files',pdf_path);
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='billing-quotation-files' AND name=pdf_path) THEN
  RAISE EXCEPTION 'Non-owner registration writer cannot read an uploaded quotation PDF';
 END IF;
 BEGIN
  INSERT INTO storage.objects(bucket_id,name) VALUES('billing-quotation-files',
   '9b000000-0000-4000-8000-000000000001/quotations/not-a-pdf.webp');
  RAISE EXCEPTION 'Quotation PDF storage accepted another extension';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO storage.objects(bucket_id,name) VALUES('billing-quotation-files',
   '9b000000-0000-4000-8000-000000000004/quotations/foreign.pdf');
  RAISE EXCEPTION 'Quotation writer uploaded to another workspace';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 payload=payload||jsonb_build_object('number','PERMISSION-WITH-PDF',
  'items',jsonb_build_array(jsonb_build_object('id','9b000000-0000-4000-8000-000000000011',
   'materialId',current_setting('test.quotation_permissions.material'),'quantity','1','notes','')),
  'attachmentKey',pdf_path,'attachmentName','solicitacao.pdf','attachmentSize',128);
 r=public.billing_rpc('quotations','save',payload);
 PERFORM set_config('test.quotation_permissions.pdf_quote',r->'quote'->>'id',true);
 IF r->'quote'->>'attachmentKey'<>pdf_path
  OR r->'quote'->>'attachmentName'<>'solicitacao.pdf'
  OR r->'quote'->>'attachmentSize'<>'128' OR r->'quote'->'providers'<>'[]'::jsonb THEN
  RAISE EXCEPTION 'Non-owner registration writer could not create a quotation with its PDF: %',r;
 END IF;

 BEGIN
  INSERT INTO public.billing_quotations(owner_id,title,quotation_number,request_date,requester,notes,status)
   VALUES('9b000000-0000-4000-8000-000000000001','Direct insert','DIRECT','2026-10-05','Writer','','open');
  RAISE EXCEPTION 'Registration writer directly inserted a quotation';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.billing_quotations SET title='Direct update' WHERE id=quote_id;
  RAISE EXCEPTION 'Registration writer directly updated a quotation';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  DELETE FROM public.billing_quotations WHERE id=quote_id;
  RAISE EXCEPTION 'Registration writer directly deleted a quotation';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.billing_quotation_items SET quantity=99
   WHERE id='9b000000-0000-4000-8000-000000000010';
  RAISE EXCEPTION 'Registration writer directly updated quotation items';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claim.sub','9b000000-0000-4000-8000-000000000003',true);
DO $$
DECLARE r jsonb;affected integer;
 pdf_path text:='9b000000-0000-4000-8000-000000000001/quotations/permission-draft.pdf';
BEGIN
 r=public.billing_rpc('quotations','get',jsonb_build_object('id',current_setting('test.quotation_permissions.pdf_quote')));
 IF r->'quote'->>'attachmentKey'<>pdf_path
  OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='billing-quotation-files' AND name=pdf_path) THEN
  RAISE EXCEPTION 'Registration reader cannot read a quotation and its private PDF';
 END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','save',current_setting('test.quotation_permissions.payload')::jsonb);
  RAISE EXCEPTION 'Read-only member created a quotation';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('quotations','update-item-quantity',jsonb_build_object(
   'id',current_setting('test.quotation_permissions.quote'),
   'quotationItemId','9b000000-0000-4000-8000-000000000010','quantity','4'));
  RAISE EXCEPTION 'Read-only member updated a quotation quantity';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('quotations','delete',jsonb_build_object('id',current_setting('test.quotation_permissions.quote')));
  RAISE EXCEPTION 'Read-only member deleted a quotation';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO storage.objects(bucket_id,name) VALUES('billing-quotation-files',
   '9b000000-0000-4000-8000-000000000001/quotations/reader.pdf');
  RAISE EXCEPTION 'Read-only member uploaded a quotation PDF';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 DELETE FROM storage.objects WHERE bucket_id='billing-quotation-files' AND name=pdf_path;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='billing-quotation-files' AND name=pdf_path) THEN
  RAISE EXCEPTION 'Read-only member deleted a quotation PDF';
 END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','9b000000-0000-4000-8000-000000000004',true);
SELECT public.billing_rpc('settings','get','{}');
DO $$
DECLARE r jsonb;affected integer;
 pdf_path text:='9b000000-0000-4000-8000-000000000001/quotations/permission-draft.pdf';
BEGIN
 r=public.billing_rpc('quotations','list','{"status":"open"}');
 IF r->'quotes'<>'[]'::jsonb OR EXISTS(SELECT 1 FROM storage.objects
  WHERE bucket_id='billing-quotation-files' AND name=pdf_path) THEN
  RAISE EXCEPTION 'Quotations or private PDFs leaked into another workspace';
 END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','get',jsonb_build_object('id',current_setting('test.quotation_permissions.quote')));
  RAISE EXCEPTION 'Outsider read another workspace quotation';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('quotations','update-item-quantity',jsonb_build_object(
   'id',current_setting('test.quotation_permissions.quote'),
   'quotationItemId','9b000000-0000-4000-8000-000000000010','quantity','4'));
  RAISE EXCEPTION 'Outsider changed another workspace quotation quantity';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('quotations','save',current_setting('test.quotation_permissions.payload')::jsonb);
  RAISE EXCEPTION 'Outsider created a quotation using another workspace references';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO storage.objects(bucket_id,name) VALUES('billing-quotation-files',
   '9b000000-0000-4000-8000-000000000001/quotations/outsider.pdf');
  RAISE EXCEPTION 'Outsider uploaded a quotation PDF into another workspace';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 DELETE FROM storage.objects WHERE bucket_id='billing-quotation-files' AND name=pdf_path;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'Outsider deleted another workspace PDF'; END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.billing_rpc('quotations','save',current_setting('test.quotation_permissions.payload')::jsonb);
  RAISE EXCEPTION 'Quotation creation accepted a missing authenticated identity';
 EXCEPTION WHEN SQLSTATE '28000' THEN NULL; END;
 BEGIN
  INSERT INTO storage.objects(bucket_id,name) VALUES('billing-quotation-files',
   '9b000000-0000-4000-8000-000000000001/quotations/no-session.pdf');
  RAISE EXCEPTION 'Quotation PDF upload accepted a missing identity';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM public.billing_rpc('quotations','list','{"status":"open"}');
  RAISE EXCEPTION 'Anonymous user read quotations';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','9b000000-0000-4000-8000-000000000002',true);
DO $$
DECLARE r jsonb;affected integer;
 pdf_path text:='9b000000-0000-4000-8000-000000000001/quotations/permission-draft.pdf';
BEGIN
 r=public.billing_rpc('quotations','delete',jsonb_build_object('id',current_setting('test.quotation_permissions.pdf_quote')));
 IF r->>'deleted'<>'true' OR r->>'attachmentKey'<>pdf_path THEN
  RAISE EXCEPTION 'Non-owner registration writer could not delete the PDF quotation: %',r;
 END IF;
 DELETE FROM storage.objects WHERE bucket_id='billing-quotation-files' AND name=pdf_path;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='billing-quotation-files' AND name=pdf_path) THEN
  RAISE EXCEPTION 'Non-owner registration writer could not delete the quotation PDF';
 END IF;
 r=public.billing_rpc('quotations','delete',jsonb_build_object('id',current_setting('test.quotation_permissions.quote')));
 IF r->>'deleted'<>'true' OR EXISTS(SELECT 1 FROM public.billing_quotations) THEN
  RAISE EXCEPTION 'Quotation permission fixtures were not deleted by the registration writer';
 END IF;
END $$;
RESET ROLE;
ROLLBACK;
