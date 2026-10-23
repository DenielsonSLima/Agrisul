BEGIN;
CREATE FUNCTION billing_private.import_operational_summary(
 p_days bigint,p_documents bigint,p_entries bigint,p_pending bigint,p_date_from date,p_date_to date
) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('dayCount',p_days,'documentCount',p_documents,'entryCount',p_entries,
  'pendingCount',p_pending,'reviewedCount',p_entries-p_pending,'dateFrom',p_date_from,'dateTo',p_date_to)
$$;
REVOKE ALL ON FUNCTION billing_private.import_operational_summary(bigint,bigint,bigint,bigint,date,date) FROM PUBLIC,anon,authenticated;

-- Listing projects only identifiers, display metadata and server counts. Large
-- workbook snapshots and entry values are loaded by get when a day is expanded.
CREATE FUNCTION billing_private.import_client_collection(p_owner uuid,p_status text,p_search text,p_client uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 WITH documents AS MATERIALIZED (
  SELECT d.*,coalesce(nullif(c.trade_name,''),c.legal_name) client_name
  FROM public.billing_import_documents d
  JOIN public.billing_clients c ON c.owner_id=d.owner_id AND c.id=d.client_id
  WHERE d.owner_id=p_owner AND (p_status='all' OR d.status=p_status)
   AND (p_client IS NULL OR d.client_id=p_client)
   AND (p_search='' OR strpos(lower(c.legal_name||' '||c.trade_name||' '||d.source_name),lower(p_search))>0)
 ), entry_state AS MATERIALIZED (
  SELECT e.id,e.document_id,d.client_id,e.entry_date,
   billing_private.import_entry_pending(p_owner,e.id,d.profile_snapshot->'fields') pending
  FROM documents d JOIN public.billing_import_entries e ON e.owner_id=d.owner_id AND e.document_id=d.id
 ), document_metrics AS (
  SELECT document_id,count(*) entry_count,count(*) FILTER(WHERE pending) pending_count
  FROM entry_state GROUP BY document_id
 ), day_document_metrics AS (
  SELECT document_id,entry_date,count(*) entry_count,count(*) FILTER(WHERE pending) pending_count
  FROM entry_state GROUP BY document_id,entry_date
 ), day_documents AS (
  SELECT d.client_id,dm.entry_date,jsonb_agg(jsonb_build_object(
   'id',d.id,'clientId',d.client_id,'clientName',d.client_name,
   'profileId',d.profile_id,'profileName',d.profile_snapshot->>'name',
   'sourceName',d.source_name,'sourceHash',d.source_hash,'status',d.status,
   'createdAt',d.created_at,'updatedAt',d.updated_at,'finishedAt',d.finished_at,
   'entryCount',total.entry_count,'pendingCount',total.pending_count,
   'dayEntryCount',dm.entry_count,'dayPendingCount',dm.pending_count
  ) ORDER BY d.created_at,d.id) documents
  FROM documents d JOIN document_metrics total ON total.document_id=d.id
  JOIN day_document_metrics dm ON dm.document_id=d.id
  GROUP BY d.client_id,dm.entry_date
 ), day_metrics AS (
  SELECT client_id,entry_date,count(DISTINCT document_id) document_count,count(*) entry_count,
   count(*) FILTER(WHERE pending) pending_count
  FROM entry_state GROUP BY client_id,entry_date
 ), client_metrics AS (
  SELECT client_id,count(DISTINCT entry_date) day_count,count(DISTINCT document_id) document_count,
   count(*) entry_count,count(*) FILTER(WHERE pending) pending_count,
   min(entry_date) date_from,max(entry_date) date_to
  FROM entry_state GROUP BY client_id
 ), client_names AS (
  SELECT DISTINCT client_id,client_name FROM documents
 ), client_rows AS (
  SELECT cm.client_id,cn.client_name,
   billing_private.import_operational_summary(cm.day_count,cm.document_count,cm.entry_count,cm.pending_count,cm.date_from,cm.date_to) summary,
   jsonb_agg(jsonb_build_object('date',dm.entry_date,
    'summary',billing_private.import_operational_summary(1,dm.document_count,dm.entry_count,dm.pending_count,dm.entry_date,dm.entry_date),
    'documents',dd.documents) ORDER BY dm.entry_date DESC) days
  FROM client_metrics cm JOIN client_names cn ON cn.client_id=cm.client_id
  JOIN day_metrics dm ON dm.client_id=cm.client_id
  JOIN day_documents dd ON dd.client_id=dm.client_id AND dd.entry_date=dm.entry_date
  GROUP BY cm.client_id,cn.client_name,cm.day_count,cm.document_count,cm.entry_count,cm.pending_count,cm.date_from,cm.date_to
 )
 SELECT jsonb_build_object('clients',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'clientId',client_id,'clientName',client_name,'summary',summary,'days',days) ORDER BY client_name,client_id) FROM client_rows),'[]'::jsonb),
  'total',(SELECT count(*) FROM documents),'canManage',billing_private.has_permission('registrations.write'))
$$;
REVOKE ALL ON FUNCTION billing_private.import_client_collection(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.import_documents_dispatch(text,jsonb) RENAME TO import_documents_dispatch_before_client_summaries;
REVOKE ALL ON FUNCTION billing_private.import_documents_dispatch_before_client_summaries(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.import_documents_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_client uuid;v_id uuid;v_status text;v_search text;
 r public.billing_import_documents;v_summary jsonb;v_days jsonb;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('list','get') THEN
  RETURN billing_private.import_documents_dispatch_before_client_summaries(p_action,p_payload);
 END IF;
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Entre para acessar as importações.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize('registrations.read');
 PERFORM billing_private.request_payload(p_payload,CASE WHEN p_action='list' THEN ARRAY['status','search','clientId'] ELSE ARRAY['id'] END);
 IF p_action='list' THEN
  v_status=coalesce(p_payload->>'status','open');v_search=btrim(coalesce(p_payload->>'search',''));v_client=nullif(p_payload->>'clientId','')::uuid;
  IF v_status NOT IN ('open','finished','all') OR length(v_search)>160 THEN RAISE EXCEPTION 'Filtros inválidos.' USING ERRCODE='22023'; END IF;
  RETURN billing_private.import_client_collection(v_owner,v_status,v_search,v_client);
 END IF;
 v_id=nullif(p_payload->>'id','')::uuid;
 SELECT * INTO r FROM public.billing_import_documents WHERE owner_id=v_owner AND id=v_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Importação não encontrada.' USING ERRCODE='P0002'; END IF;
 WITH entry_state AS MATERIALIZED (
  SELECT e.entry_date,billing_private.import_entry_pending(v_owner,e.id,r.profile_snapshot->'fields') pending
  FROM public.billing_import_entries e WHERE e.owner_id=v_owner AND e.document_id=r.id
 ), day_metrics AS (
  SELECT entry_date,count(*) entry_count,count(*) FILTER(WHERE pending) pending_count FROM entry_state GROUP BY entry_date
 )
 SELECT billing_private.import_operational_summary(count(DISTINCT entry_date),1,count(*),count(*) FILTER(WHERE pending),min(entry_date),max(entry_date)),
  coalesce((SELECT jsonb_agg(jsonb_build_object('date',entry_date,
   'summary',billing_private.import_operational_summary(1,1,entry_count,pending_count,entry_date,entry_date)) ORDER BY entry_date DESC)
   FROM day_metrics),'[]'::jsonb) INTO v_summary,v_days FROM entry_state;
 RETURN jsonb_build_object('document',billing_private.import_document_json(r),'summary',v_summary,'daySummaries',v_days);
EXCEPTION WHEN invalid_text_representation THEN
 RAISE EXCEPTION 'Confira o cliente e a importação informados.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.import_documents_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
COMMIT;
