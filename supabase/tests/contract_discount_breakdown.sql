BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('77777777-7777-4777-8777-777777777771','discount-months-a@example.invalid',now()),
 ('77777777-7777-4777-8777-777777777772','discount-months-b@example.invalid',now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777771',true);
DO $$
DECLARE
 company uuid;client uuid;contract_type uuid;contract uuid;other_contract uuid;farm uuid;plot uuid;load_id uuid;discount_id uuid;
 scope jsonb;load_input jsonb;discount_input jsonb;s jsonb;r jsonb;agreement jsonb;month_row jsonb;
 details jsonb:='{"tradeName":"","cnpj":"","street":"","number":"","complement":"","district":"","city":"","state":"","zipCode":"","phone":"","email":""}';
 notes text:=E'Transporte acordado com a usina.\nAplicar apenas nos meses selecionados, conforme observação d\'água.';
BEGIN
 company=(public.billing_rpc('companies','save',details||'{"legalName":"Empresa descontos mensais","isPrimary":true}')->'company'->>'id')::uuid;
 client=(public.billing_rpc('clients','save',details||'{"legalName":"Usina descontos mensais","cnpj":"11222333000181"}')->'client'->>'id')::uuid;
 PERFORM public.billing_rpc('contract-types','save','{"name":"Descontos mensais","stages":[]}');
 SELECT id INTO contract_type FROM public.billing_contract_types WHERE name='Descontos mensais';
 r=jsonb_build_object('title','Contrato descontos mensais','companyId',company,'clientId',client,'typeId',contract_type,'startDate','2026-07-01','endDate','','contractedVolume','1000','value','','notes','','atrPriceType','gross','atrPeriodType','monthly');
 contract=(public.billing_rpc('contracts','save',r)->'contract'->>'id')::uuid;
 other_contract=(public.billing_rpc('contracts','save',r||'{"title":"Outro contrato com cargas"}')->'contract'->>'id')::uuid;
 scope=jsonb_build_object('companyId',company,'contractId',contract);
 PERFORM set_config('discount_months.contract',contract::text,true);
 PERFORM set_config('discount_months.company',company::text,true);
 farm=(public.billing_rpc('farms','save','{"name":"Fazenda descontos mensais","areaHa":"10","city":"Cidade","state":"SP"}')->'farm'->>'id')::uuid;
 plot=(public.billing_rpc('plots','save',jsonb_build_object('name','Talhão descontos mensais','farmId',farm,'areaHa','10'))->'data'->'plots'->0->>'id')::uuid;
 load_input=scope||jsonb_build_object('farmId',farm,'plotId',plot,'atr','100','document','','notes','');
 load_id=(public.billing_rpc('contracts','save-load',load_input||'{"loadedAt":"2026-07-01","volume":"0.003"}')->'load'->>'id')::uuid;
 PERFORM public.billing_rpc('contracts','save-load',load_input||'{"loadedAt":"2026-07-31","volume":"0.002"}');
 PERFORM public.billing_rpc('contracts','save-load',load_input||'{"loadedAt":"2026-08-01","volume":"0.005"}');
 PERFORM public.billing_rpc('contracts','save-load',load_input||'{"loadedAt":"2026-09-01","volume":"0.004"}');
 PERFORM public.billing_rpc('contracts','save-load',load_input||jsonb_build_object('contractId',other_contract,'loadedAt','2026-07-01','volume','100'));
 discount_input=scope||jsonb_build_object('requestId',gen_random_uuid(),'title','Transporte','ratePerTon','1','months',jsonb_build_array('2026-10','2026-08','2026-07'),'notes',notes);
 discount_id=(public.billing_rpc('contracts','save-discount',discount_input)->>'id')::uuid;
 PERFORM public.billing_rpc('contracts','save-discount',scope||jsonb_build_object('requestId',gen_random_uuid(),'title','Serviços','ratePerTon','3','months',jsonb_build_array('2026-09','2026-07'),'notes','Outro tipo de desconto.'));
 s=public.billing_rpc('contracts','get',jsonb_build_object('id',contract,'companyId',company))->'contract'->'financialSummary';
 IF s->'totals'->>'discountAmount' IS DISTINCT FROM '0.05' OR s->'totals'->>'loadedVolume' IS DISTINCT FROM '0.014' THEN RAISE EXCEPTION 'Incorrect overall discount totals: %',s; END IF;
 SELECT item INTO agreement FROM jsonb_array_elements(s->'discounts') item WHERE item->>'title'='Transporte';
 IF agreement->>'notes' IS DISTINCT FROM notes OR agreement->>'amount' IS DISTINCT FROM '0.02' OR agreement->>'loadedVolume' IS DISTINCT FROM '0.01' THEN RAISE EXCEPTION 'Notes or monthly rounding lost: %',agreement; END IF;
 -- Sum loads before rounding each agreement/month; sum those rounded months for the agreement total.
 IF agreement->'monthlyBreakdown' IS DISTINCT FROM '[{"month":"2026-07","loadedVolume":"0.005","amount":"0.01"},{"month":"2026-08","loadedVolume":"0.005","amount":"0.01"},{"month":"2026-10","loadedVolume":"0","amount":"0"}]'::jsonb THEN RAISE EXCEPTION 'Missing sorted monthly values, selected empty month, decimal strings or contract isolation: %',agreement; END IF;
 SELECT item INTO agreement FROM jsonb_array_elements(s->'discounts') item WHERE item->>'title'='Serviços';
 IF agreement->'monthlyBreakdown' IS DISTINCT FROM '[{"month":"2026-07","loadedVolume":"0.005","amount":"0.02"},{"month":"2026-09","loadedVolume":"0.004","amount":"0.01"}]'::jsonb THEN RAISE EXCEPTION 'Separate agreements or selected months merged: %',agreement; END IF;
 -- Detailed rows reconcile with the same monthly totals shown elsewhere in finance.
 FOR month_row IN SELECT item FROM jsonb_array_elements(s->'months') item LOOP
  IF (month_row->>'discountAmount')::numeric IS DISTINCT FROM
   (SELECT coalesce(sum((detail->>'amount')::numeric),0) FROM jsonb_array_elements(s->'discounts') d CROSS JOIN LATERAL jsonb_array_elements(d->'monthlyBreakdown') detail WHERE detail->>'month'=month_row->>'month')
  THEN RAISE EXCEPTION 'Monthly details do not reconcile: %',month_row; END IF;
 END LOOP;
 r=public.billing_rpc('contracts','get',jsonb_build_object('id',other_contract,'companyId',company))->'contract'->'financialSummary';
 IF r->'discounts' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'Agreements leaked into another contract: %',r; END IF;
 PERFORM public.billing_rpc('contracts','save-load',load_input||jsonb_build_object('id',load_id,'loadedAt','2026-07-01','volume','0.013'));
 s=public.billing_rpc('contracts','get',jsonb_build_object('id',contract,'companyId',company))->'contract'->'financialSummary';
 SELECT item INTO agreement FROM jsonb_array_elements(s->'discounts') item WHERE item->>'title'='Transporte';
 IF agreement->'monthlyBreakdown'->0 IS DISTINCT FROM '{"month":"2026-07","loadedVolume":"0.015","amount":"0.02"}'::jsonb OR agreement->>'amount' IS DISTINCT FROM '0.03' THEN RAISE EXCEPTION 'Breakdown did not follow edited load: %',agreement; END IF;
 PERFORM public.billing_rpc('contracts','save-discount',discount_input||jsonb_build_object('id',discount_id,'expectedRevision',1,'months',jsonb_build_array('2026-08','2026-10')));
 s=public.billing_rpc('contracts','get',jsonb_build_object('id',contract,'companyId',company))->'contract'->'financialSummary';
 SELECT item INTO agreement FROM jsonb_array_elements(s->'discounts') item WHERE item->>'title'='Transporte';
 IF agreement->'monthlyBreakdown' IS DISTINCT FROM '[{"month":"2026-08","loadedVolume":"0.005","amount":"0.01"},{"month":"2026-10","loadedVolume":"0","amount":"0"}]'::jsonb OR agreement->>'notes' IS DISTINCT FROM notes THEN RAISE EXCEPTION 'Changed applicability retained an excluded month or lost notes: %',agreement; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777772',true);
DO $$ BEGIN
 BEGIN PERFORM public.billing_rpc('contracts','get',jsonb_build_object('id',current_setting('discount_months.contract'),'companyId',current_setting('discount_months.company')));RAISE EXCEPTION 'Cross-account monthly discount read allowed';EXCEPTION WHEN invalid_parameter_value OR no_data_found THEN NULL;END;
 IF EXISTS(SELECT 1 FROM public.billing_contract_discounts) THEN RAISE EXCEPTION 'Monthly discount RLS leaked another account'; END IF;
 BEGIN PERFORM billing_private.contract_financial_summary(NULL::public.billing_contracts);RAISE EXCEPTION 'Private financial helper exposed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ BEGIN
 BEGIN PERFORM public.billing_rpc('contracts','get',jsonb_build_object('id',current_setting('discount_months.contract'),'companyId',current_setting('discount_months.company')));RAISE EXCEPTION 'Unauthenticated monthly discount read allowed';EXCEPTION WHEN invalid_authorization_specification THEN NULL;END;
END $$;
RESET ROLE;
ROLLBACK;
