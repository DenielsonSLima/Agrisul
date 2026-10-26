BEGIN;

CREATE INDEX billing_import_documents_client_status
 ON public.billing_import_documents(owner_id,client_id,status,created_at,id);

-- Fields come from each immutable document snapshot; workbook binaries never
-- belong to this operational read projection. Filters use destination values.
CREATE FUNCTION billing_private.import_client_ledger(
 p_owner uuid,p_client uuid,p_status text,p_from date,p_to date,p_farm text,p_plot text,p_group_by text
) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 WITH documents AS MATERIALIZED (
  SELECT d.id,d.owner_id,d.source_name,d.status,d.created_at,d.updated_at,
   d.profile_snapshot->>'name' profile_name,d.profile_snapshot->>'parser' parser,
   d.profile_snapshot->'fields' fields
  FROM public.billing_import_documents d
  WHERE d.owner_id=p_owner AND d.client_id=p_client AND (p_status='all' OR d.status=p_status)
 ), original_rows AS MATERIALIZED (
  SELECT e.*,d.source_name,d.profile_name,d.parser,d.fields,d.created_at document_created_at,
   billing_private.import_source_group_key(e.source,d.parser) source_group
  FROM documents d JOIN public.billing_import_entries e ON e.owner_id=d.owner_id AND e.document_id=d.id
 ), first_positions AS (
  SELECT document_id,source_group,min(position) first_position FROM original_rows
  WHERE source_group IS NOT NULL GROUP BY document_id,source_group
 ), original_ordinals AS (
  SELECT document_id,source_group,row_number() OVER(PARTITION BY document_id ORDER BY first_position,source_group::text)::integer ordinal
  FROM first_positions
 ), dated_rows AS MATERIALIZED (
  SELECT e.*,o.ordinal,billing_private.import_values_json(e.owner_id,e.id) cell_values,
   billing_private.import_entry_pending(e.owner_id,e.id,e.fields) pending
  FROM original_rows e LEFT JOIN original_ordinals o ON o.document_id=e.document_id AND o.source_group=e.source_group
  WHERE (p_from IS NULL OR e.entry_date>=p_from) AND (p_to IS NULL OR e.entry_date<=p_to)
 ), dimension_rows AS MATERIALIZED (
  SELECT e.*,coalesce(e.cell_values->>'COD_FAZENDA','') farm,coalesce(e.cell_values->>'COD_TALHAO','') plot
  FROM dated_rows e
 ), filtered_rows AS MATERIALIZED (
  SELECT e.*,row_number() OVER(ORDER BY e.document_created_at,e.document_id,e.position,e.id) base_order
  FROM dimension_rows e
  WHERE (p_farm='' OR e.farm=CASE WHEN p_farm='__empty__' THEN '' ELSE p_farm END)
   AND (p_plot='' OR e.plot=CASE WHEN p_plot='__empty__' THEN '' ELSE p_plot END)
 ), buckets AS (
  SELECT e.*,CASE p_group_by WHEN 'day' THEN e.entry_date::text WHEN 'farm' THEN e.farm WHEN 'plot' THEN e.plot
   WHEN 'source-group' THEN coalesce(e.source_group::text,'manual:'||e.id::text) ELSE 'none' END bucket_key
  FROM filtered_rows e
 ), bucket_metrics AS (
  SELECT bucket_key,min(base_order) first_order,
   CASE p_group_by
    WHEN 'day' THEN to_char(min(entry_date),'DD/MM/YYYY')
    WHEN 'farm' THEN CASE WHEN min(farm)='' THEN 'Fazenda não informada' ELSE 'Fazenda '||min(farm) END
    WHEN 'plot' THEN CASE WHEN min(plot)='' THEN 'Talhão não informado' ELSE 'Talhão '||min(plot) END
    WHEN 'source-group' THEN CASE WHEN bool_and(source_group IS NULL) THEN 'Lançamento manual'
     WHEN count(DISTINCT nullif(cell_values->>'COD_ENTRADA',''))=1 THEN 'Entrada '||min(nullif(cell_values->>'COD_ENTRADA',''))
     ELSE 'Conjunto '||min(ordinal)::text END
    ELSE 'Lançamentos' END label,
   billing_private.import_operational_group_summary(count(DISTINCT entry_date),count(DISTINCT document_id),count(*),
    count(*) FILTER(WHERE pending),min(entry_date),max(entry_date),count(DISTINCT source_group)) summary
  FROM buckets GROUP BY bucket_key
 ), bucket_order AS (
  SELECT m.*,row_number() OVER(ORDER BY CASE WHEN p_group_by IN ('day','farm','plot') THEN bucket_key END,first_order,bucket_key) bucket_order
  FROM bucket_metrics m
 ), row_starts AS (
  SELECT e.*,b.bucket_order,
   e.source_group IS NOT NULL AND (
    lag(e.source_group) OVER visible_order IS DISTINCT FROM e.source_group
    OR lag(e.document_id) OVER visible_order IS DISTINCT FROM e.document_id
    OR lag(e.bucket_key) OVER visible_order IS DISTINCT FROM e.bucket_key
   ) group_start
  FROM buckets e JOIN bucket_order b ON b.bucket_key=e.bucket_key
  WINDOW visible_order AS(ORDER BY b.bucket_order,e.base_order)
 ), bands AS (
  SELECT r.*,sum(group_start::integer) OVER(ORDER BY bucket_order,base_order ROWS UNBOUNDED PRECEDING) band_ordinal
  FROM row_starts r
 ), grouped_rows AS (
  SELECT bucket_key,jsonb_agg(jsonb_build_object(
   'documentId',document_id,
   'bandOrdinal',CASE WHEN source_group IS NOT NULL THEN band_ordinal END,
   'groupBand',CASE WHEN source_group IS NULL THEN NULL WHEN band_ordinal%2=0 THEN 'even' ELSE 'odd' END,
   'groupStart',group_start,
   'entry',jsonb_build_object('id',id,'date',to_char(entry_date,'YYYY-MM-DD'),'values',cell_values,'source',source,
    'sourcePage',source_page,'sourceLine',source_line,'reviewed',reviewed,
    'groupKey',source_group::text,'groupOrdinal',ordinal)
  ) ORDER BY base_order) entries FROM bands GROUP BY bucket_key
 )
 SELECT jsonb_build_object(
  'clientId',p_client,
  'clientName',(SELECT coalesce(nullif(c.trade_name,''),c.legal_name) FROM public.billing_clients c WHERE c.owner_id=p_owner AND c.id=p_client),
  'summary',(SELECT billing_private.import_operational_group_summary(count(DISTINCT entry_date),count(DISTINCT document_id),count(*),
   count(*) FILTER(WHERE pending),min(entry_date),max(entry_date),count(DISTINCT source_group)) FROM filtered_rows),
  'facets',jsonb_build_object(
   'farms',coalesce((SELECT jsonb_agg(jsonb_build_object('value',CASE WHEN farm='' THEN '__empty__' ELSE farm END,
    'label',CASE WHEN farm='' THEN 'Não informada' ELSE farm END) ORDER BY farm) FROM (SELECT DISTINCT farm FROM dimension_rows) f),'[]'::jsonb),
   'plots',coalesce((SELECT jsonb_agg(jsonb_build_object('value',CASE WHEN plot='' THEN '__empty__' ELSE plot END,
    'label',CASE WHEN plot='' THEN 'Não informado' ELSE plot END) ORDER BY plot) FROM (SELECT DISTINCT plot FROM dimension_rows) t),'[]'::jsonb)
  ),
  'documents',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'sourceName',d.source_name,'profileName',d.profile_name,
   'status',d.status,'updatedAt',d.updated_at,'fields',d.fields) ORDER BY d.created_at,d.id)
   FROM documents d WHERE EXISTS(SELECT 1 FROM filtered_rows r WHERE r.document_id=d.id)),'[]'::jsonb),
  'groups',coalesce((SELECT jsonb_agg(jsonb_build_object('key',b.bucket_key,'label',b.label,'summary',b.summary,'entries',r.entries)
   ORDER BY b.bucket_order) FROM bucket_order b JOIN grouped_rows r ON r.bucket_key=b.bucket_key),'[]'::jsonb),
  'canManage',billing_private.has_permission('registrations.write')
 )
$$;
REVOKE ALL ON FUNCTION billing_private.import_client_ledger(uuid,uuid,text,date,date,text,text,text) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.import_documents_dispatch(text,jsonb) RENAME TO import_documents_dispatch_before_client_ledger;
REVOKE ALL ON FUNCTION billing_private.import_documents_dispatch_before_client_ledger(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.import_documents_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();v_client uuid;v_status text;v_group text;v_from date;v_to date;v_farm text;v_plot text;k text;v text;
BEGIN
 IF p_action IS DISTINCT FROM 'ledger' THEN RETURN billing_private.import_documents_dispatch_before_client_ledger(p_action,p_payload); END IF;
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Entre para acessar os lançamentos.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize('registrations.read');
 PERFORM billing_private.request_payload(p_payload,ARRAY['clientId','status','dateFrom','dateTo','farm','plot','groupBy']);
 FOREACH k IN ARRAY ARRAY['clientId','status','dateFrom','dateTo','farm','plot','groupBy'] LOOP
  IF p_payload?k AND jsonb_typeof(p_payload->k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Filtros de lançamentos inválidos.' USING ERRCODE='22023'; END IF;
 END LOOP;
 v_client=nullif(p_payload->>'clientId','')::uuid;
 IF v_client IS NULL OR NOT EXISTS(SELECT 1 FROM public.billing_clients c WHERE c.owner_id=v_owner AND c.id=v_client) THEN
  RAISE EXCEPTION 'Empresa não encontrada.' USING ERRCODE='P0002'; END IF;
 v_status=coalesce(p_payload->>'status','open');v_group=coalesce(p_payload->>'groupBy','none');
 v_farm=btrim(coalesce(p_payload->>'farm',''));v_plot=btrim(coalesce(p_payload->>'plot',''));
 IF v_status NOT IN ('open','finished','all') OR v_group NOT IN ('none','day','farm','plot','source-group') OR length(v_farm)>160 OR length(v_plot)>160 THEN
  RAISE EXCEPTION 'Filtros de lançamentos inválidos.' USING ERRCODE='22023'; END IF;
 FOREACH k IN ARRAY ARRAY['dateFrom','dateTo'] LOOP
  v=nullif(btrim(p_payload->>k),'');
  IF v IS NOT NULL THEN
   IF v!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v::date<'0001-01-01'::date OR v::date>'9998-12-31'::date THEN
    RAISE EXCEPTION 'Informe datas válidas para filtrar os lançamentos.' USING ERRCODE='22023'; END IF;
   IF k='dateFrom' THEN v_from=v::date;ELSE v_to=v::date;END IF;
  END IF;
 END LOOP;
 IF v_from IS NOT NULL AND v_to IS NOT NULL AND v_from>v_to THEN RAISE EXCEPTION 'A data inicial não pode ser posterior à final.' USING ERRCODE='22023'; END IF;
 RETURN billing_private.import_client_ledger(v_owner,v_client,v_status,v_from,v_to,v_farm,v_plot,v_group);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Confira a empresa e os filtros de datas informados.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.import_documents_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
COMMIT;
