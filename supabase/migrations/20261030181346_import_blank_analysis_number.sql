BEGIN;

-- The analysis number remains in source evidence; it is never an ERP value.
CREATE FUNCTION billing_private.import_blank_analysis_fields(p_fields jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(CASE WHEN field->>'key'='NUMERO_ANALISE' THEN
  field||jsonb_build_object('source','manual','sourceKey','','defaultValue','','pattern','','mappings','{}'::jsonb,'required',false)
  ELSE field END ORDER BY ordinal),'[]'::jsonb)
 FROM jsonb_array_elements(p_fields) WITH ORDINALITY AS fields(field,ordinal)
$$;
REVOKE ALL ON FUNCTION billing_private.import_blank_analysis_fields(jsonb) FROM PUBLIC,anon,authenticated;

DO $$
DECLARE definition text;
 profile_anchor text:='v_config=billing_private.import_numbering_config(v_config,old.config,p_payload);';
 store_anchor text:=$anchor$v_key=f->>'key';v=btrim(coalesce(p_values->>v_key,''));$anchor$;
BEGIN
 definition=pg_get_functiondef('billing_private.import_profiles_dispatch_before_lifecycle(text,jsonb)'::regprocedure);
 IF strpos(definition,profile_anchor)=0 THEN RAISE EXCEPTION 'Unexpected import profile write path';END IF;
 definition=replace(definition,profile_anchor,profile_anchor||$new$
 v_config=jsonb_set(v_config,'{fields}',billing_private.import_blank_analysis_fields(v_config->'fields'));$new$);
 EXECUTE definition;

 -- All imports, individual edits, bulk edits and type conversions use this
 -- private storage function after the dispatcher's authorization and locks.
 definition=pg_get_functiondef('billing_private.import_store_values(uuid,uuid,jsonb,jsonb,boolean)'::regprocedure);
 IF strpos(definition,store_anchor)=0 THEN RAISE EXCEPTION 'Unexpected import value write path';END IF;
 definition=replace(definition,'FOR f IN SELECT value FROM jsonb_array_elements(p_fields) LOOP',
  'FOR f IN SELECT value FROM jsonb_array_elements(billing_private.import_blank_analysis_fields(p_fields)) LOOP');
 definition=replace(definition,store_anchor,store_anchor||$new$
  IF v_key='NUMERO_ANALISE' THEN v='';END IF;$new$);
 EXECUTE definition;
END $$;

-- Correct saved profiles and historical snapshots as well as future imports.
-- Preserve source.numeroAnalise, all other values, column order and types.
UPDATE public.billing_import_profiles SET config=jsonb_set(config,'{fields}',billing_private.import_blank_analysis_fields(config->'fields'))
WHERE config->'fields' IS DISTINCT FROM billing_private.import_blank_analysis_fields(config->'fields');

UPDATE public.billing_import_documents d SET
 profile_snapshot=jsonb_set(profile_snapshot,'{fields}',billing_private.import_blank_analysis_fields(profile_snapshot->'fields')),
 updated_at=clock_timestamp()
WHERE profile_snapshot->'fields' IS DISTINCT FROM billing_private.import_blank_analysis_fields(profile_snapshot->'fields')
 OR EXISTS(SELECT 1 FROM public.billing_import_entries e JOIN public.billing_import_entry_values v ON v.owner_id=e.owner_id AND v.entry_id=e.id
  WHERE e.owner_id=d.owner_id AND e.document_id=d.id AND v.field_key='NUMERO_ANALISE'
   AND coalesce(v.text_value,v.decimal_value::text,v.date_value::text,'')<>'');

UPDATE public.billing_import_entry_values SET text_value='',decimal_value=NULL,date_value=NULL
WHERE field_key='NUMERO_ANALISE' AND coalesce(text_value,decimal_value::text,date_value::text,'')<>'';

COMMIT;
