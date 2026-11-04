BEGIN;

-- Explicit cell/bulk edits only. No existing import or source evidence is rewritten.
CREATE FUNCTION billing_private.save_import_plot_area(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id(); d public.billing_import_documents;
 ids uuid[]; target uuid; vals jsonb; candidates jsonb; candidate jsonb; choice jsonb;
 choices jsonb:='[]'; updates jsonb:='[]'; item jsonb; farm text; plot text;
 plot_type text; normalized text; selected_id uuid; filled integer:=0;
BEGIN
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Entre para acessar as importações.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize('imports.write');
 PERFORM billing_private.request_payload(p_payload,ARRAY['id','entryIds','value','expectedUpdatedAt','selections']);
 IF jsonb_typeof(p_payload->'value') IS DISTINCT FROM 'string' OR length(p_payload->>'value')>1000
  OR jsonb_typeof(p_payload->'entryIds') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Informe o talhão e as linhas selecionadas.' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_payload->'entryIds') NOT BETWEEN 1 AND 3000 THEN RAISE EXCEPTION 'Selecione entre 1 e 3000 linhas.' USING ERRCODE='22023'; END IF;
 IF p_payload?'selections' AND jsonb_typeof(p_payload->'selections') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Escolhas de talhão inválidas.' USING ERRCODE='22023'; END IF;
 SELECT array_agg(DISTINCT value::uuid) INTO ids FROM jsonb_array_elements_text(p_payload->'entryIds');
 IF cardinality(ids)<>jsonb_array_length(p_payload->'entryIds') THEN RAISE EXCEPTION 'Não repita linhas na seleção.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(coalesce(p_payload->'selections','{}')) k WHERE NOT(k=ANY(ids::text[]))) THEN
  RAISE EXCEPTION 'Escolha fora das linhas selecionadas.' USING ERRCODE='22023'; END IF;
 PERFORM billing_private.lock_request_actor();
 PERFORM pg_advisory_xact_lock(hashtextextended('billing:imports:'||v_owner::text,0));
 SELECT * INTO d FROM public.billing_import_documents WHERE owner_id=v_owner AND id=nullif(p_payload->>'id','')::uuid FOR UPDATE;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Importação não encontrada.' USING ERRCODE='P0002'; END IF;
 IF d.status<>'open' THEN RAISE EXCEPTION 'Reabra a importação antes de alterar o talhão.' USING ERRCODE='23514'; END IF;
 IF nullif(p_payload->>'expectedUpdatedAt','')::timestamptz IS DISTINCT FROM d.updated_at THEN
  RAISE EXCEPTION 'A importação mudou. Atualize antes de salvar.' USING ERRCODE='40001'; END IF;
 IF (SELECT count(*) FROM public.billing_import_entries WHERE owner_id=v_owner AND document_id=d.id AND id=ANY(ids))<>cardinality(ids) THEN
  RAISE EXCEPTION 'A seleção contém linhas fora deste documento.' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(d.profile_snapshot->'fields') f WHERE f->>'key' IN ('COD_TALHAO','AREA'))<>2 THEN
  RAISE EXCEPTION 'O modelo precisa das colunas Talhão e Área.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(d.profile_snapshot->'fields') f WHERE f->>'key' IN ('COD_TALHAO','AREA') AND f->>'type' NOT IN ('text','decimal')) THEN
  RAISE EXCEPTION 'Use Texto ou Número nas colunas Talhão e Área.' USING ERRCODE='22023'; END IF;
 SELECT f->>'type' INTO plot_type FROM jsonb_array_elements(d.profile_snapshot->'fields') f WHERE f->>'key'='COD_TALHAO';
 normalized=billing_private.import_equipment_value(p_payload->>'value',plot_type);
 plot=billing_private.import_plot_code(normalized);
 -- Keep catalog rows stable from lookup through the atomic save (same order as farm/plot RPCs).
 PERFORM 1 FROM public.billing_farms WHERE owner_id=v_owner ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.billing_farm_plots WHERE owner_id=v_owner ORDER BY id FOR SHARE;
 FOREACH target IN ARRAY ids LOOP
  vals=billing_private.import_values_json(v_owner,target);
  farm=billing_private.import_plot_code(vals->>'COD_FAZENDA');
  SELECT coalesce(jsonb_agg(jsonb_build_object('plotId',p.id,'plotName',p.name,'areaHa',billing_private.decimal_text(p.area_ha),
    'updatedAt',p.updated_at,'farmId',f.id,'farmCode',f.code,'farmName',f.name) ORDER BY f.code,f.name,p.name,p.id),'[]') INTO candidates
   FROM public.billing_farm_plots p JOIN public.billing_farms f ON f.owner_id=p.owner_id AND f.id=p.farm_id
   WHERE p.owner_id=v_owner AND plot<>'' AND billing_private.import_plot_code(p.name)=plot
    AND (farm='' OR billing_private.import_plot_code(f.code)=farm);
  choice=p_payload->'selections'->target::text;
  candidate=NULL;
  IF choice IS NOT NULL THEN
   PERFORM billing_private.request_payload(choice,ARRAY['plotId','updatedAt']);
   selected_id=nullif(choice->>'plotId','')::uuid;
   SELECT c INTO candidate FROM jsonb_array_elements(candidates) c WHERE (c->>'plotId')::uuid=selected_id;
   IF candidate IS NULL THEN RAISE EXCEPTION 'Escolha um talhão cadastrado para esta fazenda e este código.' USING ERRCODE='22023'; END IF;
   IF nullif(choice->>'updatedAt','')::timestamptz IS DISTINCT FROM (candidate->>'updatedAt')::timestamptz THEN
    RAISE EXCEPTION 'A área cadastrada mudou. Digite o talhão novamente para conferir.' USING ERRCODE='40001'; END IF;
  ELSIF jsonb_array_length(candidates)=1 THEN candidate=candidates->0;
  ELSIF jsonb_array_length(candidates)>1 THEN
   choices=choices||jsonb_build_array(jsonb_build_object('entryId',target,'farmCode',coalesce(vals->>'COD_FAZENDA',''),'plotCode',normalized,'candidates',candidates));
  END IF;
  -- Unknown/cleared plots clear stale areas; never retain another plot's area.
  vals=vals||jsonb_build_object('COD_TALHAO',normalized,'AREA',coalesce(candidate->>'areaHa',''));
  IF candidate IS NOT NULL THEN
   filled=filled+1;
   IF farm='' AND EXISTS(SELECT 1 FROM jsonb_array_elements(d.profile_snapshot->'fields') f WHERE f->>'key'='COD_FAZENDA') THEN
    vals=vals||jsonb_build_object('COD_FAZENDA',candidate->>'farmCode');
   END IF;
  END IF;
  updates=updates||jsonb_build_array(jsonb_build_object('entryId',target,'values',vals));
 END LOOP;
 -- Return all ambiguities before the first write, including multi-row edits.
 IF jsonb_array_length(choices)>0 THEN RETURN jsonb_build_object('saved',false,'choices',choices); END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(updates) LOOP
  PERFORM billing_private.import_store_values(v_owner,(item->>'entryId')::uuid,d.profile_snapshot->'fields',item->'values',false);
 END LOOP;
 UPDATE public.billing_import_entries SET reviewed=false WHERE owner_id=v_owner AND document_id=d.id AND id=ANY(ids);
 UPDATE public.billing_import_documents SET updated_at=clock_timestamp() WHERE owner_id=v_owner AND id=d.id RETURNING * INTO d;
 RETURN jsonb_build_object('saved',true,'document',billing_private.import_document_json(d),'filledCount',filled,'unmatchedCount',cardinality(ids)-filled);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Confira o talhão, as escolhas e a revisão do documento.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.save_import_plot_area(jsonb) FROM PUBLIC,anon,authenticated;

-- Preserve dispatcher depth and the other concurrent import features.
DO $$
DECLARE definition text:=pg_get_functiondef('billing_private.import_documents_dispatch(text,jsonb)'::regprocedure);
 anchor text:=E'\nBEGIN\n';
BEGIN
 IF strpos(definition,anchor)=0 OR strpos(definition,'save_import_plot_area')>0 THEN RAISE EXCEPTION 'Unexpected import dispatcher for plot areas'; END IF;
 definition=replace(definition,anchor,anchor||$route$ IF p_action='save-plot-area' THEN RETURN billing_private.save_import_plot_area(p_payload); END IF;
$route$);
 EXECUTE definition;
END $$;

COMMIT;
