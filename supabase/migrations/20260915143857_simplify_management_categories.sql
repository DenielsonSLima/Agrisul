-- Manejo has two independent dimensions: the crop cycle identifies plant or
-- ratoon, while the category identifies soil preparation or cultural work.
-- Preserve existing links while removing the redundant ratoon category.
DO $migration_guard$
BEGIN
 IF EXISTS(
  SELECT 1 FROM public.billing_cultural_practices source
  JOIN public.billing_cultural_practices target
   ON target.owner_id=source.owner_id
   AND target.culture_id=source.culture_id
   AND target.culture_subtype_id=source.culture_subtype_id
   AND target.category='cultural-practices'
   AND target.name_key=source.name_key
  WHERE source.category='ratoon-management'
   AND source.name_key=billing_private.name_key('Controle de plantas daninhas')
 ) OR EXISTS(
  SELECT 1 FROM public.billing_cultural_practices source
  JOIN public.billing_cultural_practices target
   ON target.owner_id=source.owner_id
   AND target.culture_id=source.culture_id
   AND target.culture_subtype_id=source.culture_subtype_id
   AND target.category='cultural-practices'
   AND target.name_key IN(
    billing_private.name_key('Controle de pragas'),
    billing_private.name_key('Controle de doenças')
   )
  WHERE source.category='ratoon-management'
   AND source.name_key=billing_private.name_key('Controle de pragas/doenças')
 ) THEN
  RAISE EXCEPTION 'Existem observações de manejo conflitantes. Consolide os controles antes de simplificar as categorias.';
 END IF;
END $migration_guard$;

-- Split the combined control into the two canonical processes. The original
-- row becomes pest control (keeping its id) and disease control receives the
-- same observation and creation timestamp.
INSERT INTO public.billing_cultural_practices(
 owner_id,created_at,updated_at,culture_id,culture_subtype_id,category,name,description
)
SELECT owner_id,created_at,updated_at,culture_id,culture_subtype_id,
 'cultural-practices','Controle de doenças',description
FROM public.billing_cultural_practices
WHERE category='ratoon-management'
 AND name_key=billing_private.name_key('Controle de pragas/doenças');

UPDATE public.billing_cultural_practices
SET category='cultural-practices',name='Controle de pragas'
WHERE category='ratoon-management'
 AND name_key=billing_private.name_key('Controle de pragas/doenças');

UPDATE public.billing_cultural_practices
SET category='cultural-practices'
WHERE category='ratoon-management';

ALTER TABLE public.billing_cultural_practices
 DROP CONSTRAINT billing_cultural_practices_category_check,
 ADD CONSTRAINT billing_cultural_practices_category_check
 CHECK(category IN('soil-preparation','cultural-practices'));

CREATE FUNCTION billing_private.management_catalog()
RETURNS TABLE(category text,category_label text,operation text,sort_order integer)
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT * FROM (VALUES
  ('soil-preparation','Preparar solo','Subsolagem',1),
  ('soil-preparation','Preparar solo','Gradagem',2),
  ('soil-preparation','Preparar solo','Calagem',3),
  ('soil-preparation','Preparar solo','Gessagem',4),
  ('soil-preparation','Preparar solo','Adubação de plantio',5),
  ('soil-preparation','Preparar solo','Sulcamento',6),
  ('soil-preparation','Preparar solo','Plantio',7),
  ('cultural-practices','Tratos culturais','Operações pós-colheita',101),
  ('cultural-practices','Tratos culturais','Adubação de cobertura',102),
  ('cultural-practices','Tratos culturais','Adubação da soqueira',103),
  ('cultural-practices','Tratos culturais','Irrigação',104),
  ('cultural-practices','Tratos culturais','Manejo da palhada',105),
  ('cultural-practices','Tratos culturais','Controle de plantas daninhas',106),
  ('cultural-practices','Tratos culturais','Controle de pragas',107),
  ('cultural-practices','Tratos culturais','Controle de doenças',108),
  ('cultural-practices','Tratos culturais','Correções e intervenções necessárias',109)
 ) AS catalog(category,category_label,operation,sort_order)
$$;
REVOKE ALL ON FUNCTION billing_private.management_catalog() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.management_dispatch(p_action text,p_payload jsonb)
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
 v_catalog jsonb;
BEGIN
 IF v_owner IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_action NOT IN('list','get','save','delete') THEN
  RAISE EXCEPTION 'Operação de manejo inválida.' USING ERRCODE='22023';
 END IF;
 PERFORM billing_private.authorize('registrations.'||CASE WHEN p_action IN('list','get') THEN 'read' ELSE 'write' END);

 IF p_action IN('save','delete') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('billing:'||v_owner::text,0));
 END IF;

 IF p_action='list' THEN
  v_culture_id=nullif(p_payload->>'cultureId','')::uuid;
  v_subtype_id=nullif(p_payload->>'cultureSubtypeId','')::uuid;
  IF v_subtype_id IS NOT NULL AND v_culture_id IS NULL THEN
   RAISE EXCEPTION 'Selecione a cultura antes do ciclo.' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(jsonb_agg(billing_private.present_management_entry(p)
   ORDER BY catalog.sort_order,p.id),'[]'::jsonb)
  INTO v_entries
  FROM public.billing_cultural_practices p
  JOIN billing_private.management_catalog() catalog
   ON catalog.category=p.category AND catalog.operation=p.name
  WHERE p.owner_id=v_owner
   AND (v_culture_id IS NULL OR p.culture_id=v_culture_id)
   AND (v_subtype_id IS NULL OR p.culture_subtype_id=v_subtype_id);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'category',category,'categoryLabel',category_label,
   'name',operation,'position',sort_order
  ) ORDER BY sort_order),'[]'::jsonb)
  INTO v_catalog FROM billing_private.management_catalog();
  RETURN jsonb_build_object('practices',v_entries,'catalog',v_catalog);
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
  RAISE EXCEPTION 'Selecione uma cultura e um ciclo vinculados.' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS(
  SELECT 1 FROM billing_private.management_catalog() catalog
  WHERE catalog.category=v_category AND catalog.operation=v_name
 ) THEN
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
  RAISE EXCEPTION 'Esta operação de manejo já está vinculada à cultura e ao ciclo selecionados.' USING ERRCODE='23505';
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Selecione uma cultura e um ciclo válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.management_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.management_dispatch(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION billing_private.bootstrap_sugarcane_management(p_payload jsonb)
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

 INSERT INTO public.billing_cultures(owner_id,name) VALUES(v_owner,'Cana-de-açúcar')
 ON CONFLICT(owner_id,name_key) DO NOTHING RETURNING id INTO v_culture_id;
 GET DIAGNOSTICS v_created_cultures=ROW_COUNT;
 IF v_culture_id IS NULL THEN
  SELECT id INTO STRICT v_culture_id FROM public.billing_cultures
  WHERE owner_id=v_owner AND name_key=billing_private.name_key('Cana-de-açúcar');
 END IF;

 INSERT INTO public.billing_culture_subtypes(owner_id,culture_id,name) VALUES(v_owner,v_culture_id,'Cana planta')
 ON CONFLICT(owner_id,culture_id,name_key) DO NOTHING RETURNING id INTO v_plant_id;
 GET DIAGNOSTICS v_rows=ROW_COUNT;v_created_subtypes=v_created_subtypes+v_rows;
 IF v_plant_id IS NULL THEN
  SELECT id INTO STRICT v_plant_id FROM public.billing_culture_subtypes
  WHERE owner_id=v_owner AND culture_id=v_culture_id AND name_key=billing_private.name_key('Cana planta');
 END IF;

 INSERT INTO public.billing_culture_subtypes(owner_id,culture_id,name) VALUES(v_owner,v_culture_id,'Cana soca')
 ON CONFLICT(owner_id,culture_id,name_key) DO NOTHING RETURNING id INTO v_ratoon_id;
 GET DIAGNOSTICS v_rows=ROW_COUNT;v_created_subtypes=v_created_subtypes+v_rows;
 IF v_ratoon_id IS NULL THEN
  SELECT id INTO STRICT v_ratoon_id FROM public.billing_culture_subtypes
  WHERE owner_id=v_owner AND culture_id=v_culture_id AND name_key=billing_private.name_key('Cana soca');
 END IF;

 INSERT INTO public.billing_cultural_practices(owner_id,culture_id,culture_subtype_id,category,name,description)
 SELECT v_owner,v_culture_id,v_plant_id,catalog.category,catalog.operation,''
 FROM billing_private.management_catalog() catalog
 WHERE catalog.category='soil-preparation' OR catalog.operation=ANY(ARRAY[
  'Controle de plantas daninhas','Adubação de cobertura','Irrigação','Controle de pragas','Controle de doenças'
 ])
 UNION ALL
 SELECT v_owner,v_culture_id,v_ratoon_id,catalog.category,catalog.operation,''
 FROM billing_private.management_catalog() catalog
 WHERE catalog.category='cultural-practices' AND catalog.operation=ANY(ARRAY[
  'Operações pós-colheita','Adubação da soqueira','Irrigação','Manejo da palhada',
  'Controle de plantas daninhas','Controle de pragas','Controle de doenças','Correções e intervenções necessárias'
 ])
 ON CONFLICT(owner_id,culture_id,culture_subtype_id,category,name_key) DO NOTHING;
 GET DIAGNOSTICS v_created_practices=ROW_COUNT;

 SELECT name INTO STRICT v_culture_name FROM public.billing_cultures
 WHERE owner_id=v_owner AND id=v_culture_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name)
  ORDER BY CASE s.id WHEN v_plant_id THEN 0 ELSE 1 END),'[]'::jsonb)
 INTO v_subtypes FROM public.billing_culture_subtypes s
 WHERE s.owner_id=v_owner AND s.id IN(v_plant_id,v_ratoon_id);
 SELECT count(*) INTO v_total_practices
 FROM public.billing_cultural_practices p
 WHERE p.owner_id=v_owner AND p.culture_id=v_culture_id AND (
  (p.culture_subtype_id=v_plant_id AND EXISTS(
   SELECT 1 FROM billing_private.management_catalog() catalog
   WHERE catalog.category=p.category AND catalog.operation=p.name
    AND (catalog.category='soil-preparation' OR catalog.operation=ANY(ARRAY[
     'Controle de plantas daninhas','Adubação de cobertura','Irrigação','Controle de pragas','Controle de doenças'
    ]))
  )) OR
  (p.culture_subtype_id=v_ratoon_id AND EXISTS(
   SELECT 1 FROM billing_private.management_catalog() catalog
   WHERE catalog.category=p.category AND catalog.operation=p.name
    AND catalog.operation=ANY(ARRAY[
     'Operações pós-colheita','Adubação da soqueira','Irrigação','Manejo da palhada',
     'Controle de plantas daninhas','Controle de pragas','Controle de doenças','Correções e intervenções necessárias'
    ])
  ))
 );

 RETURN jsonb_build_object(
  'culture',jsonb_build_object('id',v_culture_id,'name',v_culture_name),
  'subtypes',v_subtypes,
  'focus',jsonb_build_object('cultureId',v_culture_id,'cultureSubtypeId',v_plant_id),
  'created',jsonb_build_object('cultures',v_created_cultures,'subtypes',v_created_subtypes,'practices',v_created_practices),
  'totalPractices',v_total_practices
 );
END $$;
REVOKE ALL ON FUNCTION billing_private.bootstrap_sugarcane_management(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.bootstrap_sugarcane_management(jsonb) TO authenticated;

COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS 'Authenticated workspace RPC. Manejo exposes a server-owned catalog with soil preparation and cultural-practice associations per crop cycle.';
