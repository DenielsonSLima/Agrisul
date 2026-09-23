BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('94000000-0000-4000-8000-000000000001','quotation-owner@example.invalid',now()),
 ('94000000-0000-4000-8000-000000000002','quotation-other@example.invalid',now()),
 ('94000000-0000-4000-8000-000000000003','quotation-reader@example.invalid',now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000001',true);
SELECT public.billing_rpc('settings','get','{}');

DO $$
DECLARE
 r jsonb;material_a uuid;material_b uuid;material_without_reference uuid;provider_a uuid;provider_b uuid;quote_id uuid;reference_less_quote_id uuid;requester_id uuid;reference_id uuid;item_snapshot jsonb;
 item_a uuid:='94000000-0000-4000-8000-000000000010';
 item_b uuid:='94000000-0000-4000-8000-000000000011';
 reference_less_item uuid:='94000000-0000-4000-8000-000000000012';
 quote_provider_a uuid:='94000000-0000-4000-8000-000000000020';
 quote_provider_b uuid:='94000000-0000-4000-8000-000000000021';
 priced_quote_id uuid:='94000000-0000-4000-8000-000000000022';
 reference_less_quote_provider uuid:='94000000-0000-4000-8000-000000000023';
 payload jsonb;
BEGIN
 r=public.billing_rpc('signatures','save','{"name":"Equipe de compras","role":"requester"}');
 requester_id=(r->'signature'->>'id')::uuid;
 r=public.billing_rpc('materials','save','{"name":"Adubo 14-00-18","internalCode":"MAT-ADUBO","unit":"kg","application":"Cobertura"}');
 material_a=(r->'material'->>'id')::uuid;
 PERFORM public.billing_rpc('material-variants','save',jsonb_build_object('materialId',material_a,'brand','Marca A','code','AD-1418'));
 PERFORM public.billing_rpc('material-variants','save',jsonb_build_object('materialId',material_a,'brand','Marca B','code','AD-EQUIV'));
 r=public.billing_rpc('materials','save','{"name":"Herbicida seletivo","internalCode":"MAT-HERB","unit":"L","application":"Pós-emergência"}');
 material_b=(r->'material'->>'id')::uuid;
 PERFORM public.billing_rpc('material-variants','save',jsonb_build_object('materialId',material_b,'brand','Marca H','code','HERB-01'));
 IF (public.billing_rpc('materials','list','{}')->'materials'->0->>'createdAt') IS NULL THEN
  RAISE EXCEPTION 'Material envelope is incomplete';
 END IF;

 r=public.billing_rpc('service-providers','save',jsonb_build_object(
  'documentType','CNPJ','document','04773159000523','legalName','Fornecedor Alfa','tradeName','Alfa',
  'street','Rua A','number','10','complement','','district','Centro','city','Cidade','state','SP',
  'zipCode','01001000','phone','11999990000','email','alfa@example.invalid'));
 provider_a=(r->'provider'->>'id')::uuid;
 r=public.billing_rpc('service-providers','save',jsonb_build_object(
  'documentType','CPF','document','11144477735','legalName','Fornecedor Beta','tradeName','Beta',
  'street','Rua B','number','20','complement','','district','Centro','city','Cidade','state','SP',
  'zipCode','01001000','phone','11999990001','email','beta@example.invalid'));
 provider_b=(r->'provider'->>'id')::uuid;

 r=public.billing_rpc('materials','save',jsonb_build_object(
  'name','Arruela sem referência','unit','PC','application','Uso geral'));
 material_without_reference=(r->'material'->>'id')::uuid;
 r=public.billing_rpc('quotations','save',jsonb_build_object(
  'title','Produto sem referência','number','COT-SEM-REF',
  'requestDate','2026-09-22','requester','IGNORADO',
  'requesterSignatureId',requester_id,'notes','',
  'items',jsonb_build_array(jsonb_build_object(
   'id',reference_less_item,'materialId',material_without_reference,
   'materialVariantId',NULL,'materialName','IGNORADO','materialCode','IGNORADO',
   'materialApplication','IGNORADO','materialReferences','[]'::jsonb,
   'quantity','3','unit','IGNORADO','notes','')),
  'providers',jsonb_build_array(jsonb_build_object(
   'id',reference_less_quote_provider,'providerId',provider_a,
   'providerName','IGNORADO','providerEmail','','providerPhone','',
   'notes','','sentAt',NULL,'values',jsonb_build_object(reference_less_item::text,'')))));
 reference_less_quote_id=(r->'quote'->>'id')::uuid;
 item_snapshot=r->'quote'->'items'->0;
 IF item_snapshot->>'materialName'<>'Arruela sem referência'
  OR item_snapshot->>'materialCode'<>''
  OR item_snapshot->>'materialApplication'<>'Uso geral'
  OR item_snapshot->>'unit'<>'PC'
  OR item_snapshot->>'materialVariantId' IS NOT NULL
  OR jsonb_array_length(item_snapshot->'materialReferences')<>0 THEN
  RAISE EXCEPTION 'Material without references was not safely snapshotted: %',item_snapshot;
 END IF;
 PERFORM public.billing_rpc('quotations','delete',jsonb_build_object('id',reference_less_quote_id));

 payload=jsonb_build_object(
  'title','Insumos de setembro','number','','requestDate','2026-09-22','requester','IGNORADO','requesterSignatureId',requester_id,'notes','Entregar na fazenda',
  'items',jsonb_build_array(
   jsonb_build_object('id',item_a,'materialId',material_a,'materialName','IGNORADO','quantity','2','unit','IGNORADO','notes','Saco de 50 kg'),
   jsonb_build_object('id',item_b,'materialId',material_b,'materialName','IGNORADO','quantity','1,5','unit','IGNORADO','notes','')
  ),
  'providers',jsonb_build_array(
   jsonb_build_object('id',quote_provider_a,'providerId',provider_a,'providerName','IGNORADO','providerEmail','alterado@cliente.invalid',
    'providerPhone','','notes','','sentAt',NULL,'values',jsonb_build_object(item_a::text,'',item_b::text,'')),
   jsonb_build_object('id',quote_provider_b,'providerId',provider_b,'providerName','IGNORADO','providerEmail','',
    'providerPhone','','notes','Aguardando retorno','sentAt',NULL,'values',jsonb_build_object(item_a::text,'',item_b::text,''))
  ));
 BEGIN
  PERFORM public.billing_rpc('quotations','save',jsonb_set(
   jsonb_set(payload,'{id}',to_jsonb(priced_quote_id)),
   ARRAY['providers','0','values',item_a::text],to_jsonb('1'::text)
  ));
  RAISE EXCEPTION 'Quotation save accepted a price outside negotiation history';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.billing_quotations WHERE id=priced_quote_id)
  OR EXISTS(SELECT 1 FROM public.billing_quotation_provider_values WHERE quotation_id=priced_quote_id)
  OR EXISTS(SELECT 1 FROM public.billing_quotation_negotiations WHERE quotation_id=priced_quote_id) THEN
  RAISE EXCEPTION 'Rejected priced quotation save left partial data';
 END IF;
 r=public.billing_rpc('quotations','save',payload);quote_id=(r->'quote'->>'id')::uuid;
 IF r->'quote'->>'number'<>'COT-001' OR r->'quote'->>'requestDate'<>'2026-09-22'
  OR r->'quote'->>'requester'<>'Equipe de compras' OR jsonb_array_length(r->'quote'->'items')<>2
  OR jsonb_array_length(r->'quote'->'providers')<>2 THEN RAISE EXCEPTION 'Quotation aggregate envelope invalid: %',r; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.billing_quotations WHERE owner_id=auth.uid() AND id=quote_id AND requester_signature_id=requester_id) THEN
  RAISE EXCEPTION 'Quotation requester was not linked to the signature registry';
 END IF;
 IF r->'quote'->'items'->0->>'materialName' NOT IN ('Adubo 14-00-18','Herbicida seletivo')
  OR r->'quote'->'items'->0->>'materialCode'<>'MAT-ADUBO'
  OR coalesce(r->'quote'->'items'->0->>'materialVariantId','')=''
  OR jsonb_array_length(r->'quote'->'items'->0->'materialReferences')=0
  OR jsonb_array_length(r->'quote'->'negotiations')<>0
  OR r->'quote'->'winnerProviderId' IS DISTINCT FROM 'null'::jsonb
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->'quote'->'providers') p WHERE p->>'providerName'='IGNORADO')
  OR NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(r->'quote'->'providers') p
   WHERE p->>'providerId'=provider_a::text
    AND p->>'providerDocumentType'='CNPJ'
    AND p->>'providerDocument'='04773159000523'
    AND p->>'providerTradeName'='Alfa'
  )
  OR NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(r->'quote'->'providers') p
   WHERE p->>'providerId'=provider_b::text
    AND p->>'providerDocumentType'='CPF'
    AND p->>'providerDocument'='11144477735'
    AND p->>'providerTradeName'='Beta'
  ) THEN
  RAISE EXCEPTION 'Browser-controlled snapshots were accepted';
 END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','toggle-status',jsonb_build_object('id',quote_id));
  RAISE EXCEPTION 'Incomplete quotation was finalized';
 EXCEPTION WHEN check_violation THEN NULL; END;

 payload=jsonb_set(payload,'{id}',to_jsonb(quote_id));
 r=public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',quote_provider_a,'quotationItemId',item_a,
  'unitPrice','10.25','notes',' Primeira proposta '));
 r=public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',quote_provider_a,'quotationItemId',item_b,
  'unitPrice','20','notes',''));
 r=public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',quote_provider_b,'quotationItemId',item_a,
  'unitPrice','9,99','notes','Oferta inicial'));
 IF (SELECT p->>'total' FROM jsonb_array_elements(r->'quote'->'providers') p WHERE p->>'providerId'=provider_a::text)<>'50.5'
  OR (SELECT p->'values'->>item_a::text FROM jsonb_array_elements(r->'quote'->'providers') p WHERE p->>'providerId'=provider_a::text)<>'10.25'
  OR (SELECT p->'values'->>item_b::text FROM jsonb_array_elements(r->'quote'->'providers') p WHERE p->>'providerId'=provider_b::text)<>'' THEN
  RAISE EXCEPTION 'Exact provider values or database total are wrong: %',r;
 END IF;
 IF (SELECT (p->>'quotedItemCount')::integer FROM jsonb_array_elements(r->'quote'->'providers') p WHERE p->>'providerId'=provider_a::text)<>2
  OR NOT (SELECT (p->>'isComplete')::boolean FROM jsonb_array_elements(r->'quote'->'providers') p WHERE p->>'providerId'=provider_a::text)
  OR (SELECT (p->>'isComplete')::boolean FROM jsonb_array_elements(r->'quote'->'providers') p WHERE p->>'providerId'=provider_b::text)
  OR r->'quote'->'winningProviderIds'<>jsonb_build_array(quote_provider_a) THEN
  RAISE EXCEPTION 'Incomplete proposals competed or the complete winner was not selected: %',r;
 END IF;
 IF jsonb_array_length(r->'quote'->'negotiations')<>3
  OR NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(r->'quote'->'negotiations') n
   WHERE n->>'providerId'=quote_provider_a::text AND n->>'itemId'=item_a::text
    AND (n->>'version')::integer=1 AND n->>'unitPrice'='10.25'
    AND n->>'notes'='Primeira proposta'
  ) THEN
  RAISE EXCEPTION 'Initial negotiation history projection is invalid: %',r;
 END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','save',payload);
  RAISE EXCEPTION 'Destructive quotation save was accepted after negotiation history';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('quotations','delete',jsonb_build_object('id',quote_id));
  RAISE EXCEPTION 'Quotation with negotiation history was deleted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;

 r=public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',quote_provider_b,'quotationItemId',item_a,
  'unitPrice','10.25','notes','Cobriu a primeira oferta'));
 r=public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',quote_provider_b,'quotationItemId',item_b,
  'unitPrice','20','notes',''));
 IF jsonb_array_length(r->'quote'->'winningProviderIds')<>2 THEN
  RAISE EXCEPTION 'Equal complete totals were not reported as a tie: %',r;
 END IF;
 r=public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',quote_id,'quotationProviderId',quote_provider_b,'quotationItemId',item_a,
  'unitPrice','10','notes','Valor final negociado'));
 IF r->'quote'->'winningProviderIds'<>jsonb_build_array(quote_provider_b)
  OR (SELECT p->>'total' FROM jsonb_array_elements(r->'quote'->'providers') p WHERE p->>'providerId'=provider_b::text)<>'50' THEN
  RAISE EXCEPTION 'Lowest complete proposal was not selected as the winner: %',r;
 END IF;
 IF jsonb_array_length(r->'quote'->'negotiations')<>6
  OR (SELECT max((n->>'version')::integer) FROM jsonb_array_elements(r->'quote'->'negotiations') n
      WHERE n->>'providerId'=quote_provider_b::text AND n->>'itemId'=item_a::text)<>3
  OR (SELECT count(*) FROM public.billing_quotation_negotiations n
      WHERE n.owner_id=auth.uid() AND n.quotation_id=quote_id)<>6
  OR EXISTS(
   SELECT 1 FROM public.billing_quotation_negotiations n
   WHERE n.owner_id=auth.uid() AND n.quotation_id=quote_id
   GROUP BY n.quotation_provider_id,n.quotation_item_id
   HAVING min(n.revision)<>1 OR max(n.revision)<>count(*)
  )
  OR (SELECT v.unit_price FROM public.billing_quotation_provider_values v
      WHERE v.owner_id=auth.uid() AND v.quotation_id=quote_id
       AND v.quotation_provider_id=quote_provider_b
       AND v.quotation_item_id=item_a)<>10.00 THEN
  RAISE EXCEPTION 'Negotiation versions are not contiguous and append-only: %',r;
 END IF;

 BEGIN
  PERFORM public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
   'id',quote_id,'quotationProviderId',quote_provider_a,'quotationItemId',item_a,
   'unitPrice','1.001','notes','Inválido'));
  RAISE EXCEPTION 'Provider price precision above cents was accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 IF (SELECT count(*) FROM public.billing_quotation_negotiations n
     WHERE n.owner_id=auth.uid() AND n.quotation_id=quote_id)<>6 THEN
  RAISE EXCEPTION 'Rejected negotiation created a history entry';
 END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
   'id',quote_id,'quotationProviderId',quote_provider_a,'quotationItemId',item_a,
   'unitPrice','1','notes','','ownerId',auth.uid()));
  RAISE EXCEPTION 'Negotiation accepted an owner from the payload';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

 PERFORM public.billing_rpc('service-providers','save',jsonb_build_object(
  'id',provider_a,'documentType','CNPJ','document','04773159000523','legalName','Fornecedor alterado fora da cotação','tradeName','Alfa',
  'street','Rua A','number','10','complement','','district','Centro','city','Cidade','state','SP',
  'zipCode','01001000','phone','11999990000','email','alfa@example.invalid'));
 PERFORM public.billing_rpc('materials','save',jsonb_build_object(
  'id',material_a,'name','Material alterado fora da cotação','internalCode','MAT-ALTERADO',
  'unit','kg','application','Cobertura'));
 r=public.billing_rpc('quotations','get',jsonb_build_object('id',quote_id));
 IF NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(r->'quote'->'providers') p
   WHERE p->>'providerName'='Fornecedor Alfa'
    AND p->>'providerDocumentType'='CNPJ'
    AND p->>'providerDocument'='04773159000523'
    AND p->>'providerTradeName'='Alfa'
  )
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'quote'->'items') i WHERE i->>'materialName'='Adubo 14-00-18') THEN
  RAISE EXCEPTION 'Quotation snapshots changed with registry edits';
 END IF;
 r=public.billing_rpc('quotations','finalize',jsonb_build_object(
  'id',quote_id,'winnerProviderId',quote_provider_b));
 IF r->'quote'->>'status'<>'finished'
  OR r->'purchaseOrder'->>'quotationProviderId'<>quote_provider_b::text
  OR r->'purchaseOrder'->>'number'<>'PED-001'
  OR r->'quote'->>'purchaseOrderId'<>r->'purchaseOrder'->>'id'
  OR r->'quote'->>'winnerProviderId'<>quote_provider_b::text
  OR jsonb_array_length(r->'quote'->'negotiations')<>6
  OR (SELECT material_internal_code FROM public.billing_purchase_order_items
      WHERE owner_id=auth.uid() AND quotation_id=quote_id
       AND quotation_item_id=item_a)<>'MAT-ADUBO' THEN
  RAISE EXCEPTION 'Complete quotation was not finalized into one purchase order: %',r;
 END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
   'id',quote_id,'quotationProviderId',quote_provider_a,'quotationItemId',item_a,
   'unitPrice','1','notes','Tardia'));
  RAISE EXCEPTION 'Finished quotation accepted a negotiation';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('quotations','save',payload);
  RAISE EXCEPTION 'Finished quotation was edited';
 EXCEPTION WHEN check_violation THEN NULL; END;
 r=public.billing_rpc('quotations','list','{"status":"finished"}');
 IF (r->>'total')::integer<>1 OR r->'quotes'->0->>'id'<>quote_id::text THEN RAISE EXCEPTION 'Finished quotation list is invalid'; END IF;

 SELECT material_variant_id INTO reference_id
 FROM public.billing_quotation_items
 WHERE owner_id=auth.uid() AND quotation_id=quote_id AND id=item_a;
 PERFORM public.billing_rpc('material-variants','delete',jsonb_build_object('id',reference_id));
 r=public.billing_rpc('quotations','get',jsonb_build_object('id',quote_id));
 SELECT value INTO item_snapshot
 FROM jsonb_array_elements(r->'quote'->'items')
 WHERE value->>'materialId'=material_a::text;
 IF item_snapshot->>'materialVariantId' IS NOT NULL
  OR jsonb_array_length(item_snapshot->'materialReferences')<>2 THEN
  RAISE EXCEPTION 'Deleting a catalog reference changed the quotation snapshot: %',item_snapshot;
 END IF;

 PERFORM set_config('test.quotation.id',quote_id::text,true);
 PERFORM set_config('test.quotation.material',material_a::text,true);
 PERFORM set_config('test.quotation.provider',provider_a::text,true);
 PERFORM set_config('test.quotation.item',item_a::text,true);
 PERFORM set_config('test.quotation.quote_provider',quote_provider_a::text,true);
END $$;

DO $$ BEGIN
 BEGIN
  INSERT INTO public.billing_materials(owner_id,name,code,unit,application)
   VALUES(auth.uid(),'Direto','DIRECT','kg','');
  RAISE EXCEPTION 'Direct material DML was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO public.billing_quotation_provider_values(owner_id,quotation_id,quotation_provider_id,quotation_item_id,unit_price)
   VALUES(auth.uid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1);
  RAISE EXCEPTION 'Direct quotation value DML was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO public.billing_quotation_negotiations(
   owner_id,quotation_id,quotation_provider_id,quotation_item_id,revision,unit_price
  ) VALUES(auth.uid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1,1);
  RAISE EXCEPTION 'Direct negotiation history insert was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.billing_quotation_negotiations SET notes='alterado';
  RAISE EXCEPTION 'Direct negotiation history update was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  DELETE FROM public.billing_quotation_negotiations;
  RAISE EXCEPTION 'Direct negotiation history delete was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000002',true);
SELECT public.billing_rpc('settings','get','{}');
DO $$
DECLARE
 r jsonb;
 foreign_quote uuid:=current_setting('test.quotation.id')::uuid;
 foreign_quote_provider uuid:=current_setting('test.quotation.quote_provider')::uuid;
 foreign_item uuid:=current_setting('test.quotation.item')::uuid;
BEGIN
 r=public.billing_rpc('quotations','list','{"status":"finished"}');
 IF (r->>'total')::integer<>0 OR EXISTS(SELECT 1 FROM public.billing_quotations) THEN RAISE EXCEPTION 'Quotation tenant isolation failed'; END IF;
 BEGIN
  PERFORM public.billing_rpc('quotations','get',jsonb_build_object('id',foreign_quote));
  RAISE EXCEPTION 'Foreign quotation get was accepted';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
   'id',foreign_quote,'quotationProviderId',foreign_quote_provider,
   'quotationItemId',foreign_item,'unitPrice','1','notes','Tentativa cruzada'));
  RAISE EXCEPTION 'Foreign quotation negotiation was accepted';
 EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;

RESET ROLE;
INSERT INTO public.billing_access_profiles(id,owner_id,name,description,permissions)
 VALUES('94000000-0000-4000-8000-000000000030','94000000-0000-4000-8000-000000000001','Leitor de cotações','',ARRAY['registrations.read']);
INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,is_owner,status)
 VALUES('94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000003','94000000-0000-4000-8000-000000000030',false,'active');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000003',true);
DO $$
DECLARE r jsonb;
BEGIN
 r=public.billing_rpc('quotations','list','{"status":"finished"}');
 IF (r->>'total')::integer<>1
  OR jsonb_array_length(r->'quotes'->0->'negotiations')<>6
  OR NOT EXISTS(SELECT 1 FROM public.billing_quotation_provider_values)
  OR NOT EXISTS(SELECT 1 FROM public.billing_quotation_negotiations) THEN
  RAISE EXCEPTION 'Registration reader cannot read quotation aggregate or Realtime rows';
 END IF;
 BEGIN
  PERFORM public.billing_rpc('materials','save','{"name":"Sem acesso","unit":"kg","application":""}');
  RAISE EXCEPTION 'Read-only member wrote a material';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
   'id',current_setting('test.quotation.id')::uuid,
   'quotationProviderId',current_setting('test.quotation.quote_provider')::uuid,
   'quotationItemId',current_setting('test.quotation.item')::uuid,
   'unitPrice','1','notes','Sem acesso'));
  RAISE EXCEPTION 'Read-only member recorded a negotiation';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.billing_rpc('quotations','list','{"status":"finished"}');RAISE EXCEPTION 'Anonymous quotation RPC was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.billing_rpc('quotations','record-negotiation',jsonb_build_object(
  'id',current_setting('test.quotation.id')::uuid,
  'quotationProviderId',current_setting('test.quotation.quote_provider')::uuid,
  'quotationItemId',current_setting('test.quotation.item')::uuid,
  'unitPrice','1','notes','Anônimo'));RAISE EXCEPTION 'Anonymous negotiation RPC was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
