-- Executive summary over an inclusive date range. Financial and operational
-- figures are company-scoped; planning remains workspace-scoped because the
-- current planning model intentionally has no company foreign key.
CREATE INDEX billing_contract_payments_owner_received
 ON public.billing_contract_payments(owner_id,received_at,contract_id);

CREATE FUNCTION billing_private.summary_dashboard(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_company uuid;
 v_from date;v_to date;v_previous_from date;v_previous_to date;v_days integer;v_result jsonb;
BEGIN
 v_company=billing_private.overview_scope(p_payload,ARRAY['companyId','from','to']);
 PERFORM billing_private.authorize_resource('contracts','list');
 PERFORM billing_private.authorize('registrations.read');
 IF p_payload->>'from' IS NULL AND p_payload->>'to' IS NULL THEN
  v_to=(now() AT TIME ZONE 'America/Sao_Paulo')::date;v_from=v_to-364;
 ELSIF p_payload->>'from' IS NULL OR p_payload->>'to' IS NULL OR
    p_payload->>'from'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR p_payload->>'to'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
  RAISE EXCEPTION 'Informe o período completo do resumo.' USING ERRCODE='22023';
 ELSE v_from=(p_payload->>'from')::date;v_to=(p_payload->>'to')::date;
 END IF;
 v_days=v_to-v_from+1;
 IF v_from<'1900-01-01' OR v_to>'9999-12-31' OR v_days<1 THEN
  RAISE EXCEPTION 'A data inicial deve ser igual ou anterior à data final.' USING ERRCODE='22023';
 END IF;
 IF v_days>1827 THEN RAISE EXCEPTION 'O resumo aceita períodos de até cinco anos.' USING ERRCODE='22023'; END IF;
 v_previous_to=v_from-1;v_previous_from=v_previous_to-v_days+1;

 WITH contracts AS MATERIALIZED (
  SELECT c.*,cl.legal_name client_name
  FROM public.billing_contracts c JOIN public.billing_clients cl ON cl.owner_id=c.owner_id AND cl.id=c.client_id
  WHERE c.owner_id=v_owner AND c.company_id=v_company
 ), financial_loads AS MATERIALIZED (
  SELECT l.id,l.contract_id,l.farm_id,l.plot_id,l.loaded_at,l.volume,l.atr,
   f.name farm_name,p.name plot_name,finance.gross_amount,finance.discount_amount,finance.net_amount
  FROM public.billing_contracts c JOIN LATERAL billing_private.contract_load_financials(c) finance ON true
  JOIN public.billing_contract_loads l ON l.owner_id=c.owner_id AND l.contract_id=c.id AND l.id=finance.load_id
  JOIN public.billing_farms f ON f.owner_id=l.owner_id AND f.id=l.farm_id
  JOIN public.billing_farm_plots p ON p.owner_id=l.owner_id AND p.farm_id=l.farm_id AND p.id=l.plot_id
  WHERE c.owner_id=v_owner AND c.company_id=v_company AND l.loaded_at BETWEEN v_previous_from AND v_to
 ), cash_entries AS MATERIALIZED (
  SELECT p.contract_id,p.kind,p.received_at,p.amount
  FROM public.billing_contract_payments p JOIN contracts c ON c.id=p.contract_id AND c.owner_id=p.owner_id
  WHERE p.received_at BETWEEN v_previous_from AND v_to
 ), current_loads AS MATERIALIZED (SELECT * FROM financial_loads WHERE loaded_at BETWEEN v_from AND v_to),
 current_cash AS MATERIALIZED (SELECT * FROM cash_entries WHERE received_at BETWEEN v_from AND v_to),
 current_load_contract AS (
  SELECT contract_id,count(*)::integer load_count,sum(volume) loaded_volume,
   count(*) FILTER(WHERE gross_amount IS NULL)::integer pending_load_count,
   coalesce(sum(gross_amount),0) gross_amount,coalesce(sum(discount_amount),0) discount_amount,
   coalesce(sum(net_amount),0) net_amount
  FROM current_loads GROUP BY contract_id
 ), current_cash_contract AS (
  SELECT contract_id,coalesce(sum(amount) FILTER(WHERE kind='advance'),0) advance_amount,
   coalesce(sum(amount) FILTER(WHERE kind='receipt'),0) receipt_amount
  FROM current_cash GROUP BY contract_id
 ), contract_metrics AS MATERIALIZED (
  SELECT c.id,c.client_name,c.contract_number,c.title,c.status,
   coalesce(l.load_count,0) load_count,coalesce(l.loaded_volume,0) loaded_volume,
   coalesce(l.pending_load_count,0) pending_load_count,coalesce(l.gross_amount,0) gross_amount,
   coalesce(l.discount_amount,0) discount_amount,coalesce(l.net_amount,0) net_amount,
   coalesce(p.advance_amount,0) advance_amount,coalesce(p.receipt_amount,0) receipt_amount,
   coalesce(p.advance_amount,0)+coalesce(p.receipt_amount,0) received_amount
  FROM contracts c LEFT JOIN current_load_contract l ON l.contract_id=c.id
  LEFT JOIN current_cash_contract p ON p.contract_id=c.id
 ), totals AS MATERIALIZED (
  SELECT count(*)::integer contract_count,count(*) FILTER(WHERE status='Ativo')::integer active_contract_count,
   coalesce(sum(load_count),0)::integer load_count,coalesce(sum(loaded_volume),0) loaded_volume,
   coalesce(sum(pending_load_count),0)::integer pending_load_count,coalesce(sum(gross_amount),0) gross_amount,
   coalesce(sum(discount_amount),0) discount_amount,coalesce(sum(net_amount),0) net_amount,
   coalesce(sum(advance_amount),0) advance_amount,coalesce(sum(receipt_amount),0) receipt_amount,
   coalesce(sum(received_amount),0) received_amount,
   coalesce(sum(greatest(net_amount-received_amount,0)),0) pending_amount,
   coalesce(sum(greatest(received_amount-net_amount,0)),0) credit_amount
  FROM contract_metrics
 ), previous_load_contract AS (
  SELECT contract_id,count(*)::integer load_count,sum(volume) loaded_volume,
   count(*) FILTER(WHERE gross_amount IS NULL)::integer pending_load_count,coalesce(sum(net_amount),0) net_amount
  FROM financial_loads WHERE loaded_at BETWEEN v_previous_from AND v_previous_to GROUP BY contract_id
 ), previous_cash_contract AS (
  SELECT contract_id,coalesce(sum(amount),0) received_amount FROM cash_entries
  WHERE received_at BETWEEN v_previous_from AND v_previous_to GROUP BY contract_id
 ), previous_metrics AS (
  SELECT c.id,coalesce(l.load_count,0) load_count,coalesce(l.loaded_volume,0) loaded_volume,
   coalesce(l.pending_load_count,0) pending_load_count,coalesce(l.net_amount,0) net_amount,
   coalesce(p.received_amount,0) received_amount
  FROM contracts c LEFT JOIN previous_load_contract l ON l.contract_id=c.id
  LEFT JOIN previous_cash_contract p ON p.contract_id=c.id
 ), previous_totals AS MATERIALIZED (
  SELECT coalesce(sum(load_count),0)::integer load_count,coalesce(sum(loaded_volume),0) loaded_volume,
   coalesce(sum(pending_load_count),0)::integer pending_load_count,coalesce(sum(net_amount),0) net_amount,
   coalesce(sum(received_amount),0) received_amount FROM previous_metrics
 ), calendar AS MATERIALIZED (
  SELECT generate_series(date_trunc('month',v_from)::date,date_trunc('month',v_to)::date,interval '1 month')::date month_start
 ), month_load_contract AS (
  SELECT contract_id,date_trunc('month',loaded_at)::date month_start,count(*)::integer load_count,sum(volume) loaded_volume,
   count(*) FILTER(WHERE gross_amount IS NULL)::integer pending_load_count,coalesce(sum(gross_amount),0) gross_amount,
   coalesce(sum(discount_amount),0) discount_amount,coalesce(sum(net_amount),0) net_amount
  FROM current_loads GROUP BY contract_id,date_trunc('month',loaded_at)
 ), month_cash_contract AS (
  SELECT contract_id,date_trunc('month',received_at)::date month_start,
   coalesce(sum(amount) FILTER(WHERE kind='advance'),0) advance_amount,
   coalesce(sum(amount) FILTER(WHERE kind='receipt'),0) receipt_amount
  FROM current_cash GROUP BY contract_id,date_trunc('month',received_at)
 ), month_contract AS (
  SELECT cal.month_start,c.id,coalesce(l.load_count,0) load_count,coalesce(l.loaded_volume,0) loaded_volume,
   coalesce(l.pending_load_count,0) pending_load_count,coalesce(l.gross_amount,0) gross_amount,
   coalesce(l.discount_amount,0) discount_amount,coalesce(l.net_amount,0) net_amount,
   coalesce(p.advance_amount,0) advance_amount,coalesce(p.receipt_amount,0) receipt_amount,
   coalesce(p.advance_amount,0)+coalesce(p.receipt_amount,0) received_amount
  FROM calendar cal CROSS JOIN contracts c
  LEFT JOIN month_load_contract l ON l.contract_id=c.id AND l.month_start=cal.month_start
  LEFT JOIN month_cash_contract p ON p.contract_id=c.id AND p.month_start=cal.month_start
 ), month_totals AS (
  SELECT cal.month_start,coalesce(sum(mc.load_count),0)::integer load_count,coalesce(sum(mc.loaded_volume),0) loaded_volume,
   coalesce(sum(mc.pending_load_count),0)::integer pending_load_count,coalesce(sum(mc.gross_amount),0) gross_amount,
   coalesce(sum(mc.discount_amount),0) discount_amount,coalesce(sum(mc.net_amount),0) net_amount,
   coalesce(sum(mc.advance_amount),0) advance_amount,coalesce(sum(mc.receipt_amount),0) receipt_amount,
   coalesce(sum(mc.received_amount),0) received_amount,
   coalesce(sum(greatest(mc.net_amount-mc.received_amount,0)),0) pending_amount,
   coalesce(sum(greatest(mc.received_amount-mc.net_amount,0)),0) credit_amount
  FROM calendar cal LEFT JOIN month_contract mc ON mc.month_start=cal.month_start GROUP BY cal.month_start
 ), farm_totals AS (
  SELECT l.farm_id,l.farm_name,f.area_ha,count(DISTINCT l.plot_id)::integer plot_count,count(*)::integer load_count,
   sum(l.volume) loaded_volume,count(*) FILTER(WHERE l.gross_amount IS NULL)::integer pending_load_count,
   coalesce(sum(l.gross_amount),0) gross_amount,coalesce(sum(l.discount_amount),0) discount_amount,
   coalesce(sum(l.net_amount),0) net_amount
  FROM current_loads l JOIN public.billing_farms f ON f.owner_id=v_owner AND f.id=l.farm_id
  GROUP BY l.farm_id,l.farm_name,f.area_ha
 ), planning_periods AS MATERIALIZED (
  SELECT p.* FROM public.billing_planning_periods p
  WHERE p.owner_id=v_owner AND p.status<>'cancelled' AND p.start_date<=v_to AND p.end_date>=v_from
 ), focused_period AS MATERIALIZED (
  SELECT p.* FROM planning_periods p
  ORDER BY (v_to BETWEEN p.start_date AND p.end_date) DESC,(p.status='active') DESC,p.end_date DESC,p.created_at DESC,p.id
  LIMIT 1
 ), planning_totals AS MATERIALIZED (
  SELECT (SELECT count(*)::integer FROM planning_periods) period_count,
   (SELECT count(*)::integer FROM planning_periods WHERE status='active') active_period_count,
   coalesce((SELECT name FROM focused_period),'') period_name,
   coalesce((SELECT least(v_to,end_date)::text FROM focused_period),'') progress_as_of,
   coalesce((SELECT target_area_ha FROM focused_period),0) target_area_ha,
   coalesce((SELECT harvest_target_tons FROM focused_period),0) harvest_target_tons,
   coalesce((SELECT sum(a.area_ha) FROM public.billing_planning_allocations a JOIN focused_period p ON p.id=a.period_id
    WHERE a.owner_id=v_owner AND a.status='active'),0) allocated_area_ha,
   coalesce((SELECT sum(l.area_ha) FROM public.billing_planning_field_logs l JOIN focused_period p ON p.id=l.period_id
    WHERE l.owner_id=v_owner AND l.voided_at IS NULL AND l.kind='planting' AND l.occurred_on BETWEEN p.start_date AND least(v_to,p.end_date)),0) planted_area_ha,
   coalesce((SELECT sum(l.area_ha) FROM public.billing_planning_field_logs l JOIN focused_period p ON p.id=l.period_id
    WHERE l.owner_id=v_owner AND l.voided_at IS NULL AND l.kind='management' AND l.occurred_on BETWEEN p.start_date AND least(v_to,p.end_date)),0) managed_area_ha,
   coalesce((SELECT sum(l.area_ha) FROM public.billing_planning_field_logs l JOIN focused_period p ON p.id=l.period_id
    WHERE l.owner_id=v_owner AND l.voided_at IS NULL AND l.kind='loss' AND l.occurred_on BETWEEN p.start_date AND least(v_to,p.end_date)),0) lost_area_ha,
   coalesce((SELECT count(*) FROM public.billing_planning_field_logs l JOIN focused_period p ON p.id=l.period_id
    WHERE l.owner_id=v_owner AND l.voided_at IS NULL AND l.occurred_on BETWEEN p.start_date AND least(v_to,p.end_date)),0)::integer field_log_count,
   coalesce((SELECT count(*) FROM public.billing_planning_field_logs l JOIN focused_period p ON p.id=l.period_id
    WHERE l.owner_id=v_owner AND l.voided_at IS NULL AND l.kind='management' AND l.occurred_on BETWEEN p.start_date AND least(v_to,p.end_date)),0)::integer management_event_count,
   coalesce((SELECT sum(l.volume) FROM focused_period p
    JOIN LATERAL billing_private.planning_v5_harvest_scope(v_owner,p.id) scope ON true
    JOIN public.billing_contract_loads l ON l.owner_id=v_owner AND l.farm_id=scope.farm_id AND l.plot_id=scope.plot_id
     AND l.loaded_at BETWEEN p.start_date AND least(v_to,p.end_date)),0) harvested_tons
 ), management_totals AS (
  SELECT cp.id,cp.name,count(*)::integer event_count,sum(l.area_ha) area_ha
  FROM public.billing_planning_field_logs l JOIN focused_period p ON p.id=l.period_id
  JOIN public.billing_cultural_practices cp ON cp.owner_id=l.owner_id AND cp.id=l.practice_id
  WHERE l.owner_id=v_owner AND l.voided_at IS NULL AND l.kind='management'
   AND l.occurred_on BETWEEN p.start_date AND least(v_to,p.end_date)
  GROUP BY cp.id,cp.name
 ), registry_totals AS MATERIALIZED (
  SELECT (SELECT count(*)::integer FROM public.billing_farms WHERE owner_id=v_owner) farm_count,
   (SELECT count(*)::integer FROM public.billing_farm_plots WHERE owner_id=v_owner) plot_count,
   coalesce((SELECT sum(area_ha) FROM public.billing_farms WHERE owner_id=v_owner),0) farm_area_ha,
   coalesce((SELECT sum(area_ha) FROM public.billing_farm_plots WHERE owner_id=v_owner),0) plot_area_ha
 )
 SELECT jsonb_build_object(
  'range',jsonb_build_object('from',v_from,'to',v_to,'dayCount',v_days,'generatedAt',statement_timestamp()),
  'totals',jsonb_build_object('contractCount',t.contract_count,'activeContractCount',t.active_contract_count,
   'loadCount',t.load_count,'loadedVolume',billing_private.decimal_text(t.loaded_volume),
   'farmCount',(SELECT count(*)::integer FROM farm_totals),'plotCount',(SELECT count(DISTINCT plot_id)::integer FROM current_loads),
   'billingPending',t.pending_load_count>0,'pendingLoadCount',t.pending_load_count,
   'grossAmount',CASE WHEN t.pending_load_count>0 THEN '' ELSE billing_private.decimal_text(t.gross_amount) END,
   'discountAmount',billing_private.decimal_text(t.discount_amount),
   'netAmount',CASE WHEN t.pending_load_count>0 THEN '' ELSE billing_private.decimal_text(t.net_amount) END,
   'advanceAmount',billing_private.decimal_text(t.advance_amount),'receiptAmount',billing_private.decimal_text(t.receipt_amount),
   'receivedAmount',billing_private.decimal_text(t.received_amount),
   'pendingAmount',CASE WHEN t.pending_load_count>0 THEN '' ELSE billing_private.decimal_text(t.pending_amount) END,
   'creditAmount',CASE WHEN t.pending_load_count>0 THEN '' ELSE billing_private.decimal_text(t.credit_amount) END),
  'comparison',jsonb_build_object('from',v_previous_from,'to',v_previous_to,'loadCount',pt.load_count,
   'loadedVolume',billing_private.decimal_text(pt.loaded_volume),
   'netAmount',CASE WHEN pt.pending_load_count>0 THEN '' ELSE billing_private.decimal_text(pt.net_amount) END,
   'receivedAmount',billing_private.decimal_text(pt.received_amount),
   'volumeChangePercent',CASE WHEN pt.loaded_volume=0 THEN '' ELSE billing_private.decimal_text(round((t.loaded_volume-pt.loaded_volume)*100/abs(pt.loaded_volume),2)) END,
   'netChangePercent',CASE WHEN t.pending_load_count>0 OR pt.pending_load_count>0 OR pt.net_amount=0 THEN '' ELSE billing_private.decimal_text(round((t.net_amount-pt.net_amount)*100/abs(pt.net_amount),2)) END,
   'receivedChangePercent',CASE WHEN pt.received_amount=0 THEN '' ELSE billing_private.decimal_text(round((t.received_amount-pt.received_amount)*100/abs(pt.received_amount),2)) END),
  'months',coalesce((SELECT jsonb_agg(jsonb_build_object('month',to_char(m.month_start,'YYYY-MM'),'loadCount',m.load_count,
   'loadedVolume',billing_private.decimal_text(m.loaded_volume),'billingPending',m.pending_load_count>0,
   'pendingLoadCount',m.pending_load_count,'grossAmount',CASE WHEN m.pending_load_count>0 THEN '' ELSE billing_private.decimal_text(m.gross_amount) END,
   'discountAmount',billing_private.decimal_text(m.discount_amount),'netAmount',CASE WHEN m.pending_load_count>0 THEN '' ELSE billing_private.decimal_text(m.net_amount) END,
   'advanceAmount',billing_private.decimal_text(m.advance_amount),'receiptAmount',billing_private.decimal_text(m.receipt_amount),
   'receivedAmount',billing_private.decimal_text(m.received_amount),
   'pendingAmount',CASE WHEN m.pending_load_count>0 THEN '' ELSE billing_private.decimal_text(m.pending_amount) END,
   'creditAmount',CASE WHEN m.pending_load_count>0 THEN '' ELSE billing_private.decimal_text(m.credit_amount) END) ORDER BY m.month_start) FROM month_totals m),'[]'::jsonb),
  'contractStatus',coalesce((SELECT jsonb_agg(jsonb_build_object('status',status,'count',amount) ORDER BY amount DESC,status)
   FROM (SELECT status,count(*)::integer amount FROM contracts GROUP BY status) rows),'[]'::jsonb),
  'contracts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'clientName',client_name,'contractNumber',contract_number,
   'title',title,'status',status,'loadCount',load_count,'loadedVolume',billing_private.decimal_text(loaded_volume),
   'billingPending',pending_load_count>0,'grossAmount',CASE WHEN pending_load_count>0 THEN '' ELSE billing_private.decimal_text(gross_amount) END,
   'discountAmount',billing_private.decimal_text(discount_amount),'netAmount',CASE WHEN pending_load_count>0 THEN '' ELSE billing_private.decimal_text(net_amount) END,
   'receivedAmount',billing_private.decimal_text(received_amount),
   'pendingAmount',CASE WHEN pending_load_count>0 THEN '' ELSE billing_private.decimal_text(greatest(net_amount-received_amount,0)) END)
   ORDER BY loaded_volume DESC,received_amount DESC,lower(client_name),id) FROM contract_metrics),'[]'::jsonb),
  'farms',coalesce((SELECT jsonb_agg(jsonb_build_object('id',farm_id,'name',farm_name,'areaHa',billing_private.decimal_text(area_ha),
   'plotCount',plot_count,'loadCount',load_count,'loadedVolume',billing_private.decimal_text(loaded_volume),
   'billingPending',pending_load_count>0,'grossAmount',CASE WHEN pending_load_count>0 THEN '' ELSE billing_private.decimal_text(gross_amount) END,
   'discountAmount',billing_private.decimal_text(discount_amount),'netAmount',CASE WHEN pending_load_count>0 THEN '' ELSE billing_private.decimal_text(net_amount) END)
   ORDER BY loaded_volume DESC,lower(farm_name),farm_id) FROM farm_totals),'[]'::jsonb),
  'agriculture',jsonb_build_object('scope','workspace','registeredFarmCount',r.farm_count,'registeredPlotCount',r.plot_count,
   'farmAreaHa',billing_private.decimal_text(r.farm_area_ha),'plotAreaHa',billing_private.decimal_text(r.plot_area_ha)),
  'planning',jsonb_build_object('scope','workspace','periodCount',p.period_count,'activePeriodCount',p.active_period_count,
   'periodName',p.period_name,'progressAsOf',p.progress_as_of,
   'targetAreaHa',billing_private.decimal_text(p.target_area_ha),'allocatedAreaHa',billing_private.decimal_text(p.allocated_area_ha),
   'plantedAreaHa',billing_private.decimal_text(p.planted_area_ha),'managedAreaHa',billing_private.decimal_text(p.managed_area_ha),
   'lostAreaHa',billing_private.decimal_text(p.lost_area_ha),'fieldLogCount',p.field_log_count,'managementEventCount',p.management_event_count,
   'harvestTargetTons',billing_private.decimal_text(p.harvest_target_tons),'harvestedTons',billing_private.decimal_text(p.harvested_tons),
   'plantingPercent',billing_private.decimal_text(CASE WHEN p.target_area_ha>0 THEN round(p.planted_area_ha*100/p.target_area_ha,2) ELSE 0 END),
   'harvestPercent',billing_private.decimal_text(CASE WHEN p.harvest_target_tons>0 THEN round(p.harvested_tons*100/p.harvest_target_tons,2) ELSE 0 END)),
  'management',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'eventCount',event_count,
   'areaHa',billing_private.decimal_text(area_ha)) ORDER BY area_ha DESC,lower(name),id) FROM management_totals),'[]'::jsonb)
 ) INTO v_result FROM totals t CROSS JOIN previous_totals pt CROSS JOIN planning_totals p CROSS JOIN registry_totals r;
 RETURN v_result;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
 RAISE EXCEPTION 'Informe um período válido.' USING ERRCODE='22023';
END $$;

REVOKE ALL ON FUNCTION billing_private.summary_dashboard(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.summary_dashboard(jsonb) TO authenticated;

-- Keep the monthly projection used by Relatórios stable while giving Resumo
-- a dedicated range action.
ALTER FUNCTION billing_private.summary_dispatch(text,jsonb) RENAME TO summary_monthly_dispatch;
REVOKE ALL ON FUNCTION billing_private.summary_monthly_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.summary_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_action='dashboard' THEN RETURN billing_private.summary_dashboard(p_payload); END IF;
 RETURN billing_private.summary_monthly_dispatch(p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION billing_private.summary_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.summary_dispatch(text,jsonb) TO authenticated;

COMMENT ON FUNCTION billing_private.summary_dashboard(jsonb) IS
 'Owner-isolated executive dashboard. Company finance uses exact load/cash dates; workspace planning is returned with an explicit scope.';
