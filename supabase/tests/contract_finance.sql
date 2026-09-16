BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('55555555-5555-4555-8555-555555555555','finance-a@example.invalid',now()),
 ('66666666-6666-4666-8666-666666666666','finance-b@example.invalid',now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',true);
DO $$
DECLARE
 company uuid;other_company uuid;client uuid;contract_type uuid;contract uuid;farm uuid;plot uuid;
 scope jsonb;input jsonb;discount_input jsonb;r jsonb;s jsonb;payment_id uuid;discount_id uuid;load_id uuid;revision integer;
 details jsonb:='{"tradeName":"","cnpj":"","street":"","number":"","complement":"","district":"","city":"","state":"","zipCode":"","phone":"","email":""}';
BEGIN
 company=(public.billing_rpc('companies','save',details||'{"legalName":"Empresa financeira","isPrimary":true}')->'company'->>'id')::uuid;
 other_company=(public.billing_rpc('companies','save',details||'{"legalName":"Outra empresa financeira","isPrimary":false}')->'company'->>'id')::uuid;
 client=(public.billing_rpc('clients','save',details||'{"legalName":"Usina financeira","cnpj":"11222333000181"}')->'client'->>'id')::uuid;
 contract_type=(public.billing_rpc('contract-types','save','{"name":"Financeiro","stages":[]}')->'type'->>'id')::uuid;
 -- The RPC envelope for a contract type is validated below by the contract save.
 IF contract_type IS NULL THEN
  SELECT id INTO contract_type FROM public.billing_contract_types WHERE name='Financeiro';
 END IF;
 contract=(public.billing_rpc('contracts','save',jsonb_build_object('title','Contrato financeiro','companyId',company,'clientId',client,'typeId',contract_type,'startDate','2026-07-01','endDate','','contractedVolume','1000','value','','notes','','atrPriceType','gross','atrPeriodType','monthly'))->'contract'->>'id')::uuid;
 scope=jsonb_build_object('companyId',company,'contractId',contract);
 PERFORM set_config('finance.contract',contract::text,true);PERFORM set_config('finance.company',company::text,true);
 farm=(public.billing_rpc('farms','save','{"name":"Fazenda financeira","areaHa":"10","city":"Cidade","state":"SP"}')->'farm'->>'id')::uuid;
 plot=(public.billing_rpc('plots','save',jsonb_build_object('name','Talhão financeiro','farmId',farm,'areaHa','10'))->'data'->'plots'->0->>'id')::uuid;
 FOR i IN 6..8 LOOP
  PERFORM public.billing_rpc('atr','save',jsonb_build_object('year',2026,'month',i,'monthlyGrossValue','1','monthlyNetValue','0.9','accumulatedGrossValue','0.8','accumulatedNetValue','0.7'));
 END LOOP;
 r=public.billing_rpc('contracts','save-load',scope||jsonb_build_object('farmId',farm,'plotId',plot,'loadedAt','2026-07-01','volume','10','atr','100','document','','notes',''));
 load_id=(r->'load'->>'id')::uuid;
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('farmId',farm,'plotId',plot,'loadedAt','2026-07-02','volume','30','atr','200','document','','notes',''));
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('farmId',farm,'plotId',plot,'loadedAt','2026-08-01','volume','20','atr','150','document','','notes',''));
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('farmId',farm,'plotId',plot,'loadedAt','2026-09-01','volume','10','atr','150','document','','notes',''));
 discount_input=scope||jsonb_build_object('requestId',gen_random_uuid(),'title','Acordo 75','ratePerTon','75,00','months',jsonb_build_array('2026-07','2026-09'),'notes','');
 discount_id=(public.billing_rpc('contracts','save-discount',discount_input)->>'id')::uuid;
 IF (public.billing_rpc('contracts','save-discount',discount_input)->>'id')::uuid<>discount_id THEN RAISE EXCEPTION 'Discount retry duplicated'; END IF;
 input=scope||jsonb_build_object('requestId',gen_random_uuid(),'kind','advance','receivedAt','2026-06-30','referenceMonth','2026-07','amount','1000,25','document','ADV','notes','');
 payment_id=(public.billing_rpc('contracts','save-payment',input)->>'id')::uuid;
 IF (public.billing_rpc('contracts','save-payment',input)->>'id')::uuid<>payment_id THEN RAISE EXCEPTION 'Payment retry duplicated'; END IF;
 PERFORM public.billing_rpc('contracts','save-payment',scope||jsonb_build_object('requestId',gen_random_uuid(),'kind','receipt','receivedAt','2026-08-10','referenceMonth','2026-07','amount','2000.50','document','REC','notes',''));
 s=public.billing_rpc('contracts','get',jsonb_build_object('id',contract,'companyId',company))->'contract'->'financialSummary';
 IF s->'totals'->>'loadedVolume'<>'70' OR s->'totals'->>'averageAtr'<>'164.285714' OR s->'totals'->>'grossAmount'<>'11500' OR s->'totals'->>'discountAmount'<>'3750' OR s->'totals'->>'netAmount'<>'7750' OR s->'totals'->>'receivedAmount'<>'3000.75' OR s->'totals'->>'pendingAmount'<>'4749.25' THEN RAISE EXCEPTION 'Finance totals wrong: %',s->'totals'; END IF;
 SELECT item INTO r FROM jsonb_array_elements(s->'months') item WHERE item->>'month'='2026-07';
 IF r->>'averageAtr'<>'175' OR r->>'discountAmount'<>'3000' OR r->>'pendingAmount'<>'999.25' THEN RAISE EXCEPTION 'Weighted ATR or monthly totals wrong: %',r; END IF;
 SELECT item INTO r FROM jsonb_array_elements(s->'months') item WHERE item->>'month'='2026-08';
 IF r->>'discountAmount'<>'0' OR r->>'receivedAmount'<>'0' OR r->>'pendingAmount'<>'3000' THEN RAISE EXCEPTION 'Unselected month discounted or receipt assigned by date: %',r; END IF;
 IF jsonb_array_length(s->'payments')<>2 THEN RAISE EXCEPTION 'Receipts duplicated'; END IF;

 -- A different rate can apply only to August, leaving July and September intact.
 PERFORM public.billing_rpc('contracts','save-discount',scope||jsonb_build_object('requestId',gen_random_uuid(),'title','Acordo 50','ratePerTon','50','months',jsonb_build_array('2026-08'),'notes',''));
 BEGIN PERFORM public.billing_rpc('contracts','save-discount',discount_input||jsonb_build_object('requestId',gen_random_uuid()));RAISE EXCEPTION 'Duplicate agreement accepted';EXCEPTION WHEN unique_violation THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('contracts','save-discount',discount_input||jsonb_build_object('requestId',gen_random_uuid(),'title','Duplicated months','months',jsonb_build_array('2026-07','2026-07')));RAISE EXCEPTION 'Duplicate months accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('contracts','save-discount',discount_input||jsonb_build_object('requestId',gen_random_uuid(),'title','Bad month','months',jsonb_build_array('2026-13')));RAISE EXCEPTION 'Invalid month accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('contracts','save-payment',input||'{"amount":"1.001"}');RAISE EXCEPTION 'Fractional cent accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('contracts','save-payment',input||'{"amount":"-1"}');RAISE EXCEPTION 'Negative receipt accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('contracts','save-payment',input||'{"amount":"NaN"}');RAISE EXCEPTION 'NaN accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('contracts','save-payment',input||'{"owner_id":"66666666-6666-4666-8666-666666666666"}');RAISE EXCEPTION 'Owner injection accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('contracts','save-payment',input||jsonb_build_object('companyId',other_company));RAISE EXCEPTION 'Cross company accepted';EXCEPTION WHEN no_data_found THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('contracts','save-payment',input||'{"amount":"2"}');RAISE EXCEPTION 'Changed retry accepted';EXCEPTION WHEN unique_violation THEN NULL;END;
 PERFORM public.billing_rpc('contracts','save-payment',input||jsonb_build_object('id',payment_id,'expectedRevision',1,'amount','1100.25'));
 BEGIN PERFORM public.billing_rpc('contracts','save-payment',input||jsonb_build_object('id',payment_id,'expectedRevision',1));RAISE EXCEPTION 'Stale update accepted';EXCEPTION WHEN serialization_failure THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('contracts','delete-payment',scope||jsonb_build_object('id',payment_id,'expectedRevision',1));RAISE EXCEPTION 'Stale delete accepted';EXCEPTION WHEN serialization_failure THEN NULL;END;
 PERFORM public.billing_rpc('contracts','delete-payment',scope||jsonb_build_object('id',payment_id,'expectedRevision',2));
 PERFORM public.billing_rpc('contracts','save-discount',discount_input||jsonb_build_object('id',discount_id,'expectedRevision',1,'months',jsonb_build_array('2026-09')));
 s=public.billing_rpc('contracts','get',jsonb_build_object('id',contract,'companyId',company))->'contract'->'financialSummary';
 IF s->'totals'->>'discountAmount'<>'1750' OR s->'totals'->>'advanceAmount'<>'0' THEN RAISE EXCEPTION 'Removal did not recalculate'; END IF;
 -- A month with no delivered quantity can carry an advance without fabricating revenue.
 PERFORM public.billing_rpc('contracts','save-payment',input||jsonb_build_object('requestId',gen_random_uuid(),'referenceMonth','2026-11','amount','100'));
 s=public.billing_rpc('contracts','get',jsonb_build_object('id',contract,'companyId',company))->'contract'->'financialSummary';
 SELECT item INTO r FROM jsonb_array_elements(s->'months') item WHERE item->>'month'='2026-11';
 IF r->>'pendingAmount'<>'0' OR r->>'creditAmount'<>'100' OR r->>'grossAmount'<>'0' THEN RAISE EXCEPTION 'Advance before delivery mishandled'; END IF;
 -- Missing quote makes the financial balance unknown, but keeps discounts and receipts.
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('farmId',farm,'plotId',plot,'loadedAt','2026-10-01','volume','1','atr','100','document','','notes',''));
 s=public.billing_rpc('contracts','get',jsonb_build_object('id',contract,'companyId',company))->'contract'->'financialSummary';
 IF s->'totals'->>'billingPending'<>'true' OR s->'totals'->>'pendingAmount'<>'' OR s->'totals'->>'creditAmount'<>'' OR s->'totals'->>'receivedAmount'<>'2100.5' THEN RAISE EXCEPTION 'Missing quote fabricated a balance: %',s->'totals'; END IF;
 -- Discounts follow changes in delivered quantity and can be removed independently.
 SELECT id INTO load_id FROM public.billing_contract_loads WHERE contract_id=contract AND loaded_at='2026-09-01';
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('id',load_id,'farmId',farm,'plotId',plot,'loadedAt','2026-09-01','volume','20','atr','150','document','','notes',''));
 s=public.billing_rpc('contracts','get',jsonb_build_object('id',contract,'companyId',company))->'contract'->'financialSummary';
 IF s->'totals'->>'discountAmount'<>'2500' THEN RAISE EXCEPTION 'Discount did not follow changed load quantity'; END IF;
 PERFORM public.billing_rpc('contracts','delete-discount',scope||jsonb_build_object('id',discount_id,'expectedRevision',2));
 s=public.billing_rpc('contracts','get',jsonb_build_object('id',contract,'companyId',company))->'contract'->'financialSummary';
 IF s->'totals'->>'discountAmount'<>'1000' THEN RAISE EXCEPTION 'Deleted agreement still affects totals'; END IF;
 BEGIN INSERT INTO public.billing_contract_payments(owner_id,contract_id) VALUES(auth.uid(),contract);RAISE EXCEPTION 'Direct payment insert allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN UPDATE public.billing_contract_discounts SET title='Bypass';RAISE EXCEPTION 'Direct discount update allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN DELETE FROM public.billing_contract_payments;RAISE EXCEPTION 'Direct payment delete allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',true);
DO $$ BEGIN
 BEGIN PERFORM public.billing_rpc('contracts','get',jsonb_build_object('id',current_setting('finance.contract'),'companyId',current_setting('finance.company')));RAISE EXCEPTION 'Cross account read allowed';EXCEPTION WHEN invalid_parameter_value OR no_data_found THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('contracts','save-payment',jsonb_build_object('contractId',current_setting('finance.contract'),'companyId',current_setting('finance.company')));RAISE EXCEPTION 'Cross account write allowed';EXCEPTION WHEN no_data_found THEN NULL;END;
 IF EXISTS(SELECT 1 FROM public.billing_contract_payments) OR EXISTS(SELECT 1 FROM public.billing_contract_discounts) THEN RAISE EXCEPTION 'Finance RLS leaked another account';END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ BEGIN
 BEGIN PERFORM public.billing_rpc('contracts','save-payment','{}');RAISE EXCEPTION 'Unauthenticated finance allowed';EXCEPTION WHEN invalid_authorization_specification THEN NULL;END;
END $$;
RESET ROLE;
ROLLBACK;
