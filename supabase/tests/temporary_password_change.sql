BEGIN;

RESET ROLE;
INSERT INTO auth.users(id,email,email_confirmed_at,encrypted_password,raw_user_meta_data)
VALUES(
 '6f000000-0000-4000-8000-000000000001',
 'temporary-password@example.invalid',
 now(),
 '$2a$10$temporary-password-hash',
 '{"onboarding_required":false}'
);
SELECT billing_private.require_temporary_password_change('6f000000-0000-4000-8000-000000000001');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','6f000000-0000-4000-8000-000000000001',true);

DO $$
DECLARE v_result jsonb;
BEGIN
 v_result=public.billing_rpc('onboarding','inspect','{}');
 IF v_result->>'status'<>'password' THEN
  RAISE EXCEPTION 'Temporary password was not reported as required: %',v_result;
 END IF;

 BEGIN
  PERFORM public.billing_rpc('settings','get','{}');
  RAISE EXCEPTION 'A temporary-password account reached a workspace RPC';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;

 BEGIN
  PERFORM public.billing_rpc('onboarding','complete-password','{}');
  RAISE EXCEPTION 'Unchanged temporary password was accepted';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;

 BEGIN
  PERFORM billing_private.require_temporary_password_change('6f000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'Authenticated clients can invoke private provisioning';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END $$;

RESET ROLE;
UPDATE auth.users
SET encrypted_password='$2a$10$personal-password-hash'
WHERE id='6f000000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','6f000000-0000-4000-8000-000000000001',true);
DO $$
DECLARE v_result jsonb;
BEGIN
 v_result=public.billing_rpc('onboarding','complete-password','{}');
 IF v_result->>'status'<>'password-changed' THEN
  RAISE EXCEPTION 'Changed password was not acknowledged: %',v_result;
 END IF;

 v_result=public.billing_rpc('onboarding','inspect','{}');
 IF v_result->>'status'<>'ready' THEN
  RAISE EXCEPTION 'Account did not become ready after password change: %',v_result;
 END IF;

 PERFORM public.billing_rpc('settings','get','{}');
END $$;

RESET ROLE;
DO $$
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM billing_private.password_change_requirements
  WHERE user_id='6f000000-0000-4000-8000-000000000001'
    AND completed_at IS NOT NULL
 ) THEN
  RAISE EXCEPTION 'Password change completion was not persisted';
 END IF;
 IF has_table_privilege('authenticated','billing_private.password_change_requirements','SELECT')
    OR has_table_privilege('authenticated','billing_private.password_change_requirements','INSERT')
    OR has_table_privilege('authenticated','billing_private.password_change_requirements','UPDATE')
    OR has_table_privilege('authenticated','billing_private.password_change_requirements','DELETE') THEN
  RAISE EXCEPTION 'Password requirements table is exposed to authenticated users';
 END IF;
END $$;

ROLLBACK;
