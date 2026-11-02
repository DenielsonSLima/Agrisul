BEGIN;

-- Access is attached to the authenticated membership and immutable workspace,
-- never to payload identity or editable JWT user metadata. Parent modules are
-- navigation groups; granting one child never grants its siblings.
CREATE FUNCTION billing_private.permission_catalog() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT ARRAY['access-profiles.manage','agenda.read','atr.read','atr.write','clients.read','clients.write','companies.read','companies.write','contract-types.read','contract-types.write','contracts.read','contracts.write','cultural-practices.read','cultural-practices.write','cultures.read','cultures.write','document-templates.read','document-templates.write','documentation.read','documentation.write','employees.read','employees.write','farms.read','farms.write','fleet.read','fleet.write','home.read','imports.read','imports.write','material-categories.read','material-categories.write','materials.read','materials.write','overtime.read','overtime.write','payment-methods.read','payment-methods.write','planning.read','planning.write','purchase-orders.read','purchase-orders.write','purchase-requests.read','purchase-requests.write','quotations.read','quotations.write','report-headers.read','report-headers.write','reports.read','service-providers.read','service-providers.write','service-requests.approve','service-requests.read','service-requests.write','settings.write','signatures.manage','signatures.read','summary.read','users.manage','watermarks.read','watermarks.write']::text[] $$;
REVOKE ALL ON FUNCTION billing_private.permission_catalog() FROM PUBLIC,anon,authenticated;

-- Compatibility for the two former blanket permissions. Expansion is one-way:
-- no granular key ever produces registrations.* or requests.*.
CREATE FUNCTION billing_private.expand_legacy_permissions(p_permissions text[]) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(array_agg(DISTINCT permission ORDER BY permission),'{}') FROM (
  SELECT permission FROM unnest(p_permissions) permission
  WHERE permission NOT LIKE 'registrations.%' AND permission NOT LIKE 'requests.%'
  UNION ALL
  SELECT resource||'.'||action FROM unnest(ARRAY['clients','employees','service-providers','atr','farms','contract-types','material-categories','materials','fleet','payment-methods','cultures','cultural-practices','purchase-requests','quotations','purchase-orders','planning','imports']::text[]) resource
  CROSS JOIN (VALUES('read'),('write')) a(action)
  WHERE 'registrations.'||action=ANY(p_permissions)
  UNION ALL SELECT 'home.read' WHERE 'registrations.read'=ANY(p_permissions)
  UNION ALL SELECT 'summary.read' WHERE 'registrations.read'=ANY(p_permissions)
  UNION ALL SELECT 'signatures.read' WHERE p_permissions && ARRAY['registrations.read','signatures.manage']::text[]
  UNION ALL SELECT 'service-requests.'||action FROM (VALUES('read'),('write'),('approve')) a(action)
   WHERE 'requests.'||action=ANY(p_permissions)
  UNION ALL SELECT 'overtime.'||action FROM (VALUES('read'),('write')) a(action)
   WHERE 'requests.'||action=ANY(p_permissions)
 ) expanded
$$;
REVOKE ALL ON FUNCTION billing_private.expand_legacy_permissions(text[]) FROM PUBLIC,anon,authenticated;

DO $$ DECLARE c text; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.billing_access_profiles'::regclass
  AND contype='c' AND pg_get_constraintdef(oid) LIKE '%permissions%'
 LOOP EXECUTE format('ALTER TABLE public.billing_access_profiles DROP CONSTRAINT %I',c); END LOOP;
END $$;

-- Preserve every existing profile's previous paths before removing blanket bits.
UPDATE public.billing_access_profiles SET permissions=billing_private.expand_legacy_permissions(permissions||
 ARRAY['home.read']::text[]||
 CASE WHEN 'contracts.read'=ANY(permissions) THEN ARRAY['agenda.read','reports.read'] ELSE '{}'::text[] END||
 CASE WHEN 'report-headers.read'=ANY(permissions) THEN ARRAY['document-templates.read'] ELSE '{}'::text[] END||
 CASE WHEN 'report-headers.write'=ANY(permissions) THEN ARRAY['document-templates.write'] ELSE '{}'::text[] END);

CREATE FUNCTION billing_private.normalize_access_permissions() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 NEW.permissions=billing_private.expand_legacy_permissions(NEW.permissions);RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION billing_private.normalize_access_permissions() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER billing_normalize_access_permissions BEFORE INSERT OR UPDATE OF permissions
 ON public.billing_access_profiles FOR EACH ROW EXECUTE FUNCTION billing_private.normalize_access_permissions();
ALTER TABLE public.billing_access_profiles ADD CONSTRAINT billing_access_profiles_permission_catalog
 CHECK(cardinality(permissions)<=100 AND permissions <@ billing_private.permission_catalog());

-- Existing defaults are expanded explicitly, as are defaults for a new workspace.
CREATE OR REPLACE FUNCTION billing_private.create_workspace_defaults(p_owner uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 INSERT INTO public.billing_access_profiles(owner_id,name,description,permissions,is_system) VALUES
 (p_owner,'Administrador','Acesso completo ao espaço de trabalho',billing_private.permission_catalog(),true),
 (p_owner,'Somente leitura','Consulta dados e usa os padrões de relatório',
  ARRAY(SELECT permission FROM unnest(billing_private.permission_catalog()) permission WHERE permission LIKE '%.read'),true)
 ON CONFLICT(owner_id,name_key) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION billing_private.create_workspace_defaults(uuid) FROM PUBLIC,anon,authenticated;

-- Keep the existing profile CRUD, no-escalation checks and system profile locks;
-- replace only its catalog/dependency validation with the granular contract.
DO $$ DECLARE definition text;start_at integer;end_at integer; BEGIN
 SELECT pg_get_functiondef('billing_private.access_profiles_dispatch(text,jsonb)'::regprocedure) INTO definition;
 start_at=strpos(definition,' IF length(v_name) NOT BETWEEN');
 end_at=strpos(definition,' IF NOT v_is_owner AND NOT(v_permissions <@ v_actor_permissions)');
 IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION 'Unexpected access profile dispatcher'; END IF;
 definition=substr(definition,1,start_at-1)||$validation$
 IF cardinality(v_permissions)<>(SELECT count(DISTINCT permission) FROM unnest(v_permissions) permission) THEN
  RAISE EXCEPTION 'Permissões duplicadas.' USING ERRCODE='22023'; END IF;
 v_permissions=billing_private.expand_legacy_permissions(v_permissions);
 IF length(v_name) NOT BETWEEN 2 AND 100 OR length(v_description)>500 OR cardinality(v_permissions)>100
  OR NOT(v_permissions <@ billing_private.permission_catalog()) THEN
  RAISE EXCEPTION 'Confira os dados e permissões do perfil de acesso.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(v_permissions) permission WHERE permission ~ '\.(write|approve)$'
  AND permission<>'settings.write' AND NOT(regexp_replace(permission,'\.(write|approve)$','.read')=ANY(v_permissions)))
  OR ('report-headers.read'=ANY(v_permissions) AND NOT(ARRAY['companies.read','watermarks.read']::text[] <@ v_permissions)) THEN
  RAISE EXCEPTION 'Inclua também as permissões de consulta necessárias.' USING ERRCODE='22023'; END IF;
$validation$||substr(definition,end_at);
 EXECUTE definition;
END $$;

-- Retarget authorization in the existing private implementation chain. Its
-- business logic, locks, validation and owner-qualified queries stay unchanged.
DO $$ DECLARE f record;definition text;resource text; BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='billing_private' AND p.prokind='f'
   AND p.proname NOT IN ('access_profiles_dispatch','create_workspace_defaults','expand_legacy_permissions','permission_catalog','authorize_resource')
   AND (p.prosrc LIKE '%registrations.%' OR p.prosrc LIKE '%requests.%')
 LOOP
  definition=pg_get_functiondef(f.oid);
  IF f.proname LIKE 'overtime%' THEN definition=replace(definition,'''requests.','''overtime.');
  ELSE definition=replace(definition,'''requests.','''service-requests.'); END IF;
  resource=CASE
   WHEN f.proname='employees_dispatch' OR f.proname LIKE 'overtime%' THEN 'employees'
   WHEN f.proname LIKE 'import_%' THEN 'imports'
   WHEN f.proname LIKE 'planning%' THEN 'planning'
   WHEN f.proname LIKE 'summary%' THEN 'summary'
   WHEN f.proname='fleet_dispatch' OR f.proname='cane_import' THEN 'fleet'
   WHEN f.proname LIKE 'service_providers%' THEN 'service-providers'
   WHEN f.proname='service_purchase_source_payload' THEN 'purchase-requests'
   WHEN f.proname LIKE 'material_categories%' THEN 'material-categories'
   WHEN f.proname LIKE 'material_%' THEN 'materials'
   WHEN f.proname LIKE 'payment_methods%' THEN 'payment-methods'
   WHEN f.proname LIKE 'purchase_orders%' THEN 'purchase-orders'
   WHEN f.proname LIKE 'purchase_requests%' THEN 'purchase-requests'
   WHEN f.proname='farm_summary_list' THEN 'farms'
   WHEN f.proname IN ('management_dispatch','bootstrap_sugarcane_management') THEN 'cultural-practices'
   WHEN f.proname='signatures_dispatch' THEN 'signatures'
   WHEN f.proname='can_read_request_file' OR f.proname='documentation_dispatch' THEN 'quotations'
   WHEN f.proname='home_dashboard' THEN NULL
   WHEN f.proname LIKE 'quotations%' THEN NULL
   ELSE NULL END;
  IF resource IS NOT NULL THEN definition=replace(definition,'''registrations.',''''||resource||'.');
  ELSIF f.proname LIKE 'quotations%' THEN
   definition=replace(definition,'''registrations.write''',
    '(CASE WHEN p_resource=''materials'' THEN ''materials.write'' ELSE ''quotations.write'' END)');
   definition=replace(definition,'''registrations.read''',
    '(CASE WHEN p_resource=''materials'' THEN ''materials.read'' ELSE ''quotations.read'' END)');
  ELSIF f.proname='home_dashboard' THEN
   definition=replace(definition,'billing_private.has_permission(''registrations.read'')',
    '(billing_private.has_permission(''clients.read'') AND billing_private.has_permission(''farms.read'') AND billing_private.has_permission(''service-providers.read'') AND billing_private.has_permission(''planning.read''))');
  END IF;
  IF definition LIKE '%''registrations.%' OR definition LIKE '%''requests.%' THEN
   RAISE EXCEPTION 'Unmapped legacy authorization in %',f.proname;
  END IF;
  EXECUTE definition;
 END LOOP;
 -- Document templates are an independent registration submodule.
 SELECT pg_get_functiondef('billing_private.document_templates_dispatch(text,jsonb)'::regprocedure) INTO definition;
 definition=replace(definition,'''report-headers.','''document-templates.');
 EXECUTE definition;
END $$;

-- Read-only projections expose their own module's authorized output. Private
-- shared builders can serve reports without granting the Contracts UI/API; the
-- central gate still checks the requested module before invoking any builder.
CREATE FUNCTION billing_private.authorize_any(p_permissions text[]) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM unnest(p_permissions) permission WHERE billing_private.has_permission(permission)) THEN
  RAISE EXCEPTION 'Você não tem permissão para realizar esta operação.' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION billing_private.authorize_any(text[]) FROM PUBLIC,anon,authenticated;
DO $$ DECLARE f record;definition text;guard text; BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='billing_private' AND p.prokind='f'
   AND (p.proname LIKE 'summary%' OR p.proname LIKE 'reports%' OR p.proname='agenda_dispatch' OR p.proname='farm_summary_list')
 LOOP
  definition=pg_get_functiondef(f.oid);
  guard=CASE WHEN f.proname LIKE 'summary%' THEN 'billing_private.authorize_any(ARRAY[''summary.read'',''reports.read''])'
   WHEN f.proname='agenda_dispatch' THEN 'billing_private.authorize_any(ARRAY[''agenda.read'',''home.read''])'
   WHEN f.proname='farm_summary_list' THEN 'billing_private.authorize_any(ARRAY[''farms.read'',''reports.read''])'
   ELSE 'billing_private.authorize(''reports.read'')' END;
  definition=replace(definition,'billing_private.authorize_resource(''contracts'',''list'')',guard);
  IF f.proname LIKE 'summary%' THEN definition=replace(definition,'billing_private.authorize(''summary.read'')',guard); END IF;
  IF f.proname='reports_dispatch' THEN definition=replace(definition,'billing_private.authorize_resource(''farms'',''list'')',guard); END IF;
  IF f.proname='farm_summary_list' THEN definition=replace(definition,'billing_private.authorize(''farms.read'')',guard); END IF;
  EXECUTE definition;
 END LOOP;
END $$;

-- Granular RLS protects direct SELECT/Realtime as well as the RPC.
DO $$ DECLARE p record;resource text;expression text; BEGIN
 FOR p IN SELECT tablename,policyname,qual FROM pg_policies WHERE schemaname='public'
  AND (qual LIKE '%registrations.%' OR qual LIKE '%requests.%')
 LOOP
  resource=CASE
   WHEN p.tablename='billing_employees' THEN 'employees'
   WHEN p.tablename='billing_atr_records' THEN 'atr'
   WHEN p.tablename='billing_clients' THEN 'clients'
   WHEN p.tablename='billing_contract_types' THEN 'contract-types'
   WHEN p.tablename='billing_cultural_practices' THEN 'cultural-practices'
   WHEN p.tablename IN ('billing_cultures','billing_culture_subtypes') THEN 'cultures'
   WHEN p.tablename IN ('billing_farms','billing_farm_plots') THEN 'farms'
   WHEN p.tablename='billing_fleet_vehicles' THEN 'fleet'
   WHEN p.tablename LIKE 'billing_import_%' THEN 'imports'
   WHEN p.tablename='billing_material_categories' THEN 'material-categories'
   WHEN p.tablename IN ('billing_materials','billing_material_variants') THEN 'materials'
   WHEN p.tablename='billing_payment_methods' THEN 'payment-methods'
   WHEN p.tablename LIKE 'billing_planning_%' THEN 'planning'
   WHEN p.tablename LIKE 'billing_purchase_order%' THEN 'purchase-orders'
   WHEN p.tablename LIKE 'billing_purchase_request%' THEN 'purchase-requests'
   WHEN p.tablename LIKE 'billing_quotation%' THEN 'quotations'
   WHEN p.tablename LIKE 'billing_service_provider%' THEN 'service-providers'
   WHEN p.tablename='billing_signatures' THEN 'signatures'
   ELSE NULL END;
  expression=replace(p.qual,'''requests.','''service-requests.');
  IF p.tablename LIKE 'billing_overtime_%' THEN expression=replace(expression,'''service-requests.','''overtime.'); END IF;
  IF resource IS NOT NULL THEN expression=replace(expression,'''registrations.',''''||resource||'.'); END IF;
  IF expression LIKE '%''registrations.%' THEN RAISE EXCEPTION 'Unmapped policy: %',p.tablename; END IF;
  IF p.tablename='billing_document_templates' THEN expression=replace(expression,'''report-headers.read''','''document-templates.read'''); END IF;
  EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)',p.policyname,p.tablename,expression);
 END LOOP;
 -- Storage and helpers now use the service submodule, never the blanket requests bit.
 FOR p IN SELECT policyname,qual,with_check,cmd FROM pg_policies WHERE schemaname='storage'
  AND (coalesce(qual,'') ~ '(requests|registrations)\.' OR coalesce(with_check,'') ~ '(requests|registrations)\.')
 LOOP
  resource=CASE WHEN p.policyname LIKE 'billing_material_images_%' THEN 'materials'
   WHEN p.policyname LIKE 'billing_quotation_files_%' THEN 'quotations' ELSE NULL END;
  expression=replace(p.qual,'''requests.','''service-requests.');
  IF resource IS NOT NULL THEN expression=replace(expression,'''registrations.',''''||resource||'.'); END IF;
  IF coalesce(expression,'') LIKE '%''registrations.%' THEN RAISE EXCEPTION 'Unmapped storage policy %',p.policyname; END IF;
  IF expression IS NOT NULL THEN EXECUTE format('ALTER POLICY %I ON storage.objects USING (%s)',p.policyname,expression); END IF;
  IF p.with_check IS NOT NULL THEN
   expression=replace(p.with_check,'''requests.','''service-requests.');
   IF resource IS NOT NULL THEN expression=replace(expression,'''registrations.',''''||resource||'.'); END IF;
   IF expression LIKE '%''registrations.%' THEN RAISE EXCEPTION 'Unmapped storage policy %',p.policyname; END IF;
   EXECUTE format('ALTER POLICY %I ON storage.objects WITH CHECK (%s)',p.policyname,expression);
  END IF;
 END LOOP;
END $$;

-- Minimal authenticated session projection; no administration APIs are needed
-- to select a company while recording overtime.
CREATE FUNCTION billing_private.permissions_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();owner uuid:=billing_private.current_owner_id();is_owner boolean;permissions text[];companies jsonb;
BEGIN
 IF actor IS NULL OR owner IS NULL THEN RAISE EXCEPTION 'Faça login.' USING ERRCODE='28000'; END IF;
 IF p_action IS DISTINCT FROM 'get' THEN RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023'; END IF;
 PERFORM billing_private.request_payload(p_payload,'{}');
 SELECT m.is_owner,CASE WHEN m.is_owner THEN billing_private.permission_catalog() ELSE ap.permissions END
 INTO is_owner,permissions FROM public.billing_memberships m LEFT JOIN public.billing_access_profiles ap
  ON ap.owner_id=m.owner_id AND ap.id=m.access_profile_id
 WHERE m.user_id=actor AND m.owner_id=owner AND m.status='active';
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'isPrimary',c.is_primary)
  ORDER BY c.is_primary DESC,lower(c.name),c.id),'[]') INTO companies
 FROM public.billing_companies c WHERE c.owner_id=owner AND (is_owner OR permissions && ARRAY[
  'companies.read','overtime.read','contracts.read','summary.read','agenda.read','reports.read','planning.read','imports.read','documentation.read']::text[]);
 RETURN jsonb_build_object('isOwner',coalesce(is_owner,false),'permissions',coalesce(permissions,'{}'),'companies',companies);
END $$;
REVOKE ALL ON FUNCTION billing_private.permissions_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.overtime_document_brand(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE owner uuid:=billing_private.current_owner_id();company uuid;header public.billing_report_headers;watermark public.billing_watermarks;brand jsonb;issuer jsonb;
BEGIN
 IF auth.uid() IS NULL OR owner IS NULL THEN RAISE EXCEPTION 'Faça login.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize('overtime.read');
 PERFORM billing_private.request_payload(p_payload,ARRAY['companyId']);
 company=nullif(p_payload->>'companyId','')::uuid;
 SELECT * INTO header FROM public.billing_report_headers WHERE owner_id=owner;
 IF company IS NULL THEN
  SELECT id INTO company FROM public.billing_companies WHERE owner_id=owner
   ORDER BY (id=header.default_company_id) DESC NULLS LAST,is_primary DESC,name,id LIMIT 1;
 END IF;
 SELECT billing_private.present(to_jsonb(c)) INTO brand FROM public.billing_companies c WHERE c.owner_id=owner AND c.id=company;
 IF brand IS NULL THEN RAISE EXCEPTION 'Selecione uma empresa cadastrada.' USING ERRCODE='22023'; END IF;
 SELECT * INTO watermark FROM public.billing_watermarks WHERE owner_id=owner;
 SELECT jsonb_build_object('id',u.id,'name',coalesce(s.name,u.email,'Usuário'),'email',coalesce(u.email,'')) INTO issuer
  FROM auth.users u LEFT JOIN public.billing_user_settings s ON s.user_id=u.id WHERE u.id=auth.uid();
 RETURN jsonb_build_object('company',brand,'header',jsonb_build_object(
  'variant',coalesce(header.portrait_variant,'detailed'),'logoAlignment',coalesce(header.portrait_logo_alignment,'left'),
  'showCnpj',coalesce(header.portrait_show_cnpj,true),'showContact',coalesce(header.portrait_show_contact,true)),
  'watermark',jsonb_build_object('portraitImageKey',watermark.portrait_image_key,'opacity',coalesce(watermark.opacity,15),'size',coalesce(watermark.size,60)),'issuer',issuer);
EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Selecione uma empresa válida.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.overtime_document_brand(jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.can_read_overtime_brand_file(p_bucket text,p_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND billing_private.has_permission('overtime.read') AND
 CASE p_bucket WHEN 'billing-company-logos' THEN EXISTS(SELECT 1 FROM public.billing_companies c
  WHERE c.owner_id=billing_private.current_owner_id() AND c.logo_key=p_path)
 WHEN 'billing-watermarks' THEN EXISTS(SELECT 1 FROM public.billing_watermarks w
  WHERE w.owner_id=billing_private.current_owner_id() AND w.portrait_image_key=p_path)
 ELSE false END
$$;
REVOKE ALL ON FUNCTION billing_private.can_read_overtime_brand_file(text,text) FROM PUBLIC,anon,authenticated;
CREATE POLICY billing_overtime_brand_files_read ON storage.objects FOR SELECT TO authenticated
 USING(billing_private.can_read_overtime_brand_file(bucket_id,name));

-- Linking is owner-only and never creates an Auth user, changes credentials,
-- confirms email, sends mail, or moves someone out of a different workspace.
ALTER FUNCTION billing_private.users_dispatch(text,jsonb) RENAME TO users_before_existing_link_dispatch;
CREATE FUNCTION billing_private.users_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();owner uuid:=billing_private.current_owner_id();target uuid;profile uuid;v_email text;member public.billing_memberships;
BEGIN
 IF p_action IS DISTINCT FROM 'link-existing' THEN RETURN billing_private.users_before_existing_link_dispatch(p_action,p_payload); END IF;
 IF actor IS NULL OR owner IS NULL THEN RAISE EXCEPTION 'Faça login.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.lock_request_actor();
 IF actor<>owner OR NOT EXISTS(SELECT 1 FROM public.billing_memberships
  WHERE owner_id=owner AND user_id=actor AND is_owner AND status='active') THEN
  RAISE EXCEPTION 'Somente o proprietário pode vincular uma conta existente.' USING ERRCODE='42501'; END IF;
 PERFORM billing_private.request_payload(p_payload,ARRAY['email','accessProfileId']);
 IF jsonb_typeof(p_payload->'email') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'accessProfileId') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Informe e-mail e perfil de acesso.' USING ERRCODE='22023'; END IF;
 v_email=lower(btrim(p_payload->>'email'));profile=(p_payload->>'accessProfileId')::uuid;
 PERFORM 1 FROM public.billing_access_profiles WHERE owner_id=owner AND id=profile FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Selecione um perfil deste espaço.' USING ERRCODE='22023'; END IF;
 SELECT id INTO target FROM auth.users WHERE lower(btrim(auth.users.email))=v_email;
 IF target IS NULL THEN RAISE EXCEPTION 'Conta existente não encontrada.' USING ERRCODE='P0002'; END IF;
 -- Same locks/order as onboarding/invites prevent a concurrent workspace claim.
 PERFORM pg_advisory_xact_lock(hashtextextended('billing-actor:'||target::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('billing-invite:'||v_email,0));
 IF EXISTS(SELECT 1 FROM public.billing_memberships WHERE user_id=target) THEN
  RAISE EXCEPTION 'Esta conta já possui vínculo com um espaço.' USING ERRCODE='23505'; END IF;
 IF EXISTS(SELECT 1 FROM public.billing_invitations WHERE email_key=v_email AND status='pending' AND expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'Esta conta possui um convite pendente; conclua ou cancele-o primeiro.' USING ERRCODE='23514'; END IF;
 INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,is_owner,status)
  VALUES(owner,target,profile,false,'active') RETURNING * INTO member;
 INSERT INTO public.billing_user_settings(user_id,owner_id,name,onboarding_completed_at)
  SELECT target,owner,left(coalesce(nullif(btrim(raw_user_meta_data->>'display_name'),''),auth.users.email,'Usuário'),150),NULL
  FROM auth.users WHERE id=target;
 RETURN jsonb_build_object('user',billing_private.present_member(member));
EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Selecione um perfil válido.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.users_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;

-- Central gate covers every routed submodule, including read-only dashboards.
-- Existing route-specific functions retain their transaction/business checks.
CREATE OR REPLACE FUNCTION billing_private.authorize_resource(p_resource text,p_action text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE resource text;action text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login.' USING ERRCODE='28000'; END IF;
 IF billing_private.temporary_password_change_required() THEN RAISE EXCEPTION 'Troque a senha temporária antes de acessar o sistema.' USING ERRCODE='42501'; END IF;
 IF p_resource IN ('settings','profile','permissions') THEN RETURN; END IF;
 resource=CASE p_resource WHEN 'plots' THEN 'farms' WHEN 'material-variants' THEN 'materials' WHEN 'watermark' THEN 'watermarks'
  WHEN 'import-profiles' THEN 'imports' WHEN 'import-documents' THEN 'imports'
  WHEN 'cane-weighings' THEN 'contracts' WHEN 'dashboard-market' THEN 'summary'
  WHEN 'dashboard-weather' THEN 'summary' WHEN 'weather-preferences' THEN 'summary' ELSE p_resource END;
 IF resource='users' THEN PERFORM billing_private.authorize('users.manage');RETURN; END IF;
 IF resource='access-profiles' THEN
  IF p_action IN ('list','get') AND billing_private.has_permission('users.manage') THEN RETURN; END IF;
  PERFORM billing_private.authorize('access-profiles.manage');RETURN;
 END IF;
 IF resource='signatures' THEN
  IF p_action IN ('list','options') AND billing_private.has_permission('signatures.read') THEN RETURN; END IF;
  PERFORM billing_private.authorize('signatures.manage');RETURN;
 END IF;
 IF NOT(resource||'.read'=ANY(billing_private.permission_catalog())) THEN
  RAISE EXCEPTION 'Recurso inválido.' USING ERRCODE='22023'; END IF;
 -- A writer always needs the submodule read bit too.
 PERFORM billing_private.authorize(resource||'.read');
 IF resource IN ('home','summary','agenda','reports') THEN RETURN; END IF;
 -- Generic CRUD resources formerly relied on this gate for write checks.
 IF resource IN ('companies','clients','atr','farms','contract-types','cultures','cultural-practices','materials','quotations','contracts','watermarks')
  AND p_action NOT IN ('get','list','document-brand') THEN
  PERFORM billing_private.authorize(resource||'.write');
 END IF;
END $$;
REVOKE ALL ON FUNCTION billing_private.authorize_resource(text,text) FROM PUBLIC,anon,authenticated;

-- Reuse the original public invoker body without another dispatch stack frame.
-- Quotations already have a long versioned implementation chain. The gate is
-- checked before every public route and in every directly executable private
-- entrypoint; implementation functions underneath those remain private.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.billing_rpc(text,text,jsonb)'::regprocedure) INTO definition;
 IF strpos(definition,'PERFORM billing_private.ensure_actor_workspace();')=0 THEN RAISE EXCEPTION 'Unexpected public RPC'; END IF;
 definition=replace(definition,'PERFORM billing_private.ensure_actor_workspace();',
  $routes$PERFORM billing_private.ensure_actor_workspace();
 PERFORM billing_private.authorize_resource(p_resource,p_action);
 IF p_resource='permissions' THEN RETURN billing_private.permissions_dispatch(p_action,p_payload); END IF;
 IF p_resource='overtime' AND p_action='document-brand' THEN RETURN billing_private.overtime_document_brand(p_payload); END IF;$routes$);
 EXECUTE definition;
END $$;

-- Private projections are shared internally by Home/Reports. The executable
-- entrypoints below authorize their actual module, not the shared builder.
ALTER FUNCTION billing_private.agenda_dispatch(text,jsonb) RENAME TO agenda_projection;
CREATE FUNCTION billing_private.agenda_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM billing_private.authorize_resource('agenda',p_action);
 RETURN billing_private.agenda_projection(p_action,p_payload);
END $$;
ALTER FUNCTION billing_private.summary_dispatch(text,jsonb) RENAME TO summary_projection;
CREATE FUNCTION billing_private.summary_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM billing_private.authorize_resource('summary',p_action);
 RETURN billing_private.summary_projection(p_action,p_payload);
END $$;
ALTER FUNCTION billing_private.farm_summary_list() RENAME TO farm_summary_projection;
CREATE FUNCTION billing_private.farm_summary_list() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM billing_private.authorize_resource('farms','list');
 RETURN billing_private.farm_summary_projection();
END $$;
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('billing_private.home_dashboard(text,jsonb)'::regprocedure) INTO definition;
 EXECUTE replace(definition,'billing_private.agenda_dispatch(', 'billing_private.agenda_projection(');
 SELECT pg_get_functiondef('billing_private.reports_dispatch(text,jsonb)'::regprocedure) INTO definition;
 definition=replace(definition,'billing_private.summary_dispatch(', 'billing_private.summary_projection(');
 definition=replace(definition,'billing_private.farm_summary_list()', 'billing_private.farm_summary_projection()');
 EXECUTE definition;
END $$;

-- Add inline authorization to entrypoints called by the public invoker. No
-- permission can be bypassed by addressing the private schema directly.
DO $$ DECLARE f record;definition text;guard text;resource text; BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='billing_private' AND p.proname IN (
   'dispatch','quotations_dispatch','dashboard_weather_read','weather_preferences_dispatch','market_feed_dispatch',
   'documentation_dispatch','home_dashboard','service_providers_dispatch','document_templates_dispatch',
   'signatures_dispatch','service_requests_dispatch','users_dispatch','access_profiles_dispatch','workspace_settings','report_headers_dispatch','reports_dispatch',
   'planning_v9_dispatch','contracts_company_dispatch','bootstrap_sugarcane_management','management_dispatch',
   'atr_dispatch','save_company','watermark_variants','permissions_dispatch','overtime_document_brand','ensure_actor_workspace')
 LOOP
  definition=pg_get_functiondef(f.oid);
  resource=CASE f.proname
   WHEN 'dashboard_weather_read' THEN 'summary' WHEN 'weather_preferences_dispatch' THEN 'summary' WHEN 'market_feed_dispatch' THEN 'summary'
   WHEN 'documentation_dispatch' THEN 'documentation' WHEN 'home_dashboard' THEN 'home'
   WHEN 'service_providers_dispatch' THEN 'service-providers' WHEN 'document_templates_dispatch' THEN 'document-templates'
   WHEN 'access_profiles_dispatch' THEN 'access-profiles' WHEN 'workspace_settings' THEN 'settings'
   WHEN 'signatures_dispatch' THEN 'signatures' WHEN 'service_requests_dispatch' THEN 'service-requests' WHEN 'users_dispatch' THEN 'users'
   WHEN 'report_headers_dispatch' THEN 'report-headers' WHEN 'reports_dispatch' THEN 'reports' WHEN 'planning_v9_dispatch' THEN 'planning'
   WHEN 'contracts_company_dispatch' THEN 'contracts' WHEN 'bootstrap_sugarcane_management' THEN 'cultural-practices'
   WHEN 'management_dispatch' THEN 'cultural-practices' WHEN 'atr_dispatch' THEN 'atr' WHEN 'save_company' THEN 'companies'
   WHEN 'watermark_variants' THEN 'watermarks' WHEN 'ensure_actor_workspace' THEN 'permissions' WHEN 'permissions_dispatch' THEN 'permissions' WHEN 'overtime_document_brand' THEN 'overtime' ELSE NULL END;
  guard=CASE WHEN resource IS NULL THEN 'PERFORM billing_private.authorize_resource(p_resource,p_action);'
   WHEN f.proname IN ('save_company','bootstrap_sugarcane_management') THEN format('PERFORM billing_private.authorize_resource(%L,''save'');',resource)
   WHEN f.proname='ensure_actor_workspace' THEN 'PERFORM billing_private.authorize_resource(''permissions'',''get'');'
   WHEN f.proname='overtime_document_brand' THEN 'PERFORM billing_private.authorize_resource(''overtime'',''document-brand'');'
   ELSE format('PERFORM billing_private.authorize_resource(%L,p_action);',resource) END;
  IF f.proname='dispatch' THEN guard=$whitelist$IF p_resource IN ('settings','profile','permissions') THEN
   RAISE EXCEPTION 'Você não tem permissão para realizar esta operação.' USING ERRCODE='42501'; END IF;
 IF p_resource IS NULL OR NOT(p_resource=ANY(ARRAY[
   'companies','clients','farms','plots','contract-types','cultures','employees','overtime','material-categories','material-variants',
   'fleet','payment-methods','cane-weighings','purchase-requests','purchase-orders','import-profiles','import-documents'])) THEN
   RAISE EXCEPTION 'Recurso inválido.' USING ERRCODE='22023'; END IF;
 $whitelist$||guard; END IF;
  IF f.proname='quotations_dispatch' THEN guard=$whitelist$IF p_resource IS NULL OR p_resource NOT IN ('materials','quotations') THEN
   RAISE EXCEPTION 'Recurso inválido.' USING ERRCODE='22023'; END IF;
 $whitelist$||guard; END IF;
  IF strpos(definition,'BEGIN')=0 THEN RAISE EXCEPTION 'Unexpected entrypoint %',f.proname; END IF;
  definition=substr(definition,1,strpos(definition,'BEGIN')+4)||E'\n '||guard||substr(definition,strpos(definition,'BEGIN')+5);
  EXECUTE definition;
 END LOOP;
END $$;

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='billing_private' AND p.prokind='f'
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature); END LOOP;
 -- Only direct dependencies of the invoker contract are executable by clients.
 FOR f IN SELECT DISTINCT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='billing_private' AND p.proname IN (
   'temporary_password_change_required','onboarding_dispatch','ensure_actor_workspace','authorize_resource',
   'dispatch','dashboard_weather_read','weather_preferences_dispatch','market_feed_dispatch','documentation_dispatch','home_dashboard',
   'service_providers_dispatch','document_templates_dispatch','signatures_dispatch','service_requests_dispatch',
   'workspace_settings','users_dispatch','access_profiles_dispatch','report_headers_dispatch','agenda_dispatch',
   'summary_dispatch','reports_dispatch','planning_v9_dispatch','quotations_dispatch','contracts_company_dispatch',
   'bootstrap_sugarcane_management','management_dispatch','atr_dispatch','farm_summary_list','save_company','watermark_variants',
   'permissions_dispatch','overtime_document_brand')
 LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature); END LOOP;
 -- RLS predicates also need execution for direct SELECT and Storage policies.
 FOR f IN SELECT DISTINCT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  JOIN pg_depend d ON d.refclassid='pg_proc'::regclass AND d.refobjid=p.oid
  JOIN pg_policy policy ON d.classid='pg_policy'::regclass AND d.objid=policy.oid
  WHERE n.nspname='billing_private'
 LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature); END LOOP;
END $$;

COMMIT;
