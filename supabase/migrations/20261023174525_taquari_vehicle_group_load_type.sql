BEGIN;
-- Only newly imported documents whose profile opts into the derived source are
-- normalized. Existing snapshots and later manual corrections stay intact.
CREATE FUNCTION billing_private.normalize_taquari_vehicle_groups(p_entries jsonb,p_fields jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
 e jsonb; s jsonb; n integer; g record; group_values jsonb:='{}'::jsonb; result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_fields) f WHERE f->>'source'='pdf' AND f->>'sourceKey'='quantidadeVeiculosConjunto') THEN
  RETURN p_entries;
 END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
  s=e->'source';
  IF jsonb_typeof(s) IS DISTINCT FROM 'object'
   OR jsonb_typeof(s->'entrada') IS DISTINCT FROM 'string' OR btrim(coalesce(s->>'entrada',''))!~'^[0-9]{1,20}$'
   OR jsonb_typeof(s->'sequencia') IS DISTINCT FROM 'string' OR btrim(coalesce(s->>'sequencia',''))!~'^[0-9]{1,4}$'
   OR jsonb_typeof(s->'dataMovimento') IS DISTINCT FROM 'string' OR coalesce(s->>'dataMovimento','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   OR s->>'dataMovimento' IS DISTINCT FROM e->>'date' THEN
   RAISE EXCEPTION 'Não foi possível identificar o conjunto: confira entrada, sequência e data do movimento originais do PDF.' USING ERRCODE='22023';
  END IF;
  n=btrim(s->>'sequencia')::integer;
  IF n<1 THEN RAISE EXCEPTION 'A sequência do conjunto deve começar em 1.' USING ERRCODE='22023'; END IF;
  IF n=1 AND (jsonb_typeof(s->'equipamento') IS DISTINCT FROM 'string' OR length(btrim(coalesce(s->>'equipamento',''))) NOT BETWEEN 1 AND 100) THEN
   RAISE EXCEPTION 'O equipamento da sequência 1 não foi encontrado no PDF.' USING ERRCODE='22023';
  END IF;
 END LOOP;
 FOR g IN
  SELECT x.value->'source'->>'dataMovimento' movement,btrim(x.value->'source'->>'entrada') entry_number,
   count(*) vehicle_count,count(DISTINCT btrim(x.value->'source'->>'sequencia')::integer) distinct_count,
   min(btrim(x.value->'source'->>'sequencia')::integer) minimum_sequence,max(btrim(x.value->'source'->>'sequencia')::integer) maximum_sequence,
   max(btrim(x.value->'source'->>'equipamento')) FILTER(WHERE btrim(x.value->'source'->>'sequencia')::integer=1) principal
  FROM jsonb_array_elements(p_entries) x GROUP BY x.value->'source'->>'dataMovimento',btrim(x.value->'source'->>'entrada')
 LOOP
  IF g.vehicle_count<>g.distinct_count THEN
   RAISE EXCEPTION 'O conjunto da entrada % em % tem sequência repetida. Confira as páginas do PDF.',g.entry_number,g.movement USING ERRCODE='22023';
  END IF;
  IF g.minimum_sequence<>1 OR g.maximum_sequence<>g.vehicle_count THEN
   RAISE EXCEPTION 'O conjunto da entrada % em % está incompleto: são necessárias todas as sequências de 1 a %.',g.entry_number,g.movement,g.maximum_sequence USING ERRCODE='22023';
  END IF;
  group_values=jsonb_set(group_values,ARRAY[g.movement||'|'||g.entry_number],jsonb_build_object('quantity',g.vehicle_count::text,'principal',g.principal));
 END LOOP;
 SELECT jsonb_agg(x.value||jsonb_build_object(
  'source',(x.value->'source')||jsonb_build_object('quantidadeVeiculosConjunto',v.data->>'quantity','equipamentoPrincipal',v.data->>'principal'),
  'values',(x.value->'values')||coalesce((
   SELECT jsonb_object_agg(f->>'key',CASE WHEN f->>'sourceKey'='quantidadeVeiculosConjunto' THEN v.data->>'quantity'
    WHEN f?'mappings' AND f->'mappings'<>'{}'::jsonb THEN coalesce(f->'mappings'->>(v.data->>'principal'),'')
    ELSE v.data->>'principal' END)
   FROM jsonb_array_elements(p_fields) f WHERE f->>'source'='pdf' AND f->>'sourceKey' IN ('quantidadeVeiculosConjunto','equipamentoPrincipal')
  ),'{}'::jsonb)) ORDER BY x.position) INTO result
 FROM jsonb_array_elements(p_entries) WITH ORDINALITY x(value,position)
 CROSS JOIN LATERAL(SELECT group_values->((x.value->'source'->>'dataMovimento')||'|'||btrim(x.value->'source'->>'entrada')) data) v;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION billing_private.normalize_taquari_vehicle_groups(jsonb,jsonb) FROM PUBLIC,anon,authenticated;

DO $$
DECLARE definition text;
BEGIN
 definition=pg_get_functiondef('billing_private.import_profiles_dispatch(text,jsonb)'::regprocedure);
 IF strpos(definition,$before$'equipamentoPrincipal','fazendaZonaTalhao'$before$)=0 THEN
  RAISE EXCEPTION 'Expected Taquari source whitelist was not found.';
 END IF;
 EXECUTE replace(definition,$before$'equipamentoPrincipal','fazendaZonaTalhao'$before$,$after$'equipamentoPrincipal','fazendaZonaTalhao','quantidadeVeiculosConjunto'$after$);

 definition=pg_get_functiondef('billing_private.import_documents_dispatch(text,jsonb)'::regprocedure);
 IF strpos(definition,$before$INSERT INTO public.billing_import_documents(id,owner_id,client_id,profile_id,profile_snapshot,source_name,source_hash)$before$)=0 THEN
  RAISE EXCEPTION 'Expected import insertion was not found.';
 END IF;
 EXECUTE replace(definition,
  $before$INSERT INTO public.billing_import_documents(id,owner_id,client_id,profile_id,profile_snapshot,source_name,source_hash)$before$,
  $after$p_payload=jsonb_set(p_payload,'{entries}',billing_private.normalize_taquari_vehicle_groups(p_payload->'entries',p.config->'fields'));
  INSERT INTO public.billing_import_documents(id,owner_id,client_id,profile_id,profile_snapshot,source_name,source_hash)$after$);
END $$;
REVOKE ALL ON FUNCTION billing_private.import_profiles_dispatch(text,jsonb),billing_private.import_documents_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
COMMIT;
