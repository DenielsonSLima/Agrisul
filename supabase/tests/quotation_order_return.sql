-- All accounts, orders and return history created here are rolled back.
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('9d000000-0000-4000-8000-000000000001','order-return-owner@example.invalid',now()),
 ('9d000000-0000-4000-8000-000000000002','order-return-outsider@example.invalid',now()),
 ('9d000000-0000-4000-8000-000000000003','order-return-writer@example.invalid',now()),
 ('9d000000-0000-4000-8000-000000000004','order-return-reader@example.invalid',now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','9d000000-0000-4000-8000-000000000001',true);
SELECT public.billing_rpc('settings','get','{}');
DO $$ DECLARE r jsonb; BEGIN
 r=public.billing_rpc('signatures','save','{"name":"Comprador do retorno","role":"requester"}');
 PERFORM set_config('test.order_return.signature',r->'signature'->>'id',true);
END $$;
RESET ROLE;
INSERT INTO public.billing_access_profiles(id,owner_id,name,permissions) VALUES
 ('9d000000-0000-4000-8000-000000000040','9d000000-0000-4000-8000-000000000001','Escritor do retorno',ARRAY['registrations.read','registrations.write']),
 ('9d000000-0000-4000-8000-000000000041','9d000000-0000-4000-8000-000000000001','Leitor do retorno',ARRAY['registrations.read']);
INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,is_owner,status) VALUES
 ('9d000000-0000-4000-8000-000000000001','9d000000-0000-4000-8000-000000000003','9d000000-0000-4000-8000-000000000040',false,'active'),
 ('9d000000-0000-4000-8000-000000000001','9d000000-0000-4000-8000-000000000004','9d000000-0000-4000-8000-000000000041',false,'active');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','9d000000-0000-4000-8000-000000000003',true);
DO $$
DECLARE
 r jsonb;
 payload jsonb;
 before_quote jsonb;
 before_other jsonb;
 orders_snapshot jsonb;
 items_snapshot jsonb;
 history jsonb;
 signature_id uuid;
 material_id uuid;
 provider_a uuid;
 provider_b uuid;
 payment_id uuid;
 quote_id uuid;
 other_id uuid;
 order_id uuid;
 item_a uuid:=gen_random_uuid();
 item_b uuid:=gen_random_uuid();
 supplier_a uuid:=gen_random_uuid();
 supplier_b uuid:=gen_random_uuid();
BEGIN
 signature_id=current_setting('test.order_return.signature')::uuid;
 r=public.billing_rpc('materials','save','{"name":"Material do retorno","internalCode":"RET-1","unit":"UN","application":"Trator"}');
 material_id=(r->'material'->>'id')::uuid;
 payload='{"documentType":"CPF","document":"52998224725","legalName":"Fornecedor A do retorno","tradeName":"Retorno A","street":"Rua A","number":"1","complement":"","district":"Centro","city":"Cidade","state":"SP","zipCode":"01001000","phone":"11999990000","email":"return-a@example.invalid"}';
 r=public.billing_rpc('service-providers','save',payload);
 provider_a=(r->'provider'->>'id')::uuid;
 r=public.billing_rpc('service-providers','save',payload||jsonb_build_object(
  'document','11144477735','legalName','Fornecedor B do retorno','tradeName','Retorno B'));
 provider_b=(r->'provider'->>'id')::uuid;
 r=public.billing_rpc('payment-methods','save','{"name":"30/60 dias","description":"Condição preservada"}');
 payment_id=(r->'paymentMethod'->>'id')::uuid;
 payload=jsonb_build_object('title','Retorno de dois pedidos','number','',
  'requestDate','2026-10-06','requesterSignatureId',signature_id,'notes','Preservar negociação',
  'items',jsonb_build_array(
   jsonb_build_object('id',item_a,'materialId',material_id,'quantity','2','notes','Primeiro item'),
   jsonb_build_object('id',item_b,'materialId',material_id,'quantity','3','notes','Segundo item')),
  'providers',jsonb_build_array(
   jsonb_build_object('id',supplier_a,'providerId',provider_a,'notes','','sentAt',NULL,'values','{}'::jsonb),
   jsonb_build_object('id',supplier_b,'providerId',provider_b,'notes','','sentAt',NULL,'values','{}'::jsonb)));
 r=public.billing_rpc('quotations','save',payload);
 quote_id=(r->'quote'->>'id')::uuid;
 PERFORM set_config('test.order_return.quote',quote_id::text,true);
 PERFORM public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',supplier_a,'quotationItemId',item_a,'unitPrice','10','notes','Inicial'));
 PERFORM public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',supplier_a,'quotationItemId',item_a,
  'unitPrice','9','availableQuantity','1','discountType','amount','discountValue','1','notes','Revisado'));
 PERFORM public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',supplier_b,'quotationItemId',item_b,'unitPrice','20','notes','Outro fornecedor'));
 PERFORM public.billing_rpc('quotations','award-item',jsonb_build_object(
  'id',quote_id,'quotationProviderId',supplier_a,'quotationItemId',item_a));
 PERFORM public.billing_rpc('quotations','award-item',jsonb_build_object(
  'id',quote_id,'quotationProviderId',supplier_b,'quotationItemId',item_b));
 r=public.billing_rpc('quotations','finalize',jsonb_build_object('id',quote_id));
 before_quote=r->'quote';
 IF jsonb_array_length(before_quote->'purchaseOrders')<>2 THEN
  RAISE EXCEPTION 'The fixture did not generate both supplier orders';
 END IF;
 order_id=(before_quote->'purchaseOrders'->0->>'id')::uuid;
 PERFORM public.billing_rpc('purchase-orders','save',jsonb_build_object(
  'id',order_id,'purchaseOrderNumber','OC-PRESERVADA','paymentMethodId',payment_id));
 SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) INTO orders_snapshot
 FROM public.billing_purchase_orders o WHERE o.quotation_id=quote_id;
 SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) INTO items_snapshot
 FROM public.billing_purchase_order_items i WHERE i.quotation_id=quote_id;
 -- An unrelated quotation must retain its status, contents and timestamps.
 payload=payload||jsonb_build_object('title','Outra cotação',
  'items',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),
   'materialId',material_id,'quantity','1','notes','')),'providers','[]'::jsonb);
 r=public.billing_rpc('quotations','save',payload);
 other_id=(r->'quote'->>'id')::uuid;
 before_other=r->'quote';
 BEGIN
  PERFORM public.billing_rpc('quotations','return-to-quotation',jsonb_build_object('id',quote_id,'ownerId',auth.uid()));
  RAISE EXCEPTION 'Return accepted fields outside the whitelist';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  UPDATE public.billing_quotations SET returned_purchase_orders='[]' WHERE id=quote_id;
  RAISE EXCEPTION 'An authenticated client could directly overwrite return history';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 r=public.billing_rpc('quotations','return-to-quotation',jsonb_build_object('id',quote_id));
 IF r->>'returnedOrderCount'<>'2' OR r->'quote'->>'status'<>'open'
  OR r->'quote'->'purchaseOrders'<>'[]'::jsonb
  OR (SELECT jsonb_agg(i-'canRemove'-'removeBlockedReason')
      FROM jsonb_array_elements(r->'quote'->'items') i)
    <>(SELECT jsonb_agg(i-'canRemove'-'removeBlockedReason')
       FROM jsonb_array_elements(before_quote->'items') i)
  OR r->'quote'->'negotiations'<>before_quote->'negotiations'
  OR r->'quote'->'itemAwards'<>before_quote->'itemAwards'
  OR r->'quote'->>'awardedTotal'<>before_quote->>'awardedTotal'
  OR EXISTS(SELECT 1 FROM public.billing_purchase_orders WHERE quotation_id=quote_id)
  OR EXISTS(SELECT 1 FROM public.billing_purchase_order_items WHERE quotation_id=quote_id) THEN
  RAISE EXCEPTION 'Return did not restore quotation state and preserve its contents';
 END IF;
 SELECT returned_purchase_orders INTO history FROM public.billing_quotations WHERE id=quote_id;
 IF jsonb_array_length(history)<>1
  OR history->0->>'returnedBy'<>auth.uid()::text
  OR history->0->>'returnedAt' IS NULL
  OR history->0->'orders'<>orders_snapshot OR history->0->'items'<>items_snapshot THEN
  RAISE EXCEPTION 'Return lost order snapshots, OC numbers, payment conditions or actor attribution';
 END IF;
 before_quote=r->'quote';
 r=public.billing_rpc('quotations','return-to-quotation',jsonb_build_object('id',quote_id));
 IF r->'quote'<>before_quote OR r->>'returnedOrderCount'<>'0'
  OR (SELECT returned_purchase_orders FROM public.billing_quotations WHERE id=quote_id)<>history THEN
  RAISE EXCEPTION 'Retry changed the quotation or duplicated the archive';
 END IF;
 r=public.billing_rpc('quotations','get',jsonb_build_object('id',other_id));
 IF r->'quote'<>before_other THEN RAISE EXCEPTION 'Return changed an unrelated quotation'; END IF;
 -- Reapproving the reopened quotation remains possible.
 r=public.billing_rpc('quotations','finalize',jsonb_build_object('id',quote_id));
 IF jsonb_array_length(r->'quote'->'purchaseOrders')<>2 THEN
  RAISE EXCEPTION 'A returned quotation cannot generate new supplier orders';
 END IF;
 r=public.billing_rpc('quotations','return-to-quotation',jsonb_build_object('id',quote_id));
 SELECT returned_purchase_orders INTO history FROM public.billing_quotations WHERE id=quote_id;
 IF jsonb_array_length(history)<>2 OR history->0->'orders'<>orders_snapshot
  OR history->0->'items'<>items_snapshot THEN
  RAISE EXCEPTION 'A second return overwrote the first archive';
 END IF;
 -- A completed purchase is protected; rejection must leave every order intact.
 r=public.billing_rpc('quotations','finalize',jsonb_build_object('id',quote_id));
 order_id=(r->'quote'->'purchaseOrders'->0->>'id')::uuid;
 PERFORM public.billing_rpc('purchase-orders','save',jsonb_build_object('id',order_id,'paymentMethodId',payment_id));
 PERFORM public.billing_rpc('purchase-orders','finish',jsonb_build_object('id',order_id));
 r=public.billing_rpc('quotations','get',jsonb_build_object('id',quote_id));
 before_quote=r->'quote';
 BEGIN
  PERFORM public.billing_rpc('quotations','return-to-quotation',jsonb_build_object('id',quote_id));
  RAISE EXCEPTION 'Return accepted a completed purchase';
 EXCEPTION WHEN check_violation THEN NULL; END;
 r=public.billing_rpc('quotations','get',jsonb_build_object('id',quote_id));
 IF r->'quote'<>before_quote
  OR (SELECT returned_purchase_orders FROM public.billing_quotations WHERE id=quote_id)<>history THEN
  RAISE EXCEPTION 'Rejected return partially changed the quotation, orders or archive';
 END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','9d000000-0000-4000-8000-000000000004',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.billing_rpc('quotations','return-to-quotation',jsonb_build_object('id',current_setting('test.order_return.quote')));
  RAISE EXCEPTION 'A reader returned purchase orders';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','9d000000-0000-4000-8000-000000000002',true);
SELECT public.billing_rpc('settings','get','{}');
DO $$ BEGIN
 BEGIN
  PERFORM public.billing_rpc('quotations','return-to-quotation',jsonb_build_object('id',current_setting('test.order_return.quote')));
  RAISE EXCEPTION 'Another workspace returned purchase orders';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.billing_quotations WHERE id=current_setting('test.order_return.quote')::uuid) THEN
  RAISE EXCEPTION 'RLS exposed another workspace return history';
 END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.billing_rpc('quotations','return-to-quotation',jsonb_build_object('id',current_setting('test.order_return.quote')));
  RAISE EXCEPTION 'Return allowed an absent session';
 EXCEPTION WHEN invalid_authorization_specification THEN NULL; END;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM public.billing_rpc('quotations','return-to-quotation',jsonb_build_object('id',current_setting('test.order_return.quote')));
  RAISE EXCEPTION 'An anonymous caller returned purchase orders';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
