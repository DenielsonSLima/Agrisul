-- Read-only postflight after applying 20261102162813 on Agrisul.
SELECT jsonb_build_object(
 'publicInvoker',NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.billing_rpc(text,text,jsonb)'::regprocedure),
 'publicGate',strpos(pg_get_functiondef('public.billing_rpc(text,text,jsonb)'::regprocedure),'PERFORM billing_private.authorize_resource(p_resource,p_action);')>0,
 'catalogSize',cardinality(billing_private.permission_catalog()),
 'legacyPermissionsRemaining',(SELECT count(*) FROM public.billing_access_profiles WHERE permissions && ARRAY['registrations.read','registrations.write','requests.read','requests.write','requests.approve']),
 'profileCount',(SELECT count(*) FROM public.billing_access_profiles),
 'privateEmployeeImplementation',NOT has_function_privilege('authenticated','billing_private.employees_dispatch(text,jsonb)','EXECUTE'),
 'privateOvertimeImplementation',NOT has_function_privilege('authenticated','billing_private.overtime_dispatch(text,jsonb)','EXECUTE'),
 'privateSharedProjection',NOT has_function_privilege('authenticated','billing_private.summary_projection(text,jsonb)','EXECUTE'),
 'genericGate',strpos(pg_get_functiondef('billing_private.dispatch(text,text,jsonb)'::regprocedure),'PERFORM billing_private.authorize_resource(p_resource,p_action);')>0,
 'genericSettingsBlocked',strpos(pg_get_functiondef('billing_private.dispatch(text,text,jsonb)'::regprocedure),'p_resource IN (''settings'',''profile'',''permissions'')')>0,
 'employeePolicy',(SELECT qual FROM pg_policies WHERE schemaname='public' AND tablename='billing_employees' AND policyname='billing_employees_read'),
 'overtimePolicies',(SELECT jsonb_agg(jsonb_build_object('table',tablename,'qual',qual)) FROM pg_policies WHERE schemaname='public' AND tablename IN ('billing_overtime_reports','billing_overtime_rows')),
 'storagePolicies',(SELECT jsonb_agg(jsonb_build_object('name',policyname,'qual',qual,'check',with_check)) FROM pg_policies WHERE schemaname='storage' AND (policyname LIKE 'billing_material_images_%' OR policyname LIKE 'billing_quotation_files_%' OR policyname='billing_overtime_brand_files_read')),
 'unmappedStoragePolicies',(SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND (coalesce(qual,'') ~ '''(registrations|requests)\.' OR coalesce(with_check,'') ~ '''(registrations|requests)\.'))
) postflight;
