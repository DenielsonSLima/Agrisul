BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('81818181-8181-4181-8181-818181818181','closure-a@example.invalid',now()),
 ('82828282-8282-4282-8282-828282828282','closure-b@example.invalid',now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81818181-8181-4181-8181-818181818181',true);
DO $$
DECLARE
 company uuid;client uuid;contract_type uuid;contract uuid;farm uuid;plot uuid;advance uuid;refund uuid;
 input jsonb;scope jsonb;refund_input jsonb;result jsonb;summary jsonb;day jsonb;
 details jsonb:='{"tradeName":"","cnpj":"","street":"","number":"","complement":"","district":"","city":"","state":"","zipCode":"","phone":"","email":""}';
BEGIN
 company=(public.billing_rpc('companies','save',details||'{"legalName":"Empresa encerramento","isPrimary":true}')->'company'->>'id')::uuid;
 client=(public.billing_rpc('clients','save',details||'{"legalName":"Cliente encerramento","cnpj":"11222333000181"}')->'client'->>'id')::uuid;
 contract_type=(public.billing_rpc('contract-types','save','{"name":"Tipo encerramento","stages":[]}')->'type'->>'id')::uuid;
 input=jsonb_build_object('title','Contrato 100 por 80','contractNumber','ENC-100-80','companyId',company,'clientId',client,'typeId',contract_type,
  'status','Ativo','startDate','2026-09-01','endDate','','contractedVolume','100','value','','notes','','atrPriceType','gross','atrPeriodType','monthly');
 contract=(public.billing_rpc('contracts','save',input)->'contract'->>'id')::uuid;
 scope=jsonb_build_object('companyId',company,'contractId',contract);
 PERFORM set_config('closure.company',company::text,true);PERFORM set_config('closure.contract',contract::text,true);
 farm=(public.billing_rpc('farms','save','{"name":"Fazenda encerramento","areaHa":"10","city":"Cidade","state":"SP"}')->'farm'->>'id')::uuid;
 plot=(public.billing_rpc('plots','save',jsonb_build_object('name','Talhão encerramento','farmId',farm,'areaHa','10'))->'data'->'plots'->0->>'id')::uuid;
 PERFORM public.billing_rpc('atr','save','{"year":2026,"month":8,"monthlyGrossValue":"1","monthlyNetValue":"1","accumulatedGrossValue":"1","accumulatedNetValue":"1"}');
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('farmId',farm,'plotId',plot,'loadedAt','2026-09-10','volume','80','atr','1','document','LOAD-80','notes',''));
 advance=(public.billing_rpc('contracts','save-payment',scope||jsonb_build_object('requestId',gen_random_uuid(),'kind','advance','receivedAt','2026-09-01','referenceMonth','2026-09','amount','100','document','ADV-100','notes',''))->>'id')::uuid;
 summary=public.billing_rpc('contracts','get',jsonb_build_object('id',contract,'companyId',company))->'contract'->'financialSummary';
 IF summary->'totals'->>'netAmount'<>'80' OR summary->'totals'->>'advanceAmount'<>'100' OR summary->'totals'->>'creditAmount'<>'20' OR summary->'totals'->>'refundableAmount'<>'20' THEN
  RAISE EXCEPTION 'Pre-close credit wrong: %',summary->'totals';
 END IF;
 refund_input=scope||jsonb_build_object('requestId',gen_random_uuid(),'refundedAt','2026-09-20','referenceMonth','2026-09','amount','20','document','PIX-20','notes','Saldo devolvido');
 BEGIN PERFORM public.billing_rpc('contracts','save-refund',refund_input);RAISE EXCEPTION 'Active refund accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('contracts','save',input||jsonb_build_object('id',contract,'status','Concluído'));RAISE EXCEPTION 'Generic close accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 result=public.billing_rpc('contracts','close',scope);
 IF result->'contract'->>'status'<>'Concluído' THEN RAISE EXCEPTION 'Contract not closed'; END IF;
 IF public.billing_rpc('contracts','close',scope)->'contract'->>'status'<>'Concluído' THEN RAISE EXCEPTION 'Close retry failed'; END IF;
 BEGIN PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('farmId',farm,'plotId',plot,'loadedAt','2026-09-11','volume','1','atr','1','document','','notes',''));RAISE EXCEPTION 'Closed load accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('contracts','save-discount',scope||jsonb_build_object('requestId',gen_random_uuid(),'title','Tardio','ratePerTon','1','months',jsonb_build_array('2026-09'),'notes',''));RAISE EXCEPTION 'Closed discount accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('contracts','save-refund',refund_input||jsonb_build_object('requestId',gen_random_uuid(),'amount','20.01'));RAISE EXCEPTION 'Excess refund accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 refund=(public.billing_rpc('contracts','save-refund',refund_input)->>'id')::uuid;
 IF (public.billing_rpc('contracts','save-refund',refund_input)->>'id')::uuid<>refund THEN RAISE EXCEPTION 'Refund retry duplicated'; END IF;
 summary=public.billing_rpc('contracts','get',jsonb_build_object('id',contract,'companyId',company))->'contract'->'financialSummary';
 IF summary->'totals'->>'advanceAmount'<>'100' OR summary->'totals'->>'refundedAmount'<>'20' OR summary->'totals'->>'receivedAmount'<>'80' OR summary->'totals'->>'creditAmount'<>'0' OR summary->'totals'->>'refundableAmount'<>'0' OR jsonb_array_length(summary->'refunds')<>1 OR jsonb_array_length(summary->'payments')<>1 THEN
  RAISE EXCEPTION 'Refund totals or ledgers wrong: %',summary;
 END IF;
 IF summary->'refunds'->0->>'amount'<>'20' OR summary->'refunds'->0->>'document'<>'PIX-20' THEN RAISE EXCEPTION 'Refund presentation wrong'; END IF;
 BEGIN PERFORM public.billing_rpc('contracts','save-refund',refund_input||jsonb_build_object('requestId',gen_random_uuid(),'amount','1'));RAISE EXCEPTION 'Second excess refund accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('contracts','save-payment',scope||jsonb_build_object('id',advance,'expectedRevision',1,'requestId',(SELECT request_id FROM public.billing_contract_payments WHERE id=advance),'kind','advance','receivedAt','2026-09-01','referenceMonth','2026-09','amount','90','document','ADV-100','notes',''));RAISE EXCEPTION 'Payment edit invalidated refund';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('contracts','delete-payment',scope||jsonb_build_object('id',advance,'expectedRevision',1));RAISE EXCEPTION 'Payment delete invalidated refund';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 result=public.billing_rpc('summary','dashboard',jsonb_build_object('companyId',company,'from','2026-09-01','to','2026-09-30'));
 IF result->'totals'->>'receivedAmount'<>'80' THEN RAISE EXCEPTION 'Executive summary ignored refund: %',result->'totals'; END IF;
 result=public.billing_rpc('agenda','list',jsonb_build_object('companyId',company,'month','2026-09','kind','refund'));
 IF result->>'eventCount'<>'1' THEN RAISE EXCEPTION 'Refund missing from agenda'; END IF;
 SELECT value INTO day FROM jsonb_array_elements(result->'days') WHERE value->>'date'='2026-09-20';
 IF day->'events'->0->>'title'<>'Estorno de adiantamento' OR day->'events'->0->>'amount'<>'20' THEN RAISE EXCEPTION 'Refund agenda event wrong: %',day; END IF;
 BEGIN PERFORM public.billing_rpc('contracts','delete-refund',scope||jsonb_build_object('id',refund,'expectedRevision',2));RAISE EXCEPTION 'Stale refund delete accepted';EXCEPTION WHEN serialization_failure THEN NULL;END;
 PERFORM public.billing_rpc('contracts','delete-refund',scope||jsonb_build_object('id',refund,'expectedRevision',1));
 summary=public.billing_rpc('contracts','get',jsonb_build_object('id',contract,'companyId',company))->'contract'->'financialSummary';
 IF summary->'totals'->>'creditAmount'<>'20' OR summary->'totals'->>'refundedAmount'<>'0' OR jsonb_array_length(summary->'refunds')<>0 THEN RAISE EXCEPTION 'Refund deletion did not restore credit'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','82828282-8282-4282-8282-828282828282',true);
DO $$ BEGIN
 BEGIN PERFORM public.billing_rpc('contracts','save-refund',jsonb_build_object('companyId',current_setting('closure.company'),'contractId',current_setting('closure.contract'),'requestId',gen_random_uuid(),'refundedAt','2026-09-20','referenceMonth','2026-09','amount','1','document','','notes',''));RAISE EXCEPTION 'Cross-owner refund accepted';EXCEPTION WHEN no_data_found THEN NULL;END;
 IF EXISTS(SELECT 1 FROM public.billing_contract_payments) THEN RAISE EXCEPTION 'Finance RLS leaked closure records'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ BEGIN
 BEGIN PERFORM public.billing_rpc('contracts','close','{}');RAISE EXCEPTION 'Anonymous close accepted';EXCEPTION WHEN invalid_authorization_specification THEN NULL;END;
END $$;
RESET ROLE;
ROLLBACK;
