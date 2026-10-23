BEGIN;
ALTER TABLE public.billing_import_profiles
 ADD COLUMN active boolean NOT NULL DEFAULT true,
 ADD COLUMN is_default boolean NOT NULL DEFAULT false,
 ADD COLUMN cloned_from_id uuid,
 ADD CONSTRAINT billing_import_profile_default_active CHECK(NOT is_default OR active),
 ADD CONSTRAINT billing_import_profile_clone_owner FOREIGN KEY(owner_id,cloned_from_id) REFERENCES public.billing_import_profiles(owner_id,id);
CREATE UNIQUE INDEX billing_import_profile_default_per_client
 ON public.billing_import_profiles(owner_id,client_id) NULLS NOT DISTINCT WHERE is_default;

CREATE OR REPLACE FUNCTION billing_private.import_profile_json(r public.billing_import_profiles)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT r.config||jsonb_build_object('id',r.id,'name',r.name,'clientId',r.client_id,
  'active',r.active,'isDefault',r.is_default,'clonedFromId',r.cloned_from_id,
  'createdAt',r.created_at,'updatedAt',r.updated_at)
$$;
REVOKE ALL ON FUNCTION billing_private.import_profile_json(public.billing_import_profiles) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.import_profiles_dispatch(text,jsonb) RENAME TO import_profiles_dispatch_before_lifecycle;
REVOKE ALL ON FUNCTION billing_private.import_profiles_dispatch_before_lifecycle(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.import_profiles_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();r public.billing_import_profiles;result public.billing_import_profiles;v_id uuid;v_client uuid;v_name text;v_active boolean;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('clone','set-active','set-default') THEN
  RETURN billing_private.import_profiles_dispatch_before_lifecycle(p_action,p_payload);
 END IF;
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Entre para acessar os modelos de importação.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize('registrations.write');
 PERFORM billing_private.request_payload(p_payload,CASE WHEN p_action='clone' THEN ARRAY['id','expectedUpdatedAt','name','clientId']
  WHEN p_action='set-active' THEN ARRAY['id','expectedUpdatedAt','active'] ELSE ARRAY['id','expectedUpdatedAt'] END);
 PERFORM billing_private.lock_request_actor();
 PERFORM pg_advisory_xact_lock(hashtextextended('billing:imports:'||v_owner::text,0));
 v_id=nullif(p_payload->>'id','')::uuid;
 SELECT * INTO r FROM public.billing_import_profiles WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Modelo de importação não encontrado.' USING ERRCODE='P0002'; END IF;
 IF nullif(p_payload->>'expectedUpdatedAt','')::timestamptz IS DISTINCT FROM r.updated_at THEN
  RAISE EXCEPTION 'O modelo foi alterado. Atualize antes de continuar.' USING ERRCODE='PT409';
 END IF;
 IF p_action='clone' THEN
  v_client=CASE WHEN p_payload?'clientId' THEN nullif(p_payload->>'clientId','')::uuid ELSE r.client_id END;
  IF v_client IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.billing_clients WHERE owner_id=v_owner AND id=v_client) THEN
   RAISE EXCEPTION 'Selecione um cliente deste espaço.' USING ERRCODE='22023';
  END IF;
  IF p_payload?'name' AND jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Informe um nome para o novo modelo.' USING ERRCODE='22023';
  END IF;
  v_name=btrim(CASE WHEN p_payload?'name' THEN p_payload->>'name' ELSE left(r.name,152)||' (cópia)' END);
  IF length(v_name) NOT BETWEEN 2 AND 160 THEN RAISE EXCEPTION 'O nome do modelo deve ter entre 2 e 160 caracteres.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.billing_import_profiles(owner_id,client_id,name,config,active,is_default,cloned_from_id)
   VALUES(v_owner,v_client,v_name,r.config,false,false,r.id) RETURNING * INTO result;
 ELSIF p_action='set-active' THEN
  IF jsonb_typeof(p_payload->'active') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Informe se o modelo deve ficar ativo.' USING ERRCODE='22023'; END IF;
  v_active=(p_payload->>'active')::boolean;
  IF r.active=v_active AND (v_active OR NOT r.is_default) THEN result=r;
  ELSE UPDATE public.billing_import_profiles SET active=v_active,is_default=CASE WHEN v_active THEN is_default ELSE false END WHERE owner_id=v_owner AND id=r.id RETURNING * INTO result; END IF;
 ELSE
  IF NOT r.active THEN RAISE EXCEPTION 'Ative o modelo antes de defini-lo como padrão.' USING ERRCODE='23514'; END IF;
  IF r.is_default THEN result=r;
  ELSE
   UPDATE public.billing_import_profiles SET is_default=false
    WHERE owner_id=v_owner AND client_id IS NOT DISTINCT FROM r.client_id AND is_default;
   UPDATE public.billing_import_profiles SET is_default=true WHERE owner_id=v_owner AND id=r.id RETURNING * INTO result;
  END IF;
 END IF;
 RETURN jsonb_build_object('profile',billing_private.import_profile_json(result));
EXCEPTION WHEN unique_violation THEN
 RAISE EXCEPTION 'Já existe um modelo com esse nome ou um padrão para esse cliente.' USING ERRCODE='23505';
WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Confira o modelo, o cliente e a revisão informados.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.import_profiles_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;

-- Existing imports are returned before this guard: inactivation never rewrites
-- a historical document or breaks a retry for its original source hash.
DO $$ DECLARE definition text; BEGIN
 definition=pg_get_functiondef('billing_private.import_documents_dispatch(text,jsonb)'::regprocedure);
 IF strpos(definition,$before$p_payload=jsonb_set(p_payload,'{entries}',billing_private.normalize_taquari_vehicle_groups$before$)=0 THEN
  RAISE EXCEPTION 'Expected Taquari import normalization was not found.';
 END IF;
 EXECUTE replace(definition,
  $before$p_payload=jsonb_set(p_payload,'{entries}',billing_private.normalize_taquari_vehicle_groups$before$,
  $after$IF NOT p.active THEN RAISE EXCEPTION 'Este modelo está inativo. Ative-o ou escolha outro modelo para importar um novo PDF.' USING ERRCODE='23514'; END IF;
  p_payload=jsonb_set(p_payload,'{entries}',billing_private.normalize_taquari_vehicle_groups$after$);
END $$;
REVOKE ALL ON FUNCTION billing_private.import_documents_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
COMMIT;
