-- Every fixture and every destructive assertion is rolled back, including when
-- this suite is executed against the remote project.
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('9c000000-0000-4000-8000-000000000001','provider-removal-owner@example.invalid',now()),
 ('9c000000-0000-4000-8000-000000000002','provider-removal-outsider@example.invalid',now()),
 ('9c000000-0000-4000-8000-000000000003','provider-removal-writer@example.invalid',now()),
 ('9c000000-0000-4000-8000-000000000004','provider-removal-reader@example.invalid',now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','9c000000-0000-4000-8000-000000000001',true);
SELECT public.billing_rpc('settings','get','{}');
DO $$ DECLARE r jsonb; BEGIN
 r=public.billing_rpc('signatures','save','{"name":"Solicitante da remoção","role":"requester"}');
 PERFORM set_config('test.provider_removal.signature',r->'signature'->>'id',true);
END $$;
RESET ROLE;
INSERT INTO public.billing_access_profiles(id,owner_id,name,permissions) VALUES
 ('9c000000-0000-4000-8000-000000000040','9c000000-0000-4000-8000-000000000001','Escritor da remoção',ARRAY['registrations.read','registrations.write']),
 ('9c000000-0000-4000-8000-000000000041','9c000000-0000-4000-8000-000000000001','Leitor da remoção',ARRAY['registrations.read']);
INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,is_owner,status) VALUES
 ('9c000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000003','9c000000-0000-4000-8000-000000000040',false,'active'),
 ('9c000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000004','9c000000-0000-4000-8000-000000000041',false,'active');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','9c000000-0000-4000-8000-000000000003',true);
DO $$
DECLARE
 r jsonb;
 before_quote jsonb;
 before_other jsonb;
 before_remaining jsonb;
 remaining jsonb;
 payload jsonb;
 signature_id uuid;
 material_a uuid;
 material_b uuid;
 registry_a uuid;
 registry_b uuid;
 quote_id uuid;
 other_quote_id uuid;
 item_a uuid:=gen_random_uuid();
 item_b uuid:=gen_random_uuid();
 other_item uuid:=gen_random_uuid();
 supplier_a uuid:=gen_random_uuid();
 supplier_b uuid:=gen_random_uuid();
 other_supplier uuid:=gen_random_uuid();
 replacement_supplier uuid:=gen_random_uuid();
BEGIN
 signature_id=current_setting('test.provider_removal.signature')::uuid;
 r=public.billing_rpc('materials','save','{"name":"Material A da remoção","internalCode":"REM-A","unit":"PC","application":"Trator"}');
 material_a=(r->'material'->>'id')::uuid;
 r=public.billing_rpc('materials','save','{"name":"Material B da remoção","internalCode":"REM-B","unit":"PC","application":"Trator"}');
 material_b=(r->'material'->>'id')::uuid;
 payload='{"documentType":"CPF","document":"52998224725","legalName":"Fornecedor A da remoção","tradeName":"Fornecedor A","street":"Rua A","number":"1","complement":"","district":"Centro","city":"Cidade","state":"SP","zipCode":"01001000","phone":"11999990000","email":"removal-a@example.invalid"}';
 r=public.billing_rpc('service-providers','save',payload);
 registry_a=(r->'provider'->>'id')::uuid;
 r=public.billing_rpc('service-providers','save',payload||jsonb_build_object(
  'document','11144477735','legalName','Fornecedor B da remoção','tradeName','Fornecedor B'));
 registry_b=(r->'provider'->>'id')::uuid;
 payload=jsonb_build_object('title','Remoção de fornecedor com preços','number','',
  'requestDate','2026-10-05','requesterSignatureId',signature_id,'notes','',
  'items',jsonb_build_array(
   jsonb_build_object('id',item_a,'materialId',material_a,'quantity','2','notes',''),
   jsonb_build_object('id',item_b,'materialId',material_b,'quantity','3','notes','')),
  'providers',jsonb_build_array(
   jsonb_build_object('id',supplier_a,'providerId',registry_a,'notes','','sentAt',NULL,'values','{}'::jsonb),
   jsonb_build_object('id',supplier_b,'providerId',registry_b,'notes','','sentAt',NULL,'values','{}'::jsonb)));
 r=public.billing_rpc('quotations','save',payload);
 quote_id=(r->'quote'->>'id')::uuid;
 PERFORM set_config('test.provider_removal.quote',quote_id::text,true);
 PERFORM set_config('test.provider_removal.supplier',supplier_b::text,true);
 PERFORM public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',supplier_a,'quotationItemId',item_a,'unitPrice','10','notes','Preço inicial'));
 PERFORM public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',supplier_a,'quotationItemId',item_a,
  'unitPrice','9','availableQuantity','1','discountType','amount','discountValue','1','notes','Preço revisado'));
 PERFORM public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',supplier_b,'quotationItemId',item_b,'unitPrice','20','notes','Proposta preservada'));
 PERFORM public.billing_rpc('quotations','award-item',jsonb_build_object(
  'id',quote_id,'quotationProviderId',supplier_a,'quotationItemId',item_a));
 r=public.billing_rpc('quotations','award-item',jsonb_build_object(
  'id',quote_id,'quotationProviderId',supplier_b,'quotationItemId',item_b));
 before_quote=r->'quote';
 SELECT p INTO before_remaining FROM jsonb_array_elements(before_quote->'providers') p
 WHERE p->>'id'=supplier_b::text;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(before_quote->'providers') p
  WHERE NOT (p->>'canRemove')::boolean OR p->>'removeBlockedReason'<>'') THEN
  RAISE EXCEPTION 'Prices, revisions or awards still block supplier removal: %',before_quote;
 END IF;

 payload=payload||jsonb_build_object('title','Outra cotação preservada',
  'items',jsonb_build_array(jsonb_build_object('id',other_item,'materialId',material_a,'quantity','2','notes','')),
  'providers',jsonb_build_array(jsonb_build_object('id',other_supplier,'providerId',registry_a,'notes','','sentAt',NULL,'values','{}'::jsonb)));
 r=public.billing_rpc('quotations','save',payload);
 other_quote_id=(r->'quote'->>'id')::uuid;
 r=public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',other_quote_id,'quotationProviderId',other_supplier,'quotationItemId',other_item,'unitPrice','7','notes','Outra cotação'));
 before_other=r->'quote';
 BEGIN
  PERFORM public.billing_rpc('quotations','remove-provider',jsonb_build_object(
   'id',quote_id,'quotationProviderId',supplier_a,'unexpected',true));
  RAISE EXCEPTION 'Supplier removal accepted fields outside its whitelist';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  DELETE FROM public.billing_quotation_negotiations WHERE quotation_id=quote_id;
  RAISE EXCEPTION 'Supplier history was directly writable';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;

 r=public.billing_rpc('quotations','remove-provider',jsonb_build_object(
  'id',quote_id,'quotationProviderId',other_supplier));
 IF r->'quote'<>before_quote THEN
  RAISE EXCEPTION 'A supplier id belonging to another quotation changed this quotation';
 END IF;
 r=public.billing_rpc('quotations','remove-provider',jsonb_build_object(
  'id',quote_id,'quotationProviderId',supplier_a));
 SELECT p INTO remaining FROM jsonb_array_elements(r->'quote'->'providers') p
 WHERE p->>'id'=supplier_b::text;
 IF jsonb_array_length(r->'quote'->'providers')<>1
  OR r->'quote'->'items'<>before_quote->'items'
  OR jsonb_array_length(r->'quote'->'negotiations')<>1
  OR jsonb_array_length(r->'quote'->'itemAwards')<>1
  OR r->'quote'->'itemAwards'->0->>'providerId'<>supplier_b::text
  OR r->'quote'->>'awardedTotal'<>'60'
  OR r->'quote'->>'pendingAwardCount'<>'1'
  OR remaining->'values'<>before_remaining->'values'
  OR remaining->'offers'<>before_remaining->'offers'
  OR remaining->>'total'<>before_remaining->>'total'
  OR EXISTS(SELECT 1 FROM public.billing_quotation_negotiations WHERE quotation_id=quote_id AND quotation_provider_id=supplier_a)
  OR EXISTS(SELECT 1 FROM public.billing_quotation_provider_values WHERE quotation_id=quote_id AND quotation_provider_id=supplier_a)
  OR EXISTS(SELECT 1 FROM public.billing_quotation_item_awards WHERE quotation_id=quote_id AND quotation_provider_id=supplier_a) THEN
  RAISE EXCEPTION 'Supplier removal cleanup, preserved scope or recalculated totals are incorrect: %',r;
 END IF;
 before_quote=r->'quote';
 r=public.billing_rpc('quotations','remove-provider',jsonb_build_object(
  'id',quote_id,'quotationProviderId',supplier_a));
 IF r->'quote'<>before_quote THEN RAISE EXCEPTION 'Supplier removal retry is not idempotent'; END IF;
 r=public.billing_rpc('quotations','get',jsonb_build_object('id',other_quote_id));
 IF r->'quote'<>before_other THEN RAISE EXCEPTION 'Removal changed another quotation'; END IF;
 r=public.billing_rpc('service-providers','get',jsonb_build_object('id',registry_a));
 IF r->'provider'->>'id'<>registry_a::text THEN RAISE EXCEPTION 'Supplier registry was removed'; END IF;

 r=public.billing_rpc('quotations','remove-provider',jsonb_build_object(
  'id',quote_id,'quotationProviderId',supplier_b));
 IF r->'quote'->'providers'<>'[]'::jsonb OR r->'quote'->'negotiations'<>'[]'::jsonb
  OR r->'quote'->'itemAwards'<>'[]'::jsonb OR r->'quote'->>'awardedTotal'<>'0' THEN
  RAISE EXCEPTION 'Removing the last priced supplier did not clear its proposal and award: %',r;
 END IF;
 r=public.billing_rpc('quotations','add-providers',jsonb_build_object('id',quote_id,
  'providers',jsonb_build_array(jsonb_build_object('id',replacement_supplier,'providerId',registry_a,'notes','','sentAt',NULL))));
 IF jsonb_array_length(r->'quote'->'providers')<>1
  OR r->'quote'->'negotiations'<>'[]'::jsonb OR r->'quote'->'providers'->0->'offers'<>'{}'::jsonb THEN
  RAISE EXCEPTION 'Readding a removed supplier restored deleted commercial history';
 END IF;
 PERFORM public.billing_rpc('quotations','award-item',jsonb_build_object(
  'id',other_quote_id,'quotationProviderId',other_supplier,'quotationItemId',other_item));
 r=public.billing_rpc('quotations','finalize',jsonb_build_object('id',other_quote_id));
 before_other=r->'quote';
 IF (before_other->'providers'->0->>'canRemove')::boolean THEN
  RAISE EXCEPTION 'A finalized supplier still advertises removal';
 END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','remove-provider',jsonb_build_object(
   'id',other_quote_id,'quotationProviderId',other_supplier));
  RAISE EXCEPTION 'Removal changed a finalized quotation';
 EXCEPTION WHEN check_violation THEN NULL; END;
 r=public.billing_rpc('quotations','get',jsonb_build_object('id',other_quote_id));
 IF r->'quote'<>before_other THEN RAISE EXCEPTION 'Rejected removal changed a generated purchase order'; END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','9c000000-0000-4000-8000-000000000004',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.billing_rpc('quotations','remove-provider',jsonb_build_object(
   'id',current_setting('test.provider_removal.quote'),'quotationProviderId',current_setting('test.provider_removal.supplier')));
  RAISE EXCEPTION 'A read-only member removed a supplier';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','9c000000-0000-4000-8000-000000000002',true);
SELECT public.billing_rpc('settings','get','{}');
DO $$ BEGIN
 BEGIN
  PERFORM public.billing_rpc('quotations','remove-provider',jsonb_build_object(
   'id',current_setting('test.provider_removal.quote'),'quotationProviderId',current_setting('test.provider_removal.supplier')));
  RAISE EXCEPTION 'Another workspace removed a supplier';
 EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.billing_rpc('quotations','remove-provider',jsonb_build_object(
   'id',current_setting('test.provider_removal.quote'),'quotationProviderId',current_setting('test.provider_removal.supplier')));
  RAISE EXCEPTION 'An unauthenticated session removed a supplier';
 EXCEPTION WHEN invalid_authorization_specification THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
