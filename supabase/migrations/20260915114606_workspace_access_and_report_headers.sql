-- Shared workspaces, database-backed access profiles and reusable report headers.
-- Existing billing_* owner_id values remain the stable workspace identifier.

CREATE TABLE public.billing_access_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 100),
 name_key text GENERATED ALWAYS AS (billing_private.name_key(name)) STORED,
 description text NOT NULL DEFAULT '' CHECK(length(description)<=500),
 permissions text[] NOT NULL DEFAULT '{}',
 is_system boolean NOT NULL DEFAULT false,
 UNIQUE(owner_id,id), UNIQUE(owner_id,name_key),
 CHECK(cardinality(permissions)<=13 AND permissions <@ ARRAY[
  'companies.read','companies.write','registrations.read','registrations.write',
  'contracts.read','contracts.write','settings.write','watermarks.read','watermarks.write',
  'users.manage','access-profiles.manage','report-headers.read','report-headers.write'
 ]::text[])
);

CREATE TABLE public.billing_memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 access_profile_id uuid,
 is_owner boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id), UNIQUE(owner_id,user_id), UNIQUE(user_id),
 FOREIGN KEY(owner_id,access_profile_id) REFERENCES public.billing_access_profiles(owner_id,id),
 CHECK((is_owner AND owner_id=user_id AND access_profile_id IS NULL) OR
       (NOT is_owner AND access_profile_id IS NOT NULL))
);

CREATE TABLE public.billing_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 email text NOT NULL CHECK(length(email) BETWEEN 3 AND 254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
 email_key text GENERATED ALWAYS AS (lower(btrim(email))) STORED,
 access_profile_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','cancelled')),
 invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '7 days'),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id),
 FOREIGN KEY(owner_id,access_profile_id) REFERENCES public.billing_access_profiles(owner_id,id)
);
CREATE UNIQUE INDEX billing_invitations_pending_email ON public.billing_invitations(email_key) WHERE status='pending';

CREATE TABLE public.billing_user_settings (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 150),
 compact boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(owner_id,user_id) REFERENCES public.billing_memberships(owner_id,user_id) ON DELETE CASCADE
);

CREATE TABLE public.billing_report_headers (
 owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 orientation text NOT NULL DEFAULT 'portrait' CHECK(orientation IN ('portrait','landscape')),
 default_company_id uuid,
 portrait_variant text NOT NULL DEFAULT 'detailed' CHECK(portrait_variant IN ('compact','detailed')),
 portrait_logo_alignment text NOT NULL DEFAULT 'left' CHECK(portrait_logo_alignment IN ('left','center','right')),
 portrait_show_cnpj boolean NOT NULL DEFAULT true,
 portrait_show_contact boolean NOT NULL DEFAULT true,
 landscape_variant text NOT NULL DEFAULT 'compact' CHECK(landscape_variant IN ('compact','detailed')),
 landscape_logo_alignment text NOT NULL DEFAULT 'left' CHECK(landscape_logo_alignment IN ('left','center','right')),
 landscape_show_cnpj boolean NOT NULL DEFAULT true,
 landscape_show_contact boolean NOT NULL DEFAULT true,
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(owner_id,default_company_id) REFERENCES public.billing_companies(owner_id,id)
);

CREATE INDEX billing_memberships_owner ON public.billing_memberships(owner_id,status,user_id);
CREATE INDEX billing_memberships_profile ON public.billing_memberships(owner_id,access_profile_id);
CREATE INDEX billing_invitations_owner ON public.billing_invitations(owner_id,status,created_at DESC);

CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_access_profiles
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_memberships
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_invitations
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_user_settings
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_report_headers
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();

CREATE FUNCTION billing_private.clear_report_default_company() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.billing_report_headers SET default_company_id=NULL
  WHERE owner_id=OLD.owner_id AND default_company_id=OLD.id;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION billing_private.clear_report_default_company() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER billing_clear_report_default_company BEFORE DELETE ON public.billing_companies
 FOR EACH ROW EXECUTE FUNCTION billing_private.clear_report_default_company();

-- Every account that predates this migration keeps its own existing workspace.
INSERT INTO public.billing_access_profiles(owner_id,name,description,permissions,is_system)
SELECT id,'Administrador','Acesso completo ao espaço de trabalho',ARRAY[
 'companies.read','companies.write','registrations.read','registrations.write',
 'contracts.read','contracts.write','settings.write','watermarks.read','watermarks.write',
 'users.manage','access-profiles.manage','report-headers.read','report-headers.write'
]::text[],true FROM auth.users;
INSERT INTO public.billing_access_profiles(owner_id,name,description,permissions,is_system)
SELECT id,'Somente leitura','Consulta dados e usa os padrões de relatório',ARRAY[
 'companies.read','registrations.read','contracts.read','watermarks.read','report-headers.read'
]::text[],true FROM auth.users;
INSERT INTO public.billing_memberships(owner_id,user_id,is_owner,status)
 SELECT id,id,true,'active' FROM auth.users;
INSERT INTO public.billing_user_settings(user_id,owner_id,name,compact)
SELECT u.id,u.id,
 left(coalesce(nullif(btrim(p.name),''),nullif(btrim(u.raw_user_meta_data->>'display_name'),''),nullif(u.email,''),'Minha conta'),150),
 coalesce(p.compact,false)
FROM auth.users u LEFT JOIN public.billing_profiles p ON p.owner_id=u.id;

CREATE FUNCTION billing_private.create_workspace_defaults(p_owner uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.billing_access_profiles(owner_id,name,description,permissions,is_system) VALUES
 (p_owner,'Administrador','Acesso completo ao espaço de trabalho',ARRAY[
  'companies.read','companies.write','registrations.read','registrations.write',
  'contracts.read','contracts.write','settings.write','watermarks.read','watermarks.write',
  'users.manage','access-profiles.manage','report-headers.read','report-headers.write'
 ]::text[],true),
 (p_owner,'Somente leitura','Consulta dados e usa os padrões de relatório',ARRAY[
  'companies.read','registrations.read','contracts.read','watermarks.read','report-headers.read'
 ]::text[],true)
 ON CONFLICT(owner_id,name_key) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION billing_private.create_workspace_defaults(uuid) FROM PUBLIC,anon,authenticated;

-- Called once at the beginning of the public RPC. A matching pending invitation
-- wins over self-provisioning and is accepted atomically for the authenticated e-mail.
CREATE FUNCTION billing_private.ensure_actor_workspace() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();v_owner uuid;v_email text;v_invitation public.billing_invitations%ROWTYPE;v_name text;v_confirmed boolean;
BEGIN
 IF v_actor IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=v_actor) THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('billing-actor:'||v_actor::text,0));
 SELECT owner_id INTO v_owner FROM public.billing_memberships WHERE user_id=v_actor AND status='active';
 IF FOUND THEN RETURN v_owner; END IF;
 IF EXISTS(SELECT 1 FROM public.billing_memberships WHERE user_id=v_actor AND status='disabled') THEN
  RAISE EXCEPTION 'Seu acesso a este espaço está desativado.' USING ERRCODE='42501';
 END IF;
 SELECT lower(btrim(email)),coalesce(nullif(btrim(raw_user_meta_data->>'display_name'),''),nullif(email,''),'Minha conta'),email_confirmed_at IS NOT NULL
  INTO v_email,v_name,v_confirmed FROM auth.users WHERE id=v_actor;
 PERFORM pg_advisory_xact_lock(hashtextextended('billing-invite:'||v_email,0));
 SELECT * INTO v_invitation FROM public.billing_invitations
  WHERE email_key=v_email AND status='pending' AND expires_at>clock_timestamp()
  ORDER BY created_at LIMIT 1 FOR UPDATE;
 IF FOUND THEN
  IF NOT v_confirmed THEN
   RAISE EXCEPTION 'Confirme seu e-mail antes de aceitar o convite.' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,is_owner,status)
   VALUES(v_invitation.owner_id,v_actor,v_invitation.access_profile_id,false,'active');
  UPDATE public.billing_invitations SET status='accepted',accepted_by=v_actor
   WHERE id=v_invitation.id;
  v_owner=v_invitation.owner_id;
 ELSE
  UPDATE public.billing_invitations SET status='cancelled'
   WHERE email_key=v_email AND status='pending' AND expires_at<=clock_timestamp();
  PERFORM billing_private.create_workspace_defaults(v_actor);
  INSERT INTO public.billing_memberships(owner_id,user_id,is_owner,status)
   VALUES(v_actor,v_actor,true,'active');
  v_owner=v_actor;
 END IF;
 INSERT INTO public.billing_user_settings(user_id,owner_id,name,compact)
  VALUES(v_actor,v_owner,left(v_name,150),false)
  ON CONFLICT(user_id) DO NOTHING;
 RETURN v_owner;
END $$;
REVOKE ALL ON FUNCTION billing_private.ensure_actor_workspace() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.ensure_actor_workspace() TO authenticated;

CREATE FUNCTION billing_private.current_owner_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT owner_id FROM public.billing_memberships
 WHERE user_id=auth.uid() AND status='active'
$$;
REVOKE ALL ON FUNCTION billing_private.current_owner_id() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.has_permission(p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(bool_or(m.is_owner OR p_permission=ANY(ap.permissions)),false)
 FROM public.billing_memberships m
 LEFT JOIN public.billing_access_profiles ap
  ON ap.owner_id=m.owner_id AND ap.id=m.access_profile_id
 WHERE m.user_id=auth.uid() AND m.status='active'
$$;
REVOKE ALL ON FUNCTION billing_private.has_permission(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.authorize(p_permission text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT billing_private.has_permission(p_permission) THEN
  RAISE EXCEPTION 'Você não tem permissão para realizar esta operação.' USING ERRCODE='42501';
 END IF;
END $$;
REVOKE ALL ON FUNCTION billing_private.authorize(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.can_access_owner(p_owner uuid,p_permission text DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.billing_memberships m
  LEFT JOIN public.billing_access_profiles ap ON ap.owner_id=m.owner_id AND ap.id=m.access_profile_id
  WHERE m.owner_id=p_owner AND m.user_id=auth.uid() AND m.status='active'
   AND (p_permission IS NULL OR m.is_owner OR p_permission=ANY(ap.permissions))
 )
$$;
REVOKE ALL ON FUNCTION billing_private.can_access_owner(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.can_access_owner(uuid,text) TO authenticated;

CREATE FUNCTION billing_private.can_access_storage_owner(p_owner text,p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN p_owner ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
  THEN billing_private.can_access_owner(p_owner::uuid,p_permission) ELSE false END
$$;
REVOKE ALL ON FUNCTION billing_private.can_access_storage_owner(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.can_access_storage_owner(text,text) TO authenticated;

CREATE FUNCTION billing_private.authorize_resource(p_resource text,p_action text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_permission text;
BEGIN
 v_permission=CASE
  WHEN p_resource='companies' THEN 'companies.'||CASE WHEN p_action IN ('get','list') THEN 'read' ELSE 'write' END
  WHEN p_resource IN ('clients','atr','farms','plots','contract-types','cultures','cultural-practices') THEN 'registrations.'||CASE WHEN p_action IN ('get','list') THEN 'read' ELSE 'write' END
  WHEN p_resource='contracts' THEN 'contracts.'||CASE WHEN p_action IN ('get','list') THEN 'read' ELSE 'write' END
  WHEN p_resource IN ('watermark','watermarks') THEN 'watermarks.'||CASE WHEN p_action IN ('get','list') THEN 'read' ELSE 'write' END
  ELSE NULL END;
 IF v_permission IS NOT NULL THEN PERFORM billing_private.authorize(v_permission); END IF;
END $$;
REVOKE ALL ON FUNCTION billing_private.authorize_resource(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.authorize_resource(text,text) TO authenticated;

CREATE FUNCTION billing_private.workspace_settings(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();v_owner uuid:=billing_private.current_owner_id();v_email text;v_name text;v_compact boolean;v_company text;
BEGIN
 IF p_action NOT IN ('get','list','save') OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
  RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023';
 END IF;
 SELECT email,coalesce(nullif(btrim(raw_user_meta_data->>'display_name'),''),nullif(email,''),'Minha conta')
  INTO v_email,v_name FROM auth.users WHERE id=v_actor;
 IF p_action='save' THEN
  IF jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string' OR
     jsonb_typeof(p_payload->'company') IS DISTINCT FROM 'string' OR
     jsonb_typeof(p_payload->'compact') IS DISTINCT FROM 'boolean' OR
     length(btrim(p_payload->>'name')) NOT BETWEEN 1 AND 150 OR
     length(btrim(p_payload->>'company')) NOT BETWEEN 1 AND 200 THEN
   RAISE EXCEPTION 'Preencha seu nome e o nome do espaço.' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.billing_user_settings(user_id,owner_id,name,compact)
   VALUES(v_actor,v_owner,btrim(p_payload->>'name'),(p_payload->>'compact')::boolean)
   ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,compact=excluded.compact;
  SELECT company INTO v_company FROM public.billing_profiles WHERE owner_id=v_owner;
  IF btrim(p_payload->>'company') IS DISTINCT FROM coalesce(v_company,'Meu espaço de trabalho') THEN
   IF v_actor<>v_owner THEN RAISE EXCEPTION 'Somente o proprietário pode renomear o espaço.' USING ERRCODE='42501'; END IF;
   INSERT INTO public.billing_profiles(owner_id,name,company,compact)
    VALUES(v_owner,CASE WHEN v_actor=v_owner THEN btrim(p_payload->>'name') ELSE left(v_name,150) END,btrim(p_payload->>'company'),false)
    ON CONFLICT(owner_id) DO UPDATE SET company=excluded.company;
  END IF;
 END IF;
 SELECT s.name,s.compact INTO v_name,v_compact FROM public.billing_user_settings s WHERE s.user_id=v_actor;
 SELECT company INTO v_company FROM public.billing_profiles WHERE owner_id=v_owner;
 RETURN jsonb_build_object('profile',jsonb_build_object(
  'id',v_actor,'name',coalesce(v_name,'Minha conta'),'company',coalesce(v_company,'Meu espaço de trabalho'),
  'email',coalesce(v_email,''),'compact',coalesce(v_compact,false),'workspaceId',v_owner,
  'role',CASE WHEN v_actor=v_owner THEN 'owner' ELSE 'member' END),
  'settings',jsonb_build_object(
  'id',v_actor,'name',coalesce(v_name,'Minha conta'),'company',coalesce(v_company,'Meu espaço de trabalho'),
  'email',coalesce(v_email,''),'compact',coalesce(v_compact,false),'workspaceId',v_owner,
  'role',CASE WHEN v_actor=v_owner THEN 'owner' ELSE 'member' END));
END $$;
REVOKE ALL ON FUNCTION billing_private.workspace_settings(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.workspace_settings(text,jsonb) TO authenticated;

CREATE FUNCTION billing_private.present_member(p_membership public.billing_memberships) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_email text;v_name text;v_profile_name text;
BEGIN
 SELECT u.email,coalesce(s.name,nullif(btrim(u.raw_user_meta_data->>'display_name'),''),u.email,'Minha conta')
  INTO v_email,v_name FROM auth.users u LEFT JOIN public.billing_user_settings s ON s.user_id=u.id WHERE u.id=p_membership.user_id;
 SELECT name INTO v_profile_name FROM public.billing_access_profiles WHERE owner_id=p_membership.owner_id AND id=p_membership.access_profile_id;
 RETURN jsonb_build_object('id',p_membership.id,'name',v_name,'email',coalesce(v_email,''),'status',p_membership.status,
  'accessProfileId',p_membership.access_profile_id,'accessProfileName',coalesce(v_profile_name,''),
  'isOwner',p_membership.is_owner,'updatedAt',p_membership.updated_at);
END $$;
REVOKE ALL ON FUNCTION billing_private.present_member(public.billing_memberships) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.users_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();v_owner uuid:=billing_private.current_owner_id();v_id uuid;v_profile uuid;v_email text;v_auth_user uuid;v_member public.billing_memberships%ROWTYPE;v_invitation public.billing_invitations%ROWTYPE;v_result jsonb;v_target_permissions text[];v_actor_permissions text[];v_actor_is_owner boolean;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_action NOT IN ('list','invite','update','disable','enable') THEN
  RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023';
 END IF;
 PERFORM billing_private.authorize('users.manage');
 IF p_action='list' THEN
  SELECT coalesce(jsonb_agg(item ORDER BY sort_owner DESC,sort_name),'[]') INTO v_result FROM (
   SELECT billing_private.present_member(m) item,m.is_owner sort_owner,lower(coalesce(s.name,u.email,'')) sort_name
    FROM public.billing_memberships m JOIN auth.users u ON u.id=m.user_id
    LEFT JOIN public.billing_user_settings s ON s.user_id=m.user_id WHERE m.owner_id=v_owner
   UNION ALL
   SELECT jsonb_build_object('id',i.id,'name','','email',i.email,'status','pending','accessProfileId',i.access_profile_id,
     'accessProfileName',p.name,'isOwner',false,'updatedAt',i.updated_at),false,lower(i.email)
    FROM public.billing_invitations i JOIN public.billing_access_profiles p ON p.owner_id=i.owner_id AND p.id=i.access_profile_id
    WHERE i.owner_id=v_owner AND i.status='pending' AND i.expires_at>clock_timestamp()
  ) q;
  RETURN jsonb_build_object('users',v_result);
 END IF;
 v_profile=nullif(p_payload->>'accessProfileId','')::uuid;
 IF p_action IN ('invite','update') THEN
  SELECT permissions INTO v_target_permissions FROM public.billing_access_profiles WHERE owner_id=v_owner AND id=v_profile;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecione um perfil de acesso válido.' USING ERRCODE='22023'; END IF;
  SELECT m.is_owner,coalesce(p.permissions,'{}') INTO v_actor_is_owner,v_actor_permissions
   FROM public.billing_memberships m LEFT JOIN public.billing_access_profiles p ON p.owner_id=m.owner_id AND p.id=m.access_profile_id
   WHERE m.owner_id=v_owner AND m.user_id=v_actor AND m.status='active';
  IF NOT v_actor_is_owner AND NOT(v_target_permissions <@ v_actor_permissions) THEN
   RAISE EXCEPTION 'Você não pode conceder permissões que não possui.' USING ERRCODE='42501';
  END IF;
 END IF;
 IF p_action='invite' THEN
  IF jsonb_typeof(p_payload->'email') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Informe um e-mail válido.' USING ERRCODE='22023'; END IF;
  v_email=lower(btrim(p_payload->>'email'));
  IF length(v_email) NOT BETWEEN 3 AND 254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN RAISE EXCEPTION 'Informe um e-mail válido.' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('billing-invite:'||v_email,0));
  SELECT id INTO v_auth_user FROM auth.users WHERE lower(btrim(email))=v_email;
  IF v_auth_user IS NOT NULL AND EXISTS(SELECT 1 FROM public.billing_memberships WHERE user_id=v_auth_user) THEN
   RAISE EXCEPTION 'Este usuário já pertence a um espaço de trabalho.' USING ERRCODE='23505';
  END IF;
  UPDATE public.billing_invitations SET status='cancelled'
   WHERE email_key=v_email AND status='pending' AND expires_at<=clock_timestamp();
  INSERT INTO public.billing_invitations(owner_id,email,access_profile_id,invited_by)
   VALUES(v_owner,v_email,v_profile,v_actor) RETURNING id INTO v_id;
  RETURN jsonb_build_object('user',jsonb_build_object('id',v_id,'name','','email',v_email,'status','pending',
   'accessProfileId',v_profile,'accessProfileName',(SELECT name FROM public.billing_access_profiles WHERE owner_id=v_owner AND id=v_profile),
   'isOwner',false,'updatedAt',clock_timestamp()));
 END IF;
 v_id=nullif(p_payload->>'id','')::uuid;
 IF v_id IS NULL THEN RAISE EXCEPTION 'Informe o usuário.' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_member FROM public.billing_memberships WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
 IF FOUND THEN
  IF v_member.is_owner OR v_member.user_id=v_actor THEN RAISE EXCEPTION 'O proprietário e o próprio acesso não podem ser alterados por esta operação.' USING ERRCODE='42501'; END IF;
  IF p_action='update' THEN UPDATE public.billing_memberships SET access_profile_id=v_profile WHERE id=v_id RETURNING * INTO v_member;
  ELSIF p_action='disable' THEN UPDATE public.billing_memberships SET status='disabled' WHERE id=v_id RETURNING * INTO v_member;
  ELSIF p_action='enable' THEN UPDATE public.billing_memberships SET status='active' WHERE id=v_id RETURNING * INTO v_member;
  ELSE RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('user',billing_private.present_member(v_member));
 END IF;
 IF p_action NOT IN ('update','disable') THEN RAISE EXCEPTION 'Usuário não encontrado.' USING ERRCODE='P0002'; END IF;
 IF p_action='update' THEN
  UPDATE public.billing_invitations SET access_profile_id=v_profile WHERE owner_id=v_owner AND id=v_id AND status='pending' RETURNING * INTO v_invitation;
 ELSE
  UPDATE public.billing_invitations SET status='cancelled' WHERE owner_id=v_owner AND id=v_id AND status='pending' RETURNING * INTO v_invitation;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Usuário não encontrado.' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('user',jsonb_build_object(
  'id',v_invitation.id,'name','','email',v_invitation.email,
  'status',CASE WHEN p_action='update' THEN 'pending' ELSE 'disabled' END,
  'accessProfileId',v_invitation.access_profile_id,
  'accessProfileName',(SELECT name FROM public.billing_access_profiles WHERE owner_id=v_owner AND id=v_invitation.access_profile_id),
  'isOwner',false,'updatedAt',v_invitation.updated_at));
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Já existe um convite ou usuário para este e-mail.' USING ERRCODE='23505';
END $$;
REVOKE ALL ON FUNCTION billing_private.users_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.users_dispatch(text,jsonb) TO authenticated;

CREATE FUNCTION billing_private.access_profiles_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();v_actor uuid:=auth.uid();v_id uuid;v_name text;v_description text;v_permissions text[];v_existing_permissions text[];v_actor_permissions text[];v_is_owner boolean;v_is_system boolean;v_row jsonb;v_count integer;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_action NOT IN ('list','get','save','delete') THEN RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023'; END IF;
 IF p_action IN ('list','get') THEN
  IF NOT billing_private.has_permission('access-profiles.manage') AND NOT billing_private.has_permission('users.manage') THEN
   RAISE EXCEPTION 'Você não tem permissão para realizar esta operação.' USING ERRCODE='42501';
  END IF;
 ELSE
  PERFORM billing_private.authorize('access-profiles.manage');
 END IF;
 SELECT m.is_owner,coalesce(p.permissions,'{}') INTO v_is_owner,v_actor_permissions
  FROM public.billing_memberships m LEFT JOIN public.billing_access_profiles p ON p.owner_id=m.owner_id AND p.id=m.access_profile_id
  WHERE m.owner_id=v_owner AND m.user_id=v_actor AND m.status='active';
 IF p_action='list' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'permissions',p.permissions,
   'isSystem',p.is_system,'userCount',(SELECT count(*) FROM public.billing_memberships m WHERE m.owner_id=p.owner_id AND m.access_profile_id=p.id)+
    (SELECT count(*) FROM public.billing_invitations i WHERE i.owner_id=p.owner_id AND i.access_profile_id=p.id AND i.status='pending'),
   'updatedAt',p.updated_at) ORDER BY p.is_system DESC,lower(p.name),p.id),'[]') INTO v_row
  FROM public.billing_access_profiles p WHERE p.owner_id=v_owner;
  RETURN jsonb_build_object('profiles',v_row);
 END IF;
 v_id=nullif(p_payload->>'id','')::uuid;
 IF p_action='get' THEN
  SELECT jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'permissions',p.permissions,'isSystem',p.is_system,
   'userCount',(SELECT count(*) FROM public.billing_memberships m WHERE m.owner_id=p.owner_id AND m.access_profile_id=p.id)+
    (SELECT count(*) FROM public.billing_invitations i WHERE i.owner_id=p.owner_id AND i.access_profile_id=p.id AND i.status='pending'),'updatedAt',p.updated_at)
   INTO v_row FROM public.billing_access_profiles p WHERE p.owner_id=v_owner AND p.id=v_id;
  IF v_row IS NULL THEN RAISE EXCEPTION 'Perfil de acesso não encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('profile',v_row);
 END IF;
 IF p_action='delete' THEN
  SELECT is_system,permissions INTO v_is_system,v_existing_permissions FROM public.billing_access_profiles WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Perfil de acesso não encontrado.' USING ERRCODE='P0002'; END IF;
  IF v_is_system THEN RAISE EXCEPTION 'Perfis padrão não podem ser excluídos.' USING ERRCODE='23514'; END IF;
  IF NOT v_is_owner AND NOT(v_existing_permissions <@ v_actor_permissions) THEN RAISE EXCEPTION 'Você não pode excluir um perfil com permissões que não possui.' USING ERRCODE='42501'; END IF;
  SELECT
   (SELECT count(*) FROM public.billing_memberships WHERE owner_id=v_owner AND access_profile_id=v_id)+
   (SELECT count(*) FROM public.billing_invitations WHERE owner_id=v_owner AND access_profile_id=v_id AND status='pending')
   INTO v_count;
  IF v_count>0 THEN RAISE EXCEPTION 'Este perfil está vinculado a usuários.' USING ERRCODE='23514'; END IF;
  DELETE FROM public.billing_invitations WHERE owner_id=v_owner AND access_profile_id=v_id AND status<>'pending';
  DELETE FROM public.billing_access_profiles WHERE owner_id=v_owner AND id=v_id;
  RETURN jsonb_build_object('id',v_id,'deleted',true);
 END IF;
 IF jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'description') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'permissions') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Confira os dados do perfil de acesso.' USING ERRCODE='22023';
 END IF;
 v_name=btrim(p_payload->>'name');v_description=btrim(p_payload->>'description');
 SELECT coalesce(array_agg(value ORDER BY value),'{}') INTO v_permissions FROM jsonb_array_elements_text(p_payload->'permissions');
 IF length(v_name) NOT BETWEEN 2 AND 100 OR length(v_description)>500 OR cardinality(v_permissions)>13 OR NOT(v_permissions <@ ARRAY[
  'companies.read','companies.write','registrations.read','registrations.write','contracts.read','contracts.write','settings.write',
  'watermarks.read','watermarks.write','users.manage','access-profiles.manage','report-headers.read','report-headers.write']::text[]) THEN
  RAISE EXCEPTION 'Confira os dados e permissões do perfil de acesso.' USING ERRCODE='22023';
 END IF;
 IF cardinality(v_permissions)<>(SELECT count(DISTINCT value) FROM unnest(v_permissions) value) THEN RAISE EXCEPTION 'Permissões duplicadas.' USING ERRCODE='22023'; END IF;
 IF ('companies.write'=ANY(v_permissions) AND NOT ('companies.read'=ANY(v_permissions))) OR
    ('registrations.write'=ANY(v_permissions) AND NOT ('registrations.read'=ANY(v_permissions))) OR
    ('contracts.write'=ANY(v_permissions) AND NOT ('contracts.read'=ANY(v_permissions))) OR
    ('watermarks.write'=ANY(v_permissions) AND NOT ('watermarks.read'=ANY(v_permissions))) OR
    ('report-headers.write'=ANY(v_permissions) AND NOT ('report-headers.read'=ANY(v_permissions))) OR
    ('report-headers.read'=ANY(v_permissions) AND (NOT ('companies.read'=ANY(v_permissions)) OR NOT ('watermarks.read'=ANY(v_permissions)))) THEN
  RAISE EXCEPTION 'Inclua também as permissões de consulta necessárias.' USING ERRCODE='22023';
 END IF;
 IF NOT v_is_owner AND NOT(v_permissions <@ v_actor_permissions) THEN RAISE EXCEPTION 'Você não pode conceder permissões que não possui.' USING ERRCODE='42501'; END IF;
 IF v_id IS NULL THEN
  INSERT INTO public.billing_access_profiles(owner_id,name,description,permissions) VALUES(v_owner,v_name,v_description,v_permissions) RETURNING id INTO v_id;
 ELSE
  SELECT is_system,permissions INTO v_is_system,v_existing_permissions FROM public.billing_access_profiles WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Perfil de acesso não encontrado.' USING ERRCODE='P0002'; END IF;
  IF v_is_system THEN RAISE EXCEPTION 'Perfis padrão não podem ser alterados.' USING ERRCODE='23514'; END IF;
  IF NOT v_is_owner AND NOT(v_existing_permissions <@ v_actor_permissions) THEN RAISE EXCEPTION 'Você não pode alterar um perfil com permissões que não possui.' USING ERRCODE='42501'; END IF;
  UPDATE public.billing_access_profiles SET name=v_name,description=v_description,permissions=v_permissions WHERE owner_id=v_owner AND id=v_id;
 END IF;
 SELECT jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'permissions',p.permissions,'isSystem',p.is_system,
  'userCount',(SELECT count(*) FROM public.billing_memberships m WHERE m.owner_id=p.owner_id AND m.access_profile_id=p.id)+
   (SELECT count(*) FROM public.billing_invitations i WHERE i.owner_id=p.owner_id AND i.access_profile_id=p.id AND i.status='pending'),'updatedAt',p.updated_at)
  INTO v_row FROM public.billing_access_profiles p WHERE p.owner_id=v_owner AND p.id=v_id;
 RETURN jsonb_build_object('profile',v_row);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Já existe um perfil de acesso com este nome.' USING ERRCODE='23505';
END $$;
REVOKE ALL ON FUNCTION billing_private.access_profiles_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.access_profiles_dispatch(text,jsonb) TO authenticated;

CREATE FUNCTION billing_private.report_headers_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();v_actor uuid:=auth.uid();v_company uuid;v_row public.billing_report_headers%ROWTYPE;v_orientation text;v_p jsonb;v_l jsonb;
BEGIN
 IF p_action IN ('get','list') THEN PERFORM billing_private.authorize('report-headers.read');
 ELSIF p_action='save' THEN PERFORM billing_private.authorize('report-headers.write');
 ELSE RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Dados inválidos.' USING ERRCODE='22023'; END IF;
 IF p_action='save' THEN
  v_orientation=p_payload->>'orientation';v_company=nullif(p_payload->>'defaultCompanyId','')::uuid;v_p=p_payload->'portrait';v_l=p_payload->'landscape';
  IF v_orientation NOT IN ('portrait','landscape') OR jsonb_typeof(v_p)<>'object' OR jsonb_typeof(v_l)<>'object' OR
   v_p->>'variant' NOT IN ('compact','detailed') OR v_l->>'variant' NOT IN ('compact','detailed') OR
   v_p->>'logoAlignment' NOT IN ('left','center','right') OR v_l->>'logoAlignment' NOT IN ('left','center','right') OR
   jsonb_typeof(v_p->'showCnpj') IS DISTINCT FROM 'boolean' OR jsonb_typeof(v_p->'showContact') IS DISTINCT FROM 'boolean' OR
   jsonb_typeof(v_l->'showCnpj') IS DISTINCT FROM 'boolean' OR jsonb_typeof(v_l->'showContact') IS DISTINCT FROM 'boolean' THEN
   RAISE EXCEPTION 'Confira as configurações de retrato e paisagem.' USING ERRCODE='22023';
  END IF;
  IF v_company IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.billing_companies WHERE owner_id=v_owner AND id=v_company) THEN
   RAISE EXCEPTION 'Selecione uma empresa deste espaço de trabalho.' USING ERRCODE='23503';
  END IF;
  INSERT INTO public.billing_report_headers(owner_id,orientation,default_company_id,
   portrait_variant,portrait_logo_alignment,portrait_show_cnpj,portrait_show_contact,
   landscape_variant,landscape_logo_alignment,landscape_show_cnpj,landscape_show_contact,updated_by)
  VALUES(v_owner,v_orientation,v_company,v_p->>'variant',v_p->>'logoAlignment',(v_p->>'showCnpj')::boolean,(v_p->>'showContact')::boolean,
   v_l->>'variant',v_l->>'logoAlignment',(v_l->>'showCnpj')::boolean,(v_l->>'showContact')::boolean,v_actor)
  ON CONFLICT(owner_id) DO UPDATE SET orientation=excluded.orientation,default_company_id=excluded.default_company_id,
   portrait_variant=excluded.portrait_variant,portrait_logo_alignment=excluded.portrait_logo_alignment,
   portrait_show_cnpj=excluded.portrait_show_cnpj,portrait_show_contact=excluded.portrait_show_contact,
   landscape_variant=excluded.landscape_variant,landscape_logo_alignment=excluded.landscape_logo_alignment,
   landscape_show_cnpj=excluded.landscape_show_cnpj,landscape_show_contact=excluded.landscape_show_contact,updated_by=excluded.updated_by;
 END IF;
 SELECT * INTO v_row FROM public.billing_report_headers WHERE owner_id=v_owner;
 RETURN jsonb_build_object('settings',jsonb_build_object(
  'orientation',coalesce(v_row.orientation,'portrait'),'defaultCompanyId',v_row.default_company_id,
  'portrait',jsonb_build_object('variant',coalesce(v_row.portrait_variant,'detailed'),'logoAlignment',coalesce(v_row.portrait_logo_alignment,'left'),'showCnpj',coalesce(v_row.portrait_show_cnpj,true),'showContact',coalesce(v_row.portrait_show_contact,true)),
  'landscape',jsonb_build_object('variant',coalesce(v_row.landscape_variant,'compact'),'logoAlignment',coalesce(v_row.landscape_logo_alignment,'left'),'showCnpj',coalesce(v_row.landscape_show_cnpj,true),'showContact',coalesce(v_row.landscape_show_contact,true)),
  'updatedAt',v_row.updated_at));
EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Selecione uma empresa válida.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.report_headers_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.report_headers_dispatch(text,jsonb) TO authenticated;

-- Retarget the already-reviewed legacy implementations from the authenticated
-- actor to the membership-derived workspace owner without duplicating them.
DO $patch$
DECLARE v_signature text;v_definition text;
BEGIN
 FOREACH v_signature IN ARRAY ARRAY[
  'billing_private.dispatch(text,text,jsonb)',
  'billing_private.save_company(jsonb)',
  'billing_private.watermark_variants(text,jsonb)'
 ] LOOP
  SELECT pg_get_functiondef(v_signature::regprocedure) INTO v_definition;
  IF length(v_definition)-length(replace(v_definition,'v_owner uuid := auth.uid();',''))<>length('v_owner uuid := auth.uid();') THEN
   RAISE EXCEPTION 'Unexpected owner declaration while patching %',v_signature;
  END IF;
  v_definition=replace(v_definition,'v_owner uuid := auth.uid();','v_owner uuid := billing_private.current_owner_id();');
  EXECUTE v_definition;
 END LOOP;
END $patch$;

ALTER TABLE public.billing_access_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_report_headers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_access_profiles,public.billing_memberships,public.billing_invitations,public.billing_user_settings,public.billing_report_headers FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_access_profiles,public.billing_memberships,public.billing_invitations,public.billing_user_settings,public.billing_report_headers TO authenticated;
CREATE POLICY billing_access_profiles_read ON public.billing_access_profiles FOR SELECT TO authenticated
 USING(
  billing_private.can_access_owner(owner_id,'access-profiles.manage') OR
  billing_private.can_access_owner(owner_id,'users.manage') OR
  EXISTS(SELECT 1 FROM public.billing_memberships m
   WHERE m.owner_id=billing_access_profiles.owner_id AND m.user_id=(SELECT auth.uid())
    AND m.status='active' AND m.access_profile_id=billing_access_profiles.id)
 );
CREATE POLICY billing_memberships_read ON public.billing_memberships FOR SELECT TO authenticated
 USING(user_id=(SELECT auth.uid()) OR billing_private.can_access_owner(owner_id,'users.manage'));
CREATE POLICY billing_invitations_read ON public.billing_invitations FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'users.manage'));
CREATE POLICY billing_user_settings_read ON public.billing_user_settings FOR SELECT TO authenticated
 USING(user_id=(SELECT auth.uid()) OR billing_private.can_access_owner(owner_id,'users.manage'));
CREATE POLICY billing_report_headers_read ON public.billing_report_headers FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'report-headers.read'));

-- Realtime SELECT follows workspace membership and the same read permission used by RPC.
DO $policies$
DECLARE item text[];v_table text;v_permission text;
BEGIN
 FOREACH item SLICE 1 IN ARRAY ARRAY[
  ARRAY['billing_companies','companies.read'],
  ARRAY['billing_clients','registrations.read'],ARRAY['billing_atr_records','registrations.read'],
  ARRAY['billing_farms','registrations.read'],ARRAY['billing_farm_plots','registrations.read'],
  ARRAY['billing_contract_types','registrations.read'],ARRAY['billing_cultures','registrations.read'],
  ARRAY['billing_culture_subtypes','registrations.read'],ARRAY['billing_cultural_practices','registrations.read'],
  ARRAY['billing_contracts','contracts.read'],ARRAY['billing_watermarks','watermarks.read']
 ] LOOP
  v_table=item[1];v_permission=item[2];
  EXECUTE format('DROP POLICY IF EXISTS billing_owner_read ON public.%I',v_table);
  EXECUTE format('CREATE POLICY billing_owner_read ON public.%I FOR SELECT TO authenticated USING (billing_private.can_access_owner(owner_id,%L))',v_table,v_permission);
 END LOOP;
 DROP POLICY IF EXISTS billing_owner_read ON public.billing_profiles;
 CREATE POLICY billing_owner_read ON public.billing_profiles FOR SELECT TO authenticated
  USING(billing_private.can_access_owner(owner_id,NULL));
END $policies$;

DROP POLICY IF EXISTS billing_company_logos_read ON storage.objects;
DROP POLICY IF EXISTS billing_company_logos_insert ON storage.objects;
DROP POLICY IF EXISTS billing_company_logos_update ON storage.objects;
DROP POLICY IF EXISTS billing_company_logos_delete ON storage.objects;
CREATE POLICY billing_company_logos_read ON storage.objects FOR SELECT TO authenticated USING(
 bucket_id='billing-company-logos' AND (
  billing_private.can_access_storage_owner((storage.foldername(name))[1],'companies.read') OR
  billing_private.can_access_storage_owner((storage.foldername(name))[1],'report-headers.read')));
CREATE POLICY billing_company_logos_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(
 bucket_id='billing-company-logos' AND billing_private.can_access_storage_owner((storage.foldername(name))[1],'companies.write'));
CREATE POLICY billing_company_logos_update ON storage.objects FOR UPDATE TO authenticated USING(
 bucket_id='billing-company-logos' AND billing_private.can_access_storage_owner((storage.foldername(name))[1],'companies.write')) WITH CHECK(
 bucket_id='billing-company-logos' AND billing_private.can_access_storage_owner((storage.foldername(name))[1],'companies.write'));
CREATE POLICY billing_company_logos_delete ON storage.objects FOR DELETE TO authenticated USING(
 bucket_id='billing-company-logos' AND billing_private.can_access_storage_owner((storage.foldername(name))[1],'companies.write'));

DROP POLICY IF EXISTS billing_watermarks_read ON storage.objects;
DROP POLICY IF EXISTS billing_watermarks_insert ON storage.objects;
DROP POLICY IF EXISTS billing_watermarks_update ON storage.objects;
DROP POLICY IF EXISTS billing_watermarks_delete ON storage.objects;
CREATE POLICY billing_watermarks_read ON storage.objects FOR SELECT TO authenticated USING(
 bucket_id='billing-watermarks' AND (billing_private.can_access_storage_owner((storage.foldername(name))[1],'watermarks.read') OR
 billing_private.can_access_storage_owner((storage.foldername(name))[1],'report-headers.read')));
CREATE POLICY billing_watermarks_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(
 bucket_id='billing-watermarks' AND billing_private.can_access_storage_owner((storage.foldername(name))[1],'watermarks.write'));
CREATE POLICY billing_watermarks_update ON storage.objects FOR UPDATE TO authenticated USING(
 bucket_id='billing-watermarks' AND billing_private.can_access_storage_owner((storage.foldername(name))[1],'watermarks.write')) WITH CHECK(
 bucket_id='billing-watermarks' AND billing_private.can_access_storage_owner((storage.foldername(name))[1],'watermarks.write'));
CREATE POLICY billing_watermarks_delete ON storage.objects FOR DELETE TO authenticated USING(
 bucket_id='billing-watermarks' AND billing_private.can_access_storage_owner((storage.foldername(name))[1],'watermarks.write'));

CREATE OR REPLACE FUNCTION public.billing_rpc(p_resource text,p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.ensure_actor_workspace();
 IF p_resource IN ('settings','profile') THEN RETURN billing_private.workspace_settings(p_action,p_payload); END IF;
 IF p_resource='users' THEN RETURN billing_private.users_dispatch(p_action,p_payload); END IF;
 IF p_resource='access-profiles' THEN RETURN billing_private.access_profiles_dispatch(p_action,p_payload); END IF;
 IF p_resource='report-headers' THEN RETURN billing_private.report_headers_dispatch(p_action,p_payload); END IF;
 PERFORM billing_private.authorize_resource(p_resource,p_action);
 IF p_resource='companies' AND p_action='save' THEN RETURN billing_private.save_company(p_payload); END IF;
 IF p_resource IN ('watermark','watermarks') THEN RETURN billing_private.watermark_variants(p_action,p_payload); END IF;
 RETURN billing_private.dispatch(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION public.billing_rpc(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_rpc(text,text,jsonb) TO authenticated;
COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS 'Authenticated workspace RPC. Actor identity and effective owner are derived from auth.uid() and membership; permissions, invitations and report headers are server-authorized.';

DO $realtime$
DECLARE t text;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  FOREACH t IN ARRAY ARRAY['billing_access_profiles','billing_memberships','billing_invitations','billing_user_settings','billing_report_headers'] LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);
   END IF;
  END LOOP;
 END IF;
END $realtime$;
