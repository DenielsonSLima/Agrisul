CREATE FUNCTION billing_private.planning_v4_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_actor uuid:=auth.uid();
 v_payload jsonb:=coalesce(p_payload,'{}'::jsonb);
 v_result jsonb;v_period_id uuid;v_search text;v_section text;
 v_page integer;v_page_size integer;v_total integer:=0;v_total_pages integer:=1;
 v_period_ids jsonb:='[]'::jsonb;v_farm_ids jsonb:='[]'::jsonb;
 v_field_log_ids jsonb:='[]'::jsonb;v_harvest_load_ids jsonb:='[]'::jsonb;v_history_ids jsonb:='[]'::jsonb;
BEGIN
 IF p_action<>'list' THEN RETURN billing_private.planning_v3_dispatch(p_action,p_payload); END IF;
 IF v_actor IS NULL OR v_owner IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar o planejamento.' USING ERRCODE='28000';
 END IF;
 PERFORM billing_private.authorize('registrations.read');
 PERFORM billing_private.planning_v2_assert_payload(v_payload,ARRAY['periodId','search','page','pageSize','section']);

 IF coalesce(v_payload->>'page','1')!~'^[0-9]+$' OR coalesce(v_payload->>'pageSize','10')!~'^[0-9]+$' THEN
  RAISE EXCEPTION 'Informe uma paginação válida.' USING ERRCODE='22023';
 END IF;
 v_period_id=nullif(v_payload->>'periodId','')::uuid;
 v_search=btrim(coalesce(v_payload->>'search',''));
 v_page=(coalesce(v_payload->>'page','1'))::integer;
 v_page_size=(coalesce(v_payload->>'pageSize','10'))::integer;
 v_section=coalesce(nullif(v_payload->>'section',''),CASE WHEN v_period_id IS NULL THEN 'seasons' ELSE 'resumo' END);
 IF length(v_search)>160 OR v_page<1 OR v_page_size NOT BETWEEN 1 AND 50
    OR v_section NOT IN('seasons','resumo','metas','areas','diario','historico') THEN
  RAISE EXCEPTION 'Confira a busca, a página e a seção do planejamento.' USING ERRCODE='22023';
 END IF;

 v_result=billing_private.planning_v3_dispatch('list',CASE WHEN v_period_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('periodId',v_period_id) END);

 SELECT coalesce(jsonb_agg(item->>'id' ORDER BY position),'[]'::jsonb) INTO v_period_ids
  FROM jsonb_array_elements(v_result->'periods') WITH ORDINALITY rows(item,position);
 SELECT coalesce(jsonb_agg(item->>'id' ORDER BY position),'[]'::jsonb) INTO v_farm_ids
  FROM jsonb_array_elements(v_result->'farms') WITH ORDINALITY rows(item,position);
 SELECT coalesce(jsonb_agg(item->>'id' ORDER BY position),'[]'::jsonb) INTO v_field_log_ids
  FROM jsonb_array_elements(v_result->'fieldLogs') WITH ORDINALITY rows(item,position);
 SELECT coalesce(jsonb_agg(item->>'id' ORDER BY position),'[]'::jsonb) INTO v_harvest_load_ids
  FROM jsonb_array_elements(v_result->'harvestLoads') WITH ORDINALITY rows(item,position);
 SELECT coalesce(jsonb_agg(item->>'id' ORDER BY position),'[]'::jsonb) INTO v_history_ids
  FROM jsonb_array_elements(v_result->'history') WITH ORDINALITY rows(item,position);

 IF v_period_id IS NULL THEN
  v_section='seasons';
  SELECT count(*)::integer INTO v_total
   FROM jsonb_array_elements(v_result->'periods') rows(item)
   WHERE v_search='' OR strpos(lower(concat_ws(' ',item->>'name',item->>'cultureName',item->>'cultureSubtypeName',item->>'notes',
    item->>'startDate',item->>'endDate',item->>'status',CASE item->>'status' WHEN 'active' THEN 'ativa' WHEN 'completed' THEN 'concluída' ELSE 'cancelada' END)),lower(v_search))>0;
  v_total_pages=greatest(1,ceil(v_total::numeric/v_page_size)::integer);v_page=least(v_page,v_total_pages);
  SELECT coalesce(jsonb_agg(id ORDER BY position),'[]'::jsonb) INTO v_period_ids FROM (
   SELECT item->>'id' id,position
   FROM jsonb_array_elements(v_result->'periods') WITH ORDINALITY rows(item,position)
   WHERE v_search='' OR strpos(lower(concat_ws(' ',item->>'name',item->>'cultureName',item->>'cultureSubtypeName',item->>'notes',
    item->>'startDate',item->>'endDate',item->>'status',CASE item->>'status' WHEN 'active' THEN 'ativa' WHEN 'completed' THEN 'concluída' ELSE 'cancelada' END)),lower(v_search))>0
   ORDER BY position LIMIT v_page_size OFFSET (v_page-1)*v_page_size
  ) page_rows;
 ELSIF v_section='areas' THEN
  SELECT count(*)::integer INTO v_total FROM jsonb_array_elements(v_result->'farms') rows(item)
   WHERE v_search='' OR strpos(lower(concat_ws(' ',item->>'name',item->>'city',item->>'state',item->'plots'::text)),lower(v_search))>0;
  v_total_pages=greatest(1,ceil(v_total::numeric/v_page_size)::integer);v_page=least(v_page,v_total_pages);
  SELECT coalesce(jsonb_agg(id ORDER BY position),'[]'::jsonb) INTO v_farm_ids FROM (
   SELECT item->>'id' id,position FROM jsonb_array_elements(v_result->'farms') WITH ORDINALITY rows(item,position)
   WHERE v_search='' OR strpos(lower(concat_ws(' ',item->>'name',item->>'city',item->>'state',item->'plots'::text)),lower(v_search))>0
   ORDER BY position LIMIT v_page_size OFFSET (v_page-1)*v_page_size
  ) page_rows;
 ELSIF v_section='diario' THEN
  WITH activities AS (
   SELECT 'field' source,item,item->>'id' id,item->>'occurredOn' activity_date,item->>'createdAt' activity_sort
    FROM jsonb_array_elements(v_result->'fieldLogs') rows(item)
   UNION ALL
   SELECT 'harvest',item,item->>'id',item->>'loadedAt',item->>'loadedAt'
    FROM jsonb_array_elements(v_result->'harvestLoads') rows(item)
  ) SELECT count(*)::integer INTO v_total FROM activities
   WHERE v_search='' OR strpos(lower(concat_ws(' ',item::text,CASE source WHEN 'field' THEN 'apontamento campo plantio manejo perda área morta' ELSE 'colheita carregamento contrato' END)),lower(v_search))>0;
  v_total_pages=greatest(1,ceil(v_total::numeric/v_page_size)::integer);v_page=least(v_page,v_total_pages);
  WITH activities AS (
   SELECT 'field' source,item,item->>'id' id,item->>'occurredOn' activity_date,item->>'createdAt' activity_sort
    FROM jsonb_array_elements(v_result->'fieldLogs') rows(item)
   UNION ALL
   SELECT 'harvest',item,item->>'id',item->>'loadedAt',item->>'loadedAt'
    FROM jsonb_array_elements(v_result->'harvestLoads') rows(item)
  ), page_rows AS (
   SELECT * FROM activities
   WHERE v_search='' OR strpos(lower(concat_ws(' ',item::text,CASE source WHEN 'field' THEN 'apontamento campo plantio manejo perda área morta' ELSE 'colheita carregamento contrato' END)),lower(v_search))>0
   ORDER BY activity_date DESC,activity_sort DESC,id DESC LIMIT v_page_size OFFSET (v_page-1)*v_page_size
  ) SELECT coalesce(jsonb_agg(id ORDER BY activity_date DESC,activity_sort DESC,id DESC) FILTER(WHERE source='field'),'[]'::jsonb),
    coalesce(jsonb_agg(id ORDER BY activity_date DESC,activity_sort DESC,id DESC) FILTER(WHERE source='harvest'),'[]'::jsonb)
   INTO v_field_log_ids,v_harvest_load_ids FROM page_rows;
 ELSIF v_section='historico' THEN
  SELECT count(*)::integer INTO v_total FROM jsonb_array_elements(v_result->'history') rows(item)
   WHERE v_search='' OR strpos(lower(concat_ws(' ',item->>'reason',item->>'createdByName',item->>'entityType',item->>'action',item->'snapshot'::text)),lower(v_search))>0;
  v_total_pages=greatest(1,ceil(v_total::numeric/v_page_size)::integer);v_page=least(v_page,v_total_pages);
  SELECT coalesce(jsonb_agg(id ORDER BY position),'[]'::jsonb) INTO v_history_ids FROM (
   SELECT item->>'id' id,position FROM jsonb_array_elements(v_result->'history') WITH ORDINALITY rows(item,position)
   WHERE v_search='' OR strpos(lower(concat_ws(' ',item->>'reason',item->>'createdByName',item->>'entityType',item->>'action',item->'snapshot'::text)),lower(v_search))>0
   ORDER BY position LIMIT v_page_size OFFSET (v_page-1)*v_page_size
  ) page_rows;
 END IF;

 RETURN v_result||jsonb_build_object(
  'visiblePeriodIds',v_period_ids,'visibleFarmIds',v_farm_ids,'visibleFieldLogIds',v_field_log_ids,
  'visibleHarvestLoadIds',v_harvest_load_ids,'visibleHistoryIds',v_history_ids,
  'pagination',jsonb_build_object('page',v_page,'pageSize',v_page_size,'total',v_total,'totalPages',v_total_pages,
   'hasPrevious',v_page>1,'hasNext',v_page<v_total_pages));
EXCEPTION
 WHEN invalid_text_representation OR numeric_value_out_of_range OR division_by_zero THEN
  RAISE EXCEPTION 'Informe filtros e identificadores válidos.' USING ERRCODE='22023';
END $$;

REVOKE ALL ON FUNCTION billing_private.planning_v4_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.planning_v4_dispatch(text,jsonb) TO authenticated;

DO $$
DECLARE v_definition text;v_old text;v_new text;
BEGIN
 v_definition=pg_get_functiondef('public.billing_rpc(text,text,jsonb)'::regprocedure);
 v_old='IF p_resource=''planning'' THEN RETURN billing_private.planning_v3_dispatch(p_action,p_payload); END IF;';
 v_new='IF p_resource=''planning'' THEN RETURN billing_private.planning_v4_dispatch(p_action,p_payload); END IF;';
 IF strpos(v_definition,v_old)=0 THEN
  IF strpos(v_definition,v_new)=0 THEN RAISE EXCEPTION 'O contrato RPC instalado não corresponde ao Planejamento esperado.'; END IF;
 ELSE EXECUTE replace(v_definition,v_old,v_new);
 END IF;
END $$;

REVOKE ALL ON FUNCTION public.billing_rpc(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_rpc(text,text,jsonb) TO authenticated;
