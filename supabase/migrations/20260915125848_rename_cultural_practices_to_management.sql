-- "Tratos culturais" becomes the user-facing Manejo workspace. Keep the
-- physical table and RPC resource stable so existing links, permissions and
-- Realtime subscriptions continue to work.
DO $migration_guard$
BEGIN
 IF EXISTS(SELECT 1 FROM public.billing_cultural_practices) THEN
  RAISE EXCEPTION 'Classifique os tratos culturais existentes antes de ativar Manejo.';
 END IF;
END $migration_guard$;

ALTER TABLE public.billing_culture_subtypes
 ADD CONSTRAINT billing_culture_subtypes_owner_culture_id_unique
 UNIQUE(owner_id,culture_id,id);

ALTER TABLE public.billing_cultural_practices
 DROP CONSTRAINT IF EXISTS billing_cultural_practices_owner_id_name_key_key,
 ADD COLUMN culture_id uuid,
 ADD COLUMN culture_subtype_id uuid,
 ADD COLUMN category text;

ALTER TABLE public.billing_cultural_practices
 ALTER COLUMN culture_id SET NOT NULL,
 ALTER COLUMN culture_subtype_id SET NOT NULL,
 ALTER COLUMN category SET NOT NULL,
 ADD CONSTRAINT billing_cultural_practices_category_check CHECK(category IN (
  'soil-preparation','cultural-practices','ratoon-management'
 )),
 ADD CONSTRAINT billing_cultural_practices_culture_fk
  FOREIGN KEY(owner_id,culture_id)
  REFERENCES public.billing_cultures(owner_id,id) ON DELETE RESTRICT,
 ADD CONSTRAINT billing_cultural_practices_subtype_fk
  FOREIGN KEY(owner_id,culture_id,culture_subtype_id)
  REFERENCES public.billing_culture_subtypes(owner_id,culture_id,id) ON DELETE RESTRICT,
 ADD CONSTRAINT billing_cultural_practices_context_name_unique
  UNIQUE(owner_id,culture_id,culture_subtype_id,category,name_key);

CREATE INDEX billing_cultural_practices_context
 ON public.billing_cultural_practices(owner_id,culture_id,culture_subtype_id,category);

CREATE FUNCTION billing_private.present_management_entry(p_entry public.billing_cultural_practices)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p_entry.id,
  'cultureId',p_entry.culture_id,
  'cultureName',c.name,
  'cultureSubtypeId',p_entry.culture_subtype_id,
  'cultureSubtypeName',s.name,
  'category',p_entry.category,
  'name',p_entry.name,
  'description',p_entry.description,
  'createdAt',p_entry.created_at,
  'updatedAt',p_entry.updated_at
 )
 FROM public.billing_cultures c
 JOIN public.billing_culture_subtypes s
  ON s.owner_id=p_entry.owner_id
  AND s.culture_id=p_entry.culture_id
  AND s.id=p_entry.culture_subtype_id
 WHERE c.owner_id=p_entry.owner_id AND c.id=p_entry.culture_id
$$;
REVOKE ALL ON FUNCTION billing_private.present_management_entry(public.billing_cultural_practices) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.management_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;
 v_culture_id uuid;
 v_subtype_id uuid;
 v_category text;
 v_name text;
 v_description text;
 v_entry public.billing_cultural_practices%ROWTYPE;
 v_entries jsonb;
BEGIN
 IF v_owner IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_action NOT IN ('list','get','save','delete') THEN
  RAISE EXCEPTION 'Operação de manejo inválida.' USING ERRCODE='22023';
 END IF;
 PERFORM billing_private.authorize('registrations.'||CASE WHEN p_action IN ('list','get') THEN 'read' ELSE 'write' END);

 IF p_action IN ('save','delete') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('billing:'||v_owner::text,0));
 END IF;

 IF p_action='list' THEN
  v_culture_id=nullif(p_payload->>'cultureId','')::uuid;
  v_subtype_id=nullif(p_payload->>'cultureSubtypeId','')::uuid;
  IF v_subtype_id IS NOT NULL AND v_culture_id IS NULL THEN
   RAISE EXCEPTION 'Selecione a cultura antes do tipo ou estágio.' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(jsonb_agg(billing_private.present_management_entry(p)
   ORDER BY p.category,lower(p.name),p.id),'[]'::jsonb)
  INTO v_entries
  FROM public.billing_cultural_practices p
  WHERE p.owner_id=v_owner
   AND (v_culture_id IS NULL OR p.culture_id=v_culture_id)
   AND (v_subtype_id IS NULL OR p.culture_subtype_id=v_subtype_id);
  RETURN jsonb_build_object('practices',v_entries);
 END IF;

 v_id=nullif(p_payload->>'id','')::uuid;
 IF p_action='get' THEN
  SELECT * INTO v_entry FROM public.billing_cultural_practices
  WHERE owner_id=v_owner AND id=v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manejo não encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('practice',billing_private.present_management_entry(v_entry));
 END IF;
 IF p_action='delete' THEN
  DELETE FROM public.billing_cultural_practices
  WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_entry;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manejo não encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('id',v_id,'deleted',true);
 END IF;

 v_culture_id=nullif(p_payload->>'cultureId','')::uuid;
 v_subtype_id=nullif(p_payload->>'cultureSubtypeId','')::uuid;
 v_category=btrim(coalesce(p_payload->>'category',''));
 v_name=btrim(coalesce(p_payload->>'name',''));
 v_description=btrim(coalesce(p_payload->>'description',''));
 IF v_culture_id IS NULL OR v_subtype_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.billing_culture_subtypes s
  WHERE s.owner_id=v_owner AND s.culture_id=v_culture_id AND s.id=v_subtype_id
 ) THEN
  RAISE EXCEPTION 'Selecione uma cultura e um tipo ou estágio vinculados.' USING ERRCODE='22023';
 END IF;
 IF v_category NOT IN ('soil-preparation','cultural-practices','ratoon-management') OR NOT (CASE v_category
  WHEN 'soil-preparation' THEN v_name=ANY(ARRAY['Subsolagem','Gradagem','Calagem','Gessagem','Adubação de plantio','Sulcamento','Plantio'])
  WHEN 'cultural-practices' THEN v_name=ANY(ARRAY['Controle de plantas daninhas','Adubação de cobertura','Irrigação','Controle de pragas','Controle de doenças','Manejo da palhada'])
  WHEN 'ratoon-management' THEN v_name=ANY(ARRAY['Operações pós-colheita','Adubação da soqueira','Controle de plantas daninhas','Controle de pragas/doenças','Correções e intervenções necessárias'])
  ELSE false END) THEN
  RAISE EXCEPTION 'Selecione uma operação válida para a categoria de manejo.' USING ERRCODE='22023';
 END IF;
 IF length(v_description)>2000 THEN
  RAISE EXCEPTION 'A descrição deve ter até 2.000 caracteres.' USING ERRCODE='22023';
 END IF;

 IF v_id IS NULL THEN
  INSERT INTO public.billing_cultural_practices(owner_id,culture_id,culture_subtype_id,category,name,description)
  VALUES(v_owner,v_culture_id,v_subtype_id,v_category,v_name,v_description)
  RETURNING * INTO v_entry;
 ELSE
  UPDATE public.billing_cultural_practices SET
   culture_id=v_culture_id,culture_subtype_id=v_subtype_id,category=v_category,name=v_name,description=v_description
  WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_entry;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manejo não encontrado.' USING ERRCODE='P0002'; END IF;
 END IF;
 RETURN jsonb_build_object('practice',billing_private.present_management_entry(v_entry));
EXCEPTION
 WHEN unique_violation THEN
  RAISE EXCEPTION 'Esta operação de manejo já está cadastrada para a cultura e o estágio selecionados.' USING ERRCODE='23505';
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Selecione uma cultura e um tipo ou estágio válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.management_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.management_dispatch(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.billing_rpc(p_resource text,p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.ensure_actor_workspace();
 IF p_resource IN ('settings','profile') THEN RETURN billing_private.workspace_settings(p_action,p_payload); END IF;
 IF p_resource='users' THEN RETURN billing_private.users_dispatch(p_action,p_payload); END IF;
 IF p_resource='access-profiles' THEN RETURN billing_private.access_profiles_dispatch(p_action,p_payload); END IF;
 IF p_resource='report-headers' THEN RETURN billing_private.report_headers_dispatch(p_action,p_payload); END IF;
 IF p_resource='planning' THEN RETURN billing_private.planning_dispatch(p_action,p_payload); END IF;
 PERFORM billing_private.authorize_resource(p_resource,p_action);
 IF p_resource='cultural-practices' THEN RETURN billing_private.management_dispatch(p_action,p_payload); END IF;
 IF p_resource='atr' THEN RETURN billing_private.atr_dispatch(p_action,p_payload); END IF;
 IF p_resource='farms' AND p_action='list' THEN RETURN billing_private.farm_summary_list(); END IF;
 IF p_resource='companies' AND p_action='save' THEN RETURN billing_private.save_company(p_payload); END IF;
 IF p_resource IN ('watermark','watermarks') THEN RETURN billing_private.watermark_variants(p_action,p_payload); END IF;
 RETURN billing_private.dispatch(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION public.billing_rpc(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_rpc(text,text,jsonb) TO authenticated;
COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS 'Authenticated workspace RPC. Manejo validates owner-scoped culture, subtype, category and operation in Postgres.';
