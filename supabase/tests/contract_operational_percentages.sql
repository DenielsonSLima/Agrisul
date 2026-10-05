BEGIN;
DO $$ DECLARE a uuid:=gen_random_uuid();b uuid:=gen_random_uuid(); BEGIN
 INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
  (a,'contract-percent-a-'||a||'@example.invalid',now()),
  (b,'contract-percent-b-'||b||'@example.invalid',now());
 PERFORM set_config('percent.owner',a::text,true);
 PERFORM set_config('percent.other',b::text,true);
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('percent.owner'),true);
DO $$
DECLARE company uuid;client uuid;kind uuid;farm uuid;contract uuid;load uuid;manual uuid;
 input jsonb;scope jsonb;r jsonb;item jsonb;key text;
 details jsonb:='{"tradeName":"","cnpj":"","street":"","number":"","complement":"","district":"","city":"","state":"","zipCode":"","phone":"","email":""}';
BEGIN
 company=(public.billing_rpc('companies','save',details||'{"legalName":"Empresa percentuais","isPrimary":true}')->'company'->>'id')::uuid;
 client=(public.billing_rpc('clients','save',details||'{"legalName":"Cliente percentuais","cnpj":"11222333000181","status":"Ativo"}')->'client'->>'id')::uuid;
 PERFORM public.billing_rpc('contract-types','save','{"name":"Tipo percentuais","stages":[]}');
 kind=(public.billing_rpc('contract-types','list')->'types'->0->>'id')::uuid;
 farm=(public.billing_rpc('farms','save','{"name":"Fazenda percentuais","areaHa":"10","city":"Cidade","state":"SP"}')->'farm'->>'id')::uuid;
 input=jsonb_build_object('title','Contrato percentuais','contractNumber','PERCENT','companyId',company,'clientId',client,'typeId',kind,'startDate','2026-09-01','endDate','','contractedVolume','40000','value','','notes','','atrPriceType','gross','atrPeriodType','monthly');
 scope=jsonb_build_object('companyId',company);
 r=public.billing_rpc('contracts','save',input)->'contract';contract=(r->>'id')::uuid;
 IF r->'operationalPercentages' IS DISTINCT FROM '{"contracted":"100","loaded":"0","remaining":"100"}'::jsonb THEN
  RAISE EXCEPTION 'Empty contract percentages: %',r;
 END IF;
 manual=(public.billing_rpc('contracts','save',input||'{"contractNumber":"MANUAL","contractedVolume":"20000","startDate":"2026-09-15"}')->'contract'->>'id')::uuid;
 load=(public.billing_rpc('contracts','save-load',scope||jsonb_build_object('contractId',contract,'farmId',farm,'plotId','','loadedAt','2026-09-10','volume','3313.43','atr','122.5677','document','','notes',''))->'load'->>'id')::uuid;
 r=public.billing_rpc('contracts','get',scope||jsonb_build_object('id',contract))->'contract';
 IF r->'operationalPercentages' IS DISTINCT FROM '{"contracted":"100","loaded":"8.28","remaining":"91.72"}'::jsonb THEN
  RAISE EXCEPTION 'Percentages must use the individual contract, not the list scale: %',r;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(public.billing_rpc('contracts','list',scope)->'contracts') LOOP
  IF item->'operationalPercentages' IS DISTINCT FROM public.billing_rpc('contracts','get',scope||jsonb_build_object('id',item->>'id'))->'contract'->'operationalPercentages' THEN
   RAISE EXCEPTION 'List/detail percentages differ';
  END IF;
  FOREACH key IN ARRAY ARRAY['contracted','loaded','remaining'] LOOP
   IF jsonb_typeof(item->'operationalPercentages'->key)<>'string' THEN RAISE EXCEPTION 'Percentages must travel as decimal text';END IF;
  END LOOP;
 END LOOP;
 -- Editing a load and accepting excess must not cap the reported percentage.
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('id',load,'contractId',contract,'farmId',farm,'plotId','','loadedAt','2026-09-10','volume','40000','atr','122.5677','document','','notes',''));
 r=public.billing_rpc('contracts','get',scope||jsonb_build_object('id',contract))->'contract';
 IF r->'operationalPercentages' IS DISTINCT FROM '{"contracted":"100","loaded":"100","remaining":"0"}'::jsonb THEN RAISE EXCEPTION 'Completed percentages: %',r;END IF;
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('id',load,'contractId',contract,'farmId',farm,'plotId','','loadedAt','2026-09-10','volume','41000','atr','122.5677','document','','notes',''));
 r=public.billing_rpc('contracts','get',scope||jsonb_build_object('id',contract))->'contract';
 IF r->'operationalPercentages' IS DISTINCT FROM '{"contracted":"100","loaded":"102.5","remaining":"0"}'::jsonb THEN RAISE EXCEPTION 'Excess percentages: %',r;END IF;
 PERFORM public.billing_rpc('contracts','save',input||jsonb_build_object('id',contract,'status','Ativo','contractedVolume','20000'));
 r=public.billing_rpc('contracts','get',scope||jsonb_build_object('id',contract))->'contract';
 IF r->'operationalPercentages'->>'loaded'<>'205' THEN RAISE EXCEPTION 'Contract edits must recalculate percentages: %',r;END IF;
 PERFORM public.billing_rpc('contracts','delete-load',scope||jsonb_build_object('id',load,'contractId',contract));
 r=public.billing_rpc('contracts','get',scope||jsonb_build_object('id',contract))->'contract';
 IF r->'operationalPercentages'->>'loaded'<>'0' OR r->'operationalPercentages'->>'remaining'<>'100' THEN RAISE EXCEPTION 'Load removal must recalculate percentages';END IF;
 PERFORM set_config('percent.company',company::text,true);
 PERFORM set_config('percent.contract',contract::text,true);
 BEGIN DELETE FROM public.billing_contracts WHERE id=contract;RAISE EXCEPTION 'Direct DML allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claim.sub',current_setting('percent.other'),true);
DO $$ BEGIN
 BEGIN PERFORM public.billing_rpc('contracts','list',jsonb_build_object('companyId',current_setting('percent.company')));RAISE EXCEPTION 'Cross owner list exposed';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('contracts','get',jsonb_build_object('companyId',current_setting('percent.company'),'id',current_setting('percent.contract')));RAISE EXCEPTION 'Cross owner contract exposed';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 IF EXISTS(SELECT 1 FROM public.billing_contracts) THEN RAISE EXCEPTION 'RLS exposed contracts';END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ BEGIN
 BEGIN PERFORM public.billing_rpc('contracts','list',jsonb_build_object('companyId',current_setting('percent.company')));RAISE EXCEPTION 'Anonymous percentages exposed';EXCEPTION WHEN invalid_authorization_specification THEN NULL;END;
END $$;
ROLLBACK;
