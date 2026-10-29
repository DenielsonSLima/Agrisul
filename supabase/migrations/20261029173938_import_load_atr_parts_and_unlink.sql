BEGIN;

ALTER TABLE public.billing_import_load_links ADD COLUMN atr_input jsonb NOT NULL DEFAULT '{}'::jsonb
 CHECK(jsonb_typeof(atr_input)='object');

-- The source rows and their exact weights come from the finalized document.
-- A client may supply ATR values, never the weights used for the average.
CREATE FUNCTION billing_private.import_load_parts(p_document public.billing_import_documents,p_trip text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 WITH entries AS MATERIALIZED (
  SELECT e,ordinality pos,coalesce(nullif(e->>'groupKey',''),'entry:'||(e->>'id')) trip,
   coalesce(e->'values'->>'COD_FAZENDA','') farm,coalesce(e->'values'->>'COD_TALHAO','') plot
  FROM jsonb_array_elements(billing_private.import_document_json(p_document)->'entries') WITH ORDINALITY x(e,ordinality)
 ), origins AS (
  SELECT trip,count(DISTINCT jsonb_build_array(farm,plot)) n FROM entries GROUP BY trip
 ), selected AS (
  SELECT e.*,row_number() OVER(ORDER BY pos) part_number FROM entries e JOIN origins o USING(trip)
  WHERE CASE WHEN o.n>1 THEN e.trip||'|origin:'||jsonb_build_array(e.farm,e.plot)::text ELSE e.trip END=p_trip
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'entryId',e->>'id','label','Parte '||part_number::text||
   CASE WHEN nullif(e->'source'->>'numeroAnalise','') IS NOT NULL THEN ' · Análise '||(e->'source'->>'numeroAnalise') ELSE '' END,
  'volume',billing_private.decimal_text(CASE WHEN e->'values'->>'PESOBRUTO' ~ '^[0-9]+([.][0-9]+)?$'
   AND e->'values'->>'TARA' ~ '^[0-9]+([.][0-9]+)?$'
   THEN (e->'values'->>'PESOBRUTO')::numeric-(e->'values'->>'TARA')::numeric END)
 ) ORDER BY pos),'[]'::jsonb) FROM selected
$$;
REVOKE ALL ON FUNCTION billing_private.import_load_parts(public.billing_import_documents,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.import_load_atr(p_parts jsonb,p_mode text,p_atr text,p_values jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE part jsonb;item jsonb;v_text text;v_atr numeric;v_total numeric:=0;v_weight numeric:=0;
 v_missing integer:=0;v_parts jsonb:='[]';v_seen text[]:='{}';
BEGIN
 IF p_mode IS NULL OR p_mode NOT IN ('pending','general','parts') OR jsonb_typeof(p_values) IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_values)>1000 THEN RAISE EXCEPTION 'Confira o modo e os valores de ATR.' USING ERRCODE='22023'; END IF;
 IF p_mode<>'parts' AND jsonb_array_length(p_values)>0 THEN RAISE EXCEPTION 'Envie os ATRs por parte somente no modo por parte.' USING ERRCODE='22023'; END IF;
 IF p_mode='pending' THEN
  IF btrim(coalesce(p_atr,''))<>'' THEN RAISE EXCEPTION 'Selecione média geral para informar o ATR.' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('mode',p_mode,'average',NULL,'complete',true,'parts','[]'::jsonb);
 END IF;
 IF p_mode='general' THEN
  v_text=replace(btrim(coalesce(p_atr,'')),',','.');
  IF v_text='' THEN RETURN jsonb_build_object('mode',p_mode,'average',NULL,'complete',false,'parts','[]'::jsonb); END IF;
  IF v_text!~'^[0-9]{1,9}([.][0-9]{1,6})?$' THEN RAISE EXCEPTION 'Informe um ATR positivo, com até seis casas decimais.' USING ERRCODE='22023'; END IF;
  v_atr=v_text::numeric;
  IF v_atr<=0 THEN RAISE EXCEPTION 'O ATR deve ser maior que zero.' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('mode',p_mode,'average',billing_private.decimal_text(v_atr),'complete',true,'parts','[]'::jsonb);
 END IF;
 IF btrim(coalesce(p_atr,''))<>'' THEN RAISE EXCEPTION 'Envie somente os valores individuais no modo por parte.' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_values) LOOP
  PERFORM billing_private.request_payload(item,ARRAY['entryId','atr']);
  IF jsonb_typeof(item->'entryId') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'atr') IS DISTINCT FROM 'string'
   OR item->>'entryId'=ANY(v_seen) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_parts) p WHERE p->>'entryId'=item->>'entryId') THEN
   RAISE EXCEPTION 'As partes do ATR não correspondem a esta origem.' USING ERRCODE='22023';
  END IF;
  v_seen=array_append(v_seen,item->>'entryId');
 END LOOP;
 FOR part IN SELECT value FROM jsonb_array_elements(p_parts) LOOP
  SELECT value INTO item FROM jsonb_array_elements(p_values) WHERE value->>'entryId'=part->>'entryId';
  v_text=replace(btrim(coalesce(item->>'atr','')),',','.');
  IF v_text='' THEN v_missing=v_missing+1;CONTINUE;END IF;
  IF v_text!~'^[0-9]{1,9}([.][0-9]{1,6})?$' THEN RAISE EXCEPTION 'Confira o ATR de cada parte: até seis casas decimais.' USING ERRCODE='22023'; END IF;
  v_atr=v_text::numeric;
  IF v_atr<=0 OR nullif(part->>'volume','')::numeric IS NULL OR (part->>'volume')::numeric<=0 THEN
   RAISE EXCEPTION 'O ATR e o peso líquido de cada parte devem ser positivos.' USING ERRCODE='22023';
  END IF;
  v_total=v_total+v_atr*(part->>'volume')::numeric;v_weight=v_weight+(part->>'volume')::numeric;
  v_parts=v_parts||jsonb_build_array(jsonb_build_object('entryId',part->>'entryId','atr',billing_private.decimal_text(v_atr),'volume',part->>'volume'));
 END LOOP;
 RETURN jsonb_build_object('mode',p_mode,'average',CASE WHEN v_missing=0 AND v_weight>0 THEN billing_private.decimal_text(round(v_total/v_weight,6)) END,
  'complete',v_missing=0 AND v_weight>0,'parts',v_parts);
END $$;
REVOKE ALL ON FUNCTION billing_private.import_load_atr(jsonb,text,text,jsonb) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.import_documents_dispatch(text,jsonb) RENAME TO import_documents_before_atr_link_dispatch;
REVOKE ALL ON FUNCTION billing_private.import_documents_before_atr_link_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.import_documents_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();c public.billing_contracts;d public.billing_import_documents;
 l public.billing_contract_loads;v_result jsonb;v_parts jsonb;v_atr jsonb;candidate record;v_allowed text[];
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('pending-loads','link-load','atr-preview','unlink-load') THEN
  RETURN billing_private.import_documents_before_atr_link_dispatch(p_action,p_payload);
 END IF;
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Entre para acessar os carregamentos.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize('contracts.read');
 IF p_action IN ('link-load','unlink-load') THEN PERFORM billing_private.authorize('contracts.write'); END IF;
 IF p_action='pending-loads' THEN
  v_result=billing_private.import_documents_before_atr_link_dispatch(p_action,p_payload);
  SELECT coalesce(jsonb_agg(item||jsonb_build_object('parts',billing_private.import_load_parts(doc,item->>'tripKey')) ORDER BY pos),'[]'::jsonb)
   INTO v_parts FROM jsonb_array_elements(v_result->'loads') WITH ORDINALITY x(item,pos)
   JOIN public.billing_import_documents doc ON doc.owner_id=v_owner AND doc.id=(item->>'documentId')::uuid;
  RETURN v_result||jsonb_build_object('loads',v_parts);
 END IF;
 v_allowed=CASE WHEN p_action='unlink-load' THEN ARRAY['companyId','contractId','loadId','expectedUpdatedAt']
  ELSE ARRAY['companyId','contractId','id','tripKey','expectedUpdatedAt','atrMode','atr','atrParts'] END;
 IF p_action='link-load' THEN v_allowed=v_allowed||ARRAY['farmId','plotId'];END IF;
 PERFORM billing_private.request_payload(p_payload,v_allowed);
 IF EXISTS(SELECT 1 FROM jsonb_each(p_payload) x WHERE x.key<>'atrParts' AND jsonb_typeof(x.value)<>'string') THEN
  RAISE EXCEPTION 'Envie os identificadores e ATR como texto.' USING ERRCODE='22023'; END IF;
 IF p_action IN ('link-load','unlink-load') THEN
  PERFORM billing_private.lock_request_actor();
  PERFORM pg_advisory_xact_lock(hashtextextended('billing:imports:'||v_owner::text,0));
 END IF;
 SELECT * INTO c FROM public.billing_contracts WHERE owner_id=v_owner AND id=nullif(p_payload->>'contractId','')::uuid
  AND company_id=nullif(p_payload->>'companyId','')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado para a empresa ativa.' USING ERRCODE='P0002'; END IF;
 IF p_action IN ('link-load','unlink-load') THEN
  SELECT * INTO c FROM public.billing_contracts WHERE owner_id=v_owner AND id=c.id FOR UPDATE;
 END IF;
 IF p_action='unlink-load' THEN
  SELECT * INTO l FROM public.billing_contract_loads WHERE owner_id=v_owner AND contract_id=c.id AND id=nullif(p_payload->>'loadId','')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.billing_import_load_links WHERE owner_id=v_owner AND load_id=l.id) THEN
   RAISE EXCEPTION 'Vínculo importado não encontrado neste contrato.' USING ERRCODE='P0002';END IF;
  IF nullif(p_payload->>'expectedUpdatedAt','')::timestamptz IS DISTINCT FROM l.updated_at THEN
   RAISE EXCEPTION 'O carregamento mudou. Atualize a lista antes de remover o vínculo.' USING ERRCODE='40001';END IF;
  PERFORM billing_private.contracts_company_dispatch('delete-load',jsonb_build_object('companyId',c.company_id::text,'contractId',c.id::text,'id',l.id::text));
  RETURN jsonb_build_object('id',l.id,'unlinked',true);
 END IF;
 SELECT * INTO d FROM public.billing_import_documents WHERE owner_id=v_owner AND id=nullif(p_payload->>'id','')::uuid AND client_id=c.client_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Documento não encontrado para o parceiro do contrato.' USING ERRCODE='P0002';END IF;
 IF p_action='link-load' THEN
  SELECT * INTO d FROM public.billing_import_documents WHERE owner_id=v_owner AND id=d.id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.billing_import_load_links WHERE owner_id=v_owner AND document_id=d.id AND trip_key=p_payload->>'tripKey') THEN
   RETURN billing_private.import_documents_before_atr_link_dispatch(p_action,p_payload-ARRAY['atrMode','atr','atrParts']);
  END IF;
 END IF;
 IF d.status<>'finished' THEN RAISE EXCEPTION 'Finalize o documento antes de vincular.' USING ERRCODE='23514'; END IF;
 IF nullif(p_payload->>'expectedUpdatedAt','')::timestamptz IS DISTINCT FROM d.updated_at THEN
  RAISE EXCEPTION 'O documento foi alterado. Atualize a fila antes de vincular.' USING ERRCODE='40001'; END IF;
 SELECT * INTO candidate FROM billing_private.import_load_candidates(d) WHERE trip_key=p_payload->>'tripKey';
 IF NOT FOUND THEN RAISE EXCEPTION 'Origem não encontrada neste conjunto.' USING ERRCODE='P0002'; END IF;
 IF candidate.issue<>'' THEN RAISE EXCEPTION '%',candidate.issue USING ERRCODE='23514';END IF;
 IF billing_private.contract_import_harvest_method(c.type_name) IS NOT NULL AND candidate.harvest_method IS DISTINCT FROM billing_private.contract_import_harvest_method(c.type_name) THEN
  RAISE EXCEPTION 'A colheita da coluna K não corresponde ao contrato.' USING ERRCODE='23514';END IF;
 v_parts=billing_private.import_load_parts(d,candidate.trip_key);
 v_atr=billing_private.import_load_atr(v_parts,coalesce(p_payload->>'atrMode','pending'),coalesce(p_payload->>'atr',''),coalesce(p_payload->'atrParts','[]'::jsonb));
 IF p_action='atr-preview' THEN RETURN v_atr;END IF;
 IF NOT (v_atr->>'complete')::boolean THEN RAISE EXCEPTION 'Preencha o ATR de todas as partes ou informe a média geral.' USING ERRCODE='22023';END IF;
 v_result=billing_private.import_documents_before_atr_link_dispatch(p_action,p_payload-ARRAY['atrMode','atr','atrParts']);
 IF (v_result->>'created')::boolean THEN
  UPDATE public.billing_contract_loads SET atr=nullif(v_atr->>'average','')::numeric
   WHERE owner_id=v_owner AND id=(v_result->'load'->>'id')::uuid RETURNING * INTO l;
  UPDATE public.billing_import_load_links SET atr_input=v_atr WHERE owner_id=v_owner AND load_id=l.id;
  v_result=v_result||jsonb_build_object('load',billing_private.present_contract_load(l));
 END IF;
 RETURN v_result;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Confira os identificadores, a revisão e os valores do carregamento.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.import_documents_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;

DO $$
DECLARE definition text:=pg_get_functiondef('billing_private.present_contract_load(public.billing_contract_loads)'::regprocedure);
 anchor text:=$anchor$'plotName',coalesce(plot.name,'')$anchor$;
BEGIN
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected contract load projection';END IF;
 definition=replace(definition,anchor,anchor||$new$,
  'imported',EXISTS(SELECT 1 FROM public.billing_import_load_links link WHERE link.owner_id=p_load.owner_id AND link.load_id=p_load.id)$new$);
 EXECUTE definition;
END $$;
DO $$
DECLARE definition text:=pg_get_functiondef('billing_private.contract_loads_list(jsonb)'::regprocedure);
 source_anchor text:=$anchor$SELECT l.*,f.name farm_name,$anchor$;
 json_anchor text:=$anchor$'document',document,'notes',notes,'createdAt',created_at,'updatedAt',updated_at$anchor$;
BEGIN
 IF strpos(definition,source_anchor)=0 OR strpos(definition,json_anchor)=0 THEN RAISE EXCEPTION 'Unexpected contract loads list projection';END IF;
 definition=replace(definition,source_anchor,$new$SELECT l.*,f.name farm_name,
  EXISTS(SELECT 1 FROM public.billing_import_load_links link WHERE link.owner_id=l.owner_id AND link.load_id=l.id) imported,$new$);
 definition=replace(definition,json_anchor,json_anchor||$new$,'imported',imported$new$);
 EXECUTE definition;
END $$;
COMMIT;
