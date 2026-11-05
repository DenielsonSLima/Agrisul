BEGIN;

-- Extend existing snapshots as well as future profiles without moving ERP columns.
CREATE FUNCTION billing_private.import_destination_config(p_config jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE fields jsonb:=p_config->'fields';col text;last_col integer:=0;n integer;i integer;label text:='';
BEGIN
 IF p_config->>'parser' NOT IN ('taquari-equipment-v1','pinheiro-usjp-v1') THEN RETURN p_config;END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(fields) f WHERE f->>'key'='COD_DESTINO') THEN
  FOR col IN SELECT f->>'column' FROM jsonb_array_elements(fields) f WHERE coalesce(f->>'column','')<>'' LOOP
   n=0;FOR i IN 1..length(col) LOOP n=n*26+ascii(upper(substr(col,i,1)))-64;END LOOP;
   last_col=greatest(last_col,n);
  END LOOP;
  n=last_col+1;
  IF n>16384 THEN RAISE EXCEPTION 'Não há coluna disponível para COD_DESTINO.' USING ERRCODE='22023';END IF;
  WHILE n>0 LOOP label=chr(65+(n-1)%26)||label;n=(n-1)/26;END LOOP;
  fields=fields||jsonb_build_array(jsonb_build_object('key','COD_DESTINO','label','COD_DESTINO','source','manual',
   'type','text','required',false,'column',label,'defaultValue','','sourceKey','','pattern','','mappings','{}'::jsonb));
 END IF;
 SELECT jsonb_agg(CASE WHEN f->>'key'='COD_DESTINO' THEN f||jsonb_build_object('type','text') ELSE f END ORDER BY pos)
 INTO fields FROM jsonb_array_elements(fields) WITH ORDINALITY x(f,pos);
 RETURN jsonb_set(p_config,'{fields}',fields);
END $$;
REVOKE ALL ON FUNCTION billing_private.import_destination_config(jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.import_destination_capture() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='billing_import_profiles' THEN NEW.config=billing_private.import_destination_config(NEW.config);
 ELSE NEW.profile_snapshot=billing_private.import_destination_config(NEW.profile_snapshot);END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION billing_private.import_destination_capture() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER import_destination_capture BEFORE INSERT OR UPDATE OF config ON public.billing_import_profiles
 FOR EACH ROW EXECUTE FUNCTION billing_private.import_destination_capture();
CREATE TRIGGER import_destination_capture BEFORE INSERT OR UPDATE OF profile_snapshot ON public.billing_import_documents
 FOR EACH ROW EXECUTE FUNCTION billing_private.import_destination_capture();
UPDATE public.billing_import_profiles SET config=billing_private.import_destination_config(config)
 WHERE config IS DISTINCT FROM billing_private.import_destination_config(config);
UPDATE public.billing_import_documents SET profile_snapshot=billing_private.import_destination_config(profile_snapshot)
 WHERE profile_snapshot IS DISTINCT FROM billing_private.import_destination_config(profile_snapshot);

-- Remove only the old prohibition; authorization, revision and import locks remain.
DO $$
DECLARE definition text:=pg_get_functiondef('billing_private.import_documents_before_atr_link_dispatch(text,jsonb)'::regprocedure);
 anchor text:=$a$   IF EXISTS(SELECT 1 FROM public.billing_import_load_links WHERE owner_id=v_owner AND document_id=nullif(p_payload->>'id','')::uuid) THEN
    RAISE EXCEPTION 'Este documento possui carregamentos vinculados. Exclua os vínculos nos contratos antes de reabrir.' USING ERRCODE='23514';
   END IF;$a$;
BEGIN
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected import reopening implementation';END IF;
 EXECUTE replace(definition,anchor,'');
END $$;

-- Compare source entry identities before/after editing. External codes and split
-- trip keys may change, but a linked load must retain a single unambiguous origin.
CREATE FUNCTION billing_private.import_sync_edited_loads(p_document public.billing_import_documents,p_previous jsonb)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE old_link jsonb;candidate jsonb;parts jsonb;matches jsonb;plan jsonb:='[]';item jsonb;atr_data jsonb;
 l public.billing_contract_loads;c public.billing_contracts;origin record;farm uuid;plot uuid;old_candidate jsonb;
 new_atr numeric;new_document text;
BEGIN
 FOR old_link IN SELECT value FROM jsonb_array_elements(p_previous) LOOP
  SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO matches
  FROM billing_private.import_load_candidates(p_document) q
  WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(billing_private.import_load_parts(p_document,q.trip_key)) part
   JOIN jsonb_array_elements(old_link->'parts') previous ON previous->>'entryId'=part->>'entryId');
  IF jsonb_array_length(matches)<>1 THEN
   RAISE EXCEPTION 'A correção divide ou remove uma origem vinculada. Remova esse vínculo no contrato antes de alterar a composição.' USING ERRCODE='23514';
  END IF;
  candidate=matches->0;
  IF candidate->>'issue'<>'' THEN RAISE EXCEPTION '%',candidate->>'issue' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(plan) p WHERE p->'candidate'->>'trip_key'=candidate->>'trip_key') THEN
   RAISE EXCEPTION 'A correção une origens já vinculadas. Remova os vínculos dessas origens antes de unir.' USING ERRCODE='23514';
  END IF;
  plan=plan||jsonb_build_array(old_link||jsonb_build_object('candidate',candidate));
 END LOOP;
 -- Temporary keys allow two existing origins to exchange their external codes.
 UPDATE public.billing_import_load_links SET trip_key='sync:'||load_id::text
 WHERE owner_id=p_document.owner_id AND document_id=p_document.id;
 FOR item IN SELECT value FROM jsonb_array_elements(plan) LOOP
  candidate=item->'candidate';old_candidate=item->'previousCandidate';
  SELECT * INTO l FROM public.billing_contract_loads WHERE owner_id=p_document.owner_id AND id=(item->>'loadId')::uuid FOR UPDATE;
  SELECT * INTO c FROM public.billing_contracts WHERE owner_id=l.owner_id AND id=l.contract_id FOR UPDATE;
  parts=billing_private.import_load_parts(p_document,candidate->>'trip_key');
  atr_data=item->'atrInput';new_atr=l.atr;farm=l.farm_id;plot=l.plot_id;
  IF coalesce(atr_data->>'mode','pending')='source' OR (coalesce(atr_data->>'mode','pending')='pending' AND l.atr IS NULL) THEN
   atr_data=billing_private.import_source_atr_average(parts);
   new_atr=nullif(atr_data->>'average','')::numeric;
  ELSIF atr_data->>'mode'='parts' THEN
   atr_data=billing_private.import_load_atr(parts,'parts','',(SELECT coalesce(jsonb_agg(jsonb_build_object('entryId',p->>'entryId','atr',p->>'atr')),'[]')
    FROM jsonb_array_elements(atr_data->'parts') p WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(parts) part WHERE part->>'entryId'=p->>'entryId')));
   IF NOT (atr_data->>'complete')::boolean THEN RAISE EXCEPTION 'Confira o ATR das partes antes de alterar esta origem vinculada.' USING ERRCODE='23514';END IF;
   new_atr=nullif(atr_data->>'average','')::numeric;
  END IF;
  IF candidate->>'farm_code' IS DISTINCT FROM old_candidate->>'farm_code' OR candidate->>'plot_code' IS DISTINCT FROM old_candidate->>'plot_code' THEN
   SELECT * INTO origin FROM billing_private.import_load_origin_match(p_document.owner_id,candidate->>'farm_code',candidate->>'plot_code');
   IF origin.farm_match_status<>'matched' OR (coalesce(candidate->>'plot_code','')<>'' AND origin.plot_match_status<>'matched') THEN
    RAISE EXCEPTION 'O código corrigido precisa identificar uma fazenda e um talhão únicos nos cadastros para atualizar o carregamento.' USING ERRCODE='23514';
   END IF;
   farm=origin.matched_farm_id;plot=origin.matched_plot_id;
  END IF;
  new_document=CASE WHEN candidate->>'entry_number' IS DISTINCT FROM old_candidate->>'entry_number'
   THEN left(coalesce(candidate->>'entry_number',p_document.source_name),100) ELSE l.document END;
  IF ROW(l.loaded_at,l.volume,l.harvest_method,l.farm_id,l.plot_id,l.atr,l.document) IS DISTINCT FROM
   ROW((candidate->>'loaded_at')::date,(candidate->>'volume')::numeric,candidate->>'harvest_method',farm,plot,new_atr,new_document) THEN
   PERFORM billing_private.authorize('contracts.write');
   IF c.status<>'Ativo' THEN RAISE EXCEPTION 'Reative o contrato antes de corrigir seus carregamentos vinculados.' USING ERRCODE='23514';END IF;
   IF candidate->>'issue'<>'' THEN RAISE EXCEPTION '%',candidate->>'issue' USING ERRCODE='23514';END IF;
   IF billing_private.contract_import_harvest_method(c.type_name) IS NOT NULL AND candidate->>'harvest_method' IS DISTINCT FROM billing_private.contract_import_harvest_method(c.type_name) THEN
    RAISE EXCEPTION 'A colheita corrigida não corresponde ao contrato vinculado.' USING ERRCODE='23514';END IF;
   PERFORM billing_private.contracts_company_dispatch('save-load',jsonb_build_object('companyId',c.company_id::text,'contractId',c.id::text,
    'id',l.id::text,'loadedAt',candidate->>'loaded_at','volume',billing_private.decimal_text((candidate->>'volume')::numeric),
    'farmId',farm::text,'plotId',coalesce(plot::text,''),'atr',coalesce(billing_private.decimal_text(new_atr),''),'document',new_document,'notes',l.notes));
   UPDATE public.billing_contract_loads SET harvest_method=candidate->>'harvest_method' WHERE owner_id=l.owner_id AND id=l.id;
  END IF;
  UPDATE public.billing_import_load_links SET trip_key=candidate->>'trip_key',atr_input=atr_data
   WHERE owner_id=p_document.owner_id AND load_id=l.id;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION billing_private.import_sync_edited_loads(public.billing_import_documents,jsonb) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.import_documents_dispatch(text,jsonb) RENAME TO import_documents_before_linked_edits_dispatch;
REVOKE ALL ON FUNCTION billing_private.import_documents_before_linked_edits_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.import_documents_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();d public.billing_import_documents;previous jsonb;result jsonb;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('save-entry','save-bulk','remove-entry','change-column-type','number-groups','save-harvest-orders','append-source-entries') THEN
  RETURN billing_private.import_documents_before_linked_edits_dispatch(p_action,p_payload);
 END IF;
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Entre para corrigir a importação.' USING ERRCODE='28000';END IF;
 PERFORM billing_private.authorize('imports.write');
 PERFORM billing_private.lock_request_actor();
 PERFORM pg_advisory_xact_lock(hashtextextended('billing:imports:'||v_owner::text,0));
 -- Same ordering as link/unlink: actor, imports, contracts, document, loads.
 PERFORM c.id FROM public.billing_contracts c WHERE c.owner_id=v_owner AND EXISTS(
  SELECT 1 FROM public.billing_contract_loads l JOIN public.billing_import_load_links x ON x.owner_id=l.owner_id AND x.load_id=l.id
  WHERE l.owner_id=c.owner_id AND l.contract_id=c.id AND x.document_id=nullif(p_payload->>'id','')::uuid)
 ORDER BY c.id FOR UPDATE;
 SELECT * INTO d FROM public.billing_import_documents WHERE owner_id=v_owner AND id=nullif(p_payload->>'id','')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Importação não encontrada.' USING ERRCODE='P0002';END IF;
 IF p_action='change-column-type' AND coalesce(p_payload->>'type','')<>'text' AND
  (p_payload->>'fieldKey'='COD_DESTINO' OR coalesce(p_payload->'fieldKeys','[]') ? 'COD_DESTINO') THEN
  RAISE EXCEPTION 'COD_DESTINO deve permanecer como Texto para exportação.' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('loadId',x.load_id,'parts',billing_private.import_load_parts(d,x.trip_key),
  'atrInput',x.atr_input,'previousCandidate',(SELECT to_jsonb(q) FROM billing_private.import_load_candidates(d) q WHERE q.trip_key=x.trip_key))),'[]')
 INTO previous FROM public.billing_import_load_links x WHERE x.owner_id=v_owner AND x.document_id=d.id;
 result=billing_private.import_documents_before_linked_edits_dispatch(p_action,p_payload);
 IF jsonb_array_length(previous)>0 THEN
  SELECT * INTO d FROM public.billing_import_documents WHERE owner_id=v_owner AND id=d.id;
  PERFORM billing_private.import_sync_edited_loads(d,previous);
 END IF;
 RETURN result;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Confira os identificadores, datas e valores da importação.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.import_documents_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
COMMIT;
