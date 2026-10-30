BEGIN;

-- Allocation is workspace-wide; identity reuse still belongs to the original
-- client and report layout. Contracts never participate in this namespace.
CREATE FUNCTION billing_private.import_numbering_group_key(p_client uuid,p_source jsonb,p_parser text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN key IS NOT NULL THEN jsonb_build_array(p_client,p_parser,key) END
 FROM (SELECT billing_private.import_source_group_key(p_source,p_parser) key) original
$$;
REVOKE ALL ON FUNCTION billing_private.import_numbering_group_key(uuid,jsonb,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.import_saved_entry_codes(p_owner uuid,p_client uuid,p_parser text,p_exclude uuid)
RETURNS TABLE(group_key jsonb,entry_code numeric,invalid boolean)
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH raw AS (
  SELECT coalesce(billing_private.import_numbering_group_key(d.client_id,e.source,d.profile_snapshot->>'parser'),
    jsonb_build_array('manual-entry',e.id)) group_key,
   coalesce(v.text_value,billing_private.decimal_text(v.decimal_value),v.date_value::text,'') raw_code
  FROM public.billing_import_documents d
  JOIN public.billing_import_entries e ON e.owner_id=d.owner_id AND e.document_id=d.id
  CROSS JOIN LATERAL(SELECT f->>'key' field_key FROM jsonb_array_elements(d.profile_snapshot->'fields') f
   WHERE f->>'key'='COD_ENTRADA' OR (f->>'source'='pdf' AND f->>'sourceKey'='entradaSequencialConjunto')
   ORDER BY CASE WHEN f->>'source'='pdf' AND f->>'sourceKey'='entradaSequencialConjunto' THEN 0 ELSE 1 END LIMIT 1) selected
  JOIN public.billing_import_entry_values v ON v.owner_id=e.owner_id AND v.entry_id=e.id AND v.field_key=selected.field_key
  WHERE d.owner_id=p_owner AND d.id IS DISTINCT FROM p_exclude
 ), parsed AS (
  SELECT group_key,raw_code,CASE WHEN raw_code~'^[0-9]{1,15}$' THEN CASE WHEN raw_code::numeric>0 THEN raw_code::numeric END END code FROM raw
 ) SELECT group_key,code,(raw_code<>'' AND code IS NULL) FROM parsed
$$;

DO $$
DECLARE definition text;
 old_next text:=$old$next_code=CASE WHEN p_config?'entrySequenceStart' OR maximum_code IS NOT NULL THEN greatest((p_config->>'entrySequenceStart')::numeric,maximum_code+1) END;$old$;
BEGIN
 definition=pg_get_functiondef('billing_private.number_import_groups(uuid,uuid,jsonb,jsonb,uuid,uuid,boolean)'::regprocedure);
 IF strpos(definition,old_next)=0 OR strpos(definition,'billing_private.import_source_group_key(')=0 THEN RAISE EXCEPTION 'Unexpected entry allocator';END IF;
 definition=replace(definition,old_next,$new$next_code=CASE WHEN maximum_code IS NOT NULL THEN maximum_code+1 ELSE (p_config->>'entrySequenceStart')::numeric END;$new$);
 definition=replace(definition,'v_key=billing_private.import_numbering_field(p_config,p_force);','v_key=billing_private.import_numbering_field(p_config,p_force OR p_exclude IS NOT NULL);');
 definition=replace(definition,'billing_private.import_source_group_key(','billing_private.import_numbering_group_key(p_client,');
 definition=replace(definition,'deste cliente','desta conta');
 EXECUTE definition;
 -- Keep the existing dispatcher, authorization, revision checks, locks and
 -- explicit anchored edits. Only its historical comparisons use the namespace.
 definition=pg_get_functiondef('billing_private.import_documents_dispatch_before_client_ledger(text,jsonb)'::regprocedure);
 IF strpos(definition,'billing_private.number_import_groups(')=0 OR strpos(definition,'billing_private.import_saved_entry_codes(')=0 THEN RAISE EXCEPTION 'Unexpected numbering dispatcher';END IF;
 definition=replace(definition,'billing_private.import_source_group_key(','billing_private.import_numbering_group_key(r.client_id,');
 definition=replace(definition,'deste cliente','desta conta');
 EXECUTE definition;
END $$;

COMMENT ON FUNCTION billing_private.import_saved_entry_codes(uuid,uuid,text,uuid)
 IS 'Current entry codes across all clients/layouts in one workspace. Client/layout identify source groups, not separate counters.';

COMMIT;
