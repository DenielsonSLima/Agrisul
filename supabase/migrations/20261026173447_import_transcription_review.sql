BEGIN;

-- Review a photographed USJP transcription without replacing the original line,
-- recalculating operational cells, or changing the identity of a vehicle group.
ALTER FUNCTION billing_private.import_documents_dispatch(text,jsonb)
 RENAME TO import_documents_dispatch_before_transcription_review;
REVOKE ALL ON FUNCTION billing_private.import_documents_dispatch_before_transcription_review(text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.import_documents_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();r public.billing_import_documents;e public.billing_import_entries;p public.billing_import_profiles;
 change jsonb;changes jsonb;history jsonb;new_source jsonb;source_key text;reason text;seen text[]:=ARRAY[]::text[];
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('correct-transcription','refresh-field-rules') THEN
  RETURN billing_private.import_documents_dispatch_before_transcription_review(p_action,p_payload);
 END IF;
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Entre para revisar a transcrição.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize('registrations.write');
 PERFORM billing_private.request_payload(p_payload,CASE WHEN p_action='refresh-field-rules'
  THEN ARRAY['id','expectedUpdatedAt','expectedProfileUpdatedAt'] ELSE ARRAY['id','entryId','expectedUpdatedAt','changes','reason'] END);
 PERFORM billing_private.lock_request_actor();
 PERFORM pg_advisory_xact_lock(hashtextextended('billing:imports:'||v_owner::text,0));
 SELECT * INTO r FROM public.billing_import_documents WHERE owner_id=v_owner AND id=nullif(p_payload->>'id','')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Importação não encontrada.' USING ERRCODE='P0002'; END IF;
 IF nullif(p_payload->>'expectedUpdatedAt','')::timestamptz IS DISTINCT FROM r.updated_at THEN
  RAISE EXCEPTION 'A importação foi alterada. Atualize antes de salvar.' USING ERRCODE='PT409';
 END IF;
 IF r.status<>'open' THEN RAISE EXCEPTION 'Reabra a importação antes de revisar a transcrição.' USING ERRCODE='23514'; END IF;
 IF p_action='refresh-field-rules' THEN
  SELECT * INTO p FROM public.billing_import_profiles WHERE owner_id=v_owner AND id=r.profile_id FOR SHARE;
  IF NOT FOUND OR (p.client_id IS NOT NULL AND p.client_id IS DISTINCT FROM r.client_id) THEN
   RAISE EXCEPTION 'Modelo incompatível com o documento.' USING ERRCODE='23514';
  END IF;
  IF nullif(p_payload->>'expectedProfileUpdatedAt','')::timestamptz IS DISTINCT FROM p.updated_at THEN
   RAISE EXCEPTION 'O modelo foi alterado. Atualize antes de continuar.' USING ERRCODE='PT409';
  END IF;
  IF r.profile_snapshot->>'parser' IS DISTINCT FROM p.config->>'parser'
   OR (SELECT jsonb_agg(jsonb_build_array(f->>'key',f->>'column',f->>'type') ORDER BY n) FROM jsonb_array_elements(r.profile_snapshot->'fields') WITH ORDINALITY a(f,n))
     IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_array(f->>'key',f->>'column',f->>'type') ORDER BY n) FROM jsonb_array_elements(p.config->'fields') WITH ORDINALITY a(f,n)) THEN
   RAISE EXCEPTION 'Preserve os campos, colunas e tipos do documento ao atualizar as regras.' USING ERRCODE='23514';
  END IF;
  UPDATE public.billing_import_entries SET reviewed=false WHERE owner_id=v_owner AND document_id=r.id;
  UPDATE public.billing_import_documents SET profile_snapshot=jsonb_set(profile_snapshot,'{fields}',p.config->'fields'),updated_at=clock_timestamp()
   WHERE owner_id=v_owner AND id=r.id RETURNING * INTO r;
  RETURN jsonb_build_object('document',billing_private.import_document_json(r));
 END IF;
 SELECT * INTO e FROM public.billing_import_entries WHERE owner_id=v_owner AND document_id=r.id AND id=nullif(p_payload->>'entryId','')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE='P0002'; END IF;
 IF r.profile_snapshot->>'parser' IS DISTINCT FROM 'pinheiro-usjp-v1' OR e.source->>'origemTipo' IS DISTINCT FROM 'fotografia' THEN
  RAISE EXCEPTION 'Esta revisão atende somente transcrições fotografadas Pinheiro/USJP.' USING ERRCODE='22023';
 END IF;
 reason=btrim(p_payload->>'reason');changes=p_payload->'changes';
 IF jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' OR length(reason) NOT BETWEEN 10 AND 1000
  OR jsonb_typeof(changes) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Informe a correção e o motivo da conferência.' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(changes) NOT BETWEEN 1 AND 16 THEN RAISE EXCEPTION 'Revise entre 1 e 16 campos de análise.' USING ERRCODE='22023'; END IF;
 new_source=e.source;history=coalesce(nullif(e.source->>'transcriptionReviewLog','')::jsonb,'[]'::jsonb);
 IF jsonb_typeof(history) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Histórico de revisão inválido.' USING ERRCODE='23514'; END IF;
 FOR change IN SELECT value FROM jsonb_array_elements(changes) LOOP
  PERFORM billing_private.request_payload(change,ARRAY['sourceKey','previousValue','value']);source_key=change->>'sourceKey';
  IF source_key IS NULL OR source_key NOT IN ('brixCana','brixCaldo','leituraSacarimetricaCorrigida','pbu','ph','arCana','polCaldo','fibra','purezaCana','purezaCaldo','polCana','atr','umidade','amido','agio')
   OR source_key=ANY(seen) OR jsonb_typeof(change->'previousValue') IS DISTINCT FROM 'string'
   OR jsonb_typeof(change->'value') IS DISTINCT FROM 'string' OR length(change->>'value') NOT BETWEEN 1 AND 100
   OR (change->>'value')!~'^-?[0-9]+([.][0-9]+)?$' THEN
   RAISE EXCEPTION 'Revise somente campos analíticos numéricos, sem repetir campos.' USING ERRCODE='22023';
  END IF;
  IF e.source->>source_key IS DISTINCT FROM change->>'previousValue' THEN
   RAISE EXCEPTION 'A leitura original foi alterada. Atualize antes de conferir.' USING ERRCODE='PT409';
  END IF;
  IF change->>'value'=change->>'previousValue' THEN RAISE EXCEPTION 'A correção precisa alterar a leitura.' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(r.profile_snapshot->'fields') f WHERE f->>'source'='pdf'
   AND (coalesce(nullif(f->>'sourceKey',''),f->>'key')=source_key OR coalesce(f->>'pattern','')<>'')) THEN
   RAISE EXCEPTION 'O campo está mapeado para o Excel. Confira também sua coluna antes de corrigir a origem.' USING ERRCODE='23514';
  END IF;
  seen=array_append(seen,source_key);new_source=jsonb_set(new_source,ARRAY[source_key],change->'value');
 END LOOP;
 history=history||jsonb_build_array(jsonb_build_object('at',clock_timestamp(),'actorId',auth.uid(),'reason',reason,'changes',changes));
 new_source=jsonb_set(new_source,'{transcriptionReviewLog}',to_jsonb(history::text));
 IF length(new_source::text)>30000 THEN RAISE EXCEPTION 'Limite do histórico de origem atingido.' USING ERRCODE='23514'; END IF;
 UPDATE public.billing_import_entries SET source=new_source,reviewed=false WHERE owner_id=v_owner AND document_id=r.id AND id=e.id;
 UPDATE public.billing_import_documents SET updated_at=clock_timestamp() WHERE owner_id=v_owner AND id=r.id RETURNING * INTO r;
 RETURN jsonb_build_object('document',billing_private.import_document_json(r));
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Confira os dados e a revisão da transcrição.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.import_documents_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
COMMIT;
