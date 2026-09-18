-- Kept open across the migration to verify preservation of actual legacy rows.
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('72000000-0000-4000-8000-000000000001','people-owner@example.invalid',now()),
 ('72000000-0000-4000-8000-000000000002','people-operator@example.invalid',now()),
 ('72000000-0000-4000-8000-000000000003','people-other@example.invalid',now()),
 ('72000000-0000-4000-8000-000000000004','people-reader@example.invalid',now());
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000001',true);
SELECT public.billing_rpc('settings','get','{}');
SELECT set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000003',true);
SELECT public.billing_rpc('settings','get','{}');
RESET ROLE;
INSERT INTO public.billing_access_profiles(id,owner_id,name,permissions) VALUES
 ('72000000-0000-4000-8000-000000000011','72000000-0000-4000-8000-000000000001','Operador solicitações',ARRAY['requests.read','requests.write','signatures.manage']),
 ('72000000-0000-4000-8000-000000000012','72000000-0000-4000-8000-000000000001','Consulta pessoas',ARRAY['requests.read']);
INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,status) VALUES
 ('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000011','active'),
 ('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000004','72000000-0000-4000-8000-000000000012','active');
INSERT INTO public.billing_user_settings(user_id,owner_id,name) VALUES
 ('72000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','Operador Logado'),
 ('72000000-0000-4000-8000-000000000004','72000000-0000-4000-8000-000000000001','Pessoa Leitora');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000001',true);
DO $$
DECLARE v_file jsonb;v_role text;v_request jsonb;
BEGIN
 FOREACH v_role IN ARRAY ARRAY['requester','manager'] LOOP
  v_file=public.billing_rpc('signatures','prepare-upload','{"fileName":"legado.png","contentType":"image/png","size":120}')->'file';
  INSERT INTO storage.objects(bucket_id,name) VALUES(v_file->>'bucket',v_file->>'path');
  PERFORM public.billing_rpc('signatures','save',jsonb_build_object('name','Assinatura legada '||v_role,'userId','72000000-0000-4000-8000-000000000001','role',v_role,'fileId',v_file->>'id'));
 END LOOP;
 v_file=public.billing_rpc('service-requests','prepare-upload','{"requestId":"72000000-0000-4000-8000-000000000020","fileName":"legado.pdf","contentType":"application/pdf","size":300}')->'file';
 INSERT INTO storage.objects(bucket_id,name) VALUES(v_file->>'bucket',v_file->>'path');
 v_request=public.billing_rpc('service-requests','create',jsonb_build_object('requestId','72000000-0000-4000-8000-000000000020',
  'companyName','Fornecedor legado','companyAddress','Rua original','items',jsonb_build_array(jsonb_build_object('description','Serviço original','application','Equipamento original')),
  'serviceValue','1300','returnDate',null,'notes','Preservar auditoria','attachmentIds',jsonb_build_array(v_file->>'id')))->'request';
 v_request=public.billing_rpc('service-requests','decide',jsonb_build_object('id',v_request->>'id','decision','approved','reason','Decisão histórica'))->'request';
 PERFORM set_config('test.people.legacy',v_request::text,true);
END $$;
RESET ROLE;
