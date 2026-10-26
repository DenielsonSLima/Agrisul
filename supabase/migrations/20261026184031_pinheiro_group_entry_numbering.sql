BEGIN;

-- Only the database allocates entry numbers. Layouts without an explicit start
-- keep empty entries until an operator configures one or usable history exists.
CREATE FUNCTION billing_private.import_numbering_field(p_config jsonb,p_manual boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE fields jsonb;result text;
BEGIN
 IF p_config->>'parser' NOT IN ('pinheiro-usjp-v1','taquari-equipment-v1') THEN RETURN NULL; END IF;
 SELECT coalesce(jsonb_agg(f),'[]'::jsonb) INTO fields FROM jsonb_array_elements(p_config->'fields') f
 WHERE f->>'source'='pdf' AND f->>'sourceKey'='entradaSequencialConjunto';
 IF jsonb_array_length(fields)>1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(fields) f WHERE f->>'type' IS DISTINCT FROM 'decimal') THEN
  RAISE EXCEPTION 'Configure somente uma entrada sequencial, com tipo numérico.' USING ERRCODE='23514'; END IF;
 result=fields->0->>'key';
 IF result IS NULL AND p_manual THEN
  SELECT f->>'key' INTO result FROM jsonb_array_elements(p_config->'fields') f
  WHERE f->>'key'='COD_ENTRADA' AND f->>'type' IN ('text','decimal');
 END IF;
 RETURN result;
END $$;

CREATE FUNCTION billing_private.import_numbering_config(p_config jsonb,p_previous jsonb,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE start_value text;
BEGIN
 IF p_payload?'entrySequenceStart' AND jsonb_typeof(p_payload->'entrySequenceStart') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Informe a entrada inicial como texto, com até 15 dígitos.' USING ERRCODE='22023'; END IF;
 start_value=CASE WHEN p_payload?'entrySequenceStart' THEN p_payload->>'entrySequenceStart'
  ELSE coalesce(p_previous->>'entrySequenceStart',CASE WHEN p_config->>'parser'='pinheiro-usjp-v1' THEN '806' END) END;
 IF start_value='' AND p_config->>'parser'='taquari-equipment-v1' THEN start_value=NULL; END IF;
 IF start_value IS NOT NULL AND start_value!~'^[1-9][0-9]{0,14}$' THEN
  RAISE EXCEPTION 'A entrada inicial deve ser inteira, positiva e ter até 15 dígitos.' USING ERRCODE='22023'; END IF;
 PERFORM billing_private.import_numbering_field(p_config);
 RETURN (p_config-'entrySequenceStart')||CASE WHEN start_value IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('entrySequenceStart',start_value) END;
END $$;

-- Current typed cells are authoritative when historical imports were corrected.
CREATE FUNCTION billing_private.import_saved_entry_codes(p_owner uuid,p_client uuid,p_parser text,p_exclude uuid)
RETURNS TABLE(group_key jsonb,entry_code numeric,invalid boolean)
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH raw AS (
 SELECT billing_private.import_source_group_key(e.source,p_parser) group_key,
 coalesce(v.text_value,billing_private.decimal_text(v.decimal_value),v.date_value::text,'') raw_code
 FROM public.billing_import_documents d
 JOIN public.billing_import_entries e ON e.owner_id=d.owner_id AND e.document_id=d.id
 CROSS JOIN LATERAL(SELECT f->>'key' field_key FROM jsonb_array_elements(d.profile_snapshot->'fields') f
 WHERE f->>'key'='COD_ENTRADA' OR (f->>'source'='pdf' AND f->>'sourceKey'='entradaSequencialConjunto')
 ORDER BY CASE WHEN f->>'source'='pdf' AND f->>'sourceKey'='entradaSequencialConjunto' THEN 0 ELSE 1 END LIMIT 1) selected
 JOIN public.billing_import_entry_values v ON v.owner_id=e.owner_id AND v.entry_id=e.id AND v.field_key=selected.field_key
 WHERE d.owner_id=p_owner AND d.client_id=p_client AND d.profile_snapshot->>'parser'=p_parser AND d.id IS DISTINCT FROM p_exclude
 ), parsed AS (
 SELECT group_key,raw_code,CASE WHEN raw_code~'^[0-9]{1,15}$' THEN CASE WHEN raw_code::numeric>0 THEN raw_code::numeric END END code FROM raw
 ) SELECT group_key,code,(raw_code<>'' AND code IS NULL) FROM parsed
$$;

CREATE FUNCTION billing_private.number_import_groups(p_owner uuid,p_client uuid,p_config jsonb,p_entries jsonb,
 p_exclude uuid DEFAULT NULL,p_anchor uuid DEFAULT NULL,p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_key text;v_parser text:=p_config->>'parser';next_code numeric;maximum_code numeric;history jsonb;reverse_codes jsonb;
 assigned jsonb:='{}';prefix_codes jsonb:='{}';g record;known jsonb;code numeric;result jsonb;anchor_key jsonb;anchor_position bigint;
BEGIN
 IF auth.uid() IS NULL OR p_owner IS DISTINCT FROM billing_private.current_owner_id() THEN RAISE EXCEPTION 'Entre para numerar os conjuntos.' USING ERRCODE='28000'; END IF;
 v_key=billing_private.import_numbering_field(p_config,p_force);
 IF v_key IS NULL THEN RETURN p_entries; END IF;
 IF p_config?'entrySequenceStart' AND coalesce(p_config->>'entrySequenceStart','')!~'^[1-9][0-9]{0,14}$' THEN
  RAISE EXCEPTION 'Entrada inicial inválida.' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('billing:imports:'||p_owner::text,0));
 WITH saved AS MATERIALIZED(SELECT * FROM billing_private.import_saved_entry_codes(p_owner,p_client,v_parser,p_exclude)),
 grouped AS(SELECT group_key,jsonb_build_object('codes',coalesce(jsonb_agg(DISTINCT entry_code::text) FILTER(WHERE entry_code IS NOT NULL),'[]'::jsonb),'invalid',bool_or(invalid)) data FROM saved WHERE group_key IS NOT NULL GROUP BY group_key),
 reversed AS(SELECT entry_code,coalesce(jsonb_agg(DISTINCT group_key) FILTER(WHERE group_key IS NOT NULL),'[]'::jsonb) keys FROM saved WHERE entry_code IS NOT NULL GROUP BY entry_code)
 SELECT (SELECT max(entry_code) FROM saved),coalesce((SELECT jsonb_object_agg(group_key::text,data) FROM grouped),'{}'::jsonb),
 coalesce((SELECT jsonb_object_agg(entry_code::text,keys) FROM reversed),'{}'::jsonb) INTO maximum_code,history,reverse_codes;
 IF p_force THEN
  IF p_config->>'entrySequenceStart' IS NULL THEN RAISE EXCEPTION 'Informe a entrada inicial para distribuir os conjuntos.' USING ERRCODE='22023'; END IF;
  next_code=(p_config->>'entrySequenceStart')::numeric;
 ELSE
  next_code=CASE WHEN p_config?'entrySequenceStart' OR maximum_code IS NOT NULL THEN greatest((p_config->>'entrySequenceStart')::numeric,maximum_code+1) END;
 END IF;
 IF p_anchor IS NOT NULL THEN
  SELECT billing_private.import_source_group_key(x->'source',v_parser) INTO anchor_key FROM jsonb_array_elements(p_entries) x WHERE x->>'id'=p_anchor::text;
  IF anchor_key IS NULL THEN RAISE EXCEPTION 'O lançamento âncora precisa pertencer a um conjunto original deste documento.' USING ERRCODE='22023'; END IF;
  SELECT min(n) INTO anchor_position FROM jsonb_array_elements(p_entries) WITH ORDINALITY x(value,n) WHERE billing_private.import_source_group_key(value->'source',v_parser)=anchor_key;
 END IF;
 -- Reserve untouched prefix codes; an anchored correction may never collide with them.
 IF anchor_position IS NOT NULL THEN
  SELECT coalesce(jsonb_object_agg(prefix.code,prefix.key),'{}'::jsonb) INTO prefix_codes FROM (
   SELECT DISTINCT x.value->'values'->>v_key code,billing_private.import_source_group_key(x.value->'source',v_parser) key
   FROM jsonb_array_elements(p_entries) WITH ORDINALITY x(value,n)
   WHERE (SELECT min(y.n) FROM jsonb_array_elements(p_entries) WITH ORDINALITY y(value,n) WHERE billing_private.import_source_group_key(y.value->'source',v_parser)=billing_private.import_source_group_key(x.value->'source',v_parser))<anchor_position
    AND coalesce(x.value->'values'->>v_key,'')~'^[1-9][0-9]{0,14}$'
  ) prefix;
 END IF;
 FOR g IN SELECT billing_private.import_source_group_key(x.value->'source',v_parser) key,min(x.position) position
 FROM jsonb_array_elements(p_entries) WITH ORDINALITY x(value,position)
 GROUP BY billing_private.import_source_group_key(x.value->'source',v_parser) ORDER BY min(x.position)
 LOOP
  IF anchor_position IS NOT NULL AND g.position<anchor_position THEN CONTINUE; END IF;
  IF g.key IS NULL THEN
   IF p_exclude IS NOT NULL THEN CONTINUE; END IF;
   RAISE EXCEPTION 'Não foi possível identificar o conjunto original para numerar a entrada.' USING ERRCODE='23514'; END IF;
  known=history->(g.key::text);
  IF coalesce((known->>'invalid')::boolean,false) OR coalesce(jsonb_array_length(known->'codes'),0)>1 THEN
   RAISE EXCEPTION 'O conjunto possui entradas divergentes no histórico deste cliente. Confira os documentos anteriores.' USING ERRCODE='23514'; END IF;
  IF p_force THEN
   code=next_code;next_code=next_code+1;
   IF coalesce(jsonb_array_length(known->'codes'),0)=1 AND (known->'codes'->>0)::numeric<>code THEN
    RAISE EXCEPTION 'O conjunto já possui outra entrada no histórico deste cliente.' USING ERRCODE='23514'; END IF;
  ELSIF coalesce(jsonb_array_length(known->'codes'),0)=1 THEN code=(known->'codes'->>0)::numeric;
  ELSE code=next_code;next_code=next_code+1; END IF;
  IF code>999999999999999 THEN RAISE EXCEPTION 'A sequência de entradas ultrapassou o limite de 15 dígitos.' USING ERRCODE='23514'; END IF;
  IF code IS NOT NULL AND (
   EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(reverse_codes->(code::text),'[]'::jsonb)) h WHERE h<>g.key)
   OR (prefix_codes?(code::text) AND prefix_codes->(code::text)<>g.key)
   OR EXISTS(SELECT 1 FROM jsonb_each_text(assigned) a WHERE a.value=code::text AND a.key<>g.key::text)
  ) THEN RAISE EXCEPTION 'A entrada já pertence a outro conjunto deste cliente.' USING ERRCODE='23514'; END IF;
  assigned=jsonb_set(assigned,ARRAY[g.key::text],to_jsonb(coalesce(billing_private.decimal_text(code),'')));
 END LOOP;
 SELECT jsonb_agg(CASE WHEN assigned?(billing_private.import_source_group_key(x.value->'source',v_parser)::text) THEN x.value||jsonb_build_object(
 'source',(x.value->'source')||jsonb_build_object('entradaSequencialConjunto',assigned->>(billing_private.import_source_group_key(x.value->'source',v_parser)::text)),
 'values',(x.value->'values')||jsonb_build_object(v_key,assigned->>(billing_private.import_source_group_key(x.value->'source',v_parser)::text))) ELSE x.value END ORDER BY x.position)
 INTO result FROM jsonb_array_elements(p_entries) WITH ORDINALITY x(value,position);
 RETURN result;
END $$;

DO $$ DECLARE definition text; BEGIN
 definition=pg_get_functiondef('billing_private.import_profile_source_key_allowed(text,text)'::regprocedure);
 IF strpos(definition,$old$'taraConvencional','pesoBrutoConvencional')$old$)=0 THEN RAISE EXCEPTION 'Source whitelist missing.'; END IF;
 definition=replace(definition,$old$'taraConvencional','pesoBrutoConvencional')$old$,$new$'taraConvencional','pesoBrutoConvencional','entradaSequencialConjunto')$new$);
 definition=replace(definition,$old$'quantidadeVeiculosConjunto','notaFiscal'$old$,$new$'quantidadeVeiculosConjunto','entradaSequencialConjunto','notaFiscal'$new$);
 EXECUTE definition;
 definition=pg_get_functiondef('billing_private.import_profiles_dispatch_before_lifecycle(text,jsonb)'::regprocedure);
 IF strpos(definition,$old$'templateName','expectedUpdatedAt']$old$)=0 OR strpos(definition,$old$IF old.id IS NULL THEN INSERT INTO public.billing_import_profiles$old$)=0 THEN RAISE EXCEPTION 'Profile config insertion missing.'; END IF;
 definition=replace(definition,$old$'templateName','expectedUpdatedAt']$old$,$new$'templateName','expectedUpdatedAt','entrySequenceStart']$new$);
 definition=replace(definition,$old$IF old.id IS NULL THEN INSERT INTO public.billing_import_profiles$old$,$new$v_config=billing_private.import_numbering_config(v_config,old.config,p_payload);
 IF old.id IS NULL THEN INSERT INTO public.billing_import_profiles$new$);
 EXECUTE definition;
 definition=pg_get_functiondef('billing_private.import_documents_dispatch_before_client_summaries(text,jsonb)'::regprocedure);
 IF strpos(definition,$old$billing_private.normalize_taquari_vehicle_groups(p_payload->'entries',p.config->'fields'));
  END IF;$old$)=0 THEN RAISE EXCEPTION 'Import normalization missing.'; END IF;
 EXECUTE replace(definition,$old$billing_private.normalize_taquari_vehicle_groups(p_payload->'entries',p.config->'fields'));
  END IF;$old$,$new$billing_private.normalize_taquari_vehicle_groups(p_payload->'entries',p.config->'fields'));
  END IF;
  p_payload=jsonb_set(p_payload,'{entries}',billing_private.number_import_groups(v_owner,v_client,p.config,p_payload->'entries'));$new$);
 definition=pg_get_functiondef('billing_private.import_documents_dispatch(text,jsonb)'::regprocedure);
 IF strpos(definition,$old$profile_snapshot=jsonb_set(profile_snapshot,'{fields}',p.config->'fields'),updated_at$old$)=0 THEN RAISE EXCEPTION 'Field rule refresh missing.'; END IF;
 EXECUTE replace(definition,$old$profile_snapshot=jsonb_set(profile_snapshot,'{fields}',p.config->'fields'),updated_at$old$,
 $new$profile_snapshot=(jsonb_set(profile_snapshot,'{fields}',p.config->'fields')-'entrySequenceStart')||CASE WHEN p.config?'entrySequenceStart' THEN jsonb_build_object('entrySequenceStart',p.config->'entrySequenceStart') WHEN p.config->>'parser'='pinheiro-usjp-v1' THEN jsonb_build_object('entrySequenceStart','806') ELSE '{}'::jsonb END,updated_at$new$);
END $$;

ALTER FUNCTION billing_private.import_documents_dispatch(text,jsonb) RENAME TO import_documents_dispatch_before_group_numbering;
REVOKE ALL ON FUNCTION billing_private.import_documents_dispatch_before_group_numbering(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.import_documents_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();r public.billing_import_documents;row_entry public.billing_import_entries;
 v_key text;v_type text;config jsonb;entries jsonb;numbered jsonb;item jsonb;new_code text;new_source jsonb;
 anchor_id uuid;old_code text;response jsonb;do_number boolean:=false;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('number-groups','finalize','save-entry','save-bulk') THEN RETURN billing_private.import_documents_dispatch_before_group_numbering(p_action,p_payload); END IF;
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Entre para acessar as importações.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize('registrations.write');
 IF p_action IN ('number-groups','finalize') THEN
  PERFORM billing_private.request_payload(p_payload,CASE WHEN p_action='number-groups' THEN ARRAY['id','expectedUpdatedAt','start','anchorEntryId'] ELSE ARRAY['id','expectedUpdatedAt'] END);
 END IF;
 PERFORM billing_private.lock_request_actor();PERFORM pg_advisory_xact_lock(hashtextextended('billing:imports:'||v_owner::text,0));
 SELECT * INTO r FROM public.billing_import_documents WHERE owner_id=v_owner AND id=nullif(p_payload->>'id','')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Importação não encontrada.' USING ERRCODE='P0002'; END IF;
 IF nullif(p_payload->>'expectedUpdatedAt','')::timestamptz IS DISTINCT FROM r.updated_at THEN RAISE EXCEPTION 'A importação foi alterada. Atualize antes de continuar.' USING ERRCODE='PT409'; END IF;
 IF r.status<>'open' THEN RAISE EXCEPTION 'Reabra a importação antes de alterar seus conjuntos.' USING ERRCODE='23514'; END IF;
 v_key=billing_private.import_numbering_field(r.profile_snapshot,p_action<>'finalize');
 IF p_action IN ('save-entry','save-bulk') THEN
  IF v_key IS NOT NULL THEN
   IF p_action='save-entry' AND nullif(p_payload->>'entryId','') IS NOT NULL THEN
    anchor_id=(p_payload->>'entryId')::uuid;
    SELECT billing_private.import_values_json(v_owner,e.id)->>v_key INTO old_code FROM public.billing_import_entries e WHERE e.owner_id=v_owner AND e.document_id=r.id AND e.id=anchor_id
     AND billing_private.import_source_group_key(e.source,r.profile_snapshot->>'parser') IS NOT NULL;
    IF NOT FOUND THEN anchor_id=NULL; END IF;
   ELSIF p_action='save-bulk' AND (p_payload->>'fieldKey'=v_key OR p_payload->'fieldKeys'?v_key) THEN
    do_number=true;
    -- Earliest selected group, then earliest selected row; the payload array
    -- never controls the anchor when rows are selected in reverse order.
    WITH original AS(SELECT e.id,e.position,billing_private.import_source_group_key(e.source,r.profile_snapshot->>'parser') key FROM public.billing_import_entries e WHERE e.owner_id=v_owner AND e.document_id=r.id),
    groups AS(SELECT key,min(position) first_position FROM original GROUP BY key)
    SELECT e.id INTO anchor_id FROM original e JOIN groups g ON g.key=e.key WHERE p_payload->'entryIds'?e.id::text ORDER BY g.first_position,e.position,e.id LIMIT 1;
   END IF;
  END IF;
  response=billing_private.import_documents_dispatch_before_group_numbering(p_action,p_payload);
  IF anchor_id IS NOT NULL THEN
   new_code=billing_private.import_values_json(v_owner,anchor_id)->>v_key;
   IF do_number OR new_code IS DISTINCT FROM old_code THEN
    RETURN billing_private.import_documents_dispatch('number-groups',jsonb_build_object('id',r.id,'expectedUpdatedAt',response->'document'->>'updatedAt','start',new_code,'anchorEntryId',anchor_id));
   END IF;
  END IF;
  RETURN response;
 END IF;
 IF p_action='number-groups' THEN
  IF v_key IS NULL THEN RAISE EXCEPTION 'Configure a coluna COD_ENTRADA neste modelo para distribuir os conjuntos.' USING ERRCODE='23514'; END IF;
  IF p_payload?'start' AND (jsonb_typeof(p_payload->'start') IS DISTINCT FROM 'string' OR p_payload->>'start'!~'^[1-9][0-9]{0,14}$') THEN
   RAISE EXCEPTION 'Informe uma entrada inicial inteira e positiva, com até 15 dígitos.' USING ERRCODE='22023'; END IF;
  config=r.profile_snapshot;
  IF p_payload?'start' THEN config=jsonb_set(config,'{entrySequenceStart}',p_payload->'start'); END IF;
  IF NOT config?'entrySequenceStart' AND config->>'parser'='pinheiro-usjp-v1' THEN config=jsonb_set(config,'{entrySequenceStart}','"806"'); END IF;
  SELECT jsonb_agg(jsonb_build_object('id',e.id,'source',e.source,'values',billing_private.import_values_json(v_owner,e.id)) ORDER BY e.position,e.id) INTO entries FROM public.billing_import_entries e WHERE e.owner_id=v_owner AND e.document_id=r.id;
  numbered=billing_private.number_import_groups(v_owner,r.client_id,config,entries,r.id,nullif(p_payload->>'anchorEntryId','')::uuid,p_payload?'start' OR p_payload?'anchorEntryId');
  SELECT f->>'type' INTO v_type FROM jsonb_array_elements(config->'fields') f WHERE f->>'key'=v_key;
  FOR item IN SELECT value FROM jsonb_array_elements(numbered) LOOP
   SELECT * INTO row_entry FROM public.billing_import_entries WHERE owner_id=v_owner AND document_id=r.id AND id=(item->>'id')::uuid;
   new_code=item->'values'->>v_key;new_source=item->'source';
   IF length(new_source::text)>30000 THEN RAISE EXCEPTION 'Limite de informações de origem atingido.' USING ERRCODE='23514'; END IF;
   IF billing_private.import_values_json(v_owner,row_entry.id)->>v_key IS DISTINCT FROM new_code OR row_entry.source IS DISTINCT FROM new_source THEN
    IF coalesce(new_code,'')='' THEN
     DELETE FROM public.billing_import_entry_values WHERE owner_id=v_owner AND entry_id=row_entry.id AND field_key=v_key;
    ELSE
    INSERT INTO public.billing_import_entry_values(owner_id,entry_id,field_key,text_value,decimal_value) VALUES(v_owner,row_entry.id,v_key,CASE WHEN v_type='text' THEN nullif(new_code,'') END,CASE WHEN v_type='decimal' THEN nullif(new_code,'')::numeric END)
    ON CONFLICT ON CONSTRAINT billing_import_entry_values_pkey DO UPDATE SET decimal_value=excluded.decimal_value,text_value=excluded.text_value,date_value=NULL;
    END IF;
    UPDATE public.billing_import_entries SET source=new_source,reviewed=false WHERE owner_id=v_owner AND id=row_entry.id;
   END IF;
  END LOOP;
  -- A suffix anchor does not replace the document's starting number.
  new_code=numbered->0->'values'->>v_key;
  UPDATE public.billing_import_documents SET profile_snapshot=CASE WHEN coalesce(new_code,'')~'^[1-9][0-9]{0,14}$' THEN jsonb_set(profile_snapshot,'{entrySequenceStart}',to_jsonb(new_code)) ELSE profile_snapshot END,updated_at=clock_timestamp() WHERE owner_id=v_owner AND id=r.id RETURNING * INTO r;
  RETURN jsonb_build_object('document',billing_private.import_document_json(r));
 END IF;
 IF v_key IS NOT NULL THEN
  IF r.profile_snapshot->>'parser'='pinheiro-usjp-v1' AND (
   NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.profile_snapshot->'fields') f WHERE f->>'key'='COD_EQUIPAMENTO_TRANSPORTE')
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.profile_snapshot->'fields') f WHERE f->>'key'='COD_EQUIPAMENTO_COMPARTIMENTO')
   OR EXISTS(SELECT 1 FROM public.billing_import_entries e WHERE e.owner_id=v_owner AND e.document_id=r.id AND
    (coalesce(btrim(billing_private.import_values_json(v_owner,e.id)->>'COD_EQUIPAMENTO_TRANSPORTE'),'')=''
     OR coalesce(btrim(billing_private.import_values_json(v_owner,e.id)->>'COD_EQUIPAMENTO_COMPARTIMENTO'),'')=''))) THEN
   RAISE EXCEPTION 'Preencha os equipamentos de transporte e compartimento de todos os lançamentos antes de finalizar.' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM public.billing_import_entries e WHERE e.owner_id=v_owner AND e.document_id=r.id AND
   coalesce(billing_private.import_values_json(v_owner,e.id)->>v_key,'')!~'^[1-9][0-9]{0,14}$') THEN
   RAISE EXCEPTION 'Todos os lançamentos precisam de uma entrada inteira e positiva para seu conjunto original.' USING ERRCODE='23514'; END IF;
  SELECT jsonb_agg(jsonb_build_object('group',billing_private.import_source_group_key(e.source,r.profile_snapshot->>'parser'),'code',billing_private.import_values_json(v_owner,e.id)->>v_key)) INTO entries FROM public.billing_import_entries e WHERE e.owner_id=v_owner AND e.document_id=r.id
   AND billing_private.import_source_group_key(e.source,r.profile_snapshot->>'parser') IS NOT NULL;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(entries) x GROUP BY x->'group' HAVING count(DISTINCT x->>'code')>1)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(entries) x GROUP BY x->>'code' HAVING count(DISTINCT x->'group')>1) THEN
   RAISE EXCEPTION 'Cada conjunto deve manter uma única entrada, diferente das entradas dos outros conjuntos.' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(entries) x JOIN billing_private.import_saved_entry_codes(v_owner,r.client_id,r.profile_snapshot->>'parser',r.id) h
   ON (h.group_key=x->'group' AND (h.invalid OR h.entry_code IS NOT NULL AND h.entry_code::text<>x->>'code'))
    OR (h.entry_code::text=x->>'code' AND h.group_key IS NOT NULL AND h.group_key<>x->'group')) THEN
   RAISE EXCEPTION 'A numeração diverge do histórico de conjuntos deste cliente.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN billing_private.import_documents_dispatch_before_group_numbering(p_action,p_payload);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'Confira a entrada inicial, os conjuntos e a revisão do documento.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.import_numbering_field(jsonb,boolean),billing_private.import_numbering_config(jsonb,jsonb,jsonb),
 billing_private.import_saved_entry_codes(uuid,uuid,text,uuid),billing_private.number_import_groups(uuid,uuid,jsonb,jsonb,uuid,uuid,boolean),
 billing_private.import_documents_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
COMMIT;
