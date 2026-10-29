BEGIN;

-- Equipment codes are NUMERIC where configured; preserve exact text otherwise.
CREATE FUNCTION billing_private.import_equipment_value(p_value text,p_type text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN p_type='decimal' AND btrim(coalesce(p_value,''))~'^-?[0-9]{1,15}([.,][0-9]{1,6})?$'
  THEN trim_scale(replace(btrim(p_value),',','.')::numeric)::text ELSE btrim(coalesce(p_value,'')) END
$$;

CREATE FUNCTION billing_private.import_mirror_equipment_values(p_fields jsonb,p_values jsonb,p_previous jsonb,p_edited_keys text[])
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE s constant text:='COD_EQUIPAMENTO_TRANSPORTE'; y constant text:='COD_EQUIPAMENTO_COMPARTIMENTO';
 s_type text;y_type text;common_type text;s_value text;y_value text;s_changed boolean;y_changed boolean;v text;
BEGIN
 SELECT f->>'type' INTO s_type FROM jsonb_array_elements(p_fields) f WHERE f->>'key'=s;
 SELECT f->>'type' INTO y_type FROM jsonb_array_elements(p_fields) f WHERE f->>'key'=y;
 IF s_type IS NULL OR y_type IS NULL OR jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN RETURN p_values; END IF;
 IF p_edited_keys IS NOT NULL AND NOT(s=ANY(p_edited_keys) OR y=ANY(p_edited_keys)) THEN RETURN p_values; END IF;
 IF p_values?s AND jsonb_typeof(p_values->s) IS DISTINCT FROM 'string'
  OR p_values?y AND jsonb_typeof(p_values->y) IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Os valores devem ser enviados como texto.' USING ERRCODE='22023';
 END IF;
 common_type=CASE WHEN s_type='decimal' OR y_type='decimal' THEN 'decimal' ELSE 'text' END;
 s_value=billing_private.import_equipment_value(p_values->>s,common_type);
 y_value=billing_private.import_equipment_value(p_values->>y,common_type);
 IF p_edited_keys IS NOT NULL THEN
  s_changed=s=ANY(p_edited_keys);y_changed=y=ANY(p_edited_keys);
 ELSE
  IF NOT p_values?s AND NOT p_values?y THEN RETURN p_values; END IF;
  s_changed=CASE WHEN NOT p_values?y THEN true WHEN NOT p_values?s THEN false
   ELSE s_value IS DISTINCT FROM billing_private.import_equipment_value(p_previous->>s,common_type) END;
  y_changed=CASE WHEN NOT p_values?s THEN true WHEN NOT p_values?y THEN false
   ELSE y_value IS DISTINCT FROM billing_private.import_equipment_value(p_previous->>y,common_type) END;
 END IF;
 IF NOT s_changed AND NOT y_changed THEN RETURN p_values; END IF;
 IF s_changed AND y_changed AND s_value IS DISTINCT FROM y_value THEN
  RAISE EXCEPTION 'Informe o mesmo equipamento nas colunas S e Y.' USING ERRCODE='22023';
 END IF;
 v=CASE WHEN s_changed THEN s_value ELSE y_value END;
 RETURN p_values||jsonb_build_object(s,v,y,v);
END $$;
REVOKE ALL ON FUNCTION billing_private.import_equipment_value(text,text),
 billing_private.import_mirror_equipment_values(jsonb,jsonb,jsonb,text[]) FROM PUBLIC,anon,authenticated;

-- Amend only the already-authorized, locked value writes. Imports retain their
-- source evidence; no existing document, value, permission or type is rewritten.
DO $$
DECLARE definition text:=pg_get_functiondef('billing_private.import_documents_dispatch_before_client_summaries(text,jsonb)'::regprocedure);
 bulk_anchor text:='PERFORM billing_private.import_store_values(v_owner,v_entry,v_fields,v_values,false);';
 entry_anchor text:='PERFORM billing_private.import_store_values(v_owner,v_entry,r.profile_snapshot->''fields'',p_payload->''values'',(p_payload->>''reviewed'')::boolean);';
BEGIN
 IF (length(definition)-length(replace(definition,bulk_anchor,'')))/length(bulk_anchor)<>1
  OR (length(definition)-length(replace(definition,entry_anchor,'')))/length(entry_anchor)<>1
  OR strpos(definition,'import_mirror_equipment_values')>0 THEN
  RAISE EXCEPTION 'Unexpected import write implementation; inspect before linking equipment fields.';
 END IF;
 definition=replace(definition,bulk_anchor,$bulk$
 IF p_action='save-bulk' THEN
  v_values=billing_private.import_mirror_equipment_values(v_fields,v_values,'{}'::jsonb,v_keys);
 END IF;
 PERFORM billing_private.import_store_values(v_owner,v_entry,v_fields,v_values,false);$bulk$);
 definition=replace(definition,entry_anchor,$entry$
 PERFORM billing_private.import_store_values(v_owner,v_entry,r.profile_snapshot->'fields',
  billing_private.import_mirror_equipment_values(r.profile_snapshot->'fields',p_payload->'values',
   billing_private.import_values_json(v_owner,v_entry),NULL),(p_payload->>'reviewed')::boolean);$entry$);
 EXECUTE definition;
END $$;
COMMIT;
