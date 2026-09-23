BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('96000000-0000-4000-8000-000000000001','award-owner@example.invalid',now()),
 ('96000000-0000-4000-8000-000000000002','award-other@example.invalid',now()),
 ('96000000-0000-4000-8000-000000000003','award-reader@example.invalid',now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000001',true);
SELECT public.billing_rpc('settings','get','{}');

DO $$
DECLARE
 r jsonb;
 requester_id uuid;
 material_a uuid;
 material_b uuid;
 provider_a uuid;
 provider_b uuid;
 quote_id uuid;
 item_a uuid:='96000000-0000-4000-8000-000000000011';
 item_b uuid:='96000000-0000-4000-8000-000000000012';
 quote_provider_a uuid:='96000000-0000-4000-8000-000000000020';
 quote_provider_b uuid:='96000000-0000-4000-8000-000000000021';
 payload jsonb;
 order_a uuid;
 order_b uuid;
 capacity_quote uuid;
 capacity_item uuid:='96000000-0000-4000-8000-000000000040';
 capacity_provider uuid:='96000000-0000-4000-8000-000000000041';
 negotiation_request uuid:='96000000-0000-4000-8000-000000000042';
BEGIN
 r=public.billing_rpc('signatures','save',
  '{"name":"Comprador adjudicação","role":"requester"}');
 requester_id=(r->'signature'->>'id')::uuid;
 r=public.billing_rpc('materials','save',jsonb_build_object(
  'name','Material da adjudicação A','internalCode','AWD-A','unit','PC',
  'application','Máquina A'));
 material_a=(r->'material'->>'id')::uuid;
 r=public.billing_rpc('materials','save',jsonb_build_object(
  'name','Material da adjudicação B','internalCode','AWD-B','unit','KG',
  'application','Máquina B'));
 material_b=(r->'material'->>'id')::uuid;
 PERFORM public.billing_rpc('material-variants','save',jsonb_build_object(
  'materialId',material_b,'brand','Marca B','code','REF-B'));

 r=public.billing_rpc('service-providers','save',jsonb_build_object(
  'documentType','CPF','document','52998224725','legalName','Fornecedor Award A',
  'tradeName','Award A','street','Rua A','number','10','complement','',
  'district','Centro','city','Cidade','state','SP','zipCode','01001000',
  'phone','11999990000','email','award-a@example.invalid'));
 provider_a=(r->'provider'->>'id')::uuid;
 r=public.billing_rpc('service-providers','save',jsonb_build_object(
  'documentType','CPF','document','11144477735','legalName','Fornecedor Award B',
  'tradeName','Award B','street','Rua B','number','20','complement','',
  'district','Centro','city','Cidade','state','SP','zipCode','01002000',
  'phone','11999990001','email','award-b@example.invalid'));
 provider_b=(r->'provider'->>'id')::uuid;

 payload=jsonb_build_object(
  'title','Cotação com adjudicação por item','number','',
  'requestDate','2026-09-23','requester','IGNORADO',
  'requesterSignatureId',requester_id,'notes','Teste de escopo incremental',
  'items',jsonb_build_array(jsonb_build_object(
   'id',item_a,'materialId',material_a,'materialName','IGNORADO',
   'quantity','2','unit','IGNORADO','notes','Item inicial')),
  'providers',jsonb_build_array(jsonb_build_object(
   'id',quote_provider_a,'providerId',provider_a,'providerName','IGNORADO',
   'providerEmail','','providerPhone','','notes','','sentAt',NULL,
   'values',jsonb_build_object(item_a::text,'')))
 );
 r=public.billing_rpc('quotations','save',payload);
 quote_id=(r->'quote'->>'id')::uuid;
 PERFORM public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',quote_provider_a,
  'quotationItemId',item_a,'unitPrice','10.00','notes','Preço inicial preservado'));

 -- Additions are append-only and retry-safe through client-generated row ids.
 payload=jsonb_build_object('id',quote_id,'items',jsonb_build_array(
  jsonb_build_object('id',item_b,'materialId',material_b,
   'quantity','3','notes','Item adicionado depois')));
 r=public.billing_rpc('quotations','add-items',payload);
 r=public.billing_rpc('quotations','add-items',payload);
 IF jsonb_array_length(r->'quote'->'items')<>2
  OR jsonb_array_length(r->'quote'->'negotiations')<>1
  OR r->'quote'->'providers'->0->'values'->>item_a::text<>'10' THEN
  RAISE EXCEPTION 'Adding/retrying an item changed existing scope or history: %',r;
 END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','add-items',jsonb_build_object(
   'id',quote_id,'items',jsonb_build_array(jsonb_build_object(
    'id',item_b,'materialId',material_b,'quantity','4','notes','Conflito'))));
  RAISE EXCEPTION 'Conflicting item retry was accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;

 payload=jsonb_build_object('id',quote_id,'providers',jsonb_build_array(
  jsonb_build_object('id',quote_provider_b,'providerId',provider_b,
   'notes','Incluído na negociação','sentAt',NULL)));
 r=public.billing_rpc('quotations','add-providers',payload);
 r=public.billing_rpc('quotations','add-providers',payload);
 IF jsonb_array_length(r->'quote'->'providers')<>2
  OR jsonb_array_length(r->'quote'->'negotiations')<>1 THEN
  RAISE EXCEPTION 'Adding/retrying a provider changed history or duplicated scope: %',r;
 END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','add-providers',jsonb_build_object(
   'id',quote_id,'unexpected',true,'providers','[]'::jsonb));
  RAISE EXCEPTION 'Provider payload whitelist was bypassed';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

 BEGIN
  PERFORM public.billing_rpc('quotations','award-item',jsonb_build_object(
   'id',quote_id,'quotationItemId',item_b,
   'quotationProviderId',quote_provider_b));
  RAISE EXCEPTION 'Item without a provider price was awarded';
 EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',quote_provider_a,
  'quotationItemId',item_b,'unitPrice','30.00','notes','Alternativa A'));
 PERFORM public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',quote_provider_b,
  'quotationItemId',item_a,'unitPrice','12.00','notes','Alternativa B'));
 PERFORM public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',quote_provider_b,
  'quotationItemId',item_b,'unitPrice','25.00','notes','Alternativa B'));

 r=public.billing_rpc('quotations','award-item',jsonb_build_object(
  'id',quote_id,'quotationItemId',item_a,
  'quotationProviderId',quote_provider_a));
 -- Exact retry must keep one decision.
 r=public.billing_rpc('quotations','award-item',jsonb_build_object(
  'id',quote_id,'quotationItemId',item_a,
  'quotationProviderId',quote_provider_a));
 IF r->'quote'->>'awardedItemCount'<>'1'
  OR (r->'quote'->>'awardComplete')::boolean
  OR r->'quote'->'itemAwards'->0->>'unitPrice'<>'10'
  OR r->'quote'->'itemAwards'->0->>'lineTotal'<>'20' THEN
  RAISE EXCEPTION 'First award projection is invalid: %',r;
 END IF;
 r=public.billing_rpc('quotations','award-item',jsonb_build_object(
  'id',quote_id,'quotationItemId',item_a,
  'quotationProviderId',quote_provider_b));
 IF jsonb_array_length(r->'quote'->'negotiations')<>4
  OR r->'quote'->>'awardedItemCount'<>'1'
  OR r->'quote'->'itemAwards'->0->>'providerId'<>quote_provider_b::text
  OR r->'quote'->'itemAwards'->0->>'lineTotal'<>'24' THEN
  RAISE EXCEPTION 'Changing an award lost prices/history or duplicated the decision: %',r;
 END IF;
 r=public.billing_rpc('quotations','award-item',jsonb_build_object(
  'id',quote_id,'quotationItemId',item_a,
  'quotationProviderId',quote_provider_a));
 IF jsonb_array_length(r->'quote'->'negotiations')<>4
  OR r->'quote'->'itemAwards'->0->>'providerId'<>quote_provider_a::text THEN
  RAISE EXCEPTION 'Restoring an award lost negotiation history: %',r;
 END IF;
 -- A new price for the approved pair must preserve the append-only history but
 -- invalidate the decision. The operator must deliberately approve it again.
 r=public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',quote_provider_a,
  'quotationItemId',item_a,'unitPrice','9.50','notes','Desconto negociado',
  'requestId',negotiation_request));
 -- Simulate a client retry after a committed response timeout. It must return
 -- the same logical result without a sixth revision or another side effect.
 r=public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',quote_provider_a,
  'quotationItemId',item_a,'unitPrice','9.50','notes','Desconto negociado',
  'requestId',negotiation_request));
 IF jsonb_array_length(r->'quote'->'negotiations')<>5
  OR r->'quote'->>'awardedItemCount'<>'0'
  OR jsonb_array_length(r->'quote'->'itemAwards')<>0
  OR r->'quote'->'providers'->0->'values'->>item_a::text<>'9.5'
  OR (SELECT count(*) FROM public.billing_quotation_negotiations n
      WHERE n.owner_id=auth.uid() AND n.request_id=negotiation_request)<>1 THEN
  RAISE EXCEPTION 'A changed approved price did not require reapproval: %',r;
 END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
   'id',quote_id,'quotationProviderId',quote_provider_a,
   'quotationItemId',item_a,'unitPrice','9.49','notes','Outro payload',
   'requestId',negotiation_request));
  RAISE EXCEPTION 'A negotiation request id was reused with another payload';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 IF (SELECT count(*) FROM public.billing_quotation_negotiations n
     WHERE n.owner_id=auth.uid() AND n.quotation_id=quote_id)<>5
  OR (SELECT unit_price FROM public.billing_quotation_provider_values v
      WHERE v.owner_id=auth.uid() AND v.quotation_id=quote_id
       AND v.quotation_provider_id=quote_provider_a
       AND v.quotation_item_id=item_a)<>9.5 THEN
  RAISE EXCEPTION 'Conflicting request id changed negotiation state';
 END IF;
 r=public.billing_rpc('quotations','award-item',jsonb_build_object(
  'id',quote_id,'quotationItemId',item_a,
  'quotationProviderId',quote_provider_a));
 IF r->'quote'->>'awardedItemCount'<>'1'
  OR r->'quote'->'itemAwards'->0->>'unitPrice'<>'9.5'
  OR r->'quote'->'itemAwards'->0->>'lineTotal'<>'19' THEN
  RAISE EXCEPTION 'Reapproval did not use the newest negotiated price: %',r;
 END IF;
 r=public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',quote_provider_a,
  'quotationItemId',item_a,'unitPrice','9.50','notes','Desconto negociado',
  'requestId',negotiation_request));
 IF jsonb_array_length(r->'quote'->'negotiations')<>5
  OR r->'quote'->>'awardedItemCount'<>'1'
  OR r->'quote'->'itemAwards'->0->>'providerId'<>quote_provider_a::text THEN
  RAISE EXCEPTION 'An exact retry after reapproval invalidated the decision: %',r;
 END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','finalize',jsonb_build_object('id',quote_id));
  RAISE EXCEPTION 'Partial item awards finalized a quotation';
 EXCEPTION WHEN check_violation THEN NULL; END;
 r=public.billing_rpc('quotations','award-item',jsonb_build_object(
  'id',quote_id,'quotationItemId',item_b,
  'quotationProviderId',quote_provider_b));
 IF r->'quote'->>'awardedItemCount'<>'2'
  OR NOT (r->'quote'->>'awardComplete')::boolean
  OR (SELECT p->>'awardedTotal' FROM jsonb_array_elements(r->'quote'->'providers') p
      WHERE p->>'id'=quote_provider_a::text)<>'19'
  OR (SELECT p->>'awardedTotal' FROM jsonb_array_elements(r->'quote'->'providers') p
      WHERE p->>'id'=quote_provider_b::text)<>'75' THEN
  RAISE EXCEPTION 'Complete award totals are invalid: %',r;
 END IF;

 r=public.billing_rpc('quotations','finalize',jsonb_build_object('id',quote_id));
 IF r->'quote'->>'status'<>'finished'
  OR jsonb_array_length(r->'purchaseOrders')<>2
  OR r->'purchaseOrder'<>'null'::jsonb
  OR r->'quote'->>'purchaseOrderId' IS NOT NULL
  OR r->'quote'->>'winnerProviderId' IS NOT NULL
  OR jsonb_array_length(r->'quote'->'purchaseOrders')<>2 THEN
  RAISE EXCEPTION 'Split finalization envelope is invalid: %',r;
 END IF;
 SELECT id INTO order_a FROM public.billing_purchase_orders
 WHERE owner_id=auth.uid() AND quotation_id=quote_id
  AND quotation_provider_id=quote_provider_a;
 SELECT id INTO order_b FROM public.billing_purchase_orders
 WHERE owner_id=auth.uid() AND quotation_id=quote_id
  AND quotation_provider_id=quote_provider_b;
 IF order_a IS NULL OR order_b IS NULL
  OR (SELECT total FROM public.billing_purchase_orders WHERE id=order_a)<>19
  OR (SELECT total FROM public.billing_purchase_orders WHERE id=order_b)<>75
  OR (SELECT count(*) FROM public.billing_purchase_order_items
      WHERE owner_id=auth.uid() AND purchase_order_id=order_a
       AND quotation_item_id=item_a)<>1
  OR (SELECT count(*) FROM public.billing_purchase_order_items
      WHERE owner_id=auth.uid() AND purchase_order_id=order_b
       AND quotation_item_id=item_b)<>1
  OR (SELECT count(*) FROM public.billing_purchase_order_items
      WHERE owner_id=auth.uid() AND quotation_id=quote_id)<>2 THEN
  RAISE EXCEPTION 'Orders were not split by the awarded provider';
 END IF;
 r=public.billing_rpc('quotations','finalize',jsonb_build_object('id',quote_id));
 IF jsonb_array_length(r->'purchaseOrders')<>2
  OR (SELECT count(*) FROM public.billing_purchase_orders
      WHERE owner_id=auth.uid() AND quotation_id=quote_id)<>2 THEN
  RAISE EXCEPTION 'Finalization retry duplicated split orders: %',r;
 END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','add-items',jsonb_build_object(
   'id',quote_id,'items',jsonb_build_array(jsonb_build_object(
    'id',gen_random_uuid(),'materialId',material_a,
    'quantity','1','notes','Tardio'))));
  RAISE EXCEPTION 'Finished quotation accepted scope changes';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('quotations','award-item',jsonb_build_object(
   'id',quote_id,'quotationItemId',item_a,'quotationProviderId',quote_provider_b));
  RAISE EXCEPTION 'Finished quotation accepted award changes';
 EXCEPTION WHEN check_violation THEN NULL; END;

 -- The 100-item limit applies to the complete quotation, not only one request.
 r=public.billing_rpc('quotations','save',jsonb_build_object(
  'title','Cotação no limite agregado','number','','requestDate','2026-09-23',
  'requester','IGNORADO','requesterSignatureId',requester_id,'notes','',
  'items',jsonb_build_array(jsonb_build_object(
   'id',capacity_item,'materialId',material_a,'materialName','IGNORADO',
   'quantity','1','unit','IGNORADO','notes','Inicial')),
  'providers',jsonb_build_array(jsonb_build_object(
   'id',capacity_provider,'providerId',provider_a,'providerName','IGNORADO',
   'providerEmail','','providerPhone','','notes','','sentAt',NULL,
   'values',jsonb_build_object(capacity_item::text,'')))
 ));
 capacity_quote=(r->'quote'->>'id')::uuid;
 SELECT jsonb_build_object('id',capacity_quote,'items',jsonb_agg(
  jsonb_build_object('id',md5('quotation-capacity-'||g::text)::uuid,
   'materialId',material_a,'quantity','1','notes','Capacidade') ORDER BY g))
 INTO payload FROM generate_series(1,99) AS series(g);
 r=public.billing_rpc('quotations','add-items',payload);
 IF jsonb_array_length(r->'quote'->'items')<>100 THEN
  RAISE EXCEPTION 'Aggregate item limit did not allow exactly 100 items: %',r;
 END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','add-items',jsonb_build_object(
   'id',capacity_quote,'items',jsonb_build_array(jsonb_build_object(
    'id',md5('quotation-capacity-overflow')::uuid,
    'materialId',material_a,'quantity','1','notes','Excedente'))));
  RAISE EXCEPTION 'Quotation accepted more than 100 aggregate items';
 EXCEPTION WHEN check_violation THEN NULL; END;

 PERFORM set_config('test.award.quote',quote_id::text,true);
 PERFORM set_config('test.award.item',item_a::text,true);
 PERFORM set_config('test.award.provider',quote_provider_a::text,true);
END $$;

DO $$ BEGIN
 BEGIN
  INSERT INTO public.billing_quotation_item_awards(
   owner_id,quotation_id,quotation_item_id,quotation_provider_id
  ) VALUES(auth.uid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
  RAISE EXCEPTION 'Direct award DML was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.billing_quotation_item_awards SET updated_at=now();
  RAISE EXCEPTION 'Direct award UPDATE was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  DELETE FROM public.billing_quotation_item_awards;
  RAISE EXCEPTION 'Direct award DELETE was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000002',true);
SELECT public.billing_rpc('settings','get','{}');
DO $$
DECLARE
 quote_id uuid:=current_setting('test.award.quote')::uuid;
 item_id uuid:=current_setting('test.award.item')::uuid;
 provider_id uuid:=current_setting('test.award.provider')::uuid;
BEGIN
 IF EXISTS(SELECT 1 FROM public.billing_quotation_item_awards) THEN
  RAISE EXCEPTION 'Award RLS leaked another workspace';
 END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','award-item',jsonb_build_object(
   'id',quote_id,'quotationItemId',item_id,'quotationProviderId',provider_id));
  RAISE EXCEPTION 'Foreign quotation award was accepted';
 EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;

RESET ROLE;
INSERT INTO public.billing_materials(
 id,owner_id,name,code,unit,application
) VALUES(
 '96000000-0000-4000-8000-000000000050',
 '96000000-0000-4000-8000-000000000002',
 'Material para colisão de UUID','COLLISION','PC',''
);
INSERT INTO public.billing_quotations(
 id,owner_id,title,quotation_number,status,request_date,requester,notes
) VALUES(
 '96000000-0000-4000-8000-000000000052',
 '96000000-0000-4000-8000-000000000002',
 'Cotação de outro espaço','COT-OTHER','open','2026-09-23','Outro usuário',''
);
INSERT INTO public.billing_quotation_items(
 id,owner_id,quotation_id,material_id,material_name,material_code,
 material_application,material_references,quantity,unit,unit_price,supplier,notes
) VALUES(
 '96000000-0000-4000-8000-000000000053',
 '96000000-0000-4000-8000-000000000002',
 '96000000-0000-4000-8000-000000000052',
 '96000000-0000-4000-8000-000000000050',
 'Material para colisão de UUID','COLLISION','','[]'::jsonb,1,'PC',NULL,'',''
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000002',true);
DO $$
DECLARE error_message text;
BEGIN
 BEGIN
  PERFORM public.billing_rpc('quotations','add-items',jsonb_build_object(
   'id','96000000-0000-4000-8000-000000000052',
   'items',jsonb_build_array(jsonb_build_object(
    'id',current_setting('test.award.item')::uuid,
    'materialId','96000000-0000-4000-8000-000000000050',
    'quantity','1','notes','Colisão entre espaços'))));
  RAISE EXCEPTION 'A globally colliding item UUID was accepted';
 EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS error_message=MESSAGE_TEXT;
  IF error_message<>'Não foi possível adicionar o item com este identificador.'
   OR error_message LIKE '%billing_quotation_items_pkey%' THEN
   RAISE EXCEPTION 'Global UUID collision leaked database details: %',error_message;
  END IF;
 END;
END $$;
RESET ROLE;
INSERT INTO public.billing_access_profiles(id,owner_id,name,description,permissions)
 VALUES('96000000-0000-4000-8000-000000000030',
 '96000000-0000-4000-8000-000000000001','Leitor de adjudicações','',
 ARRAY['registrations.read']);
INSERT INTO public.billing_memberships(
 owner_id,user_id,access_profile_id,is_owner,status
) VALUES(
 '96000000-0000-4000-8000-000000000001',
 '96000000-0000-4000-8000-000000000003',
 '96000000-0000-4000-8000-000000000030',false,'active');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000003',true);
DO $$
DECLARE r jsonb;
BEGIN
 r=public.billing_rpc('quotations','get',jsonb_build_object(
  'id',current_setting('test.award.quote')::uuid));
 IF r->'quote'->>'awardedItemCount'<>'2'
  OR (SELECT count(*) FROM public.billing_quotation_item_awards)<>2 THEN
  RAISE EXCEPTION 'Registration reader cannot read awards';
 END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','award-item',jsonb_build_object(
   'id',current_setting('test.award.quote')::uuid,
   'quotationItemId',current_setting('test.award.item')::uuid,
   'quotationProviderId',current_setting('test.award.provider')::uuid));
  RAISE EXCEPTION 'Read-only member changed an award';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM public.billing_rpc('quotations','award-item',jsonb_build_object(
   'id',current_setting('test.award.quote')::uuid,
   'quotationItemId',current_setting('test.award.item')::uuid,
   'quotationProviderId',current_setting('test.award.provider')::uuid));
  RAISE EXCEPTION 'Anonymous award was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
