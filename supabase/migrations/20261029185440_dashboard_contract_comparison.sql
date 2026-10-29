BEGIN;

-- A contract's saved type snapshot determines its modality. Reuse the exact
-- resolver already enforcing the import queue; a load's K classification is a
-- different fact and is intentionally not consulted by this projection.
CREATE FUNCTION billing_private.summary_contract_comparison(p_payload jsonb,p_summary jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid;v_company uuid;v_from date;v_to date;v_result jsonb;
 v_partner_ids uuid[];v_contract_ids uuid[];v_farm_ids uuid[];v_plot_ids uuid[];
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para continuar.' USING ERRCODE='28000'; END IF;
 v_company=billing_private.summary_scope(p_payload);
 PERFORM billing_private.authorize_resource('contracts','list');
 PERFORM billing_private.authorize('registrations.read');
 v_owner=billing_private.current_owner_id();
 PERFORM billing_private.summary_validate_selection(v_company,p_payload);
 v_partner_ids=billing_private.summary_selection_ids(p_payload,'partnerIds','partnerId');
 v_contract_ids=billing_private.summary_selection_ids(p_payload,'contractIds','contractId');
 v_farm_ids=billing_private.summary_selection_ids(p_payload,'farmIds',CASE WHEN nullif(p_payload->>'plotId','') IS NULL THEN 'farmId' ELSE NULL END);
 v_plot_ids=billing_private.summary_selection_ids(p_payload,'plotIds','plotId');
 IF p_payload->>'from' IS NULL AND p_payload->>'to' IS NULL THEN
  v_to=(now() AT TIME ZONE 'America/Sao_Paulo')::date;v_from=v_to-364;
 ELSIF p_payload->>'from' IS NULL OR p_payload->>'to' IS NULL OR
  p_payload->>'from'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR p_payload->>'to'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
  RAISE EXCEPTION 'Informe o período completo do Dashboard.' USING ERRCODE='22023';
 ELSE v_from=(p_payload->>'from')::date;v_to=(p_payload->>'to')::date;
 END IF;
 IF v_from<'1900-01-01' OR v_to>'9999-12-31' OR v_to<v_from OR v_to-v_from+1>1827 THEN
  RAISE EXCEPTION 'O Dashboard aceita períodos de um dia até cinco anos.' USING ERRCODE='22023';
 END IF;
 IF jsonb_typeof(p_summary->'contracts') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Não foi possível conferir os contratos da seleção.' USING ERRCODE='22023';
 END IF;

 WITH methods(code,label,ordinal) AS (VALUES
  ('1','Manual',1),('2','Mecanizada',2),('unknown','Não classificado',3)
 ), selected AS MATERIALIZED (
  SELECT c.id,c.client_id,client.legal_name client_name,c.type_name,
   coalesce(billing_private.contract_import_harvest_method(c.type_name),'unknown') code
  FROM public.billing_contracts c
  JOIN public.billing_clients client ON client.owner_id=c.owner_id AND client.id=c.client_id
  WHERE c.owner_id=v_owner AND c.company_id=v_company
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_summary->'contracts') authorized(value) WHERE authorized.value->>'id'=c.id::text)
   AND (cardinality(v_partner_ids)=0 OR c.client_id=ANY(v_partner_ids))
   AND (cardinality(v_contract_ids)=0 OR c.id=ANY(v_contract_ids))
   AND (coalesce(p_payload->>'status','')='' OR c.status=p_payload->>'status')
   AND ((cardinality(v_farm_ids)=0 AND cardinality(v_plot_ids)=0)
    OR EXISTS(SELECT 1 FROM public.billing_contract_loads origin
     WHERE origin.owner_id=c.owner_id AND origin.contract_id=c.id
      AND (origin.farm_id=ANY(v_farm_ids) OR origin.plot_id=ANY(v_plot_ids))))
 ), current_loads AS MATERIALIZED (
  SELECT l.id,l.contract_id,l.volume,l.atr
  FROM public.billing_contract_loads l JOIN selected c ON c.id=l.contract_id
  WHERE l.owner_id=v_owner AND l.loaded_at BETWEEN v_from AND v_to
   AND ((cardinality(v_farm_ids)=0 AND cardinality(v_plot_ids)=0)
    OR l.farm_id=ANY(v_farm_ids) OR l.plot_id=ANY(v_plot_ids))
 ), statistics AS MATERIALIZED (
  SELECT grouping(c.client_id) all_clients,grouping(c.code) all_types,c.client_id,c.code,
   min(c.client_name) client_name,count(DISTINCT c.id)::integer contract_count,
   count(l.id)::integer load_count,coalesce(sum(l.volume),0) loaded_volume,
   CASE WHEN count(l.id)=0 OR count(l.id) FILTER(WHERE l.atr IS NULL)>0 THEN NULL
    ELSE round(sum(l.volume*l.atr)/nullif(sum(l.volume),0),6) END average_atr
  FROM selected c LEFT JOIN current_loads l ON l.contract_id=c.id
  GROUP BY GROUPING SETS ((),(c.code),(c.client_id),(c.client_id,c.code))
 ), statistic_rows AS MATERIALIZED (
  SELECT *,jsonb_build_object('loadedVolume',billing_private.decimal_text(loaded_volume),
   'averageAtr',coalesce(billing_private.decimal_text(average_atr),''),
   'loadCount',load_count,'contractCount',contract_count) value
  FROM statistics
 )
 SELECT jsonb_build_object(
  'overall',overall.value,
  'types',(SELECT jsonb_agg(jsonb_build_object('code',method.code,'label',method.label,
    'loadedVolume',billing_private.decimal_text(coalesce(kind.loaded_volume,0)),
    'averageAtr',coalesce(billing_private.decimal_text(kind.average_atr),''),
    'loadCount',coalesce(kind.load_count,0),'contractCount',coalesce(kind.contract_count,0),
    'sharePercent',billing_private.decimal_text(coalesce(round(coalesce(kind.loaded_volume,0)*100/nullif(overall.loaded_volume,0),2),0)))
    ORDER BY method.ordinal)
   FROM methods method LEFT JOIN statistic_rows kind ON kind.all_clients=1 AND kind.all_types=0 AND kind.code=method.code),
  'clients',coalesce((SELECT jsonb_agg(jsonb_build_object('id',client.client_id,'name',client.client_name,'overall',client.value,
    'types',(SELECT jsonb_agg(jsonb_build_object('code',method.code,'label',method.label,
      'loadedVolume',billing_private.decimal_text(coalesce(kind.loaded_volume,0)),
      'averageAtr',coalesce(billing_private.decimal_text(kind.average_atr),''),
      'loadCount',coalesce(kind.load_count,0),'contractCount',coalesce(kind.contract_count,0),
      'sharePercent',billing_private.decimal_text(coalesce(round(coalesce(kind.loaded_volume,0)*100/nullif(client.loaded_volume,0),2),0)))
      ORDER BY method.ordinal)
     FROM methods method LEFT JOIN statistic_rows kind ON kind.all_clients=0 AND kind.all_types=0
      AND kind.client_id=client.client_id AND kind.code=method.code))
    ORDER BY client.loaded_volume DESC,lower(client.client_name),client.client_id)
   FROM statistic_rows client WHERE client.all_clients=0 AND client.all_types=1),'[]'::jsonb),
  'contracts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'clientId',c.client_id,'typeCode',c.code,'typeName',c.type_name)
    ORDER BY lower(c.client_name),c.code,c.id) FROM selected c),'[]'::jsonb)
 ) INTO v_result FROM statistic_rows overall WHERE overall.all_clients=1 AND overall.all_types=1;
 RETURN v_result;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Confira as datas e os filtros do Dashboard.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.summary_contract_comparison(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
COMMENT ON FUNCTION billing_private.summary_contract_comparison(jsonb,jsonb) IS
 'Authorized contract-type snapshot comparison, independent of load harvest_method. Server NUMERIC totals and volume-weighted ATR by modality and client; missing ATR affects only its own groups. Includes selected contracts with no loads, explicit unknown modality and all three zero-filled buckets.';

DO $migration$
DECLARE definition text;
 anchor text:='v_result=v_result||jsonb_build_object(''dimensions'',billing_private.summary_dimensions(p_payload,v_result));';
BEGIN
 definition=pg_get_functiondef('billing_private.summary_dispatch(text,jsonb)'::regprocedure);
 IF strpos(definition,anchor)=0 OR strpos(definition,'''partnerIds''')=0 OR strpos(definition,'contractComparison')>0 THEN
  RAISE EXCEPTION 'Unexpected Dashboard dispatcher before contract comparison';
 END IF;
 definition=replace(definition,anchor,anchor||E'\n v_result=v_result||jsonb_build_object(''contractComparison'',billing_private.summary_contract_comparison(p_payload,v_result));');
 EXECUTE definition;
END $migration$;

COMMIT;
