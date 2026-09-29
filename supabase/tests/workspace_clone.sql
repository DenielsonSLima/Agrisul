BEGIN;

INSERT INTO auth.users(id,email,email_confirmed_at,encrypted_password,raw_user_meta_data) VALUES
 ('7c000000-0000-4000-8000-000000000001','clone-source@example.invalid',now(),'source-hash','{"display_name":"Origem"}'::jsonb),
 ('7c000000-0000-4000-8000-000000000002','clone-target@example.invalid',now(),'temporary-hash','{"display_name":"Darliton Silva"}'::jsonb);

SELECT billing_private.create_workspace_defaults('7c000000-0000-4000-8000-000000000001');
INSERT INTO public.billing_memberships(owner_id,user_id,is_owner,status)
VALUES('7c000000-0000-4000-8000-000000000001','7c000000-0000-4000-8000-000000000001',true,'active');
INSERT INTO public.billing_user_settings(user_id,owner_id,name,compact,onboarding_completed_at)
VALUES('7c000000-0000-4000-8000-000000000001','7c000000-0000-4000-8000-000000000001','Origem',false,now());

INSERT INTO public.billing_farms(id,owner_id,name,area_ha,city,state)
VALUES('7c000000-0000-4000-8000-000000000010','7c000000-0000-4000-8000-000000000001','Fazenda clonada',10,'Japoatã','SE');
INSERT INTO public.billing_farm_plots(id,owner_id,name,area_ha,farm_id)
VALUES('7c000000-0000-4000-8000-000000000011','7c000000-0000-4000-8000-000000000001','Talhão clonado',4,'7c000000-0000-4000-8000-000000000010');

SELECT billing_private.clone_workspace_snapshot(
 '7c000000-0000-4000-8000-000000000001',
 '7c000000-0000-4000-8000-000000000002',
 'Darliton Silva'
);

DO $$
DECLARE
 v_target_farm uuid;
 v_target_plot uuid;
 v_target_plot_farm uuid;
BEGIN
 IF has_function_privilege(
  'authenticated','billing_private.clone_workspace_snapshot(uuid,uuid,text)','EXECUTE'
 ) THEN RAISE EXCEPTION 'Application users must never execute workspace cloning'; END IF;

 IF NOT EXISTS(
  SELECT 1 FROM public.billing_memberships
  WHERE owner_id='7c000000-0000-4000-8000-000000000002'
   AND user_id='7c000000-0000-4000-8000-000000000002'
   AND is_owner AND status='active'
 ) THEN RAISE EXCEPTION 'Target owner membership was not created'; END IF;
 IF (SELECT count(*) FROM public.billing_access_profiles
     WHERE owner_id='7c000000-0000-4000-8000-000000000002')<>2 THEN
  RAISE EXCEPTION 'Target access profiles were not initialized';
 END IF;
 IF NOT EXISTS(
  SELECT 1 FROM public.billing_user_settings
  WHERE user_id='7c000000-0000-4000-8000-000000000002'
   AND owner_id='7c000000-0000-4000-8000-000000000002'
   AND name='Darliton Silva' AND onboarding_completed_at IS NOT NULL
 ) THEN RAISE EXCEPTION 'Target user settings were not initialized'; END IF;

 SELECT id INTO STRICT v_target_farm FROM public.billing_farms
 WHERE owner_id='7c000000-0000-4000-8000-000000000002';
 SELECT id,farm_id INTO STRICT v_target_plot,v_target_plot_farm FROM public.billing_farm_plots
 WHERE owner_id='7c000000-0000-4000-8000-000000000002';
 IF v_target_farm='7c000000-0000-4000-8000-000000000010'
  OR v_target_plot='7c000000-0000-4000-8000-000000000011'
  OR v_target_plot_farm<>v_target_farm THEN
  RAISE EXCEPTION 'Cloned identifiers or child foreign keys were not remapped';
 END IF;
 IF (SELECT count(*) FROM public.billing_farms
     WHERE owner_id='7c000000-0000-4000-8000-000000000001')<>1 THEN
  RAISE EXCEPTION 'Source data changed during cloning';
 END IF;

 IF EXISTS(SELECT 1 FROM public.billing_quotations WHERE owner_id='7c000000-0000-4000-8000-000000000002')
  OR EXISTS(SELECT 1 FROM public.billing_purchase_orders WHERE owner_id='7c000000-0000-4000-8000-000000000002')
  OR EXISTS(SELECT 1 FROM public.billing_service_requests WHERE owner_id='7c000000-0000-4000-8000-000000000002') THEN
  RAISE EXCEPTION 'Transactional modules must start empty';
 END IF;
 IF NOT EXISTS(
  SELECT 1 FROM billing_private.password_change_requirements
  WHERE user_id='7c000000-0000-4000-8000-000000000002'
   AND password_hash_at_issue='temporary-hash' AND completed_at IS NULL
 ) THEN RAISE EXCEPTION 'Temporary password change was not required'; END IF;

 BEGIN
  PERFORM billing_private.clone_workspace_snapshot(
   '7c000000-0000-4000-8000-000000000001',
   '7c000000-0000-4000-8000-000000000002',
   'Darliton Silva'
  );
  RAISE EXCEPTION 'A repeated clone unexpectedly succeeded';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
END $$;

ROLLBACK;
