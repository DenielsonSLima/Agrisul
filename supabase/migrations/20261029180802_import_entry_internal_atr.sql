BEGIN;

ALTER TABLE public.billing_import_entries ADD COLUMN atr numeric
 CHECK(atr IS NULL OR (atr>0 AND atr<1000000000 AND atr=round(atr,6)));
COMMENT ON COLUMN public.billing_import_entries.atr IS 'Internal ATR in kg/t. Never a profile field or Excel column.';

CREATE FUNCTION billing_private.import_source_atr_value(p_value text) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN replace(btrim(p_value),',','.') ~ '^[0-9]{1,9}([.][0-9]{1,6})?$'
  THEN CASE WHEN replace(btrim(p_value),',','.')::numeric>0 THEN replace(btrim(p_value),',','.')::numeric END END
$$;
REVOKE ALL ON FUNCTION billing_private.import_source_atr_value(text) FROM PUBLIC,anon,authenticated;

-- Initialize the newly visible field from evidence already retained by the
-- extractor. Operational cells, review flags and source text remain untouched.
UPDATE public.billing_import_entries e SET atr=billing_private.import_source_atr_value(e.source->>'atr')
FROM public.billing_import_documents d
WHERE d.owner_id=e.owner_id AND d.id=e.document_id AND d.profile_snapshot->>'parser'='pinheiro-usjp-v1'
 AND billing_private.import_source_atr_value(e.source->>'atr') IS NOT NULL;

CREATE FUNCTION billing_private.import_entry_capture_atr() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.billing_import_documents d WHERE d.owner_id=NEW.owner_id AND d.id=NEW.document_id
  AND d.profile_snapshot->>'parser'='pinheiro-usjp-v1') THEN
  IF TG_OP='INSERT' THEN
   IF NEW.atr IS NULL THEN NEW.atr=billing_private.import_source_atr_value(NEW.source->>'atr');END IF;
  ELSIF NEW.source->>'atr' IS DISTINCT FROM OLD.source->>'atr' THEN
   NEW.atr=billing_private.import_source_atr_value(NEW.source->>'atr');
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION billing_private.import_entry_capture_atr() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER import_entry_capture_atr BEFORE INSERT OR UPDATE OF source ON public.billing_import_entries
FOR EACH ROW EXECUTE FUNCTION billing_private.import_entry_capture_atr();

DO $$
DECLARE definition text:=pg_get_functiondef('billing_private.import_document_json(public.billing_import_documents)'::regprocedure);
 anchor text:=$a$'reviewed',e.reviewed$a$;
BEGIN
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected import document projection';END IF;
 EXECUTE replace(definition,anchor,anchor||$n$,'atr',coalesce(billing_private.decimal_text(e.atr),'')$n$);
 definition=pg_get_functiondef('billing_private.import_load_parts(public.billing_import_documents,text)'::regprocedure);
 anchor=$a$'entryId',e->>'id','label'$a$;
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected import load parts projection';END IF;
 EXECUTE replace(definition,anchor,$n$'entryId',e->>'id','atr',coalesce(e->>'atr',''),'label'$n$);
END $$;

CREATE FUNCTION billing_private.import_source_atr_average(p_parts jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT billing_private.import_load_atr(p_parts,'parts','',coalesce((
  SELECT jsonb_agg(jsonb_build_object('entryId',p->>'entryId','atr',coalesce(p->>'atr','')))
  FROM jsonb_array_elements(p_parts) p),'[]'::jsonb))||jsonb_build_object('mode','source')
$$;
REVOKE ALL ON FUNCTION billing_private.import_source_atr_average(jsonb) FROM PUBLIC,anon,authenticated;

-- Explicit manual averages/parts remain authoritative. Source-based links,
-- and old links still awaiting ATR, follow complete import measurements.
CREATE FUNCTION billing_private.import_sync_atr_loads(p_document public.billing_import_documents)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE link record;parts jsonb;calculated jsonb;average numeric;
BEGIN
 PERFORM c.id FROM public.billing_contracts c WHERE c.owner_id=p_document.owner_id AND EXISTS(
  SELECT 1 FROM public.billing_contract_loads l JOIN public.billing_import_load_links x ON x.owner_id=l.owner_id AND x.load_id=l.id
  WHERE l.owner_id=c.owner_id AND l.contract_id=c.id AND x.document_id=p_document.id)
 ORDER BY c.id FOR UPDATE;
 FOR link IN
  SELECT x.*,l.atr,l.contract_id FROM public.billing_import_load_links x
  JOIN public.billing_contract_loads l ON l.owner_id=x.owner_id AND l.id=x.load_id
  JOIN public.billing_contracts c ON c.owner_id=l.owner_id AND c.id=l.contract_id
  WHERE x.owner_id=p_document.owner_id AND x.document_id=p_document.id AND c.status='Ativo'
   AND (x.atr_input->>'mode'='source' OR (coalesce(x.atr_input->>'mode','pending')='pending' AND l.atr IS NULL))
  ORDER BY l.contract_id,l.id
 LOOP
  PERFORM 1 FROM public.billing_contracts WHERE owner_id=p_document.owner_id AND id=link.contract_id FOR UPDATE;
  parts=billing_private.import_load_parts(p_document,link.trip_key);
  calculated=billing_private.import_source_atr_average(parts);
  IF NOT (calculated->>'complete')::boolean AND link.atr_input->>'mode' IS DISTINCT FROM 'source' THEN CONTINUE;END IF;
  average=nullif(calculated->>'average','')::numeric;
  IF average IS DISTINCT FROM link.atr OR calculated IS DISTINCT FROM link.atr_input THEN
   IF auth.uid() IS NOT NULL THEN PERFORM billing_private.authorize('contracts.write');END IF;
   UPDATE public.billing_contract_loads SET atr=average WHERE owner_id=p_document.owner_id AND id=link.load_id;
   UPDATE public.billing_import_load_links SET atr_input=calculated WHERE owner_id=p_document.owner_id AND load_id=link.load_id;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION billing_private.import_sync_atr_loads(public.billing_import_documents) FROM PUBLIC,anon,authenticated;

DO $$
DECLARE definition text:=pg_get_functiondef('billing_private.import_documents_dispatch(text,jsonb)'::regprocedure);
 anchor text:=$a$v_atr=billing_private.import_load_atr(v_parts,coalesce(p_payload->>'atrMode','pending'),coalesce(p_payload->>'atr',''),coalesce(p_payload->'atrParts','[]'::jsonb));$a$;
BEGIN
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected import ATR dispatcher';END IF;
 definition=replace(definition,anchor,$n$IF p_payload->>'atrMode'='source' THEN
  IF btrim(coalesce(p_payload->>'atr',''))<>'' OR coalesce(p_payload->'atrParts','[]'::jsonb)<>'[]'::jsonb THEN
   RAISE EXCEPTION 'O ATR da importação usa somente os valores salvos no documento.' USING ERRCODE='22023';END IF;
  v_atr=billing_private.import_source_atr_average(v_parts);
 ELSE
  $n$||anchor||$n$
 END IF;$n$);
 EXECUTE definition;
END $$;

ALTER FUNCTION billing_private.import_documents_dispatch(text,jsonb) RENAME TO import_documents_before_entry_atr_dispatch;
REVOKE ALL ON FUNCTION billing_private.import_documents_before_entry_atr_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.import_documents_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();d public.billing_import_documents;item jsonb;
 v_id uuid;seen uuid[]:='{}';text_value text;value numeric;changed integer:=0;
BEGIN
 IF p_action IS NULL OR p_action<>'save-atrs' THEN RETURN billing_private.import_documents_before_entry_atr_dispatch(p_action,p_payload);END IF;
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Entre para salvar o ATR.' USING ERRCODE='28000';END IF;
 PERFORM billing_private.authorize('registrations.write');
 PERFORM billing_private.request_payload(p_payload,ARRAY['id','expectedUpdatedAt','entries']);
 IF jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'expectedUpdatedAt') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'entries') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Confira os dados do ATR.' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(p_payload->'entries') NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'Envie entre 1 e 5000 ATRs.' USING ERRCODE='22023';END IF;
 PERFORM billing_private.lock_request_actor();
 PERFORM pg_advisory_xact_lock(hashtextextended('billing:imports:'||v_owner::text,0));
 SELECT * INTO d FROM public.billing_import_documents WHERE owner_id=v_owner AND id=nullif(p_payload->>'id','')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Importação não encontrada.' USING ERRCODE='P0002';END IF;
 IF nullif(p_payload->>'expectedUpdatedAt','')::timestamptz IS DISTINCT FROM d.updated_at THEN
  RAISE EXCEPTION 'A importação mudou. Atualize antes de salvar o ATR.' USING ERRCODE='40001';END IF;
 FOR item IN SELECT x FROM jsonb_array_elements(p_payload->'entries') x LOOP
  PERFORM billing_private.request_payload(item,ARRAY['entryId','atr']);
  IF jsonb_typeof(item->'entryId') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'atr') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Envie o identificador e o ATR como texto.' USING ERRCODE='22023';END IF;
  v_id=nullif(item->>'entryId','')::uuid;
  IF v_id IS NULL OR v_id=ANY(seen) THEN RAISE EXCEPTION 'Não repita partes na mesma gravação.' USING ERRCODE='22023';END IF;
  seen=array_append(seen,v_id);text_value=btrim(item->>'atr');value=billing_private.import_source_atr_value(text_value);
  IF text_value<>'' AND value IS NULL THEN RAISE EXCEPTION 'Informe um ATR positivo, com até seis casas decimais, ou deixe vazio.' USING ERRCODE='22023';END IF;
  UPDATE public.billing_import_entries SET atr=value WHERE owner_id=v_owner AND document_id=d.id AND id=v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado nesta importação.' USING ERRCODE='P0002';END IF;
  changed=changed+1;
 END LOOP;
 PERFORM billing_private.import_sync_atr_loads(d);
 UPDATE public.billing_import_documents SET updated_at=clock_timestamp() WHERE owner_id=v_owner AND id=d.id RETURNING * INTO d;
 RETURN jsonb_build_object('document',billing_private.import_document_json(d),'savedCount',changed);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Confira os identificadores, a revisão e o ATR informado.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.import_documents_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;

-- An explicit edit of a linked load's ATR becomes a manual override. Ordinary
-- edits that preserve its ATR continue to follow import measurements.
ALTER FUNCTION billing_private.contracts_company_dispatch(text,jsonb) RENAME TO contracts_before_entry_atr_override_dispatch;
REVOKE ALL ON FUNCTION billing_private.contracts_before_entry_atr_override_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.contracts_company_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();previous numeric;result jsonb;v_contract uuid;v_existing boolean;
BEGIN
 IF p_action IS NULL OR p_action<>'save-load' THEN RETURN billing_private.contracts_before_entry_atr_override_dispatch(p_action,p_payload);END IF;
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Entre para alterar o carregamento.' USING ERRCODE='28000';END IF;
 PERFORM billing_private.authorize('contracts.write');
 PERFORM billing_private.lock_request_actor();
 SELECT id INTO v_contract FROM public.billing_contracts WHERE owner_id=v_owner AND id=nullif(p_payload->>'contractId','')::uuid
  AND company_id=nullif(p_payload->>'companyId','')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado para a empresa ativa.' USING ERRCODE='P0002';END IF;
 SELECT atr INTO previous FROM public.billing_contract_loads WHERE owner_id=v_owner AND contract_id=v_contract AND id=nullif(p_payload->>'id','')::uuid;
 v_existing=FOUND;
 result=billing_private.contracts_before_entry_atr_override_dispatch(p_action,p_payload);
 IF v_existing AND previous IS DISTINCT FROM nullif(result->'load'->>'atr','')::numeric THEN
  UPDATE public.billing_import_load_links SET atr_input=jsonb_build_object(
   'mode',CASE WHEN nullif(result->'load'->>'atr','') IS NULL THEN 'pending' ELSE 'general' END,
   'average',nullif(result->'load'->>'atr',''),'complete',true,'parts','[]'::jsonb)
  WHERE owner_id=v_owner AND load_id=(result->'load'->>'id')::uuid;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION billing_private.contracts_company_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.contracts_company_dispatch(text,jsonb) TO authenticated;

COMMIT;
