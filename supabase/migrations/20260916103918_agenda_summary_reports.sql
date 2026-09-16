-- Calendar and reports are projections of authoritative business records.
-- Dates on the calendar are business dates; creation uses Sao Paulo time.
CREATE FUNCTION billing_private.overview_scope(p_payload jsonb, p_allowed text[])
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id(); v_company uuid;
BEGIN
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR EXISTS(
  SELECT 1 FROM jsonb_each(p_payload) e WHERE NOT e.key=ANY(p_allowed) OR jsonb_typeof(e.value)<>'string'
 ) THEN RAISE EXCEPTION 'Confira os filtros informados.' USING ERRCODE='22023'; END IF;
 v_company=nullif(p_payload->>'companyId','')::uuid;
 IF v_company IS NULL OR NOT EXISTS(SELECT 1 FROM public.billing_companies WHERE owner_id=v_owner AND id=v_company) THEN
  RAISE EXCEPTION 'Selecione uma empresa cadastrada.' USING ERRCODE='22023';
 END IF;
 RETURN v_company;
EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Selecione uma empresa válida.' USING ERRCODE='22023';
END $$;

CREATE FUNCTION billing_private.overview_month(p_month text)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF p_month IS NULL OR p_month!~'^[0-9]{4}-(0[1-9]|1[0-2])$' OR p_month<'1900-01' OR p_month>'9998-12' THEN
  RAISE EXCEPTION 'Informe um mês válido.' USING ERRCODE='22023';
 END IF;
 RETURN (p_month||'-01')::date;
END $$;

CREATE FUNCTION billing_private.agenda_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id(); v_company uuid; v_month date; v_from date; v_to date;
 v_kind text; v_result jsonb;
BEGIN
 v_company=billing_private.overview_scope(p_payload,ARRAY['companyId','month','kind']);
 PERFORM billing_private.authorize_resource('contracts','list');
 IF p_action<>'list' THEN RAISE EXCEPTION 'Operação da agenda inválida.' USING ERRCODE='22023'; END IF;
 v_month=billing_private.overview_month(p_payload->>'month');
 v_kind=coalesce(p_payload->>'kind','');
 IF v_kind NOT IN ('','contract','start','end','load','receipt','advance') THEN RAISE EXCEPTION 'Tipo de evento inválido.' USING ERRCODE='22023'; END IF;
 v_from=v_month;
 v_to=(v_month+interval '1 month')::date-1;
 WITH contracts AS MATERIALIZED (
  SELECT c.*,cl.legal_name client_name FROM public.billing_contracts c
  JOIN public.billing_clients cl ON cl.owner_id=c.owner_id AND cl.id=c.client_id
  WHERE c.owner_id=v_owner AND c.company_id=v_company
 ), events AS (
  SELECT 'contract:'||c.id id,(c.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,'contract' kind,
   'Contrato cadastrado' title,c.client_name detail,c.id contract_id,c.contract_number,
   ''::text amount,''::text volume,c.status FROM contracts c
  UNION ALL
  SELECT 'start:'||c.id,c.start_date,'start','Início de contrato',c.client_name,c.id,c.contract_number,'','',c.status
  FROM contracts c WHERE c.start_date IS NOT NULL AND c.status<>'Cancelado'
  UNION ALL
  SELECT 'end:'||c.id,c.end_date,'end','Término previsto do contrato',c.client_name,c.id,c.contract_number,'','',c.status
  FROM contracts c WHERE c.end_date IS NOT NULL AND c.status<>'Cancelado'
  UNION ALL
  SELECT 'load:'||l.id,l.loaded_at,'load','Carregamento',concat_ws(' · ',c.client_name,f.name,p.name),c.id,c.contract_number,
   '',billing_private.decimal_text(l.volume),c.status
  FROM public.billing_contract_loads l JOIN contracts c ON c.owner_id=l.owner_id AND c.id=l.contract_id
  JOIN public.billing_farms f ON f.owner_id=l.owner_id AND f.id=l.farm_id
  JOIN public.billing_farm_plots p ON p.owner_id=l.owner_id AND p.id=l.plot_id
  UNION ALL
  SELECT 'payment:'||p.id,p.received_at,CASE p.kind WHEN 'advance' THEN 'advance' ELSE 'receipt' END,
   CASE p.kind WHEN 'advance' THEN 'Adiantamento' ELSE 'Recebimento' END,c.client_name,c.id,c.contract_number,
   billing_private.decimal_text(p.amount),'',c.status
  FROM public.billing_contract_payments p JOIN contracts c ON c.owner_id=p.owner_id AND c.id=p.contract_id
 ), selected AS MATERIALIZED (
  SELECT * FROM events WHERE day BETWEEN v_from AND v_to AND (v_kind='' OR kind=v_kind)
 ), calendar AS (
  SELECT v_from+i AS day FROM generate_series(0,v_to-v_from) i
 )
 SELECT jsonb_build_object('month',p_payload->>'month','eventCount',
  (SELECT count(*) FROM selected WHERE day>=v_month AND day<v_month+interval '1 month'),
  'days',(SELECT jsonb_agg(jsonb_build_object('date',cal.day,'dayNumber',extract(day FROM cal.day)::integer,
   'gridColumn',extract(dow FROM cal.day)::integer+1,
   'inMonth',date_trunc('month',cal.day)=v_month,'isToday',cal.day=(now() AT TIME ZONE 'America/Sao_Paulo')::date,
   'eventCount',(SELECT count(*) FROM selected s WHERE s.day=cal.day),
   'kinds',coalesce((SELECT jsonb_agg(k.kind ORDER BY k.kind) FROM (SELECT DISTINCT s.kind FROM selected s WHERE s.day=cal.day) k),'[]'::jsonb),
   'summary',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',g.kind,'count',g.event_count,
    'volume',coalesce(billing_private.decimal_text(g.volume),''),'amount',coalesce(billing_private.decimal_text(g.amount),'')) ORDER BY g.kind)
    FROM (SELECT s.kind,count(*) event_count,sum(nullif(s.volume,'')::numeric) volume,sum(nullif(s.amount,'')::numeric) amount
     FROM selected s WHERE s.day=cal.day GROUP BY s.kind) g),'[]'::jsonb),
   'events',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'date',s.day,'kind',s.kind,'title',s.title,
    'detail',s.detail,'contractId',s.contract_id,'contractNumber',s.contract_number,'amount',s.amount,'volume',s.volume,'status',s.status)
    ORDER BY s.kind,s.detail,s.id) FROM selected s WHERE s.day=cal.day),'[]'::jsonb)
  ) ORDER BY cal.day) FROM calendar cal)) INTO v_result;
 RETURN v_result;
END $$;

-- Reuse each contract's monthly finance, retaining cent rounding, unknown ATR,
-- and separate credits. A credit on one contract never pays another's balance.
CREATE FUNCTION billing_private.summary_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id(); v_company uuid; v_month date; v_result jsonb;
BEGIN
 v_company=billing_private.overview_scope(p_payload,ARRAY['companyId','month']);
 PERFORM billing_private.authorize_resource('contracts','list');
 IF p_action<>'list' THEN RAISE EXCEPTION 'Operação do resumo inválida.' USING ERRCODE='22023'; END IF;
 v_month=billing_private.overview_month(p_payload->>'month');
 WITH contracts AS MATERIALIZED (
  SELECT c.*,cl.legal_name client_name,billing_private.contract_financial_summary(c) finance
  FROM public.billing_contracts c JOIN public.billing_clients cl ON cl.owner_id=c.owner_id AND cl.id=c.client_id
  WHERE c.owner_id=v_owner AND c.company_id=v_company
 ), metrics AS MATERIALIZED (
  SELECT c.*,coalesce((SELECT m FROM jsonb_array_elements(c.finance->'months') m WHERE m->>'month'=p_payload->>'month'),
   billing_private.finance_metrics(0,NULL,0,0,0,0)) data FROM contracts c
 ), totals AS (
  SELECT count(*) contract_count,count(*) FILTER(WHERE status='Ativo') active_count,
   count(*) FILTER(WHERE (data->>'billingPending')::boolean) missing,
   coalesce(sum((data->>'loadedVolume')::numeric),0) volume,
   coalesce(sum(nullif(data->>'grossAmount','')::numeric),0) gross,
   coalesce(sum((data->>'discountAmount')::numeric),0) discount,
   coalesce(sum(nullif(data->>'netAmount','')::numeric),0) net,
   coalesce(sum((data->>'receivedAmount')::numeric),0) received,
   coalesce(sum(nullif(data->>'pendingAmount','')::numeric),0) pending,
   coalesce(sum(nullif(data->>'creditAmount','')::numeric),0) credit
  FROM metrics
 ) SELECT jsonb_build_object('month',p_payload->>'month',
  'totals',jsonb_build_object('contractCount',t.contract_count,'activeCount',t.active_count,
   'loadedVolume',billing_private.decimal_text(t.volume),'billingPending',t.missing>0,'pendingContractCount',t.missing,
   'grossAmount',CASE WHEN t.missing>0 THEN '' ELSE billing_private.decimal_text(t.gross) END,
   'discountAmount',billing_private.decimal_text(t.discount),
   'netAmount',CASE WHEN t.missing>0 THEN '' ELSE billing_private.decimal_text(t.net) END,
   'receivedAmount',billing_private.decimal_text(t.received),
   'pendingAmount',CASE WHEN t.missing>0 THEN '' ELSE billing_private.decimal_text(t.pending) END,
   'creditAmount',CASE WHEN t.missing>0 THEN '' ELSE billing_private.decimal_text(t.credit) END),
  'contracts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'clientName',client_name,'contractNumber',contract_number,
   'title',title,'status',status,'startDate',coalesce(start_date::text,''),'endDate',coalesce(end_date::text,''),
   'contractedVolume',billing_private.decimal_text(contracted_volume))||data ORDER BY lower(client_name),contract_number,id)
   FROM metrics),'[]'::jsonb)
 ) INTO v_result FROM totals t;
 RETURN v_result;
END $$;

CREATE FUNCTION billing_private.reports_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id(); v_company uuid; v_month date; v_kind text; v_data jsonb; v_result jsonb;
BEGIN
 v_company=billing_private.overview_scope(p_payload,ARRAY['companyId','month','kind']);
 IF p_action<>'list' THEN RAISE EXCEPTION 'Operação de relatório inválida.' USING ERRCODE='22023'; END IF;
 v_month=billing_private.overview_month(p_payload->>'month');v_kind=p_payload->>'kind';
 IF v_kind='farms' THEN
  PERFORM billing_private.authorize_resource('farms','list');
  v_data=billing_private.farm_summary_list();
  RETURN jsonb_build_object('kind',v_kind,'scope','workspace','rows',v_data->'farms','totals',v_data->'summary','total',v_data->'summary'->'farmCount');
 END IF;
 PERFORM billing_private.authorize_resource('contracts','list');
 IF v_kind IN ('contracts','financial') THEN
  v_data=billing_private.summary_dispatch('list',p_payload-'kind');
  RETURN jsonb_build_object('kind',v_kind,'scope','company','rows',v_data->'contracts','totals',v_data->'totals',
   'total',v_data->'totals'->'contractCount','month',p_payload->>'month');
 END IF;
 IF v_kind IS DISTINCT FROM 'loads' THEN RAISE EXCEPTION 'Selecione um relatório válido.' USING ERRCODE='22023'; END IF;
 WITH selected AS MATERIALIZED (
  SELECT l.*,c.contract_number,cl.legal_name client_name,f.name farm_name,p.name plot_name
  FROM public.billing_contract_loads l JOIN public.billing_contracts c ON c.owner_id=l.owner_id AND c.id=l.contract_id
  JOIN public.billing_clients cl ON cl.owner_id=c.owner_id AND cl.id=c.client_id
  JOIN public.billing_farms f ON f.owner_id=l.owner_id AND f.id=l.farm_id
  JOIN public.billing_farm_plots p ON p.owner_id=l.owner_id AND p.id=l.plot_id
  WHERE l.owner_id=v_owner AND c.company_id=v_company AND l.loaded_at>=v_month AND l.loaded_at<v_month+interval '1 month'
 ) SELECT jsonb_build_object('kind',v_kind,'scope','company','month',p_payload->>'month','total',count(*),
  'totals',jsonb_build_object('loadCount',count(*),'volume',billing_private.decimal_text(coalesce(sum(volume),0)),
   'averageAtr',CASE WHEN count(*) FILTER(WHERE atr IS NULL)>0 THEN '' ELSE coalesce(billing_private.decimal_text(round(sum(volume*atr)/nullif(sum(volume),0),6)),'') END),
  'rows',coalesce(jsonb_agg(jsonb_build_object('id',id,'contractId',contract_id,'contractNumber',contract_number,'clientName',client_name,
   'loadedAt',loaded_at,'farmName',farm_name,'plotName',plot_name,'document',document,'notes',notes,
   'volume',billing_private.decimal_text(volume),'atr',coalesce(billing_private.decimal_text(atr),'')) ORDER BY loaded_at,client_name,id),'[]'::jsonb)) INTO v_result FROM selected;
 RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION billing_private.overview_scope(jsonb,text[]),billing_private.overview_month(text),
 billing_private.agenda_dispatch(text,jsonb),billing_private.summary_dispatch(text,jsonb),billing_private.reports_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.agenda_dispatch(text,jsonb),billing_private.summary_dispatch(text,jsonb),billing_private.reports_dispatch(text,jsonb) TO authenticated;

-- The public wrapper remains SECURITY INVOKER; all new projections enforce
-- workspace and existing read permissions in their private dispatchers.
DO $$
DECLARE v_definition text; v_anchor text;
BEGIN
 SELECT pg_get_functiondef('public.billing_rpc(text,text,jsonb)'::regprocedure) INTO v_definition;
 v_anchor='IF p_resource=''planning'' THEN RETURN billing_private.planning_dispatch(p_action,p_payload); END IF;';
 IF strpos(v_definition,v_anchor)=0 THEN RAISE EXCEPTION 'Unexpected billing_rpc definition'; END IF;
 v_definition=replace(v_definition,v_anchor,
  'IF p_resource=''agenda'' THEN RETURN billing_private.agenda_dispatch(p_action,p_payload); END IF;'
  ||E'\n IF p_resource=''summary'' THEN RETURN billing_private.summary_dispatch(p_action,p_payload); END IF;'
  ||E'\n IF p_resource=''reports'' THEN RETURN billing_private.reports_dispatch(p_action,p_payload); END IF;'
  ||E'\n IF p_resource IN (''planning'',''planning-goals'',''planning-executions'') THEN RAISE EXCEPTION ''Este módulo foi removido. Acesse Agenda ou Resumo.'' USING ERRCODE=''22023''; END IF;');
 v_definition=replace(v_definition,'IF p_resource=''planning-goals'' THEN RETURN billing_private.planning_goals_dispatch(p_action,p_payload); END IF;','');
 v_definition=replace(v_definition,'IF p_resource=''planning-executions'' THEN RETURN billing_private.planning_executions_dispatch(p_action,p_payload); END IF;','');
 EXECUTE v_definition;
END $$;

-- User-requested removal of Acompanhamento data. Restore source planning
-- actuals before erasing executions; do not erase contracts or registrations.
LOCK TABLE public.billing_planning_entries,public.billing_planning_executions IN ACCESS EXCLUSIVE MODE;
UPDATE public.billing_planning_entries SET actual_cost=legacy_actual_cost,actual_production_tons=legacy_actual_production_tons,
 actual_date=legacy_actual_date,status=legacy_status,actuals_from_executions=false WHERE actuals_from_executions;
DELETE FROM public.billing_planning_executions;
REVOKE ALL ON FUNCTION billing_private.planning_dispatch(text,jsonb),billing_private.planning_goals_dispatch(text,jsonb),
 billing_private.planning_executions_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.billing_planning_entries,public.billing_planning_goals,public.billing_planning_goal_entries,
 public.billing_planning_goal_revisions,public.billing_planning_executions FROM anon,authenticated;
