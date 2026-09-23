BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('98000000-0000-4000-8000-000000000001','excess-load-a@example.invalid',now()),
 ('98000000-0000-4000-8000-000000000002','excess-load-b@example.invalid',now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
DO $$
DECLARE
 company uuid; client uuid; kind uuid; farm uuid; plot uuid; contract uuid;
 contract_input jsonb; scope jsonb; result jsonb;
 details jsonb:='{"tradeName":"","cnpj":"","street":"","number":"","complement":"","district":"","city":"","state":"","zipCode":"","phone":"","email":""}';
BEGIN
 company=(public.billing_rpc('companies','save',details||'{"legalName":"Empresa carga excedente","isPrimary":true}')->>'id')::uuid;
 client=(public.billing_rpc('clients','save',details||'{"legalName":"Usina carga excedente","cnpj":"11222333000181"}')->'client'->>'id')::uuid;
 PERFORM public.billing_rpc('contract-types','save','{"name":"Contrato com excedente","stages":[]}');
 kind=(public.billing_rpc('contract-types','list')->'types'->0->>'id')::uuid;
 farm=(public.billing_rpc('farms','save','{"name":"Origem excedente","areaHa":"10","city":"Cidade","state":"SE"}')->'farm'->>'id')::uuid;
 plot=(public.billing_rpc('plots','save',jsonb_build_object('farmId',farm,'name','Talhão excedente','areaHa','10'))->'data'->'plots'->0->>'id')::uuid;
 PERFORM public.billing_rpc('atr','save','{"year":2026,"month":1,"monthlyGrossValue":"2","monthlyNetValue":"2","accumulatedGrossValue":"2","accumulatedNetValue":"2"}');
 contract_input=jsonb_build_object(
  'title','Contrato de 100 toneladas','contractNumber','EXCESS-1','companyId',company,
  'clientId',client,'typeId',kind,'status','Ativo','startDate','2026-01-01','endDate','',
  'contractedVolume','100','atrPriceType','gross','atrPeriodType','monthly','value','','notes','');
 contract=(public.billing_rpc('contracts','save',contract_input)->'contract'->>'id')::uuid;
 scope=jsonb_build_object('companyId',company,'contractId',contract);
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object(
  'farmId',farm,'plotId',plot,'loadedAt','2026-02-01','volume','110','atr','100',
  'document','EXCEDENTE-10','notes','Usina aceitou o caminhão adicional'));

 result=public.billing_rpc('contracts','get',jsonb_build_object('companyId',company,'id',contract));
 IF result->'contract'->>'contractedVolume'<>'100'
  OR result->'contract'->>'loadedVolume'<>'110'
  OR result->'contract'->>'remainingVolume'<>'0'
  OR result->'contract'->'financialSummary'->'totals'->>'loadedVolume'<>'110'
  OR result->'contract'->'financialSummary'->'totals'->>'grossAmount'<>'22000'
  OR result->'contract'->'financialSummary'->'totals'->>'netAmount'<>'22000' THEN
  RAISE EXCEPTION 'Excess load was not fully calculated: %',result;
 END IF;

 result=public.billing_rpc('contracts','list',scope||'{"view":"loads","groupBy":"none","search":"EXCEDENTE-10"}');
 IF result->'summary'->>'volume'<>'110'
  OR result->'summary'->>'grossAmount'<>'22000'
  OR result->'summary'->>'netAmount'<>'22000'
  OR result->'summary'->>'billingPending'<>'false' THEN
  RAISE EXCEPTION 'Excess load list omitted billing: %',result;
 END IF;

 result=public.billing_rpc('contracts','save',contract_input||jsonb_build_object('id',contract));
 IF result->'contract'->>'contractedVolume'<>'100' OR result->'contract'->>'loadedVolume'<>'110' THEN
  RAISE EXCEPTION 'Contract could not be edited after an accepted excess load: %',result;
 END IF;

 PERFORM set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000002',true);
 BEGIN
  PERFORM public.billing_rpc('contracts','get',jsonb_build_object('companyId',company,'id',contract));
  RAISE EXCEPTION 'Another owner read the excess contract';
 EXCEPTION WHEN no_data_found OR invalid_parameter_value THEN NULL;
 END;
 PERFORM set_config('request.jwt.claim.sub','',true);
 BEGIN
  PERFORM public.billing_rpc('contracts','get',jsonb_build_object('companyId',company,'id',contract));
  RAISE EXCEPTION 'Missing session read the excess contract';
 EXCEPTION WHEN invalid_authorization_specification THEN NULL;
 END;
END $$;
ROLLBACK;
