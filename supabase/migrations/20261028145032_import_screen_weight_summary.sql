BEGIN;

CREATE FUNCTION billing_private.import_weight_metrics(
 p_entries bigint,p_trips bigint,p_gross numeric,p_net numeric,p_gross_missing bigint,p_net_missing bigint
) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('entryCount',p_entries,'tripCount',p_trips,
  'grossWeight',CASE WHEN p_entries=0 THEN '0' ELSE billing_private.decimal_text(p_gross) END,
  'netWeight',CASE WHEN p_entries=0 THEN '0' ELSE billing_private.decimal_text(p_net) END,
  'grossMissingCount',p_gross_missing,'netMissingCount',p_net_missing)
$$;
REVOKE ALL ON FUNCTION billing_private.import_weight_metrics(bigint,bigint,numeric,numeric,bigint,bigint) FROM PUBLIC,anon,authenticated;

-- Inputs are the authorized document projection, never identities from a payload.
-- The source group identifies one trip; trailers/analyses contribute weights.
CREATE FUNCTION billing_private.import_screen_weight_summary(p_visible jsonb,p_all jsonb,p_fields jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 WITH field_types AS (
  SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(p_fields) f WHERE f->>'key'='PESOBRUTO' AND f->>'type'='decimal') gross_numeric,
   EXISTS(SELECT 1 FROM jsonb_array_elements(p_fields) f WHERE f->>'key'='TARA' AND f->>'type'='decimal') tare_numeric
 ), all_entries AS MATERIALIZED (
  SELECT e,coalesce(nullif(e->>'groupKey',''),'manual:'||(e->>'id')) trip_key,
   nullif(e->>'groupKey','') IS NOT NULL linked,
   nullif(e->'values'->>'COD_EQUIPAMENTO_TRANSPORTE','') equipment,
   nullif(e->'values'->>'COD_ENTRADA','') entry_number
  FROM jsonb_array_elements(p_all) e
 ), full_groups AS MATERIALIZED (
  SELECT trip_key,bool_and(linked) linked,count(*) total_entries,
   coalesce(array_agg(DISTINCT equipment ORDER BY equipment) FILTER(WHERE equipment IS NOT NULL),ARRAY[]::text[]) equipment_codes,
   coalesce(jsonb_agg(DISTINCT entry_number ORDER BY entry_number) FILTER(WHERE entry_number IS NOT NULL),'[]'::jsonb) entry_numbers,
   min((e->>'groupOrdinal')::integer) group_ordinal,min(e->>'date') entry_date
  FROM all_entries GROUP BY trip_key
 ), visible_values AS MATERIALIZED (
  SELECT a.trip_key,ord,
   CASE WHEN t.gross_numeric AND (v.e->'values'->>'PESOBRUTO')~'^-?[0-9]+([.][0-9]+)?$' THEN (v.e->'values'->>'PESOBRUTO')::numeric END gross,
   CASE WHEN t.tare_numeric AND (v.e->'values'->>'TARA')~'^-?[0-9]+([.][0-9]+)?$' THEN (v.e->'values'->>'TARA')::numeric END tare
  FROM jsonb_array_elements(p_visible) WITH ORDINALITY v(e,ord)
  JOIN all_entries a ON a.e->>'id'=v.e->>'id' CROSS JOIN field_types t
 ), weights AS MATERIALIZED (
  SELECT *,CASE WHEN gross IS NOT NULL AND tare IS NOT NULL THEN gross-tare END net FROM visible_values
 ), trip_weights AS (
  SELECT trip_key,min(ord) first_order,count(*) entry_count,sum(gross) gross,sum(net) net,
   count(*) FILTER(WHERE gross IS NULL) gross_missing,count(*) FILTER(WHERE net IS NULL) net_missing
  FROM weights GROUP BY trip_key
 ), trips AS MATERIALIZED (
  SELECT t.*,g.linked,g.total_entries,g.equipment_codes,g.entry_numbers,g.group_ordinal,g.entry_date,
   CASE WHEN cardinality(g.equipment_codes)=1 THEN 'equipment:'||g.equipment_codes[1]
    WHEN cardinality(g.equipment_codes)>1 THEN 'conflict:'||to_jsonb(g.equipment_codes)::text ELSE 'missing' END equipment_key,
   CASE WHEN cardinality(g.equipment_codes)=1 THEN 'assigned' WHEN cardinality(g.equipment_codes)>1 THEN 'conflict' ELSE 'missing' END equipment_status
  FROM trip_weights t JOIN full_groups g USING(trip_key)
 ), equipment AS (
  SELECT equipment_key,equipment_status,equipment_codes,sum(entry_count)::bigint entry_count,
   count(*) FILTER(WHERE linked) trip_count,sum(gross) gross,sum(net) net,
   sum(gross_missing)::bigint gross_missing,sum(net_missing)::bigint net_missing
  FROM trips GROUP BY equipment_key,equipment_status,equipment_codes
 ), sizes AS (
  SELECT total_entries,count(*) trip_count FROM trips WHERE linked GROUP BY total_entries
 )
 SELECT (SELECT billing_private.import_weight_metrics(count(*),count(DISTINCT w.trip_key) FILTER(WHERE g.linked),sum(w.gross),sum(w.net),
    count(*) FILTER(WHERE w.gross IS NULL),count(*) FILTER(WHERE w.net IS NULL))
   FROM weights w JOIN full_groups g USING(trip_key))
 ||jsonb_build_object(
  'equipmentCount',(SELECT count(*) FROM equipment WHERE equipment_status='assigned'),
  'unlinkedEntryCount',(SELECT coalesce(sum(entry_count),0) FROM trips WHERE NOT linked),
  'partialTripCount',(SELECT count(*) FROM trips WHERE linked AND entry_count<total_entries),
  'equipment',coalesce((SELECT jsonb_agg(billing_private.import_weight_metrics(entry_count,trip_count,gross,net,gross_missing,net_missing)
   ||jsonb_build_object('key',equipment_key,'equipmentCodes',to_jsonb(equipment_codes),'status',equipment_status)
   ORDER BY equipment_status,equipment_codes) FROM equipment),'[]'::jsonb),
  'trips',coalesce((SELECT jsonb_agg(billing_private.import_weight_metrics(entry_count,CASE WHEN linked THEN 1 ELSE 0 END,gross,net,gross_missing,net_missing)
   ||jsonb_build_object('key',trip_key,'entryNumbers',entry_numbers,'groupOrdinal',group_ordinal,'date',entry_date,
    'equipmentCodes',to_jsonb(equipment_codes),'totalEntryCount',total_entries,'partial',linked AND entry_count<total_entries,'linked',linked)
   ORDER BY first_order,trip_key) FROM trips),'[]'::jsonb),
  'groupSizes',coalesce((SELECT jsonb_agg(jsonb_build_object('entryCount',total_entries,'tripCount',trip_count) ORDER BY total_entries) FROM sizes),'[]'::jsonb)
 )
$$;
REVOKE ALL ON FUNCTION billing_private.import_screen_weight_summary(jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;

-- Enrich only the internal table projection. Existing export responses still
-- return the original model columns and typed rows, without screen summaries.
DO $$
DECLARE definition text:=pg_get_functiondef('billing_private.import_filtered_table(jsonb,jsonb)'::regprocedure);
BEGIN
 IF strpos(definition,'RETURN v_result;')=0 OR strpos(definition,'''weightSummary''')>0 THEN
  RAISE EXCEPTION 'Unexpected filtered-table projection; inspect before adding screen totals.';
 END IF;
 EXECUTE replace(definition,'RETURN v_result;',$summary$RETURN v_result||jsonb_build_object('weightSummary',
  billing_private.import_screen_weight_summary(v_result->'entries',p_document->'entries',p_document->'profileSnapshot'->'fields'));$summary$);
END $$;
COMMIT;
