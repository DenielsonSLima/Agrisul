BEGIN;

-- Keep the source trip identity and the volume of each origin used by link-load.
-- The complete trip volume comes from the same exact numeric weight summary
-- displayed in Imports, before linked origins are removed from the queue.
CREATE FUNCTION billing_private.import_load_group_summary(p_document public.billing_import_documents)
RETURNS TABLE(trip_key text,group_key text,group_ordinal integer,group_volume numeric,group_entry_count bigint,group_origin_count bigint)
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH document AS MATERIALIZED (
  SELECT billing_private.import_document_json(p_document) body
 ), entries AS MATERIALIZED (
  SELECT coalesce(nullif(e->>'groupKey',''),'entry:'||(e->>'id')) source_group,
   coalesce(e->'values'->>'COD_FAZENDA','') farm,coalesce(e->'values'->>'COD_TALHAO','') plot
  FROM document CROSS JOIN LATERAL jsonb_array_elements(body->'entries') e
 ), origins AS MATERIALIZED (
  SELECT DISTINCT source_group,farm,plot FROM entries
 ), origin_counts AS (
  SELECT source_group,count(*) origin_count FROM origins GROUP BY source_group
 ), weights AS (
  SELECT CASE WHEN (g->>'linked')::boolean THEN g->>'key'
    ELSE 'entry:'||substr(g->>'key',8) END source_group,g
  FROM document CROSS JOIN LATERAL jsonb_array_elements(
   billing_private.import_screen_weight_summary(body->'entries',body->'entries',body->'profileSnapshot'->'fields')->'trips') g
 )
 SELECT CASE WHEN c.origin_count>1 THEN o.source_group||'|origin:'||jsonb_build_array(o.farm,o.plot)::text ELSE o.source_group END,
  o.source_group,(w.g->>'groupOrdinal')::integer,
  CASE WHEN p_document.profile_snapshot->>'parser' IN ('taquari-equipment-v1','pinheiro-usjp-v1')
   AND (w.g->>'netMissingCount')::bigint=0 THEN (w.g->>'netWeight')::numeric END,
  (w.g->>'totalEntryCount')::bigint,c.origin_count
 FROM origins o JOIN origin_counts c USING(source_group) JOIN weights w USING(source_group)
$$;
REVOKE ALL ON FUNCTION billing_private.import_load_group_summary(public.billing_import_documents) FROM PUBLIC,anon,authenticated;

DO $$
DECLARE definition text:=pg_get_functiondef('billing_private.import_documents_dispatch(text,jsonb)'::regprocedure);
 old_fields text:=$old$'farmCode',trip.farm_code,'plotCode',trip.plot_code,'issue',trip.issue$old$;
 old_join text:=$old$CROSS JOIN LATERAL billing_private.import_load_candidates(doc) trip$old$;
BEGIN
 IF strpos(definition,old_fields)=0 OR strpos(definition,old_join)=0 OR strpos(definition,'''groupVolume''')>0 THEN
  RAISE EXCEPTION 'Unexpected pending-loads projection; inspect before adding source group volumes.';
 END IF;
 definition=replace(definition,old_fields,$new$'farmCode',trip.farm_code,'plotCode',trip.plot_code,'issue',trip.issue,
   'groupKey',trip_group.group_key,'groupOrdinal',trip_group.group_ordinal,
   'groupVolume',billing_private.decimal_text(trip_group.group_volume),
   'groupEntryCount',trip_group.group_entry_count,'groupOriginCount',trip_group.group_origin_count$new$);
 definition=replace(definition,old_join,$new$CROSS JOIN LATERAL billing_private.import_load_candidates(doc) trip
  JOIN LATERAL billing_private.import_load_group_summary(doc) trip_group ON trip_group.trip_key=trip.trip_key$new$);
 EXECUTE definition;
END $$;
COMMIT;
