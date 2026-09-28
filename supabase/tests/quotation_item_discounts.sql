BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('98000000-0000-4000-8000-000000000001','quotation-discounts@example.invalid',now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
SELECT public.billing_rpc('settings','get','{}');

DO $$
DECLARE
 r jsonb;
 requester_id uuid;
 material_id uuid;
 provider_id uuid;
 quote_id uuid;
 item_id uuid:='98000000-0000-4000-8000-000000000010';
 quote_provider_id uuid:='98000000-0000-4000-8000-000000000011';
 percentage_request uuid:='98000000-0000-4000-8000-000000000012';
 amount_request uuid:='98000000-0000-4000-8000-000000000013';
 order_id uuid;
 offer jsonb;
 negotiation jsonb;
 award jsonb;
 order_item jsonb;
BEGIN
 r=public.billing_rpc('signatures','save',
  '{"name":"Comprador descontos","role":"requester"}');
 requester_id=(r->'signature'->>'id')::uuid;
 r=public.billing_rpc('materials','save',jsonb_build_object(
  'name','Material com desconto','internalCode','DISC-001','unit','PC',
  'application','Teste de desconto'));
 material_id=(r->'material'->>'id')::uuid;
 r=public.billing_rpc('service-providers','save',jsonb_build_object(
  'documentType','CPF','document','52998224725',
  'legalName','Fornecedor de descontos','tradeName','Descontos',
  'street','Rua Teste','number','10','complement','','district','Centro',
  'city','Cidade','state','SP','zipCode','01001000',
  'phone','11999990000','email','discounts@example.invalid'));
 provider_id=(r->'provider'->>'id')::uuid;

 r=public.billing_rpc('quotations','save',jsonb_build_object(
  'title','Cotação com desconto por item','number','',
  'requestDate','2026-09-25','requester','IGNORADO',
  'requesterSignatureId',requester_id,'notes','Validação integral do desconto',
  'items',jsonb_build_array(jsonb_build_object(
   'id',item_id,'materialId',material_id,'materialName','IGNORADO',
   'quantity','3','unit','IGNORADO','notes','')),
  'providers',jsonb_build_array(jsonb_build_object(
   'id',quote_provider_id,'providerId',provider_id,'providerName','IGNORADO',
   'providerEmail','','providerPhone','','notes','','sentAt',NULL,
   'values',jsonb_build_object(item_id::text,'')))
 ));
 quote_id=(r->'quote'->>'id')::uuid;

 r=public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',quote_provider_id,
  'quotationItemId',item_id,'unitPrice','20.00','notes','Percentual inicial',
  'requestId',percentage_request,'discountType','percentage','discountValue','10'));
 offer=r->'quote'->'providers'->0->'offers'->item_id::text;
 negotiation=r->'quote'->'negotiations'->0;
 IF offer->>'unitPrice'<>'20' OR offer->>'discountType'<>'percentage'
  OR offer->>'discountValue'<>'10' OR offer->>'lineSubtotal'<>'60'
  OR offer->>'discountAmount'<>'6' OR offer->>'lineTotal'<>'54'
  OR offer->>'netUnitPrice'<>'18'
  OR r->'quote'->'providers'->0->>'total'<>'54'
  OR negotiation->>'lineTotal'<>'54' THEN
  RAISE EXCEPTION 'Percentage discount projection is incorrect: %',r;
 END IF;

 -- Exact retry is idempotent and keeps the discount in the fingerprint.
 PERFORM public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',quote_provider_id,
  'quotationItemId',item_id,'unitPrice','20.00','notes','Percentual inicial',
  'requestId',percentage_request,'discountType','percentage','discountValue','10'));
 IF (SELECT count(*) FROM public.billing_quotation_negotiations
  WHERE owner_id=auth.uid() AND quotation_id=quote_id)<>1 THEN
  RAISE EXCEPTION 'Exact discount retry created another revision';
 END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
   'id',quote_id,'quotationProviderId',quote_provider_id,
   'quotationItemId',item_id,'unitPrice','20.00','notes','Percentual inicial',
   'requestId',percentage_request,'discountType','percentage','discountValue','9'));
  RAISE EXCEPTION 'Conflicting discount retry was accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;

 r=public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',quote_provider_id,
  'quotationItemId',item_id,'unitPrice','20.00','notes','Desconto final',
  'requestId',amount_request,'discountType','amount','discountValue','7.25'));
 offer=r->'quote'->'providers'->0->'offers'->item_id::text;
 IF offer->>'discountType'<>'amount' OR offer->>'discountAmount'<>'7.25'
  OR offer->>'lineSubtotal'<>'60' OR offer->>'lineTotal'<>'52.75'
  OR r->'quote'->'providers'->0->>'total'<>'52.75'
  OR jsonb_array_length(r->'quote'->'negotiations')<>2 THEN
  RAISE EXCEPTION 'Fixed discount projection/history is incorrect: %',r;
 END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
   'id',quote_id,'quotationProviderId',quote_provider_id,
   'quotationItemId',item_id,'unitPrice','20.00','notes','Inválido',
   'requestId',gen_random_uuid(),'discountType','amount','discountValue','60.01'));
  RAISE EXCEPTION 'Discount greater than line subtotal was accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;

 r=public.billing_rpc('quotations','award-item',jsonb_build_object(
  'id',quote_id,'quotationItemId',item_id,
  'quotationProviderId',quote_provider_id));
 award=r->'quote'->'itemAwards'->0;
 IF award->>'discountType'<>'amount' OR award->>'discountAmount'<>'7.25'
  OR award->>'lineSubtotal'<>'60' OR award->>'lineTotal'<>'52.75'
  OR r->'quote'->'providers'->0->>'awardedTotal'<>'52.75'
  OR r->'quote'->>'awardedTotal'<>'52.75' THEN
  RAISE EXCEPTION 'Discounted award is incorrect: %',r;
 END IF;

 r=public.billing_rpc('quotations','finalize',jsonb_build_object('id',quote_id));
 order_id=(r->'purchaseOrders'->0->>'id')::uuid;
 IF r->'purchaseOrders'->0->>'total'<>'52.75' THEN
  RAISE EXCEPTION 'Discounted purchase order total is incorrect: %',r;
 END IF;
 r=public.billing_rpc('purchase-orders','get',jsonb_build_object('id',order_id));
 order_item=r->'order'->'items'->0;
 IF r->'order'->>'total'<>'52.75' OR order_item->>'unitPrice'<>'20'
  OR order_item->>'discountType'<>'amount'
  OR order_item->>'discountValue'<>'7.25'
  OR order_item->>'lineSubtotal'<>'60'
  OR order_item->>'discountAmount'<>'7.25'
  OR order_item->>'lineTotal'<>'52.75' THEN
  RAISE EXCEPTION 'Purchase order did not preserve the discount snapshot: %',r;
 END IF;
END $$;

RESET ROLE;
ROLLBACK;
