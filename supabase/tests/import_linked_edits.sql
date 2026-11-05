-- Ephemeral identities and all test records are rolled back, including on failure.
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('e734a500-19f7-4da4-9cb2-661b0a63a901','linked-edits@example.invalid',now()),
 ('e734a500-19f7-4da4-9cb2-661b0a63a902','linked-edits-other@example.invalid',now());
SELECT billing_private.create_workspace_defaults('e734a500-19f7-4da4-9cb2-661b0a63a901');
INSERT INTO public.billing_memberships(owner_id,user_id,is_owner,status) VALUES
 ('e734a500-19f7-4da4-9cb2-661b0a63a901','e734a500-19f7-4da4-9cb2-661b0a63a901',true,'active') ON CONFLICT DO NOTHING;
INSERT INTO public.billing_user_settings(user_id,owner_id,name,onboarding_completed_at) VALUES
 ('e734a500-19f7-4da4-9cb2-661b0a63a901','e734a500-19f7-4da4-9cb2-661b0a63a901','Linked edits test',now()) ON CONFLICT DO NOTHING;
INSERT INTO public.billing_companies(id,owner_id,legal_name,name) VALUES
 ('e734a500-19f7-4da4-9cb2-661b0a63a911','e734a500-19f7-4da4-9cb2-661b0a63a901','Linked edits company','Linked edits company');
INSERT INTO public.billing_clients(id,owner_id,legal_name,cnpj) VALUES
 ('e734a500-19f7-4da4-9cb2-661b0a63a921','e734a500-19f7-4da4-9cb2-661b0a63a901','Linked edits client','00000000000000');
INSERT INTO public.billing_farms(id,owner_id,code,name,area_ha,city,state) VALUES
 ('e734a500-19f7-4da4-9cb2-661b0a63a931','e734a500-19f7-4da4-9cb2-661b0a63a901','5030','Linked edits farm',100,'Capela','SE');
INSERT INTO public.billing_contract_types(id,owner_id,name,stages) VALUES
 ('e734a500-19f7-4da4-9cb2-661b0a63a941','e734a500-19f7-4da4-9cb2-661b0a63a901','MANUAL','[]');
INSERT INTO public.billing_contracts(id,owner_id,title,company_id,client_id,type_id,type_name,stages,status,start_date,contracted_volume) VALUES
 ('e734a500-19f7-4da4-9cb2-661b0a63a951','e734a500-19f7-4da4-9cb2-661b0a63a901','Linked edits',
 'e734a500-19f7-4da4-9cb2-661b0a63a911','e734a500-19f7-4da4-9cb2-661b0a63a921','e734a500-19f7-4da4-9cb2-661b0a63a941','MANUAL','[]','Ativo','2026-10-01',1000);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e734a500-19f7-4da4-9cb2-661b0a63a901',true);
DO $$
DECLARE p jsonb;d jsonb;row jsonb;fields jsonb;scope jsonb;linked jsonb;entry jsonb;exported jsonb;result jsonb;
BEGIN
 SELECT jsonb_agg(jsonb_build_object('key',key,'column',col,'type',kind,'label',key,'source','manual','required',false,'defaultValue','')) INTO fields
 FROM (VALUES ('COD_ENTRADA','A','text'),('COD_TIPOCOLHEITA','B','text'),('COD_FAZENDA','C','text'),('COD_TALHAO','D','text'),('PESOBRUTO','E','decimal'),('TARA','F','decimal')) f(key,col,kind);
 p=public.billing_rpc('import-profiles','save',jsonb_build_object('name','Linked edits','clientId','e734a500-19f7-4da4-9cb2-661b0a63a921',
  'parser','taquari-equipment-v1','sheetName','Plan1','startRow',2,'fields',fields))->'profile';
 row='{"date":"2026-10-29","source":{"entrada":"101","sequencia":"1","dataMovimento":"2026-10-29"},"values":{"COD_ENTRADA":"101","COD_TIPOCOLHEITA":"1","COD_FAZENDA":"5030","COD_TALHAO":"","PESOBRUTO":"21","TARA":"1"},"sourcePage":1,"sourceLine":"Ephemeral test"}';
 d=public.billing_rpc('import-documents','import',jsonb_build_object('profileId',p->>'id','clientId','e734a500-19f7-4da4-9cb2-661b0a63a921','sourceName','Linked edits.pdf','sourceHash',repeat('a',64),'entries',jsonb_build_array(row)))->'document';
 d=public.billing_rpc('import-documents','finalize',jsonb_build_object('id',d->>'id','expectedUpdatedAt',d->>'updatedAt'))->'document';
 scope='{"companyId":"e734a500-19f7-4da4-9cb2-661b0a63a911","contractId":"e734a500-19f7-4da4-9cb2-661b0a63a951"}';
 entry=public.billing_rpc('import-documents','pending-loads',scope)->'loads'->0;
 linked=public.billing_rpc('import-documents','link-load',scope||jsonb_build_object('id',d->>'id','expectedUpdatedAt',d->>'updatedAt','tripKey',entry->>'tripKey',
  'farmId','e734a500-19f7-4da4-9cb2-661b0a63a931','plotId','','atrMode','general','atr','143.47','atrParts','[]'::jsonb))->'load';
 d=public.billing_rpc('import-documents','reopen',jsonb_build_object('id',d->>'id','expectedUpdatedAt',d->>'updatedAt'))->'document';
 IF d->>'status'<>'open' THEN RAISE EXCEPTION 'Reopening failed';END IF;
 entry=d->'entries'->0;
 d=public.billing_rpc('import-documents','save-entry',jsonb_build_object('id',d->>'id','expectedUpdatedAt',d->>'updatedAt','entryId',entry->>'id','date',entry->>'date',
  'values',(entry->'values')||'{"PESOBRUTO":"31.125","COD_DESTINO":"000042"}'::jsonb,'reviewed',false))->'document';
 result=public.billing_rpc('contracts','get',jsonb_build_object('companyId',scope->>'companyId','id',scope->>'contractId'))->'contract';
 IF result->'loads'->0->>'id'<>linked->>'id' OR result->'loads'->0->>'volume'<>'30.125' OR result->'loads'->0->>'atr'<>'143.47' THEN
  RAISE EXCEPTION 'Linked load correction or manual ATR preservation failed';END IF;
 exported=public.billing_rpc('import-documents','export-filtered',jsonb_build_object('id',d->>'id','expectedUpdatedAt',d->>'updatedAt'));
 IF exported->'rows'->0->'values'->>'G'<>'000042' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(exported->'columns') f WHERE f->>'key'='COD_DESTINO' AND f->>'type'='text') THEN
  RAISE EXCEPTION 'Destination text export failed';END IF;
 BEGIN
  UPDATE public.billing_import_entry_values SET text_value='forged';
  RAISE EXCEPTION 'Direct DML was allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub','e734a500-19f7-4da4-9cb2-661b0a63a902',true);
 BEGIN
  PERFORM public.billing_rpc('import-documents','get',jsonb_build_object('id',d->>'id'));
  RAISE EXCEPTION 'Cross-owner access was allowed';
 EXCEPTION WHEN no_data_found OR insufficient_privilege OR invalid_authorization_specification THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub','',true);
 BEGIN
  PERFORM public.billing_rpc('import-documents','get',jsonb_build_object('id',d->>'id'));
  RAISE EXCEPTION 'Unauthenticated access was allowed';
 EXCEPTION WHEN invalid_authorization_specification THEN NULL;END;
END $$;
ROLLBACK;
