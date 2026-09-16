-- Explicit, idempotent bootstrap for the canonical sugarcane management
-- catalog. Existing user records and descriptions are never overwritten.
CREATE FUNCTION billing_private.bootstrap_sugarcane_management(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_culture_id uuid;
 v_plant_id uuid;
 v_ratoon_id uuid;
 v_created_cultures integer:=0;
 v_created_subtypes integer:=0;
 v_created_practices integer:=0;
 v_rows integer:=0;
 v_total_practices integer:=0;
 v_culture_name text;
 v_subtypes jsonb;
BEGIN
 IF v_owner IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_payload<>'{}'::jsonb THEN
  RAISE EXCEPTION 'O pré-cadastro da cana-de-açúcar não aceita parâmetros.' USING ERRCODE='22023';
 END IF;
 PERFORM billing_private.authorize('registrations.write');
 PERFORM pg_advisory_xact_lock(hashtextextended('billing:'||v_owner::text,0));

 INSERT INTO public.billing_cultures(owner_id,name)
 VALUES(v_owner,'Cana-de-açúcar')
 ON CONFLICT(owner_id,name_key) DO NOTHING
 RETURNING id INTO v_culture_id;
 GET DIAGNOSTICS v_created_cultures=ROW_COUNT;
 IF v_culture_id IS NULL THEN
  SELECT id INTO STRICT v_culture_id FROM public.billing_cultures
   WHERE owner_id=v_owner AND name_key=billing_private.name_key('Cana-de-açúcar');
 END IF;

 INSERT INTO public.billing_culture_subtypes(owner_id,culture_id,name)
 VALUES(v_owner,v_culture_id,'Cana planta')
 ON CONFLICT(owner_id,culture_id,name_key) DO NOTHING
 RETURNING id INTO v_plant_id;
 GET DIAGNOSTICS v_rows=ROW_COUNT;
 v_created_subtypes=v_created_subtypes+v_rows;
 IF v_plant_id IS NULL THEN
  SELECT id INTO STRICT v_plant_id FROM public.billing_culture_subtypes
   WHERE owner_id=v_owner AND culture_id=v_culture_id
    AND name_key=billing_private.name_key('Cana planta');
 END IF;

 INSERT INTO public.billing_culture_subtypes(owner_id,culture_id,name)
 VALUES(v_owner,v_culture_id,'Cana soca')
 ON CONFLICT(owner_id,culture_id,name_key) DO NOTHING
 RETURNING id INTO v_ratoon_id;
 GET DIAGNOSTICS v_rows=ROW_COUNT;
 v_created_subtypes=v_created_subtypes+v_rows;
 IF v_ratoon_id IS NULL THEN
  SELECT id INTO STRICT v_ratoon_id FROM public.billing_culture_subtypes
   WHERE owner_id=v_owner AND culture_id=v_culture_id
    AND name_key=billing_private.name_key('Cana soca');
 END IF;

 INSERT INTO public.billing_cultural_practices(
  owner_id,culture_id,culture_subtype_id,category,name,description
 )
 SELECT v_owner,v_culture_id,seed.subtype_id,seed.category,seed.name,''
 FROM (VALUES
  (v_plant_id,'soil-preparation','Subsolagem'),
  (v_plant_id,'soil-preparation','Gradagem'),
  (v_plant_id,'soil-preparation','Calagem'),
  (v_plant_id,'soil-preparation','Gessagem'),
  (v_plant_id,'soil-preparation','Adubação de plantio'),
  (v_plant_id,'soil-preparation','Sulcamento'),
  (v_plant_id,'soil-preparation','Plantio'),
  (v_plant_id,'cultural-practices','Controle de plantas daninhas'),
  (v_plant_id,'cultural-practices','Adubação de cobertura'),
  (v_plant_id,'cultural-practices','Irrigação'),
  (v_plant_id,'cultural-practices','Controle de pragas'),
  (v_plant_id,'cultural-practices','Controle de doenças'),
  (v_ratoon_id,'cultural-practices','Irrigação'),
  (v_ratoon_id,'cultural-practices','Manejo da palhada'),
  (v_ratoon_id,'ratoon-management','Operações pós-colheita'),
  (v_ratoon_id,'ratoon-management','Adubação da soqueira'),
  (v_ratoon_id,'ratoon-management','Controle de plantas daninhas'),
  (v_ratoon_id,'ratoon-management','Controle de pragas/doenças'),
  (v_ratoon_id,'ratoon-management','Correções e intervenções necessárias')
 ) AS seed(subtype_id,category,name)
 ON CONFLICT(owner_id,culture_id,culture_subtype_id,category,name_key) DO NOTHING;
 GET DIAGNOSTICS v_created_practices=ROW_COUNT;

 SELECT name INTO STRICT v_culture_name FROM public.billing_cultures
  WHERE owner_id=v_owner AND id=v_culture_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name)
  ORDER BY CASE s.id WHEN v_plant_id THEN 0 ELSE 1 END),'[]'::jsonb)
 INTO v_subtypes FROM public.billing_culture_subtypes s
 WHERE s.owner_id=v_owner AND s.id IN(v_plant_id,v_ratoon_id);
 SELECT count(*) INTO v_total_practices FROM public.billing_cultural_practices p
 WHERE p.owner_id=v_owner AND p.culture_id=v_culture_id
  AND ((p.culture_subtype_id=v_plant_id AND (p.category,p.name_key) IN(
    ('soil-preparation',billing_private.name_key('Subsolagem')),
    ('soil-preparation',billing_private.name_key('Gradagem')),
    ('soil-preparation',billing_private.name_key('Calagem')),
    ('soil-preparation',billing_private.name_key('Gessagem')),
    ('soil-preparation',billing_private.name_key('Adubação de plantio')),
    ('soil-preparation',billing_private.name_key('Sulcamento')),
    ('soil-preparation',billing_private.name_key('Plantio')),
    ('cultural-practices',billing_private.name_key('Controle de plantas daninhas')),
    ('cultural-practices',billing_private.name_key('Adubação de cobertura')),
    ('cultural-practices',billing_private.name_key('Irrigação')),
    ('cultural-practices',billing_private.name_key('Controle de pragas')),
    ('cultural-practices',billing_private.name_key('Controle de doenças'))
   )) OR (p.culture_subtype_id=v_ratoon_id AND (p.category,p.name_key) IN(
    ('cultural-practices',billing_private.name_key('Irrigação')),
    ('cultural-practices',billing_private.name_key('Manejo da palhada')),
    ('ratoon-management',billing_private.name_key('Operações pós-colheita')),
    ('ratoon-management',billing_private.name_key('Adubação da soqueira')),
    ('ratoon-management',billing_private.name_key('Controle de plantas daninhas')),
    ('ratoon-management',billing_private.name_key('Controle de pragas/doenças')),
    ('ratoon-management',billing_private.name_key('Correções e intervenções necessárias'))
   )));

 RETURN jsonb_build_object(
  'culture',jsonb_build_object('id',v_culture_id,'name',v_culture_name),
  'subtypes',v_subtypes,
  'focus',jsonb_build_object('cultureId',v_culture_id,'cultureSubtypeId',v_plant_id),
  'created',jsonb_build_object(
   'cultures',v_created_cultures,
   'subtypes',v_created_subtypes,
   'practices',v_created_practices
  ),
  'totalPractices',v_total_practices
 );
END $$;
REVOKE ALL ON FUNCTION billing_private.bootstrap_sugarcane_management(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.bootstrap_sugarcane_management(jsonb) TO authenticated;

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
 IF p_resource='cultural-practices' AND p_action='bootstrap-sugarcane' THEN
  RETURN billing_private.bootstrap_sugarcane_management(p_payload);
 END IF;
 IF p_resource='cultural-practices' THEN RETURN billing_private.management_dispatch(p_action,p_payload); END IF;
 IF p_resource='atr' THEN RETURN billing_private.atr_dispatch(p_action,p_payload); END IF;
 IF p_resource='farms' AND p_action='list' THEN RETURN billing_private.farm_summary_list(); END IF;
 IF p_resource='companies' AND p_action='save' THEN RETURN billing_private.save_company(p_payload); END IF;
 IF p_resource IN ('watermark','watermarks') THEN RETURN billing_private.watermark_variants(p_action,p_payload); END IF;
 RETURN billing_private.dispatch(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION public.billing_rpc(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_rpc(text,text,jsonb) TO authenticated;
COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS 'Authenticated workspace RPC. Includes an explicit, idempotent sugarcane management bootstrap with owner isolation.';
