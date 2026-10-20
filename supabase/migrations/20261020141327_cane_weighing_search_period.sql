-- Filter authorized projections, then recalculate summaries in Postgres.
-- Existing writes and their authorization/locking remain in the prior dispatcher.
ALTER FUNCTION billing_private.cane_weighings_dispatch(text,jsonb) RENAME TO cane_weighings_before_filters;
CREATE FUNCTION billing_private.cane_weighings_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_result jsonb;v_entries jsonb;v_summary jsonb;v_daily jsonb;
 v_search text;v_from date;v_to date;v_pending boolean:=false;v_total integer;v_key text;
BEGIN
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 IF p_action NOT IN ('list','get') OR p_action IS NULL THEN RETURN billing_private.cane_weighings_before_filters(p_action,p_payload); END IF;
 PERFORM billing_private.request_payload(p_payload,CASE WHEN p_action='list'
  THEN ARRAY['companyId','search','dateFrom','dateTo','pendingOnly']
  ELSE ARRAY['companyId','id','search','dateFrom','dateTo','pendingOnly'] END);
 FOREACH v_key IN ARRAY ARRAY['search','dateFrom','dateTo'] LOOP
  IF p_payload?v_key AND jsonb_typeof(p_payload->v_key) IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Informe filtros de busca e período válidos.' USING ERRCODE='22023';
  END IF;
 END LOOP;
 IF length(coalesce(p_payload->>'search',''))>160 THEN RAISE EXCEPTION 'Use até 160 caracteres na busca.' USING ERRCODE='22023'; END IF;
 FOREACH v_key IN ARRAY ARRAY['dateFrom','dateTo'] LOOP
  IF coalesce(p_payload->>v_key,'')<>'' AND p_payload->>v_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
   RAISE EXCEPTION 'Informe uma data válida para o período.' USING ERRCODE='22023';
  END IF;
 END LOOP;
 v_from=nullif(p_payload->>'dateFrom','')::date;v_to=nullif(p_payload->>'dateTo','')::date;
 IF v_from IS NOT NULL AND v_to IS NOT NULL AND v_from>v_to THEN RAISE EXCEPTION 'A data final deve ser igual ou posterior à data inicial.' USING ERRCODE='22023'; END IF;
 IF p_payload?'pendingOnly' THEN
  IF jsonb_typeof(p_payload->'pendingOnly') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Informe um filtro de pendências válido.' USING ERRCODE='22023'; END IF;
  v_pending=(p_payload->>'pendingOnly')::boolean;
 END IF;
 v_search=regexp_replace(billing_private.name_key(coalesce(p_payload->>'search','')),'[-./[:space:]]','','g');
 -- The underlying dispatcher validates company, membership and permissions.
 v_result=billing_private.cane_weighings_before_filters(p_action,p_payload-ARRAY['search','dateFrom','dateTo','pendingOnly']);
 IF p_action='list' THEN
  SELECT coalesce(jsonb_agg(c ORDER BY n),'[]') INTO v_entries
  FROM jsonb_array_elements(v_result->'controls') WITH ORDINALITY x(c,n)
  WHERE (v_from IS NULL OR (c->>'startDate')::date>=v_from) AND (v_to IS NULL OR (c->>'startDate')::date<=v_to)
   AND (NOT v_pending OR (c->'summary'->>'pendingCount')::integer>0)
   AND (v_search='' OR strpos(regexp_replace(billing_private.name_key(concat_ws(' ',c->>'partnerName',c->>'season',c->>'notes')),'[-./[:space:]]','','g'),v_search)>0);
  RETURN v_result||jsonb_build_object('controls',v_entries);
 END IF;
 v_total=jsonb_array_length(v_result->'entries');
 SELECT coalesce(jsonb_agg(e ORDER BY n),'[]') INTO v_entries
 FROM jsonb_array_elements(v_result->'entries') WITH ORDINALITY x(e,n)
 WHERE (v_from IS NULL OR (e->>'weighedAt')::date>=v_from) AND (v_to IS NULL OR (e->>'weighedAt')::date<=v_to)
  AND (NOT v_pending OR e->>'differenceKg' IS NULL)
  AND (v_search='' OR strpos(regexp_replace(billing_private.name_key(concat_ws(' ',e->>'ticket',e->>'notes',
   (SELECT string_agg(concat_ws(' ',c->>'fleetNumber',c->>'plate'),' ') FROM jsonb_array_elements(e->'components') c))),
   '[-./[:space:]]','','g'),v_search)>0);
 v_summary=billing_private.cane_summary(v_entries);
 SELECT coalesce(jsonb_agg(jsonb_build_object('date',day)||billing_private.cane_summary(entries) ORDER BY day),'[]') INTO v_daily
 FROM (SELECT e->>'weighedAt' AS day,jsonb_agg(e) AS entries FROM jsonb_array_elements(v_entries) e GROUP BY e->>'weighedAt') days;
 RETURN v_result||jsonb_build_object('entries',v_entries,'daily',v_daily,'summary',v_summary,
  'control',jsonb_set(v_result->'control','{summary}',v_summary),'totalEntryCount',v_total,
  'appliedFilters',jsonb_build_object('search',btrim(coalesce(p_payload->>'search','')),'dateFrom',coalesce(p_payload->>'dateFrom',''),
   'dateTo',coalesce(p_payload->>'dateTo',''),'pendingOnly',v_pending));
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Informe uma data válida para o período.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.cane_weighings_before_filters(text,jsonb),billing_private.cane_weighings_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.cane_weighings_dispatch(text,jsonb) TO authenticated;
