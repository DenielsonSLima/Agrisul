-- Safe for local PostgreSQL and the verified remote project: all fixtures roll back.
BEGIN;
SELECT set_config('atr_test.owner_a',gen_random_uuid()::text,true),
       set_config('atr_test.owner_b',gen_random_uuid()::text,true);
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT current_setting(setting)::uuid,'atr-'||current_setting(setting)||'@example.invalid',now()
 FROM unnest(ARRAY['atr_test.owner_a','atr_test.owner_b']) setting;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('atr_test.owner_a'),true);
DO $$
DECLARE
 company uuid;other_company uuid;client uuid;kind uuid;contract uuid;farm uuid;plot uuid;load_id uuid;missing_id uuid;
 input jsonb;scope jsonb;load_input jsonb;r jsonb;s jsonb;row jsonb;listed jsonb;quote_input jsonb;
 criterion record;quotation record;loaded_date text;august_quote uuid;current_quote uuid;
 details jsonb:='{"tradeName":"","cnpj":"","street":"","number":"","complement":"","district":"","city":"","state":"","zipCode":"","phone":"","email":""}';
BEGIN
 company=(public.billing_rpc('companies','save',details||'{"legalName":"ATR reference test","isPrimary":true}')->'company'->>'id')::uuid;
 other_company=(public.billing_rpc('companies','save',details||'{"legalName":"Other company","isPrimary":false}')->'company'->>'id')::uuid;
 client=(public.billing_rpc('clients','save',details||'{"legalName":"ATR partner","cnpj":"11222333000181"}')->'client'->>'id')::uuid;
 PERFORM public.billing_rpc('contract-types','save','{"name":"ATR reference","stages":[]}');
 kind=(public.billing_rpc('contract-types','list')->'types'->0->>'id')::uuid;
 farm=(public.billing_rpc('farms','save','{"name":"ATR farm","areaHa":"10","city":"Cidade","state":"SP"}')->'farm'->>'id')::uuid;
 plot=(public.billing_rpc('plots','save',jsonb_build_object('farmId',farm,'name','ATR plot','areaHa','10'))->'data'->'plots'->0->>'id')::uuid;

 -- Deliberately different adjacent months distinguish prior/current/latest quotes.
 FOR quotation IN SELECT * FROM (VALUES
  (2026,8,'1.5','1.4','1.3','1.2'),(2026,9,'9','8','7','6'),
  (2026,12,'2.5','2.4','2.3','2.2'),(2027,1,'5.5','5.4','5.3','5.2'),
  (2028,2,'3.5','3.4','3.3','3.2'),(2028,3,'7.5','7.4','7.3','7.2')
 ) q(year,month,mg,mn,ag,an) LOOP
  r=public.billing_rpc('atr','save',jsonb_build_object('year',quotation.year,'month',quotation.month,
   'monthlyGrossValue',quotation.mg,'monthlyNetValue',quotation.mn,
   'accumulatedGrossValue',quotation.ag,'accumulatedNetValue',quotation.an));
  IF quotation.year=2026 AND quotation.month=8 THEN august_quote=(r->'record'->>'id')::uuid;END IF;
  IF quotation.year=2026 AND quotation.month=9 THEN current_quote=(r->'record'->>'id')::uuid;END IF;
 END LOOP;

 FOR criterion IN SELECT * FROM (VALUES
  ('gross','monthly','1.5','1200','9','900','2.5','500','3.5','700','3300'),
  ('net','monthly','1.4','1120','8','800','2.4','480','3.4','680','3080'),
  ('gross','accumulated','1.3','1040','7','700','2.3','460','3.3','660','2860'),
  ('net','accumulated','1.2','960','6','600','2.2','440','3.2','640','2640')
 ) c(price,period,sep_quote,sep_amount,oct_quote,oct_amount,jan_quote,jan_amount,mar_quote,mar_amount,total) LOOP
  input=jsonb_build_object('companyId',company,'clientId',client,'typeId',kind,'title','ATR '||criterion.price||' '||criterion.period,
   'status','Ativo','startDate','2026-01-01','endDate','','contractedVolume','1000',
   'atrPriceType',criterion.price,'atrPeriodType',criterion.period,'value','','notes','');
  contract=(public.billing_rpc('contracts','save',input)->'contract'->>'id')::uuid;
  scope=jsonb_build_object('companyId',company,'contractId',contract);
  load_input=scope||jsonb_build_object('farmId',farm,'plotId',plot,'volume','1','atr','100','document','','notes','');
  PERFORM public.billing_rpc('contracts','save-load',load_input||'{"loadedAt":"2026-09-01","volume":"2"}');
  load_id=(public.billing_rpc('contracts','save-load',load_input||'{"loadedAt":"2026-09-30","volume":"3","atr":"200"}')->'load'->>'id')::uuid;
  FOREACH loaded_date IN ARRAY ARRAY['2026-10-01','2027-01-01','2027-01-31','2028-03-01','2028-03-31'] LOOP
   PERFORM public.billing_rpc('contracts','save-load',load_input||jsonb_build_object('loadedAt',loaded_date));
  END LOOP;
  s=public.billing_rpc('contracts','get',jsonb_build_object('companyId',company,'id',contract))->'contract';
  IF s->>'atrPriceType' IS DISTINCT FROM criterion.price OR s->>'atrPeriodType' IS DISTINCT FROM criterion.period
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(s->'loads') l WHERE (l->>'atr')::numeric NOT IN (100,200)) THEN
   RAISE EXCEPTION 'Load ATR or contract quotation criterion was replaced';
  END IF;
  IF s->>'billingAmount' IS DISTINCT FROM criterion.total OR s->>'billingPending' IS DISTINCT FROM 'false'
   OR s->'monthlySummary'->'totals'->>'billingAmount' IS DISTINCT FROM criterion.total
   OR s->'financialSummary'->'totals'->>'grossAmount' IS DISTINCT FROM criterion.total
   OR s->'financialSummary'->'totals'->>'pendingAmount' IS DISTINCT FROM criterion.total THEN
   RAISE EXCEPTION 'Prior-month totals disagree for %/%: %',criterion.price,criterion.period,s;
  END IF;
  FOR row IN SELECT value FROM jsonb_array_elements(s->'monthlySummary'->'months') LOOP
   CASE row->>'month'
    WHEN '2026-09' THEN
     IF row->>'atrQuote' IS DISTINCT FROM criterion.sep_quote OR row->>'billingAmount' IS DISTINCT FROM criterion.sep_amount
      OR row->>'loadedVolume'<>'5' OR row->>'averageLoadAtr'<>'160' THEN RAISE EXCEPTION 'September must use August for the entire month: %',row;END IF;
    WHEN '2026-10' THEN
     IF row->>'atrQuote' IS DISTINCT FROM criterion.oct_quote OR row->>'billingAmount' IS DISTINCT FROM criterion.oct_amount THEN RAISE EXCEPTION 'October must use September: %',row;END IF;
    WHEN '2027-01' THEN
     IF row->>'atrQuote' IS DISTINCT FROM criterion.jan_quote OR row->>'billingAmount' IS DISTINCT FROM criterion.jan_amount THEN RAISE EXCEPTION 'January must use December of the prior year: %',row;END IF;
    WHEN '2028-03' THEN
     IF row->>'atrQuote' IS DISTINCT FROM criterion.mar_quote OR row->>'billingAmount' IS DISTINCT FROM criterion.mar_amount THEN RAISE EXCEPTION 'March boundaries must use February in a leap year: %',row;END IF;
    ELSE RAISE EXCEPTION 'Grouping shifted out of the delivery month: %',row;
   END CASE;
  END LOOP;
  listed=public.billing_rpc('contracts','list',jsonb_build_object('companyId',company,'bucket','open'));
  SELECT value INTO r FROM jsonb_array_elements(listed->'contracts') WHERE value->>'id'=contract::text;
  IF r->>'billingAmount' IS DISTINCT FROM criterion.total THEN RAISE EXCEPTION 'Contract list uses a different reference';END IF;

  -- December's quote exists, but November is missing for a December delivery.
  missing_id=(public.billing_rpc('contracts','save-load',load_input||'{"loadedAt":"2026-12-15"}')->'load'->>'id')::uuid;
  s=public.billing_rpc('contracts','get',jsonb_build_object('companyId',company,'id',contract))->'contract';
  SELECT value INTO r FROM jsonb_array_elements(s->'monthlySummary'->'months') WHERE value->>'month'='2026-12';
  IF r->>'atrQuote' IS DISTINCT FROM '' OR r->>'billingPending' IS DISTINCT FROM 'true'
   OR s->>'billingAmount' IS DISTINCT FROM '' OR s->'monthlySummary'->'totals'->>'pendingQuoteMonths' IS DISTINCT FROM '1'
   OR s->'financialSummary'->'totals'->>'pendingAmount' IS DISTINCT FROM '' THEN RAISE EXCEPTION 'Missing previous quote must stay pending, without fallback';END IF;
  PERFORM public.billing_rpc('contracts','delete-load',scope||jsonb_build_object('id',missing_id));
 END LOOP;

 -- Changing only the current month affects October, while September keeps August.
 quote_input=jsonb_build_object('id',current_quote,'year',2026,'month',9,'monthlyGrossValue','90','monthlyNetValue','80','accumulatedGrossValue','70','accumulatedNetValue','60');
 PERFORM public.billing_rpc('atr','save',quote_input);
 s=public.billing_rpc('contracts','get',jsonb_build_object('companyId',company,'id',contract))->'contract';
 SELECT value INTO r FROM jsonb_array_elements(s->'monthlySummary'->'months') WHERE value->>'month'='2026-09';
 IF r->>'atrQuote' IS DISTINCT FROM '1.2' OR r->>'billingAmount' IS DISTINCT FROM '960' THEN RAISE EXCEPTION 'Current quotation replaced prior-month reference';END IF;

 -- Moving a delivery date across a month boundary changes its reference as well.
 PERFORM public.billing_rpc('contracts','save-load',load_input||jsonb_build_object('id',load_id,'loadedAt','2026-10-01','volume','3','atr','200'));
 s=public.billing_rpc('contracts','get',jsonb_build_object('companyId',company,'id',contract))->'contract';
 SELECT value INTO r FROM jsonb_array_elements(s->'monthlySummary'->'months') WHERE value->>'month'='2026-09';
 IF r->>'billingAmount' IS DISTINCT FROM '240' THEN RAISE EXCEPTION 'Edited delivery remained in old month';END IF;
 SELECT value INTO r FROM jsonb_array_elements(s->'monthlySummary'->'months') WHERE value->>'month'='2026-10';
 IF r->>'billingAmount' IS DISTINCT FROM '42000' THEN RAISE EXCEPTION 'Edited delivery did not use new prior-month quote';END IF;

 -- Another account's quotation must never fill a missing quotation for this one.
 PERFORM public.billing_rpc('atr','delete',jsonb_build_object('id',august_quote));
 PERFORM set_config('request.jwt.claim.sub',current_setting('atr_test.owner_b'),true);
 PERFORM public.billing_rpc('atr','save',(quote_input-'id')||jsonb_build_object('month',8));
 IF EXISTS(SELECT 1 FROM public.billing_contracts) OR EXISTS(SELECT 1 FROM public.billing_contract_loads) THEN RAISE EXCEPTION 'RLS exposed another account';END IF;
 BEGIN PERFORM public.billing_rpc('contracts','get',jsonb_build_object('companyId',company,'id',contract));RAISE EXCEPTION 'Cross-account detail allowed';EXCEPTION WHEN no_data_found OR invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('contracts','save',input);RAISE EXCEPTION 'Cross-account links allowed';EXCEPTION WHEN no_data_found OR invalid_parameter_value THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub',current_setting('atr_test.owner_a'),true);
 s=public.billing_rpc('contracts','get',jsonb_build_object('companyId',company,'id',contract))->'contract';
 IF s->>'billingPending' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Foreign quotation filled missing August';END IF;
 BEGIN PERFORM public.billing_rpc('contracts','get',jsonb_build_object('companyId',other_company,'id',contract));RAISE EXCEPTION 'Cross-company detail allowed';EXCEPTION WHEN no_data_found THEN NULL;END;
 BEGIN UPDATE public.billing_atr_records SET monthly_gross_value=100 WHERE id=current_quote;RAISE EXCEPTION 'Direct ATR update allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN UPDATE public.billing_contract_loads SET loaded_at='2026-09-01' WHERE id=load_id;RAISE EXCEPTION 'Direct load update allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;

 -- A valid zero quotation is known and must not be treated as missing.
 PERFORM public.billing_rpc('atr','save',jsonb_build_object('year',2026,'month',8,'monthlyGrossValue','0','monthlyNetValue','0','accumulatedGrossValue','0','accumulatedNetValue','0'));
 s=public.billing_rpc('contracts','get',jsonb_build_object('companyId',company,'id',contract))->'contract';
 SELECT value INTO r FROM jsonb_array_elements(s->'monthlySummary'->'months') WHERE value->>'month'='2026-09';
 IF r->>'atrQuote' IS DISTINCT FROM '0' OR r->>'billingAmount' IS DISTINCT FROM '0' OR s->>'billingPending' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Zero prior-month quotation treated as missing';END IF;
 PERFORM set_config('request.jwt.claim.sub','',true);
 BEGIN PERFORM public.billing_rpc('contracts','get',jsonb_build_object('companyId',company,'id',contract));RAISE EXCEPTION 'Missing session accepted';EXCEPTION WHEN invalid_authorization_specification THEN NULL;END;
END $$;
RESET ROLE;
ROLLBACK;
