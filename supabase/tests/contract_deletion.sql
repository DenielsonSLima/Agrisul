BEGIN;

INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('8d000000-0000-4000-8000-000000000001','contract-delete-owner@example.invalid',now()),
 ('8d000000-0000-4000-8000-000000000002','contract-delete-other@example.invalid',now()),
 ('8d000000-0000-4000-8000-000000000003','contract-delete-reader@example.invalid',now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','8d000000-0000-4000-8000-000000000001',true);
SELECT public.billing_rpc('settings','get','{}');

DO $$
DECLARE
 company uuid;other_company uuid;client uuid;kind uuid;contract uuid;sibling uuid;farm uuid;plot uuid;
 input jsonb;scope jsonb;profile uuid;
 details jsonb:='{"tradeName":"","cnpj":"","street":"","number":"","complement":"","district":"","city":"","state":"","zipCode":"","phone":"","email":""}';
BEGIN
 company=(public.billing_rpc('companies','save',details||'{"legalName":"Empresa para excluir contrato","isPrimary":true}')->'company'->>'id')::uuid;
 other_company=(public.billing_rpc('companies','save',details||'{"legalName":"Outra empresa para excluir","isPrimary":false}')->'company'->>'id')::uuid;
 client=(public.billing_rpc('clients','save',details||'{"legalName":"Cliente para excluir contrato","cnpj":"11222333000181"}')->'client'->>'id')::uuid;
 kind=(public.billing_rpc('contract-types','save','{"name":"Tipo para exclusão","stages":[]}')->'type'->>'id')::uuid;
 IF kind IS NULL THEN SELECT id INTO kind FROM public.billing_contract_types WHERE owner_id=auth.uid() AND name='Tipo para exclusão'; END IF;
 input=jsonb_build_object('companyId',company,'clientId',client,'typeId',kind,'title','Contrato que será excluído',
  'contractNumber','DEL-1','status','Ativo','startDate','2026-09-01','contractedVolume','1000',
  'atrPriceType','gross','atrPeriodType','monthly','value','','notes','');
 contract=(public.billing_rpc('contracts','save',input)->'contract'->>'id')::uuid;
 sibling=(public.billing_rpc('contracts','save',input||'{"title":"Contrato preservado","contractNumber":"DEL-2"}')->'contract'->>'id')::uuid;
 farm=(public.billing_rpc('farms','save','{"name":"Fazenda para exclusão","areaHa":"10","city":"Cidade","state":"SE"}')->'farm'->>'id')::uuid;
 plot=(public.billing_rpc('plots','save',jsonb_build_object('farmId',farm,'name','Talhão para exclusão','areaHa','10'))->'data'->'plots'->0->>'id')::uuid;
 scope=jsonb_build_object('companyId',company,'contractId',contract);
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('farmId',farm,'plotId',plot,'loadedAt','2026-09-10','volume','10','atr','100','document','','notes',''));
 PERFORM public.billing_rpc('contracts','save-payment',scope||jsonb_build_object('requestId',gen_random_uuid(),'kind','advance','receivedAt','2026-09-10','referenceMonth','2026-09','amount','100','document','','notes',''));
 PERFORM public.billing_rpc('contracts','save-discount',scope||jsonb_build_object('requestId',gen_random_uuid(),'title','Desconto removido','ratePerTon','2','months',jsonb_build_array('2026-09'),'notes',''));

 PERFORM set_config('contract_delete.company',company::text,true);
 PERFORM set_config('contract_delete.other_company',other_company::text,true);
 PERFORM set_config('contract_delete.contract',contract::text,true);
 PERFORM set_config('contract_delete.sibling',sibling::text,true);

 BEGIN
  PERFORM public.billing_rpc('contracts','delete',jsonb_build_object('companyId',other_company,'contractId',contract));
  RAISE EXCEPTION 'Cross-company contract deletion was accepted';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('contracts','delete',scope||'{"ownerId":"8d000000-0000-4000-8000-000000000002"}');
  RAISE EXCEPTION 'Unexpected contract deletion field was accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.billing_rpc('contracts','delete',jsonb_build_object('companyId',company));
  RAISE EXCEPTION 'Incomplete contract deletion payload was accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  DELETE FROM public.billing_contracts WHERE id=contract;
  RAISE EXCEPTION 'Direct contract deletion was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;

 RESET ROLE;
 SELECT id INTO profile FROM public.billing_access_profiles
 WHERE owner_id='8d000000-0000-4000-8000-000000000001' AND name='Somente leitura';
 INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,is_owner,status)
 VALUES('8d000000-0000-4000-8000-000000000001','8d000000-0000-4000-8000-000000000003',profile,false,'active');
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','8d000000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.billing_rpc('contracts','delete',jsonb_build_object(
   'companyId',current_setting('contract_delete.company'),'contractId',current_setting('contract_delete.contract')));
  RAISE EXCEPTION 'Read-only member deleted a contract';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claim.sub','8d000000-0000-4000-8000-000000000002',true);
SELECT public.billing_rpc('settings','get','{}');
DO $$ BEGIN
 BEGIN
  PERFORM public.billing_rpc('contracts','delete',jsonb_build_object(
   'companyId',current_setting('contract_delete.company'),'contractId',current_setting('contract_delete.contract')));
  RAISE EXCEPTION 'Cross-owner contract deletion was accepted';
 EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claim.sub','8d000000-0000-4000-8000-000000000001',true);
DO $$
DECLARE result jsonb;contract uuid:=current_setting('contract_delete.contract')::uuid;
BEGIN
 result=public.billing_rpc('contracts','delete',jsonb_build_object(
  'companyId',current_setting('contract_delete.company'),'contractId',contract));
 IF result<>jsonb_build_object('id',contract,'deleted',true) THEN
  RAISE EXCEPTION 'Unexpected contract deletion response: %',result;
 END IF;
 IF EXISTS(SELECT 1 FROM public.billing_contracts WHERE id=contract)
  OR EXISTS(SELECT 1 FROM public.billing_contract_loads WHERE contract_id=contract)
  OR EXISTS(SELECT 1 FROM public.billing_contract_payments WHERE contract_id=contract)
  OR EXISTS(SELECT 1 FROM public.billing_contract_discounts WHERE contract_id=contract) THEN
  RAISE EXCEPTION 'Contract deletion did not cascade through all dependent records';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.billing_contracts WHERE id=current_setting('contract_delete.sibling')::uuid) THEN
  RAISE EXCEPTION 'Contract deletion removed an unrelated contract';
 END IF;
 BEGIN
  PERFORM public.billing_rpc('contracts','delete',jsonb_build_object(
   'companyId',current_setting('contract_delete.company'),'contractId',contract));
  RAISE EXCEPTION 'Deleting an absent contract succeeded';
 EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claim.sub','',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.billing_rpc('contracts','delete',jsonb_build_object(
   'companyId',current_setting('contract_delete.company'),'contractId',current_setting('contract_delete.contract')));
  RAISE EXCEPTION 'Anonymous contract deletion was accepted';
 EXCEPTION WHEN invalid_authorization_specification THEN NULL; END;
END $$;

RESET ROLE;
DO $$
DECLARE is_definer boolean;config text[];
BEGIN
 SELECT p.prosecdef,p.proconfig INTO is_definer,config
 FROM pg_proc p WHERE p.oid='billing_private.contracts_company_dispatch(text,jsonb)'::regprocedure;
 IF NOT is_definer OR NOT EXISTS(SELECT 1 FROM unnest(config) setting WHERE setting LIKE 'search_path=%')
  OR has_function_privilege('authenticated','billing_private.contracts_before_contract_deletion_dispatch(text,jsonb)','EXECUTE')
  OR has_table_privilege('authenticated','public.billing_contracts','DELETE') THEN
  RAISE EXCEPTION 'Contract deletion privileges are unsafe';
 END IF;
END $$;

ROLLBACK;
