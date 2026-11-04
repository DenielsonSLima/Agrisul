BEGIN;

-- Append a missing report page without replacing document or entry identities.
ALTER FUNCTION billing_private.import_documents_dispatch(text,jsonb)
 RENAME TO import_documents_dispatch_before_source_append;
REVOKE ALL ON FUNCTION billing_private.import_documents_dispatch_before_source_append(text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.import_documents_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();r public.billing_import_documents;old_entry public.billing_import_entries;
 incoming jsonb;existing jsonb;normalized jsonb;new_entries jsonb;item jsonb;field_config jsonb;stored jsonb;updated_values jsonb;
 existing_count integer;next_position integer;field_key text;new_source jsonb;changed boolean;
BEGIN
 IF p_action IS DISTINCT FROM 'append-source-entries' THEN
  RETURN billing_private.import_documents_dispatch_before_source_append(p_action,p_payload);
 END IF;
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Entre para completar a importação.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize('registrations.write');
 PERFORM billing_private.request_payload(p_payload,ARRAY['id','expectedUpdatedAt','entries']);
 IF jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'expectedUpdatedAt') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'entries') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Informe o documento, a revisão e os lançamentos da página.' USING ERRCODE='22023';
 END IF;
 incoming=p_payload->'entries';
 IF jsonb_array_length(incoming) NOT BETWEEN 1 AND 20000 THEN RAISE EXCEPTION 'Anexe entre 1 e 20.000 lançamentos.' USING ERRCODE='22023'; END IF;
 PERFORM billing_private.lock_request_actor();
 PERFORM pg_advisory_xact_lock(hashtextextended('billing:imports:'||v_owner::text,0));
 SELECT * INTO r FROM public.billing_import_documents WHERE owner_id=v_owner AND id=nullif(p_payload->>'id','')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Importação não encontrada.' USING ERRCODE='P0002'; END IF;
 IF nullif(p_payload->>'expectedUpdatedAt','')::timestamptz IS DISTINCT FROM r.updated_at THEN
  RAISE EXCEPTION 'A importação foi alterada. Atualize antes de completar a página.' USING ERRCODE='PT409';
 END IF;
 IF r.status<>'open' THEN RAISE EXCEPTION 'Reabra a importação antes de completar a página.' USING ERRCODE='23514'; END IF;
 IF r.profile_snapshot->>'parser' IS DISTINCT FROM 'pinheiro-usjp-v1' THEN RAISE EXCEPTION 'Esta operação atende somente boletins Pinheiro/USJP.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.billing_import_load_links WHERE owner_id=v_owner AND document_id=r.id) THEN
  RAISE EXCEPTION 'O documento possui carregamentos vinculados. Confira os vínculos antes de completar a página.' USING ERRCODE='23514';
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(incoming) LOOP
  PERFORM billing_private.request_payload(item,ARRAY['date','values','source','sourcePage','sourceLine']);
  IF jsonb_typeof(item->'date') IS DISTINCT FROM 'string' OR coalesce(item->>'date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   OR jsonb_typeof(item->'values') IS DISTINCT FROM 'object' OR length((item->'values')::text)>300000
   OR jsonb_typeof(item->'source') IS DISTINCT FROM 'object' OR length((item->'source')::text)>30000
   OR jsonb_typeof(item->'sourcePage') IS DISTINCT FROM 'number' OR coalesce(item->>'sourcePage','')!~'^[0-9]{1,5}$'
   OR (item->>'sourcePage')::integer NOT BETWEEN 0 AND 10000
   OR jsonb_typeof(item->'sourceLine') IS DISTINCT FROM 'string' OR length(item->>'sourceLine')>12000 THEN
   RAISE EXCEPTION 'Confira a origem, a data e os valores dos novos lançamentos.' USING ERRCODE='22023';
  END IF;
  PERFORM (item->>'date')::date;
  IF EXISTS(SELECT 1 FROM jsonb_each(item->'source') s WHERE jsonb_typeof(s.value) IS DISTINCT FROM 'string')
   OR EXISTS(SELECT 1 FROM jsonb_each(item->'values') v WHERE jsonb_typeof(v.value) IS DISTINCT FROM 'string') THEN
   RAISE EXCEPTION 'Envie a origem e os valores dos lançamentos como texto.' USING ERRCODE='22023';
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.billing_import_entries e WHERE e.owner_id=v_owner AND e.document_id=r.id
  AND billing_private.import_source_group_key(e.source,'pinheiro-usjp-v1') IS NULL) THEN
  RAISE EXCEPTION 'O documento contém lançamentos sem identidade original. Confira-os antes de anexar a página.' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'date',e.entry_date::text,'source',e.source,
  'values',billing_private.import_values_json(v_owner,e.id),'sourcePage',e.source_page,'sourceLine',e.source_line) ORDER BY e.position,e.id),'[]'::jsonb),
  count(*)::integer,coalesce(max(e.position),0) INTO existing,existing_count,next_position
 FROM public.billing_import_entries e WHERE e.owner_id=v_owner AND e.document_id=r.id;
 IF existing_count=0 OR existing_count+jsonb_array_length(incoming)>20000 THEN RAISE EXCEPTION 'Confira o tamanho do documento antes de completar a página.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(incoming) n WHERE NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(existing) e WHERE e->'source'->>'periodoInicio'=n->'source'->>'periodoInicio'
   AND e->'source'->>'periodoFim'=n->'source'->>'periodoFim')) THEN
  RAISE EXCEPTION 'A página deve pertencer ao mesmo período agrícola do documento.' USING ERRCODE='22023';
 END IF;
 -- Validate all BAs together, including duplicate identities and agricultural dates.
 normalized=billing_private.normalize_pinheiro_analyses(existing||incoming,r.profile_snapshot->'fields');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(incoming) n JOIN public.billing_import_entries e
  ON e.owner_id=v_owner AND e.source->>'numeroAnalise'=n->'source'->>'numeroAnalise' AND e.source->>'periodoInicio'=n->'source'->>'periodoInicio'
  JOIN public.billing_import_documents d ON d.owner_id=e.owner_id AND d.id=e.document_id
  WHERE d.id<>r.id AND d.client_id=r.client_id AND d.profile_snapshot->>'parser'='pinheiro-usjp-v1') THEN
  RAISE EXCEPTION 'Um BA da página já consta em outro documento deste cliente e período.' USING ERRCODE='23514';
 END IF;
 SELECT jsonb_agg(value ORDER BY position) INTO new_entries FROM jsonb_array_elements(normalized) WITH ORDINALITY e(value,position) WHERE position>existing_count;
 -- Include this document in history so a page continuation reuses its saved code.
 new_entries=billing_private.number_import_groups(v_owner,r.client_id,r.profile_snapshot,new_entries,NULL,NULL,false);
 FOR item IN SELECT value FROM jsonb_array_elements(normalized) WITH ORDINALITY e(value,position) WHERE position<=existing_count LOOP
  SELECT * INTO STRICT old_entry FROM public.billing_import_entries WHERE owner_id=v_owner AND document_id=r.id AND id=(item->>'id')::uuid;
  new_source=item->'source';stored=billing_private.import_values_json(v_owner,old_entry.id);updated_values=stored;
  -- Appending cannot change an existing sequence, tare or gross convention.
  IF new_source->>'sequencia' IS DISTINCT FROM old_entry.source->>'sequencia'
   OR new_source->>'taraConvencional' IS DISTINCT FROM old_entry.source->>'taraConvencional'
   OR new_source->>'pesoBrutoConvencional' IS DISTINCT FROM old_entry.source->>'pesoBrutoConvencional' THEN
   RAISE EXCEPTION 'A página altera a sequência original de um lançamento existente.' USING ERRCODE='23514';
  END IF;
  IF new_source->>'quantidadeAnalisesConjunto' IS DISTINCT FROM old_entry.source->>'quantidadeAnalisesConjunto' THEN
   FOR field_config IN SELECT value FROM jsonb_array_elements(r.profile_snapshot->'fields') WHERE value->>'source'='pdf' AND value->>'sourceKey'='quantidadeAnalisesConjunto' LOOP
    field_key=field_config->>'key';
    IF stored->>field_key IS DISTINCT FROM old_entry.source->>'quantidadeAnalisesConjunto' THEN
     RAISE EXCEPTION 'A quantidade do conjunto foi editada. Confira a coluna % antes de completar a página.',field_config->>'column' USING ERRCODE='23514';
    END IF;
    updated_values=jsonb_set(updated_values,ARRAY[field_key],new_source->'quantidadeAnalisesConjunto');
   END LOOP;
  END IF;
  changed=new_source IS DISTINCT FROM old_entry.source OR updated_values IS DISTINCT FROM stored;
  IF changed THEN
   IF length(new_source::text)>30000 THEN RAISE EXCEPTION 'Limite de informações de origem atingido.' USING ERRCODE='23514'; END IF;
   IF updated_values IS DISTINCT FROM stored THEN PERFORM billing_private.import_store_values(v_owner,old_entry.id,r.profile_snapshot->'fields',updated_values,false); END IF;
   UPDATE public.billing_import_entries SET source=new_source,reviewed=false WHERE owner_id=v_owner AND document_id=r.id AND id=old_entry.id;
  END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(new_entries) LOOP
  next_position=next_position+1;updated_values=item->'values';
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(r.profile_snapshot->'fields') f WHERE f->>'key'='NUMERO_ANALISE') THEN
   updated_values=jsonb_set(updated_values,'{NUMERO_ANALISE}','""'::jsonb);
  END IF;
  IF length((item->'source')::text)>30000 THEN RAISE EXCEPTION 'Limite de informações de origem atingido.' USING ERRCODE='23514'; END IF;
  INSERT INTO public.billing_import_entries(owner_id,document_id,entry_date,source,source_page,source_line,position)
   VALUES(v_owner,r.id,(item->>'date')::date,item->'source',(item->>'sourcePage')::integer,item->>'sourceLine',next_position) RETURNING * INTO old_entry;
  PERFORM billing_private.import_store_values(v_owner,old_entry.id,r.profile_snapshot->'fields',updated_values,false);
 END LOOP;
 UPDATE public.billing_import_documents SET updated_at=clock_timestamp() WHERE owner_id=v_owner AND id=r.id RETURNING * INTO r;
 RETURN jsonb_build_object('document',billing_private.import_document_json(r),'appendedCount',jsonb_array_length(incoming));
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'Confira os identificadores, datas, valores e a revisão da página.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.import_documents_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;

COMMIT;
