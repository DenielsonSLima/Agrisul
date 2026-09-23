BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('95000000-0000-4000-8000-000000000001','order-owner@example.invalid',now()),
 ('95000000-0000-4000-8000-000000000002','order-other@example.invalid',now()),
 ('95000000-0000-4000-8000-000000000003','order-reader@example.invalid',now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000001',true);
SELECT public.billing_rpc('settings','get','{}');

DO $$ BEGIN
 IF to_regclass('public.billing_purchase_orders_quote_provider') IS NULL
  OR to_regclass('public.billing_purchase_order_items_order_quote') IS NULL
  OR to_regclass('public.billing_purchase_order_items_quotation_item') IS NULL THEN
  RAISE EXCEPTION 'Purchase-order composite foreign keys are missing covering indexes';
 END IF;
END $$;

DO $$
DECLARE
 r jsonb;
 material_id uuid;
 requester_id uuid;
 provider_a uuid;
 provider_b uuid;
 payment_method_id uuid;
 quote_id uuid;
 order_id uuid;
 item_id uuid:='95000000-0000-4000-8000-000000000010';
 quote_provider_a uuid:='95000000-0000-4000-8000-000000000020';
 quote_provider_b uuid:='95000000-0000-4000-8000-000000000021';
 payload jsonb;
 item jsonb;
BEGIN
 r=public.billing_rpc('payment-methods','save',jsonb_build_object(
  'name','30 dias via boleto','description','Pagamento integral em trinta dias'));
 payment_method_id=(r->'paymentMethod'->>'id')::uuid;
 r=public.billing_rpc('signatures','save','{"name":"Comprador responsável","role":"requester"}');
 requester_id=(r->'signature'->>'id')::uuid;
 r=public.billing_rpc('materials','save',jsonb_build_object(
  'name','Filtro hidráulico','internalCode','INT-FH-01','unit','PC',
  'application','Colhedora'));
 material_id=(r->'material'->>'id')::uuid;
 PERFORM public.billing_rpc('material-variants','save',jsonb_build_object(
  'materialId',material_id,'brand','Mann','code','H601/10'));
 PERFORM public.billing_rpc('material-variants','save',jsonb_build_object(
  'materialId',material_id,'brand','Baldwin','code','P106HD'));

 r=public.billing_rpc('service-providers','save',jsonb_build_object(
  'documentType','CPF','document','52998224725','legalName','Fornecedor Escolhido','tradeName','Escolhido',
  'street','Rua A','number','10','complement','','district','Centro','city','Cidade','state','SP',
  'zipCode','01001000','phone','11999990000','email','escolhido@example.invalid'));
 provider_a=(r->'provider'->>'id')::uuid;
 r=public.billing_rpc('service-providers','save',jsonb_build_object(
  'documentType','CPF','document','11144477735','legalName','Fornecedor Menor Preço','tradeName','Menor',
  'street','Rua B','number','20','complement','','district','Centro','city','Cidade','state','SP',
  'zipCode','01001000','phone','11999990001','email','menor@example.invalid'));
 provider_b=(r->'provider'->>'id')::uuid;

 payload=jsonb_build_object(
  'title','Filtros para manutenção','number','','requestDate','2026-09-23',
  'requester','IGNORADO','requesterSignatureId',requester_id,'notes','Entrega no almoxarifado',
  'items',jsonb_build_array(jsonb_build_object(
   'id',item_id,'materialId',material_id,'materialName','IGNORADO',
   'quantity','2.5','unit','IGNORADO','notes','Lote de manutenção')),
  'providers',jsonb_build_array(
   jsonb_build_object('id',quote_provider_a,'providerId',provider_a,
    'providerName','IGNORADO','providerEmail','','providerPhone','','notes','Prazo melhor',
     'sentAt',NULL,'values',jsonb_build_object(item_id::text,'')),
   jsonb_build_object('id',quote_provider_b,'providerId',provider_b,
    'providerName','IGNORADO','providerEmail','','providerPhone','','notes','',
    'sentAt',NULL,'values',jsonb_build_object(item_id::text,''))
  ));
 r=public.billing_rpc('quotations','save',payload);
 quote_id=(r->'quote'->>'id')::uuid;
 payload=jsonb_set(payload,'{id}',to_jsonb(quote_id));
 r=public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',quote_provider_a,'quotationItemId',item_id,
  'unitPrice','10.25','notes','Proposta inicial'));

 BEGIN
  PERFORM public.billing_rpc('quotations','toggle-status',jsonb_build_object('id',quote_id));
  RAISE EXCEPTION 'Legacy toggle finalized a quotation without selecting a winner';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('quotations','finalize',jsonb_build_object(
   'id',quote_id,'winnerProviderId',quote_provider_b));
  RAISE EXCEPTION 'Incomplete selected provider generated a purchase order';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.billing_purchase_orders
  WHERE owner_id=auth.uid() AND quotation_id=quote_id) THEN
  RAISE EXCEPTION 'Failed finalization left a purchase order behind';
 END IF;

 r=public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',quote_provider_b,'quotationItemId',item_id,
  'unitPrice','9.50','notes','Menor preço'));
 IF r->'quote'->'winningProviderIds'<>jsonb_build_array(quote_provider_b) THEN
  RAISE EXCEPTION 'Lower-price recommendation is wrong before explicit selection: %',r;
 END IF;

 -- Business may choose delivery/quality over the lowest price. Any complete
 -- proposal is valid when the winner is explicitly selected.
 r=public.billing_rpc('quotations','finalize',jsonb_build_object(
  'id',quote_id,'winnerProviderId',quote_provider_a));
 order_id=(r->'purchaseOrder'->>'id')::uuid;
 IF r->'quote'->>'status'<>'finished'
  OR r->'quote'->>'purchaseOrderId'<>order_id::text
  OR r->'purchaseOrder'->>'number'<>'PED-001'
  OR r->'purchaseOrder'->>'status'<>'open'
  OR r->'purchaseOrder'->>'quotationProviderId'<>quote_provider_a::text
  OR r->'purchaseOrder'->>'providerName'<>'Fornecedor Escolhido'
  OR r->'purchaseOrder'->>'providerEmail'<>'escolhido@example.invalid'
  OR r->'purchaseOrder'->>'providerPhone'<>'11999990000'
  OR r->'purchaseOrder'->>'requestDate'<>'2026-09-23'
  OR r->'purchaseOrder'->>'total'<>'25.625'
  OR jsonb_array_length(r->'purchaseOrder'->'items')<>1 THEN
  RAISE EXCEPTION 'Finalization/order envelope is invalid: %',r;
 END IF;
 item=r->'purchaseOrder'->'items'->0;
 IF item->>'materialName'<>'Filtro hidráulico'
  OR item->>'materialInternalCode'<>'INT-FH-01'
  OR item->>'quantity'<>'2.5' OR item->>'unitPrice'<>'10.25'
  OR item->>'lineTotal'<>'25.625'
  OR jsonb_array_length(item->'materialReferences')<>2 THEN
  RAISE EXCEPTION 'Purchase-order item snapshot is invalid: %',item;
 END IF;

 r=public.billing_rpc('quotations','finalize',jsonb_build_object(
  'id',quote_id,'winnerProviderId',quote_provider_a));
 IF r->'purchaseOrder'->>'id'<>order_id::text
  OR (SELECT count(*) FROM public.billing_purchase_orders
   WHERE owner_id=auth.uid() AND quotation_id=quote_id)<>1 THEN
  RAISE EXCEPTION 'Finalization retry duplicated or changed the purchase order: %',r;
 END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','finalize',jsonb_build_object(
   'id',quote_id,'winnerProviderId',quote_provider_b));
  RAISE EXCEPTION 'Finalization retry changed the selected provider';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('quotations','toggle-status',jsonb_build_object('id',quote_id));
  RAISE EXCEPTION 'Quotation with a purchase order was reopened';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('quotations','delete',jsonb_build_object('id',quote_id));
  RAISE EXCEPTION 'Quotation with a purchase order was deleted';
 EXCEPTION WHEN check_violation THEN NULL; END;

 r=public.billing_rpc('purchase-orders','save',jsonb_build_object(
  'id',order_id,'purchaseOrderNumber','OC-2026-0042','paymentMethodId',payment_method_id));
 IF r->'order'->>'purchaseOrderNumber'<>'OC-2026-0042'
  OR r->'order'->>'paymentMethod'<>'30 dias via boleto'
  OR r->'order'->>'paymentMethodId'<>payment_method_id::text THEN
  RAISE EXCEPTION 'Editable purchase-order fields were not persisted: %',r;
 END IF;
 r=public.billing_rpc('purchase-orders','get',jsonb_build_object('id',order_id));
 IF r->'order'->>'id'<>order_id::text OR r->'order'->>'total'<>'25.625' THEN
  RAISE EXCEPTION 'Purchase-order get is invalid: %',r;
 END IF;
 r=public.billing_rpc('purchase-orders','list','{}');
 IF r->>'total'<>'1' OR r->'orders'->0->>'id'<>order_id::text
  OR r->'counts'->>'open'<>'1' OR r->'counts'->>'finished'<>'0'
  OR r->'orders'->0->>'itemCount'<>'1'
  OR jsonb_array_length(r->'orders'->0->'items')<>0 THEN
  RAISE EXCEPTION 'Purchase-order list is invalid: %',r;
 END IF;

 PERFORM public.billing_rpc('service-providers','save',jsonb_build_object(
  'id',provider_a,'documentType','CPF','document','52998224725','legalName','Fornecedor Renomeado','tradeName','Escolhido',
  'street','Rua A','number','10','complement','','district','Centro','city','Cidade','state','SP',
  'zipCode','01001000','phone','11888880000','email','novo@example.invalid'));
 PERFORM public.billing_rpc('materials','save',jsonb_build_object(
  'id',material_id,'name','Filtro renomeado','internalCode','NOVO-CODIGO',
  'unit','PC','application','Outra máquina'));
 r=public.billing_rpc('purchase-orders','get',jsonb_build_object('id',order_id));
 IF r->'order'->>'providerName'<>'Fornecedor Escolhido'
  OR r->'order'->>'providerEmail'<>'escolhido@example.invalid'
  OR r->'order'->'items'->0->>'materialName'<>'Filtro hidráulico'
  OR r->'order'->'items'->0->>'materialInternalCode'<>'INT-FH-01'
  OR jsonb_array_length(r->'order'->'items'->0->'materialReferences')<>2 THEN
  RAISE EXCEPTION 'Catalog edits changed the purchase-order snapshot: %',r;
 END IF;

 r=public.billing_rpc('purchase-orders','finish',jsonb_build_object('id',order_id));
 IF r->'order'->>'status'<>'finished' OR r->'order'->>'finishedAt' IS NULL THEN
  RAISE EXCEPTION 'Purchase order was not finalized: %',r;
 END IF;
 r=public.billing_rpc('purchase-orders','list',jsonb_build_object(
  'status','finished','search','OC-2026','dateFrom','2026-09-01','dateTo','2026-09-30'));
 IF r->>'total'<>'1' OR r->'orders'->0->>'id'<>order_id::text THEN
  RAISE EXCEPTION 'Finished purchase-order filters are invalid: %',r;
 END IF;

 PERFORM set_config('test.purchase_order.id',order_id::text,true);
END $$;

DO $$ BEGIN
 BEGIN
  INSERT INTO public.billing_purchase_orders(
   owner_id,quotation_id,quotation_provider_id,provider_id,order_number,
   quotation_number,quotation_title,quotation_request_date,quotation_requester,
   provider_snapshot,total
  ) VALUES(auth.uid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'DIRETO',
   'COT-DIRETA','Direto inválido',current_date,'Direto',
   jsonb_build_object('id',gen_random_uuid()),0);
  RAISE EXCEPTION 'Direct purchase-order DML was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000002',true);
SELECT public.billing_rpc('settings','get','{}');
DO $$
DECLARE r jsonb;foreign_order uuid:=current_setting('test.purchase_order.id')::uuid;
BEGIN
 r=public.billing_rpc('purchase-orders','list','{"status":"finished"}');
 IF r->>'total'<>'0' OR EXISTS(SELECT 1 FROM public.billing_purchase_orders) THEN
  RAISE EXCEPTION 'Purchase-order tenant isolation failed: %',r;
 END IF;
 BEGIN
  PERFORM public.billing_rpc('purchase-orders','get',jsonb_build_object('id',foreign_order));
  RAISE EXCEPTION 'Foreign purchase order get was accepted';
 EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;

RESET ROLE;
INSERT INTO public.billing_access_profiles(id,owner_id,name,description,permissions)
 VALUES('95000000-0000-4000-8000-000000000030','95000000-0000-4000-8000-000000000001',
 'Leitor de pedidos','',ARRAY['registrations.read']);
INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,is_owner,status)
 VALUES('95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000003',
 '95000000-0000-4000-8000-000000000030',false,'active');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000003',true);
DO $$
DECLARE r jsonb;order_id uuid:=current_setting('test.purchase_order.id')::uuid;
BEGIN
 r=public.billing_rpc('purchase-orders','list','{"status":"finished"}');
 IF r->>'total'<>'1' OR NOT EXISTS(SELECT 1 FROM public.billing_purchase_order_items) THEN
  RAISE EXCEPTION 'Registration reader cannot read purchase orders or Realtime rows';
 END IF;
 BEGIN
  PERFORM public.billing_rpc('purchase-orders','save',jsonb_build_object(
   'id',order_id,'purchaseOrderNumber','Sem acesso'));
  RAISE EXCEPTION 'Read-only member edited a purchase order';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM public.billing_rpc('purchase-orders','list','{}');
  RAISE EXCEPTION 'Anonymous purchase-order RPC was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
