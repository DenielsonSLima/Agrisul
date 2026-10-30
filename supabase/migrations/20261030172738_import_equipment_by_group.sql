BEGIN;

-- Called only after the dispatcher checks owner, permission, revision, open
-- status and selected IDs, while holding the existing import/document locks.
CREATE FUNCTION billing_private.import_spread_equipment(p_document public.billing_import_documents,p_ids uuid[],p_value text)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE fields jsonb:=p_document.profile_snapshot->'fields';mirrored jsonb;target uuid;targets uuid[];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(fields) f WHERE f->>'key'='COD_EQUIPAMENTO_TRANSPORTE')
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(fields) f WHERE f->>'key'='COD_EQUIPAMENTO_COMPARTIMENTO') THEN RETURN;END IF;
 mirrored=billing_private.import_mirror_equipment_values(fields,
  jsonb_build_object('COD_EQUIPAMENTO_TRANSPORTE',p_value),'{}'::jsonb,ARRAY['COD_EQUIPAMENTO_TRANSPORTE']);
 -- Derive each identity once from original evidence. Neither a visible filter,
 -- an ERP entry number nor a source-supplied groupKey controls membership.
 WITH original AS MATERIALIZED (
  SELECT e.id,billing_private.import_source_group_key(e.source,p_document.profile_snapshot->>'parser') key
  FROM public.billing_import_entries e WHERE e.owner_id=p_document.owner_id AND e.document_id=p_document.id
 ), selected_groups AS(SELECT DISTINCT key FROM original WHERE id=ANY(p_ids) AND key IS NOT NULL)
 SELECT array_agg(o.id ORDER BY o.id) INTO targets FROM original o
 WHERE o.id=ANY(p_ids) OR o.key IN(SELECT key FROM selected_groups);
 FOREACH target IN ARRAY coalesce(targets,'{}'::uuid[]) LOOP
  PERFORM billing_private.import_store_values(p_document.owner_id,target,fields,
   billing_private.import_values_json(p_document.owner_id,target)||mirrored,false);
 END LOOP;
 UPDATE public.billing_import_entries SET reviewed=false
 WHERE owner_id=p_document.owner_id AND document_id=p_document.id AND id=ANY(targets);
END $$;

CREATE FUNCTION billing_private.import_group_equipment_values(p_document public.billing_import_documents,p_entry uuid,p_values jsonb,p_previous jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE fields jsonb:=p_document.profile_snapshot->'fields';mirrored jsonb;key text;kind text;changed boolean:=false;
BEGIN
 mirrored=billing_private.import_mirror_equipment_values(fields,p_values,p_previous,NULL);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(fields) f WHERE f->>'key'='COD_EQUIPAMENTO_TRANSPORTE')
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(fields) f WHERE f->>'key'='COD_EQUIPAMENTO_COMPARTIMENTO') THEN RETURN mirrored;END IF;
 FOR key,kind IN SELECT f->>'key',f->>'type' FROM jsonb_array_elements(fields) f
  WHERE f->>'key' IN ('COD_EQUIPAMENTO_TRANSPORTE','COD_EQUIPAMENTO_COMPARTIMENTO') LOOP
  IF mirrored?key AND billing_private.import_equipment_value(mirrored->>key,kind)
   IS DISTINCT FROM billing_private.import_equipment_value(p_previous->>key,kind) THEN changed=true;END IF;
 END LOOP;
 IF changed THEN PERFORM billing_private.import_spread_equipment(p_document,ARRAY[p_entry],mirrored->>'COD_EQUIPAMENTO_TRANSPORTE');END IF;
 RETURN mirrored;
END $$;
REVOKE ALL ON FUNCTION billing_private.import_spread_equipment(public.billing_import_documents,uuid[],text),
 billing_private.import_group_equipment_values(public.billing_import_documents,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;

DO $$
DECLARE definition text:=pg_get_functiondef('billing_private.import_documents_dispatch_before_client_summaries(text,jsonb)'::regprocedure);
 bulk_anchor text:='FOREACH v_entry IN ARRAY v_ids LOOP';
 entry_anchor text:=$a$billing_private.import_mirror_equipment_values(r.profile_snapshot->'fields',p_payload->'values',
   billing_private.import_values_json(v_owner,v_entry),NULL)$a$;
BEGIN
 IF (length(definition)-length(replace(definition,bulk_anchor,'')))/length(bulk_anchor)<>1 OR strpos(definition,entry_anchor)=0 THEN
  RAISE EXCEPTION 'Unexpected import equipment write paths';END IF;
 definition=replace(definition,bulk_anchor,$n$IF p_action='save-bulk' AND (
   'COD_EQUIPAMENTO_TRANSPORTE'=ANY(v_keys) OR 'COD_EQUIPAMENTO_COMPARTIMENTO'=ANY(v_keys)) THEN
  PERFORM billing_private.import_spread_equipment(r,v_ids,p_payload->>'value');
 END IF;
 FOREACH v_entry IN ARRAY v_ids LOOP$n$);
 definition=replace(definition,entry_anchor,$n$billing_private.import_group_equipment_values(r,v_entry,p_payload->'values',
   billing_private.import_values_json(v_owner,v_entry))$n$);
 EXECUTE definition;
END $$;

COMMIT;
