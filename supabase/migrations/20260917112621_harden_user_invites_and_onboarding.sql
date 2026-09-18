-- Secure e-mail invitations, explicit onboarding and permanent workspace removal.
-- Passwords remain in Supabase Auth and never pass through billing_rpc.

ALTER TABLE public.billing_memberships
 DROP CONSTRAINT billing_memberships_status_check;
ALTER TABLE public.billing_memberships
 ADD CONSTRAINT billing_memberships_status_check CHECK(status IN ('active','disabled','removed')),
 ADD COLUMN disabled_at timestamptz,
 ADD COLUMN disabled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 ADD COLUMN removed_at timestamptz,
 ADD COLUMN removed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
UPDATE public.billing_memberships
 SET disabled_at=coalesce(disabled_at,updated_at)
 WHERE status='disabled';

ALTER TABLE public.billing_invitations
 ADD COLUMN delivery_status text NOT NULL DEFAULT 'queued'
  CHECK(delivery_status IN ('queued','sent','failed')),
 ADD COLUMN delivery_attempts integer NOT NULL DEFAULT 0 CHECK(delivery_attempts>=0),
 ADD COLUMN last_delivery_at timestamptz,
 ADD COLUMN last_delivery_error text CHECK(last_delivery_error IS NULL OR length(last_delivery_error)<=300),
 ADD COLUMN request_id uuid,
 ADD COLUMN attempt_id uuid,
 ADD COLUMN auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
UPDATE public.billing_invitations
 SET delivery_status=CASE WHEN status='accepted' THEN 'sent' ELSE 'queued' END;
CREATE UNIQUE INDEX billing_invitations_owner_request
 ON public.billing_invitations(owner_id,request_id) WHERE request_id IS NOT NULL;
CREATE INDEX billing_invitations_auth_user
 ON public.billing_invitations(auth_user_id) WHERE auth_user_id IS NOT NULL;

ALTER TABLE public.billing_user_settings
 ADD COLUMN onboarding_completed_at timestamptz;
UPDATE public.billing_user_settings SET onboarding_completed_at=coalesce(updated_at,created_at,now());

CREATE OR REPLACE FUNCTION billing_private.assert_can_manage_profiles(
 p_owner uuid,p_current_profile uuid DEFAULT NULL,p_requested_profile uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();v_actor_is_owner boolean;v_actor_permissions text[];v_permissions text[];v_profile uuid;
BEGIN
 SELECT m.is_owner,coalesce(p.permissions,'{}')
  INTO v_actor_is_owner,v_actor_permissions
 FROM public.billing_memberships m
 LEFT JOIN public.billing_access_profiles p ON p.owner_id=m.owner_id AND p.id=m.access_profile_id
 WHERE m.owner_id=p_owner AND m.user_id=v_actor AND m.status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'Você não tem permissão para gerenciar usuários.' USING ERRCODE='42501'; END IF;
 IF v_actor_is_owner THEN RETURN; END IF;
 FOREACH v_profile IN ARRAY ARRAY[p_current_profile,p_requested_profile] LOOP
  IF v_profile IS NULL THEN CONTINUE; END IF;
  SELECT permissions INTO v_permissions FROM public.billing_access_profiles
   WHERE owner_id=p_owner AND id=v_profile;
  IF NOT FOUND OR NOT(v_permissions <@ v_actor_permissions) OR
     v_permissions && ARRAY['users.manage','access-profiles.manage']::text[] THEN
   RAISE EXCEPTION 'Somente o proprietário pode gerenciar este nível de acesso.' USING ERRCODE='42501';
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION billing_private.assert_can_manage_profiles(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.present_member(p_membership public.billing_memberships) RETURNS jsonb
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

CREATE OR REPLACE FUNCTION billing_private.present_invitation(p_invitation public.billing_invitations) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p_invitation.id,'name','','email',p_invitation.email,'status','pending',
  'accessProfileId',p_invitation.access_profile_id,
  'accessProfileName',coalesce((SELECT p.name FROM public.billing_access_profiles p
    WHERE p.owner_id=p_invitation.owner_id AND p.id=p_invitation.access_profile_id),''),
  'isOwner',false,'deliveryStatus',p_invitation.delivery_status,
  'expiresAt',p_invitation.expires_at,'updatedAt',p_invitation.updated_at)
$$;
REVOKE ALL ON FUNCTION billing_private.present_invitation(public.billing_invitations) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.onboarding_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();v_email text;v_name text;v_confirmed boolean;v_member public.billing_memberships%ROWTYPE;v_invitation public.billing_invitations%ROWTYPE;v_completed timestamptz;
BEGIN
 IF v_actor IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_action NOT IN ('inspect','complete') THEN
  RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023';
 END IF;
 SELECT lower(btrim(email)),email_confirmed_at IS NOT NULL
  INTO v_email,v_confirmed FROM auth.users WHERE id=v_actor;
 IF v_email IS NULL THEN RAISE EXCEPTION 'Sua conta não possui um e-mail válido.' USING ERRCODE='22023'; END IF;
 IF p_action='complete' THEN PERFORM pg_advisory_xact_lock(hashtextextended('billing-actor:'||v_actor::text,0)); END IF;
 SELECT * INTO v_member FROM public.billing_memberships WHERE user_id=v_actor FOR UPDATE;
 IF FOUND AND v_member.status='disabled' THEN
  RETURN jsonb_build_object('status','disabled','email',v_email);
 ELSIF FOUND AND v_member.status='removed' THEN
  RETURN jsonb_build_object('status','removed','email',v_email);
 ELSIF FOUND AND v_member.status='active' THEN
  SELECT onboarding_completed_at INTO v_completed FROM public.billing_user_settings WHERE user_id=v_actor;
  IF p_action='inspect' THEN
   RETURN jsonb_build_object('status',CASE WHEN v_completed IS NULL THEN 'invite' ELSE 'ready' END,'email',v_email);
  END IF;
  IF v_completed IS NOT NULL THEN RETURN jsonb_build_object('status','ready','email',v_email); END IF;
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('billing-invite:'||v_email,0));
  UPDATE public.billing_invitations SET status='cancelled'
   WHERE email_key=v_email AND status='pending' AND expires_at<=clock_timestamp();
  SELECT * INTO v_invitation FROM public.billing_invitations
   WHERE email_key=v_email AND status='pending' AND expires_at>clock_timestamp()
   ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
   IF EXISTS(SELECT 1 FROM public.billing_invitations WHERE auth_user_id=v_actor AND status='cancelled') THEN
    RETURN jsonb_build_object('status','invalid','email',v_email);
   END IF;
   RETURN jsonb_build_object('status','ready','email',v_email);
  END IF;
  IF p_action='inspect' THEN
   RETURN jsonb_build_object('status','invite','email',v_email,'invitationId',v_invitation.id);
  END IF;
  IF NOT v_confirmed THEN RAISE EXCEPTION 'Confirme seu e-mail antes de aceitar o convite.' USING ERRCODE='42501'; END IF;
 END IF;
 IF jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Informe seu nome.' USING ERRCODE='22023';
 END IF;
 v_name=btrim(p_payload->>'name');
 IF length(v_name) NOT BETWEEN 2 AND 150 THEN
  RAISE EXCEPTION 'O nome deve ter entre 2 e 150 caracteres.' USING ERRCODE='22023';
 END IF;
 IF v_member.id IS NULL THEN
  INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,is_owner,status)
   VALUES(v_invitation.owner_id,v_actor,v_invitation.access_profile_id,false,'active') RETURNING * INTO v_member;
  UPDATE public.billing_invitations SET status='accepted',accepted_by=v_actor
   WHERE id=v_invitation.id AND status='pending';
 END IF;
 INSERT INTO public.billing_user_settings(user_id,owner_id,name,compact,onboarding_completed_at)
  VALUES(v_actor,v_member.owner_id,v_name,false,clock_timestamp())
  ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,onboarding_completed_at=excluded.onboarding_completed_at;
 RETURN jsonb_build_object('status','ready','email',v_email,'workspaceId',v_member.owner_id,'name',v_name);
END $$;
REVOKE ALL ON FUNCTION billing_private.onboarding_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.onboarding_dispatch(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION billing_private.ensure_actor_workspace() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();v_owner uuid;v_email text;v_name text;
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
 IF EXISTS(SELECT 1 FROM public.billing_memberships WHERE user_id=v_actor AND status='removed') THEN
  RAISE EXCEPTION 'Seu acesso a este espaço foi excluído.' USING ERRCODE='42501';
 END IF;
 SELECT lower(btrim(email)),coalesce(nullif(btrim(raw_user_meta_data->>'display_name'),''),nullif(email,''),'Minha conta')
  INTO v_email,v_name FROM auth.users WHERE id=v_actor;
 PERFORM pg_advisory_xact_lock(hashtextextended('billing-invite:'||v_email,0));
 UPDATE public.billing_invitations SET status='cancelled'
  WHERE email_key=v_email AND status='pending' AND expires_at<=clock_timestamp();
 IF EXISTS(SELECT 1 FROM public.billing_invitations WHERE email_key=v_email AND status='pending') THEN
  RAISE EXCEPTION 'Conclua o convite antes de acessar o espaço.' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM public.billing_invitations WHERE auth_user_id=v_actor AND status='cancelled') THEN
  RAISE EXCEPTION 'Este convite não está mais disponível.' USING ERRCODE='42501';
 END IF;
 PERFORM billing_private.create_workspace_defaults(v_actor);
 INSERT INTO public.billing_memberships(owner_id,user_id,is_owner,status)
  VALUES(v_actor,v_actor,true,'active');
 INSERT INTO public.billing_user_settings(user_id,owner_id,name,compact,onboarding_completed_at)
  VALUES(v_actor,v_actor,left(v_name,150),false,clock_timestamp())
  ON CONFLICT(user_id) DO NOTHING;
 RETURN v_actor;
END $$;
REVOKE ALL ON FUNCTION billing_private.ensure_actor_workspace() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.ensure_actor_workspace() TO authenticated;

CREATE OR REPLACE FUNCTION billing_private.users_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();v_owner uuid:=billing_private.current_owner_id();v_id uuid;v_profile uuid;v_email text;v_auth_user uuid;v_request uuid;v_attempt uuid;v_member public.billing_memberships%ROWTYPE;v_invitation public.billing_invitations%ROWTYPE;v_result jsonb;v_error text;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_action NOT IN (
  'list','invite','prepare-invite','finalize-invite','update','disable','enable','remove','cancel-invite') THEN
  RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023';
 END IF;
 PERFORM billing_private.authorize('users.manage');
 IF p_action='list' THEN
  UPDATE public.billing_invitations SET status='cancelled'
   WHERE owner_id=v_owner AND status='pending' AND expires_at<=clock_timestamp();
  SELECT coalesce(jsonb_agg(item ORDER BY sort_owner DESC,sort_name),'[]') INTO v_result FROM (
   SELECT billing_private.present_member(m) item,m.is_owner sort_owner,lower(coalesce(s.name,u.email,'')) sort_name
    FROM public.billing_memberships m JOIN auth.users u ON u.id=m.user_id
    LEFT JOIN public.billing_user_settings s ON s.user_id=m.user_id
    WHERE m.owner_id=v_owner AND m.status<>'removed'
   UNION ALL
   SELECT billing_private.present_invitation(i),false,lower(i.email)
    FROM public.billing_invitations i WHERE i.owner_id=v_owner AND i.status='pending' AND i.expires_at>clock_timestamp()
  ) q;
  RETURN jsonb_build_object('users',v_result);
 END IF;
 v_profile=nullif(p_payload->>'accessProfileId','')::uuid;
 IF p_action IN ('invite','prepare-invite') THEN
  IF jsonb_typeof(p_payload->'email') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Informe um e-mail válido.' USING ERRCODE='22023'; END IF;
  v_email=lower(btrim(p_payload->>'email'));
  IF length(v_email) NOT BETWEEN 3 AND 254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN RAISE EXCEPTION 'Informe um e-mail válido.' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.billing_access_profiles WHERE owner_id=v_owner AND id=v_profile) THEN RAISE EXCEPTION 'Selecione um perfil de acesso válido.' USING ERRCODE='22023'; END IF;
  PERFORM billing_private.assert_can_manage_profiles(v_owner,NULL,v_profile);
  v_request=nullif(p_payload->>'requestId','')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended('billing-invite:'||v_email,0));
  IF v_request IS NOT NULL THEN
   SELECT * INTO v_invitation FROM public.billing_invitations WHERE owner_id=v_owner AND request_id=v_request;
   IF FOUND THEN RETURN jsonb_build_object('user',billing_private.present_invitation(v_invitation),'invitationId',v_invitation.id); END IF;
  END IF;
  SELECT id INTO v_auth_user FROM auth.users WHERE lower(btrim(email))=v_email;
  IF v_auth_user IS NOT NULL AND EXISTS(SELECT 1 FROM public.billing_memberships WHERE user_id=v_auth_user) THEN
   RAISE EXCEPTION 'Este usuário já pertence ou pertenceu a um espaço de trabalho.' USING ERRCODE='23505';
  END IF;
  UPDATE public.billing_invitations SET status='cancelled'
   WHERE email_key=v_email AND status='pending' AND expires_at<=clock_timestamp();
  IF EXISTS(SELECT 1 FROM public.billing_invitations WHERE email_key=v_email AND status='pending') THEN
   RAISE EXCEPTION 'Já existe um convite pendente para este e-mail.' USING ERRCODE='23505';
  END IF;
  INSERT INTO public.billing_invitations(owner_id,email,access_profile_id,invited_by,expires_at,delivery_status,request_id)
   VALUES(v_owner,v_email,v_profile,v_actor,clock_timestamp()+interval '1 hour','queued',v_request) RETURNING * INTO v_invitation;
  RETURN jsonb_build_object('user',billing_private.present_invitation(v_invitation),'invitationId',v_invitation.id);
 END IF;
 v_id=nullif(p_payload->>'id','')::uuid;
 IF p_action='finalize-invite' THEN
  v_id=coalesce(v_id,nullif(p_payload->>'invitationId','')::uuid);
  v_attempt=nullif(p_payload->>'attemptId','')::uuid;
  IF v_id IS NULL OR v_attempt IS NULL OR p_payload->>'outcome' NOT IN ('sent','failed') THEN RAISE EXCEPTION 'Resultado de envio inválido.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_invitation FROM public.billing_invitations WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
  IF NOT FOUND OR v_invitation.status<>'pending' THEN RAISE EXCEPTION 'Convite não encontrado.' USING ERRCODE='P0002'; END IF;
  PERFORM billing_private.assert_can_manage_profiles(v_owner,v_invitation.access_profile_id,NULL);
  IF v_invitation.attempt_id=v_attempt THEN RETURN jsonb_build_object('user',billing_private.present_invitation(v_invitation)); END IF;
  v_error=CASE WHEN p_payload->>'outcome'='failed' THEN left(coalesce(nullif(btrim(p_payload->>'error'),''),'Falha ao enviar o convite.'),300) ELSE NULL END;
  v_auth_user=nullif(p_payload->>'authUserId','')::uuid;
  IF p_payload->>'outcome'='sent' AND (v_auth_user IS NULL OR NOT EXISTS(
   SELECT 1 FROM auth.users WHERE id=v_auth_user AND lower(btrim(email))=v_invitation.email_key)) THEN
   RAISE EXCEPTION 'A identidade criada não corresponde ao convite.' USING ERRCODE='22023';
  END IF;
  UPDATE public.billing_invitations SET delivery_status=p_payload->>'outcome',delivery_attempts=delivery_attempts+1,
   last_delivery_at=clock_timestamp(),last_delivery_error=v_error,attempt_id=v_attempt,
   auth_user_id=coalesce(v_auth_user,auth_user_id),expires_at=CASE WHEN p_payload->>'outcome'='sent' THEN clock_timestamp()+interval '1 hour' ELSE expires_at END
   WHERE id=v_id RETURNING * INTO v_invitation;
  RETURN jsonb_build_object('user',billing_private.present_invitation(v_invitation));
 END IF;
 IF v_id IS NULL THEN RAISE EXCEPTION 'Informe o usuário.' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_member FROM public.billing_memberships WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
 IF FOUND THEN
  IF v_member.is_owner OR v_member.user_id=v_actor THEN RAISE EXCEPTION 'O proprietário e o próprio acesso não podem ser alterados por esta operação.' USING ERRCODE='42501'; END IF;
  IF v_member.status='removed' THEN RAISE EXCEPTION 'Usuário não encontrado.' USING ERRCODE='P0002'; END IF;
  IF p_action='update' THEN
   IF NOT EXISTS(SELECT 1 FROM public.billing_access_profiles WHERE owner_id=v_owner AND id=v_profile) THEN RAISE EXCEPTION 'Selecione um perfil de acesso válido.' USING ERRCODE='22023'; END IF;
   PERFORM billing_private.assert_can_manage_profiles(v_owner,v_member.access_profile_id,v_profile);
   UPDATE public.billing_memberships SET access_profile_id=v_profile WHERE id=v_id RETURNING * INTO v_member;
  ELSIF p_action='disable' THEN
   PERFORM billing_private.assert_can_manage_profiles(v_owner,v_member.access_profile_id,NULL);
   UPDATE public.billing_memberships SET status='disabled',disabled_at=clock_timestamp(),disabled_by=v_actor WHERE id=v_id RETURNING * INTO v_member;
  ELSIF p_action='enable' THEN
   PERFORM billing_private.assert_can_manage_profiles(v_owner,v_member.access_profile_id,NULL);
   UPDATE public.billing_memberships SET status='active',disabled_at=NULL,disabled_by=NULL WHERE id=v_id RETURNING * INTO v_member;
  ELSIF p_action='remove' THEN
   PERFORM billing_private.assert_can_manage_profiles(v_owner,v_member.access_profile_id,NULL);
   UPDATE public.billing_memberships SET status='removed',removed_at=clock_timestamp(),removed_by=v_actor WHERE id=v_id RETURNING * INTO v_member;
  ELSE RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('user',billing_private.present_member(v_member));
 END IF;
 IF p_action NOT IN ('update','disable','remove','cancel-invite') THEN RAISE EXCEPTION 'Usuário não encontrado.' USING ERRCODE='P0002'; END IF;
 SELECT * INTO v_invitation FROM public.billing_invitations WHERE owner_id=v_owner AND id=v_id AND status='pending' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Usuário não encontrado.' USING ERRCODE='P0002'; END IF;
 IF p_action='update' THEN
  IF NOT EXISTS(SELECT 1 FROM public.billing_access_profiles WHERE owner_id=v_owner AND id=v_profile) THEN RAISE EXCEPTION 'Selecione um perfil de acesso válido.' USING ERRCODE='22023'; END IF;
  PERFORM billing_private.assert_can_manage_profiles(v_owner,v_invitation.access_profile_id,v_profile);
  UPDATE public.billing_invitations SET access_profile_id=v_profile WHERE id=v_id RETURNING * INTO v_invitation;
  RETURN jsonb_build_object('user',billing_private.present_invitation(v_invitation));
 END IF;
 PERFORM billing_private.assert_can_manage_profiles(v_owner,v_invitation.access_profile_id,NULL);
 UPDATE public.billing_invitations SET status='cancelled' WHERE id=v_id RETURNING * INTO v_invitation;
 RETURN jsonb_build_object('user',jsonb_build_object('id',v_invitation.id,'name','','email',v_invitation.email,
  'status','inactive','accessProfileId',v_invitation.access_profile_id,'accessProfileName','',
  'isOwner',false,'updatedAt',v_invitation.updated_at));
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Já existe um convite ou usuário para este e-mail.' USING ERRCODE='23505';
END $$;
REVOKE ALL ON FUNCTION billing_private.users_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.users_dispatch(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION billing_private.workspace_settings(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();v_owner uuid:=billing_private.current_owner_id();v_email text;v_name text;v_compact boolean;v_company text;v_onboarded timestamptz;
BEGIN
 IF p_action NOT IN ('get','list','save') OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023'; END IF;
 SELECT email,coalesce(nullif(btrim(raw_user_meta_data->>'display_name'),''),nullif(email,''),'Minha conta') INTO v_email,v_name FROM auth.users WHERE id=v_actor;
 IF p_action='save' THEN
  IF jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'company') IS DISTINCT FROM 'string' OR
     jsonb_typeof(p_payload->'compact') IS DISTINCT FROM 'boolean' OR length(btrim(p_payload->>'name')) NOT BETWEEN 1 AND 150 OR
     length(btrim(p_payload->>'company')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Preencha seu nome e o nome do espaço.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.billing_user_settings(user_id,owner_id,name,compact,onboarding_completed_at)
   VALUES(v_actor,v_owner,btrim(p_payload->>'name'),(p_payload->>'compact')::boolean,clock_timestamp())
   ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,compact=excluded.compact,onboarding_completed_at=coalesce(billing_user_settings.onboarding_completed_at,excluded.onboarding_completed_at);
  SELECT company INTO v_company FROM public.billing_profiles WHERE owner_id=v_owner;
  IF btrim(p_payload->>'company') IS DISTINCT FROM coalesce(v_company,'Meu espaço de trabalho') THEN
   IF v_actor<>v_owner THEN RAISE EXCEPTION 'Somente o proprietário pode renomear o espaço.' USING ERRCODE='42501'; END IF;
   INSERT INTO public.billing_profiles(owner_id,name,company,compact) VALUES(v_owner,btrim(p_payload->>'name'),btrim(p_payload->>'company'),false)
    ON CONFLICT(owner_id) DO UPDATE SET company=excluded.company;
  END IF;
 END IF;
 SELECT s.name,s.compact,s.onboarding_completed_at INTO v_name,v_compact,v_onboarded FROM public.billing_user_settings s WHERE s.user_id=v_actor;
 SELECT company INTO v_company FROM public.billing_profiles WHERE owner_id=v_owner;
 RETURN jsonb_build_object('profile',jsonb_build_object('id',v_actor,'name',coalesce(v_name,'Minha conta'),'company',coalesce(v_company,'Meu espaço de trabalho'),
  'email',coalesce(v_email,''),'compact',coalesce(v_compact,false),'workspaceId',v_owner,'onboardingCompleted',v_onboarded IS NOT NULL,
  'role',CASE WHEN v_actor=v_owner THEN 'owner' ELSE 'member' END),'settings',jsonb_build_object(
  'id',v_actor,'name',coalesce(v_name,'Minha conta'),'company',coalesce(v_company,'Meu espaço de trabalho'),
  'email',coalesce(v_email,''),'compact',coalesce(v_compact,false),'workspaceId',v_owner,'onboardingCompleted',v_onboarded IS NOT NULL,
  'role',CASE WHEN v_actor=v_owner THEN 'owner' ELSE 'member' END));
END $$;
REVOKE ALL ON FUNCTION billing_private.workspace_settings(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.workspace_settings(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.billing_rpc(p_resource text,p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 IF p_resource='onboarding' THEN RETURN billing_private.onboarding_dispatch(p_action,p_payload); END IF;
 PERFORM billing_private.ensure_actor_workspace();
 IF p_resource IN ('settings','profile') THEN RETURN billing_private.workspace_settings(p_action,p_payload); END IF;
 IF p_resource='users' THEN RETURN billing_private.users_dispatch(p_action,p_payload); END IF;
 IF p_resource='access-profiles' THEN RETURN billing_private.access_profiles_dispatch(p_action,p_payload); END IF;
 IF p_resource='report-headers' THEN RETURN billing_private.report_headers_dispatch(p_action,p_payload); END IF;
 IF p_resource='agenda' THEN RETURN billing_private.agenda_dispatch(p_action,p_payload); END IF;
 IF p_resource='summary' THEN RETURN billing_private.summary_dispatch(p_action,p_payload); END IF;
 IF p_resource='reports' THEN RETURN billing_private.reports_dispatch(p_action,p_payload); END IF;
 IF p_resource='planning' THEN RETURN billing_private.planning_v9_dispatch(p_action,p_payload); END IF;
 IF p_resource IN ('planning-goals','planning-executions') THEN RAISE EXCEPTION 'Este contrato antigo de planejamento permanece desativado.' USING ERRCODE='22023'; END IF;
 PERFORM billing_private.authorize_resource(p_resource,p_action);
 IF p_resource='contracts' THEN RETURN billing_private.contracts_company_dispatch(p_action,p_payload); END IF;
 IF p_resource='cultural-practices' AND p_action='bootstrap-sugarcane' THEN RETURN billing_private.bootstrap_sugarcane_management(p_payload); END IF;
 IF p_resource='cultural-practices' THEN RETURN billing_private.management_dispatch(p_action,p_payload); END IF;
 IF p_resource='atr' THEN RETURN billing_private.atr_dispatch(p_action,p_payload); END IF;
 IF p_resource='farms' AND p_action='list' THEN RETURN billing_private.farm_summary_list(); END IF;
 IF p_resource='companies' AND p_action='save' THEN RETURN billing_private.save_company(p_payload); END IF;
 IF p_resource IN ('watermark','watermarks') THEN RETURN billing_private.watermark_variants(p_action,p_payload); END IF;
 RETURN billing_private.dispatch(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION public.billing_rpc(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_rpc(text,text,jsonb) TO authenticated;
COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS 'Authenticated workspace RPC. Explicit invite onboarding, permanent workspace removal and hierarchical user administration are enforced in Postgres.';
