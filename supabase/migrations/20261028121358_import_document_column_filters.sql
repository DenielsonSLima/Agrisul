BEGIN;

-- One projection serves the table and the workbook. Values keep their document's
-- configured types; numeric sorting never goes through floating point or JS.
CREATE FUNCTION billing_private.import_filtered_table(p_document jsonb,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE v_fields jsonb:=p_document->'profileSnapshot'->'fields';
 v_filters jsonb:=coalesce(p_payload->'columnFilters','{}'::jsonb);v_key text:=coalesce(p_payload->>'sortKey','');
 v_direction text:=coalesce(p_payload->>'sortDirection','asc');v_type text;v_filter record;v_date date;v_from date;v_to date;v text;k text;v_result jsonb;
BEGIN
 IF jsonb_typeof(v_filters) IS DISTINCT FROM 'object' OR v_direction NOT IN ('asc','desc') THEN
  RAISE EXCEPTION 'Filtros ou ordenação inválidos.' USING ERRCODE='22023'; END IF;
 FOREACH k IN ARRAY ARRAY['date','dateFrom','dateTo','farm','plot','sortKey','sortDirection'] LOOP
  IF p_payload?k AND (jsonb_typeof(p_payload->k) IS DISTINCT FROM 'string' OR length(p_payload->>k)>160) THEN
   RAISE EXCEPTION 'Filtros de coluna inválidos.' USING ERRCODE='22023'; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['date','dateFrom','dateTo'] LOOP
  v=nullif(p_payload->>k,'');
  IF v IS NOT NULL THEN
   IF v!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v::date<'0001-01-01'::date OR v::date>'9998-12-31'::date THEN
    RAISE EXCEPTION 'Informe uma data válida.' USING ERRCODE='22023'; END IF;
   IF k='date' THEN v_date=v::date;ELSIF k='dateFrom' THEN v_from=v::date;ELSE v_to=v::date;END IF;
  END IF;
 END LOOP;
 IF v_from>v_to THEN RAISE EXCEPTION 'A data inicial não pode ser posterior à final.' USING ERRCODE='22023'; END IF;
 FOR v_filter IN SELECT * FROM jsonb_each(v_filters) LOOP
  IF v_filter.key NOT IN ('$date','$reviewed') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_fields) f WHERE f->>'key'=v_filter.key) THEN
   RAISE EXCEPTION 'Coluna de filtro desconhecida.' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(v_filter.value) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Selecione valores válidos.' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(v_filter.value)>10000 OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_filter.value) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'string' OR length(x#>>'{}')>1000) THEN
   RAISE EXCEPTION 'Selecione valores válidos.' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF v_key='$date' THEN v_type='date';ELSIF v_key='$reviewed' THEN v_type='text';
 ELSIF v_key<>'' THEN
  SELECT f->>'type' INTO v_type FROM jsonb_array_elements(v_fields) f WHERE f->>'key'=v_key;
  IF v_type IS NULL THEN RAISE EXCEPTION 'Coluna de ordenação desconhecida.' USING ERRCODE='22023'; END IF;
 END IF;
 WITH base AS MATERIALIZED (
  SELECT e,ordinality pos,(e->'values')||jsonb_build_object('$date',e->>'date','$reviewed',e->>'reviewed') cells
  FROM jsonb_array_elements(p_document->'entries') WITH ORDINALITY AS x(e,ordinality)
  WHERE (v_date IS NULL OR (e->>'date')::date=v_date)
   AND (v_from IS NULL OR (e->>'date')::date>=v_from) AND (v_to IS NULL OR (e->>'date')::date<=v_to)
   AND (coalesce(p_payload->>'farm','')='' OR coalesce(e->'values'->>'COD_FAZENDA','')=CASE WHEN p_payload->>'farm'='__empty__' THEN '' ELSE p_payload->>'farm' END)
   AND (coalesce(p_payload->>'plot','')='' OR coalesce(e->'values'->>'COD_TALHAO','')=CASE WHEN p_payload->>'plot'='__empty__' THEN '' ELSE p_payload->>'plot' END)
 ), filtered AS MATERIALIZED (
  SELECT *,nullif(cells->>v_key,'') sort_value FROM base b
  WHERE NOT EXISTS(SELECT 1 FROM jsonb_each(v_filters) f WHERE NOT f.value @> jsonb_build_array(coalesce(b.cells->>f.key,'')))
 ), ordered AS (
  SELECT *,row_number() OVER(ORDER BY
   CASE WHEN v_type='decimal' AND v_direction='asc' THEN sort_value::numeric END ASC NULLS LAST,
   CASE WHEN v_type='decimal' AND v_direction='desc' THEN sort_value::numeric END DESC NULLS LAST,
   CASE WHEN v_type='date' AND v_direction='asc' THEN sort_value::date END ASC NULLS LAST,
   CASE WHEN v_type='date' AND v_direction='desc' THEN sort_value::date END DESC NULLS LAST,
   CASE WHEN v_type='text' AND v_direction='asc' THEN lower(sort_value) END ASC NULLS LAST,
   CASE WHEN v_type='text' AND v_direction='desc' THEN lower(sort_value) END DESC NULLS LAST,pos) n
  FROM filtered
 ), facet_values AS (
  SELECT f.key,coalesce(b.cells->>f.key,'') value FROM base b CROSS JOIN (
   SELECT f->>'key' key FROM jsonb_array_elements(v_fields) f UNION ALL SELECT '$date' UNION ALL SELECT '$reviewed'
  ) f GROUP BY f.key,coalesce(b.cells->>f.key,'')
 ), facets AS (SELECT key,jsonb_agg(value ORDER BY value) values FROM facet_values GROUP BY key)
 SELECT jsonb_build_object(
  'entries',coalesce((SELECT jsonb_agg(e ORDER BY n) FROM ordered),'[]'::jsonb),
  'updatedAt',p_document->>'updatedAt',
  'summary',(SELECT billing_private.import_operational_group_summary(count(DISTINCT e->>'date'),CASE WHEN count(*)>0 THEN 1 ELSE 0 END,count(*),
   count(*) FILTER(WHERE billing_private.import_entry_pending((p_document->>'ownerId')::uuid,(e->>'id')::uuid,v_fields)),
   min((e->>'date')::date),max((e->>'date')::date),count(DISTINCT nullif(e->>'groupKey',''))) FROM filtered),
  'facets',coalesce((SELECT jsonb_object_agg(key,values) FROM facets),'{}'::jsonb)
 ) INTO v_result;
 RETURN v_result;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Confira os filtros e os tipos das colunas.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.import_filtered_table(jsonb,jsonb) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.import_documents_dispatch(text,jsonb) RENAME TO import_documents_dispatch_before_column_filters;
REVOKE ALL ON FUNCTION billing_private.import_documents_dispatch_before_column_filters(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.import_documents_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();v_result jsonb;v_document jsonb;v_table jsonb;v_id uuid;v_cards jsonb;
BEGIN
 IF p_action='ledger' THEN
  v_result=billing_private.import_documents_dispatch_before_column_filters(p_action,p_payload);
  SELECT coalesce(jsonb_agg(d||jsonb_build_object('summary',(
   SELECT billing_private.import_operational_group_summary(count(DISTINCT row->'entry'->>'date'),CASE WHEN count(*)>0 THEN 1 ELSE 0 END,count(*),
    count(*) FILTER(WHERE billing_private.import_entry_pending(v_owner,(row->'entry'->>'id')::uuid,d->'fields')),
    min((row->'entry'->>'date')::date),max((row->'entry'->>'date')::date),count(DISTINCT row->'entry'->>'groupKey'))
   FROM jsonb_array_elements(v_result->'groups') g CROSS JOIN LATERAL jsonb_array_elements(g->'entries') row WHERE row->>'documentId'=d->>'id'
  )) ORDER BY ord),'[]'::jsonb) INTO v_cards FROM jsonb_array_elements(v_result->'documents') WITH ORDINALITY x(d,ord);
  RETURN v_result||jsonb_build_object('documents',v_cards);
 END IF;
 IF p_action NOT IN ('table','export-filtered') OR p_action IS NULL THEN
  RETURN billing_private.import_documents_dispatch_before_column_filters(p_action,p_payload); END IF;
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Entre para acessar os lançamentos.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize('registrations.read');
 PERFORM billing_private.request_payload(p_payload,ARRAY['id','date','dateFrom','dateTo','farm','plot','columnFilters','sortKey','sortDirection','expectedUpdatedAt']);
 v_id=(p_payload->>'id')::uuid;
 -- Existing export obtains a shared document lock; writers use the same row lock.
 IF p_action='export-filtered' THEN
  v_result=billing_private.import_documents_dispatch_before_column_filters('export',jsonb_build_object('id',v_id));
  v_document=v_result->'document';
  IF jsonb_typeof(p_payload->'expectedUpdatedAt') IS DISTINCT FROM 'string' OR (p_payload->>'expectedUpdatedAt')::timestamptz IS DISTINCT FROM (v_document->>'updatedAt')::timestamptz THEN
   RAISE EXCEPTION 'O PDF foi atualizado. Aguarde a atualização da tabela antes de exportar.' USING ERRCODE='40001'; END IF;
 ELSE
  v_document=billing_private.import_documents_dispatch_before_column_filters('get',jsonb_build_object('id',v_id))->'document';
 END IF;
 v_table=billing_private.import_filtered_table(v_document||jsonb_build_object('ownerId',v_owner),p_payload);
 IF p_action='table' THEN RETURN v_table;END IF;
 IF jsonb_array_length(v_table->'entries')=0 THEN RAISE EXCEPTION 'Nenhum lançamento no filtro para exportar.' USING ERRCODE='22023'; END IF;
 RETURN jsonb_set(v_result,'{rows}',coalesce((
  SELECT jsonb_agg(r ORDER BY ord) FROM jsonb_array_elements(v_table->'entries') WITH ORDINALITY e(entry,ord)
  JOIN LATERAL jsonb_array_elements(v_result->'rows') r ON r->>'entryId'=entry->>'id'
 ),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION billing_private.import_documents_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
COMMIT;
