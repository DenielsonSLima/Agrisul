BEGIN;

INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)
VALUES('61000000-0000-4000-8000-000000000001','owner-lifecycle@example.invalid',now(),'{}');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',false);
SELECT public.billing_rpc('settings','get','{}');

DO $$
DECLARE v_result jsonb;
BEGIN
 v_result=public.billing_rpc('onboarding','inspect','{}');
 IF v_result->>'status'<>'ready' THEN RAISE EXCEPTION 'Owner should be ready: %',v_result; END IF;
 v_result=public.billing_rpc('users','prepare-invite',jsonb_build_object(
  'email','invited-lifecycle@example.invalid',
  'accessProfileId',(SELECT id FROM public.billing_access_profiles WHERE name='Somente leitura' LIMIT 1),
  'requestId','61000000-0000-4000-8000-000000000010'));
 IF v_result->'user'->>'status'<>'pending' OR v_result->'user'->>'deliveryStatus'<>'queued' THEN
  RAISE EXCEPTION 'Invitation should be queued: %',v_result;
 END IF;
END $$;

RESET ROLE;
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)
VALUES('61000000-0000-4000-8000-000000000002','invited-lifecycle@example.invalid',now(),'{}');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',false);
DO $$
DECLARE v_result jsonb;
BEGIN
 v_result=public.billing_rpc('users','finalize-invite',jsonb_build_object(
  'invitationId',(SELECT id FROM public.billing_invitations WHERE email='invited-lifecycle@example.invalid'),
  'attemptId','61000000-0000-4000-8000-000000000011',
  'outcome','sent','authUserId','61000000-0000-4000-8000-000000000002'));
 IF v_result->'user'->>'deliveryStatus'<>'sent' THEN RAISE EXCEPTION 'Invitation should be sent: %',v_result; END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',false);
DO $$
DECLARE v_result jsonb;
BEGIN
 v_result=public.billing_rpc('onboarding','inspect','{}');
 IF v_result->>'status'<>'invite' THEN RAISE EXCEPTION 'Invite must require onboarding: %',v_result; END IF;
 v_result=public.billing_rpc('onboarding','complete','{"name":"Pessoa Convidada"}');
 IF v_result->>'status'<>'ready' OR v_result->>'name'<>'Pessoa Convidada' THEN RAISE EXCEPTION 'Onboarding failed: %',v_result; END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',false);
SELECT public.billing_rpc('users','disable',jsonb_build_object('id',(
 SELECT id FROM public.billing_memberships WHERE user_id='61000000-0000-4000-8000-000000000002')));
SELECT set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',false);
DO $$
DECLARE v_result jsonb;
BEGIN
 v_result=public.billing_rpc('onboarding','inspect','{}');
 IF v_result->>'status'<>'disabled' THEN RAISE EXCEPTION 'Disabled access not reported: %',v_result; END IF;
 BEGIN
  PERFORM public.billing_rpc('settings','get','{}');
  RAISE EXCEPTION 'Disabled user reached workspace RPC';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END $$;

SELECT set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',false);
SELECT public.billing_rpc('users','enable',jsonb_build_object('id',(
 SELECT id FROM public.billing_memberships WHERE user_id='61000000-0000-4000-8000-000000000002')));
SELECT public.billing_rpc('users','remove',jsonb_build_object('id',(
 SELECT id FROM public.billing_memberships WHERE user_id='61000000-0000-4000-8000-000000000002')));

SELECT set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',false);
DO $$
DECLARE v_result jsonb;
BEGIN
 v_result=public.billing_rpc('onboarding','inspect','{}');
 IF v_result->>'status'<>'removed' THEN RAISE EXCEPTION 'Removed access not reported: %',v_result; END IF;
 BEGIN
  PERFORM public.billing_rpc('settings','get','{}');
  RAISE EXCEPTION 'Removed user reached workspace RPC';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END $$;

RESET ROLE;
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES
 ('61000000-0000-4000-8000-000000000003','manager-lifecycle@example.invalid',now(),'{}'),
 ('61000000-0000-4000-8000-000000000004','superior-lifecycle@example.invalid',now(),'{}');
INSERT INTO public.billing_access_profiles(id,owner_id,name,description,permissions,is_system) VALUES
 ('61000000-0000-4000-8000-000000000020','61000000-0000-4000-8000-000000000001','Gestor restrito','Teste de hierarquia',ARRAY['users.manage'],false),
 ('61000000-0000-4000-8000-000000000021','61000000-0000-4000-8000-000000000001','Gestor superior','Teste de hierarquia',ARRAY['users.manage','access-profiles.manage'],false);
INSERT INTO public.billing_memberships(id,owner_id,user_id,access_profile_id,is_owner,status) VALUES
 ('61000000-0000-4000-8000-000000000030','61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000003','61000000-0000-4000-8000-000000000020',false,'active'),
 ('61000000-0000-4000-8000-000000000031','61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000004','61000000-0000-4000-8000-000000000021',false,'active');
INSERT INTO public.billing_user_settings(user_id,owner_id,name,compact,onboarding_completed_at) VALUES
 ('61000000-0000-4000-8000-000000000003','61000000-0000-4000-8000-000000000001','Gestor restrito',false,now()),
 ('61000000-0000-4000-8000-000000000004','61000000-0000-4000-8000-000000000001','Gestor superior',false,now());

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000003',false);
DO $$
BEGIN
 BEGIN
  PERFORM public.billing_rpc('users','disable','{"id":"61000000-0000-4000-8000-000000000031"}');
  RAISE EXCEPTION 'Restricted manager changed a superior profile';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END $$;

RESET ROLE;
ROLLBACK;
