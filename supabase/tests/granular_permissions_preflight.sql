-- Read-only production preflight. Run only on Agrisul ykounjabfsrtkzostbbz.
SELECT jsonb_build_object(
 'latestRequiredMigration',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261102161426'),
 'alreadyApplied',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261102162813'),
 'publicInvoker',NOT p.prosecdef,
 'privateTargetAbsent',to_regprocedure('billing_private.rpc_before_granular(text,text,jsonb)') IS NULL,
 'guardTargetAbsent',to_regprocedure('billing_private.guarded_rpc(text,text,jsonb)') IS NULL,
 'projectionTargetsAbsent',to_regprocedure('billing_private.agenda_projection(text,jsonb)') IS NULL AND to_regprocedure('billing_private.summary_projection(text,jsonb)') IS NULL AND to_regprocedure('billing_private.farm_summary_projection()') IS NULL,
 'profileDispatcherAnchor',strpos(pg_get_functiondef('billing_private.access_profiles_dispatch(text,jsonb)'::regprocedure),' IF length(v_name) NOT BETWEEN')>0,
 'profileHierarchyAnchor',strpos(pg_get_functiondef('billing_private.access_profiles_dispatch(text,jsonb)'::regprocedure),' IF NOT v_is_owner AND NOT(v_permissions <@ v_actor_permissions)')>0,
 'overtimeDispatcher',to_regprocedure('billing_private.overtime_dispatch(text,jsonb)') IS NOT NULL,
 'employeeDispatcher',to_regprocedure('billing_private.employees_dispatch(text,jsonb)') IS NOT NULL,
 'ownerActive',EXISTS(SELECT 1 FROM public.billing_memberships WHERE owner_id='bd34b83d-57ae-4441-97f2-d948c8256f64' AND user_id=owner_id AND is_owner AND status='active'),
 'profiles', (SELECT count(*) FROM public.billing_access_profiles),
 'legacyProfiles',(SELECT count(*) FROM public.billing_access_profiles WHERE permissions && ARRAY['registrations.read','registrations.write','requests.read','requests.write','requests.approve']),
 'employeePolicies',(SELECT jsonb_agg(jsonb_build_object('name',policyname,'using',qual)) FROM pg_policies WHERE schemaname='public' AND tablename='billing_employees'),
 'overtimePolicies',(SELECT jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'using',qual)) FROM pg_policies WHERE schemaname='public' AND tablename IN ('billing_overtime_reports','billing_overtime_rows'))
) preflight FROM pg_proc p WHERE p.oid='public.billing_rpc(text,text,jsonb)'::regprocedure;
