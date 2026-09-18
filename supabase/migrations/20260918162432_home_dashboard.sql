-- Read-only landing page. Each section has its existing permission boundary;
-- optional company scope lets request-only members use the home page too.
CREATE FUNCTION billing_private.home_dashboard(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_actor uuid:=auth.uid();v_owner uuid:=billing_private.current_owner_id();v_company uuid;
 v_today date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date;v_month date;v_next date;
 v_contracts boolean;v_registry boolean;v_requests boolean;v_finance jsonb;v_agenda jsonb;
 v_request_data jsonb;v_planning jsonb;v_registry_data jsonb;v_attention jsonb;
BEGIN
 IF v_actor IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o início.' USING ERRCODE='28000'; END IF;
 IF p_action IS DISTINCT FROM 'get' THEN RAISE EXCEPTION 'Operação do início inválida.' USING ERRCODE='22023'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR EXISTS(
  SELECT 1 FROM jsonb_each(p_payload) e WHERE e.key NOT IN ('companyId','month') OR jsonb_typeof(e.value)<>'string'
 ) THEN RAISE EXCEPTION 'Confira os filtros do início.' USING ERRCODE='22023'; END IF;
 v_month=billing_private.overview_month(coalesce(p_payload->>'month',to_char(v_today,'YYYY-MM')));
 v_next=(v_month+interval '1 month')::date;
 v_contracts=billing_private.has_permission('contracts.read');
 v_registry=billing_private.has_permission('registrations.read');
 v_requests=billing_private.has_permission('requests.read');
 v_company=nullif(p_payload->>'companyId','')::uuid;
 IF v_company IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.billing_companies WHERE owner_id=v_owner AND id=v_company) THEN
  RAISE EXCEPTION 'Selecione uma empresa cadastrada.' USING ERRCODE='22023'; END IF;

 IF v_contracts AND v_company IS NOT NULL THEN
  WITH contracts AS MATERIALIZED (
   SELECT c.*,cl.legal_name client_name FROM public.billing_contracts c
   JOIN public.billing_clients cl ON cl.owner_id=c.owner_id AND cl.id=c.client_id
   WHERE c.owner_id=v_owner AND c.company_id=v_company
  ), loads AS MATERIALIZED (
   SELECT l.*,f.gross_amount,f.net_amount,f.discount_amount FROM public.billing_contracts c
   JOIN LATERAL billing_private.contract_load_financials(c) f ON true
   JOIN public.billing_contract_loads l ON l.owner_id=v_owner AND l.contract_id=c.id AND l.id=f.load_id
   WHERE c.owner_id=v_owner AND c.company_id=v_company AND l.loaded_at>=v_month AND l.loaded_at<v_next
  ), totals AS (
   SELECT count(*) load_count,count(*) FILTER(WHERE net_amount IS NULL) pending_count,
    coalesce(sum(volume),0) volume,coalesce(sum(net_amount),0) net_amount FROM loads
  )
  SELECT jsonb_build_object('scope','company','loadCount',t.load_count,'loadedVolume',billing_private.decimal_text(t.volume),
   'netAmount',CASE WHEN t.pending_count>0 THEN '' ELSE billing_private.decimal_text(t.net_amount) END,
   'pendingLoadCount',t.pending_count,'contractCount',(SELECT count(*) FROM contracts),
   'activeContractCount',(SELECT count(*) FROM contracts WHERE status='Ativo'),
   'receivedAmount',billing_private.decimal_text(coalesce((SELECT sum(p.amount) FROM public.billing_contract_payments p
     JOIN contracts c ON c.id=p.contract_id AND c.owner_id=p.owner_id WHERE p.received_at>=v_month AND p.received_at<v_next),0)),
   'pendingContracts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'label',coalesce(nullif(c.contract_number,''),c.title),
     'clientName',c.client_name) ORDER BY c.client_name,c.id) FROM
     (SELECT c.* FROM contracts c WHERE EXISTS(SELECT 1 FROM loads l WHERE l.contract_id=c.id AND l.net_amount IS NULL)
      ORDER BY c.client_name,c.id LIMIT 4) c),'[]'::jsonb)) INTO v_finance FROM totals t;

  WITH contracts AS MATERIALIZED (
   SELECT c.*,cl.legal_name client_name FROM public.billing_contracts c
   JOIN public.billing_clients cl ON cl.owner_id=c.owner_id AND cl.id=c.client_id
   WHERE c.owner_id=v_owner AND c.company_id=v_company AND c.status='Ativo'
  ) SELECT jsonb_build_object('overdueCount',(SELECT count(*) FROM contracts WHERE end_date<v_today),
   'endingSoonCount',(SELECT count(*) FROM contracts WHERE end_date BETWEEN v_today AND v_today+29),
   'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'label',coalesce(nullif(c.contract_number,''),c.title),
     'clientName',c.client_name,'endDate',c.end_date,'overdue',c.end_date<v_today) ORDER BY c.end_date,c.id)
    FROM (SELECT * FROM contracts WHERE end_date<=v_today+29 ORDER BY end_date,id LIMIT 5) c),'[]'::jsonb)) INTO v_attention;

  WITH calendars AS (
   SELECT billing_private.agenda_dispatch('list',jsonb_build_object('companyId',v_company,'month',to_char(m,'YYYY-MM'))) data
   FROM (SELECT DISTINCT date_trunc('month',d)::date m FROM generate_series(v_today::timestamp,(v_today+6)::timestamp,interval '1 day') d) months
  ), events AS MATERIALIZED (
   SELECT e FROM calendars CROSS JOIN LATERAL jsonb_array_elements(data->'days') d
    CROSS JOIN LATERAL jsonb_array_elements(d->'events') e
   WHERE (e->>'date')::date BETWEEN v_today AND v_today+6
  ) SELECT jsonb_build_object('from',v_today,'to',v_today+6,'total',(SELECT count(*) FROM events),
    'todayCount',(SELECT count(*) FROM events WHERE e->>'date'=v_today::text),
    'items',coalesce((SELECT jsonb_agg(e ORDER BY e->>'date',e->>'kind',e->>'id')
      FROM (SELECT e FROM events ORDER BY e->>'date',e->>'kind',e->>'id' LIMIT 7) selected),'[]'::jsonb)) INTO v_agenda;
 END IF;

 IF v_requests THEN
  WITH requests AS MATERIALIZED (
   SELECT r.*,CASE WHEN latest.id IS NOT NULL THEN latest.return_date ELSE r.return_date END current_return_date
   FROM public.billing_service_requests r
   LEFT JOIN LATERAL (SELECT id,return_date FROM public.billing_service_request_complements c
    WHERE c.owner_id=v_owner AND c.request_id=r.id ORDER BY version DESC LIMIT 1) latest ON true
   WHERE r.owner_id=v_owner
  ) SELECT jsonb_build_object('scope','workspace',
   'pendingCount',(SELECT count(*) FROM requests WHERE status='pending'),
   'inProgressCount',(SELECT count(*) FROM requests WHERE status='approved' AND completed_at IS NULL),
   'overdueCount',(SELECT count(*) FROM requests WHERE status='approved' AND completed_at IS NULL AND current_return_date<v_today),
   'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'number',r.number,'providerName',r.company_name,
     'requesterName',r.requester_name,'createdAt',r.created_at,'returnDate',r.current_return_date,
     'status',CASE WHEN r.status='pending' THEN 'open' ELSE 'in_progress' END,
     'overdue',r.status='approved' AND r.current_return_date<v_today) ORDER BY r.priority DESC,r.current_return_date NULLS LAST,r.created_at,r.id)
    FROM (SELECT *,coalesce(status='approved' AND current_return_date<v_today,false) priority FROM requests
     WHERE status='pending' OR (status='approved' AND completed_at IS NULL)
     ORDER BY priority DESC,current_return_date NULLS LAST,created_at,id LIMIT 5) r),'[]'::jsonb)) INTO v_request_data;
 END IF;

 IF v_registry THEN
  SELECT jsonb_build_object('scope','workspace',
   'clientCount',(SELECT count(*) FROM public.billing_clients WHERE owner_id=v_owner),
   'farmCount',(SELECT count(*) FROM public.billing_farms WHERE owner_id=v_owner),
   'plotCount',(SELECT count(*) FROM public.billing_farm_plots WHERE owner_id=v_owner),
   'providerCount',(SELECT count(*) FROM public.billing_service_providers WHERE owner_id=v_owner),
   'farmAreaHa',billing_private.decimal_text(coalesce((SELECT sum(area_ha) FROM public.billing_farms WHERE owner_id=v_owner),0))) INTO v_registry_data;
  WITH focus AS MATERIALIZED (
   SELECT * FROM public.billing_planning_periods WHERE owner_id=v_owner AND status='active' AND v_today BETWEEN start_date AND end_date
   ORDER BY end_date DESC,created_at DESC,id LIMIT 1
  ), metrics AS (
   SELECT p.*,
    coalesce((SELECT sum(a.area_ha) FROM public.billing_planning_allocations a WHERE a.owner_id=v_owner AND a.period_id=p.id AND a.status='active'),0) allocated,
    coalesce((SELECT sum(l.area_ha) FROM public.billing_planning_field_logs l WHERE l.owner_id=v_owner AND l.period_id=p.id
      AND l.kind='planting' AND l.voided_at IS NULL AND l.occurred_on BETWEEN p.start_date AND v_today),0) planted,
    coalesce((SELECT sum(l.volume) FROM billing_private.planning_v5_harvest_scope(v_owner,p.id) scope
      JOIN public.billing_contract_loads l ON l.owner_id=v_owner AND l.farm_id=scope.farm_id AND l.plot_id=scope.plot_id
      WHERE l.loaded_at BETWEEN p.start_date AND v_today),0) harvested
   FROM focus p
  ) SELECT jsonb_build_object('scope','workspace','id',p.id,'name',p.name,'endDate',p.end_date,'asOf',v_today,
   'activePeriodCount',(SELECT count(*) FROM public.billing_planning_periods WHERE owner_id=v_owner AND status='active' AND v_today BETWEEN start_date AND end_date),
   'targetAreaHa',billing_private.decimal_text(p.target_area_ha),'allocatedAreaHa',billing_private.decimal_text(p.allocated),
   'plantedAreaHa',billing_private.decimal_text(p.planted),'harvestTargetTons',billing_private.decimal_text(p.harvest_target_tons),
   'harvestedTons',billing_private.decimal_text(p.harvested),
   'plantingPercent',billing_private.decimal_text(round(p.planted*100/nullif(p.target_area_ha,0),2)),
   'harvestPercent',coalesce(billing_private.decimal_text(round(p.harvested*100/nullif(p.harvest_target_tons,0),2)),''))
   INTO v_planning FROM metrics p;
 END IF;
 RETURN jsonb_build_object('today',v_today,'month',to_char(v_month,'YYYY-MM'),'generatedAt',statement_timestamp(),
  'permissions',jsonb_build_object('contracts',v_contracts,'registrations',v_registry,'requests',v_requests,
   'summary',v_contracts AND v_registry,'companies',billing_private.has_permission('companies.read'),
   'createCompany',billing_private.has_permission('companies.write'),'createContract',billing_private.has_permission('contracts.write'),
   'createRequest',billing_private.has_permission('requests.write')),
  'finance',v_finance,'contracts',v_attention,'agenda',v_agenda,'requests',v_request_data,'planning',v_planning,'registrations',v_registry_data);
END $$;
REVOKE ALL ON FUNCTION billing_private.home_dashboard(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.home_dashboard(text,jsonb) TO authenticated;
DO $$ DECLARE v_definition text;v_anchor text:='PERFORM billing_private.ensure_actor_workspace();';
BEGIN
 SELECT pg_get_functiondef('public.billing_rpc(text,text,jsonb)'::regprocedure) INTO v_definition;
 IF strpos(v_definition,v_anchor)=0 THEN RAISE EXCEPTION 'Unexpected public RPC definition'; END IF;
 EXECUTE replace(v_definition,v_anchor,v_anchor||E'\n IF p_resource=''home'' THEN RETURN billing_private.home_dashboard(p_action,p_payload); END IF;');
END $$;
COMMENT ON FUNCTION billing_private.home_dashboard(text,jsonb) IS 'Permission-aware home projection: company finance by actual dates; current workspace requests, registrations and one active planning period.';
