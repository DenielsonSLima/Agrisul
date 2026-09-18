-- Detailed company load report. Financial values are allocated for the whole
-- contract/month before filters are applied, preserving cent reconciliation.
CREATE INDEX IF NOT EXISTS billing_contract_loads_report_period
 ON public.billing_contract_loads(owner_id,loaded_at,contract_id,id);

CREATE FUNCTION billing_private.reports_loads_dispatch(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_company uuid; v_farm uuid; v_plot uuid;
 v_from date; v_to date; v_month date;
 v_search text:=btrim(coalesce(p_payload->>'search',''));
 v_text text; v_result jsonb;
BEGIN
 v_company=billing_private.overview_scope(p_payload,ARRAY['companyId','kind','month','search','from','to','farmId','plotId']);
 PERFORM billing_private.authorize_resource('contracts','list');

 IF length(v_search)>200 THEN RAISE EXCEPTION 'A busca deve ter até 200 caracteres.' USING ERRCODE='22023'; END IF;
 IF coalesce(p_payload->>'month','')<>'' AND (coalesce(p_payload->>'from','')<>'' OR coalesce(p_payload->>'to','')<>'') THEN
  RAISE EXCEPTION 'Use o mês ou o período, sem combinar os dois filtros.' USING ERRCODE='22023';
 END IF;
 IF coalesce(p_payload->>'month','')<>'' THEN
  v_month=billing_private.overview_month(p_payload->>'month');
  v_from=v_month; v_to=(v_month+interval '1 month-1 day')::date;
 ELSE
  FOREACH v_text IN ARRAY ARRAY[coalesce(p_payload->>'from',''),coalesce(p_payload->>'to','')] LOOP
   IF v_text<>'' AND (v_text!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_text::date<'1900-01-01' OR v_text::date>'9999-12-31') THEN
    RAISE EXCEPTION 'Informe um período válido.' USING ERRCODE='22023';
   END IF;
  END LOOP;
  v_from=nullif(p_payload->>'from','')::date; v_to=nullif(p_payload->>'to','')::date;
  IF v_from IS NULL AND v_to IS NULL THEN RAISE EXCEPTION 'Informe o período inicial e final.' USING ERRCODE='22023'; END IF;
  v_from=coalesce(v_from,v_to); v_to=coalesce(v_to,v_from);
 END IF;
 IF v_from>v_to THEN RAISE EXCEPTION 'A data inicial deve ser igual ou anterior à data final.' USING ERRCODE='22023'; END IF;

 v_farm=nullif(p_payload->>'farmId','')::uuid;
 v_plot=nullif(p_payload->>'plotId','')::uuid;
 IF v_plot IS NOT NULL AND v_farm IS NULL THEN RAISE EXCEPTION 'Selecione a fazenda antes do talhão.' USING ERRCODE='22023'; END IF;
 IF v_farm IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.billing_farms WHERE owner_id=v_owner AND id=v_farm) THEN
  RAISE EXCEPTION 'Fazenda ou talhão não encontrado.' USING ERRCODE='P0002';
 END IF;
 IF v_plot IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.billing_farm_plots WHERE owner_id=v_owner AND farm_id=v_farm AND id=v_plot) THEN
  RAISE EXCEPTION 'Fazenda ou talhão não encontrado.' USING ERRCODE='P0002';
 END IF;

 WITH scoped_contracts AS MATERIALIZED (
  SELECT c contract_data,c.id contract_id,cl.legal_name client_name,cl.cnpj client_cnpj
  FROM public.billing_contracts c
  JOIN public.billing_clients cl ON cl.owner_id=c.owner_id AND cl.id=c.client_id
  WHERE c.owner_id=v_owner AND c.company_id=v_company
 ), priced AS MATERIALIZED (
  SELECT l.*,(c.contract_data).contract_number,(c.contract_data).title contract_title,c.client_name,c.client_cnpj,
   f.name farm_name,p.name plot_name,finance.gross_amount,finance.discount_amount,finance.net_amount,finance.atr_quote
  FROM scoped_contracts c
  JOIN billing_private.contract_load_financials(c.contract_data) finance ON true
  JOIN public.billing_contract_loads l ON l.owner_id=(c.contract_data).owner_id AND l.contract_id=c.contract_id AND l.id=finance.load_id
  JOIN public.billing_farms f ON f.owner_id=l.owner_id AND f.id=l.farm_id
  JOIN public.billing_farm_plots p ON p.owner_id=l.owner_id AND p.farm_id=l.farm_id AND p.id=l.plot_id
 ), selected AS MATERIALIZED (
  SELECT * FROM priced
  WHERE loaded_at>=v_from AND loaded_at<=v_to
   AND (v_farm IS NULL OR farm_id=v_farm) AND (v_plot IS NULL OR plot_id=v_plot)
   AND (v_search='' OR strpos(billing_private.name_key(concat_ws(' ',contract_number,contract_title,client_name,client_cnpj,farm_name,plot_name,document,notes)),billing_private.name_key(v_search))>0)
 ), contract_totals AS MATERIALIZED (
  SELECT contract_id,contract_number,contract_title,client_name,count(*) load_count,
   sum(volume) volume,count(DISTINCT farm_id) farm_count,count(DISTINCT plot_id) plot_count,
   CASE WHEN count(*) FILTER(WHERE atr IS NULL)>0 THEN NULL ELSE round(sum(volume*atr)/nullif(sum(volume),0),6) END average_atr,
   CASE WHEN count(*) FILTER(WHERE gross_amount IS NULL)>0 THEN NULL ELSE coalesce(sum(gross_amount),0) END gross_amount,
   coalesce(sum(discount_amount),0) discount_amount,
   CASE WHEN count(*) FILTER(WHERE net_amount IS NULL)>0 THEN NULL ELSE coalesce(sum(net_amount),0) END net_amount,
   count(*) FILTER(WHERE gross_amount IS NULL) pending_load_count
  FROM selected GROUP BY contract_id,contract_number,contract_title,client_name
 ), report_totals AS (
  SELECT count(*) load_count,count(DISTINCT contract_id) contract_count,count(DISTINCT farm_id) farm_count,count(DISTINCT plot_id) plot_count,
   coalesce(sum(volume),0) volume,
   CASE WHEN count(*)=0 THEN 0 WHEN count(*) FILTER(WHERE atr IS NULL)>0 THEN NULL ELSE round(sum(volume*atr)/nullif(sum(volume),0),6) END average_atr,
   CASE WHEN count(*) FILTER(WHERE gross_amount IS NULL)>0 THEN NULL ELSE coalesce(sum(gross_amount),0) END gross_amount,
   coalesce(sum(discount_amount),0) discount_amount,
   CASE WHEN count(*) FILTER(WHERE net_amount IS NULL)>0 THEN NULL ELSE coalesce(sum(net_amount),0) END net_amount,
   count(*) FILTER(WHERE gross_amount IS NULL) pending_load_count
  FROM selected
 ), origins AS (
  SELECT f.id,f.name,coalesce(jsonb_agg(DISTINCT jsonb_build_object('id',p.id,'name',p.name) ORDER BY jsonb_build_object('id',p.id,'name',p.name)),'[]'::jsonb) plots
  FROM public.billing_farms f
  JOIN public.billing_contract_loads l ON l.owner_id=f.owner_id AND l.farm_id=f.id
  JOIN scoped_contracts c ON c.contract_id=l.contract_id
  JOIN public.billing_farm_plots p ON p.owner_id=l.owner_id AND p.farm_id=l.farm_id AND p.id=l.plot_id
  WHERE f.owner_id=v_owner GROUP BY f.id,f.name
 ), groups AS (
  SELECT t.*,
   (SELECT jsonb_agg(jsonb_build_object(
    'id',s.id,'contractId',s.contract_id,'farmId',s.farm_id,'plotId',s.plot_id,'loadedAt',s.loaded_at,
    'farmName',s.farm_name,'plotName',s.plot_name,'document',s.document,'notes',s.notes,
    'volume',billing_private.decimal_text(s.volume),'atr',coalesce(billing_private.decimal_text(s.atr),''),
    'atrReferenceMonth',to_char(date_trunc('month',s.loaded_at)-interval '1 month','YYYY-MM'),
    'atrQuote',coalesce(billing_private.decimal_text(s.atr_quote),''),
    'grossAmount',coalesce(billing_private.decimal_text(s.gross_amount),''),
    'discountAmount',billing_private.decimal_text(s.discount_amount),
    'netAmount',coalesce(billing_private.decimal_text(s.net_amount),''),'billingPending',s.gross_amount IS NULL
   ) ORDER BY s.loaded_at,s.created_at,s.id) FROM selected s WHERE s.contract_id=t.contract_id) loads
  FROM contract_totals t
 )
 SELECT jsonb_build_object(
  'kind','loads','scope','company','period',jsonb_build_object('from',v_from::text,'to',v_to::text),
  'filters',jsonb_build_object('search',v_search,'from',v_from::text,'to',v_to::text,
   'farmId',coalesce(v_farm::text,''),'plotId',coalesce(v_plot::text,''),
   'farmName',coalesce((SELECT name FROM public.billing_farms WHERE owner_id=v_owner AND id=v_farm),''),
   'plotName',coalesce((SELECT name FROM public.billing_farm_plots WHERE owner_id=v_owner AND farm_id=v_farm AND id=v_plot),'')),
  'origins',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'plots',plots) ORDER BY billing_private.name_key(name),id) FROM origins),'[]'::jsonb),
  'total',t.load_count,
  'totals',jsonb_build_object('loadCount',t.load_count,'contractCount',t.contract_count,'farmCount',t.farm_count,'plotCount',t.plot_count,
   'volume',billing_private.decimal_text(t.volume),'averageAtr',coalesce(billing_private.decimal_text(t.average_atr),''),
   'grossAmount',coalesce(billing_private.decimal_text(t.gross_amount),''),'discountAmount',billing_private.decimal_text(t.discount_amount),
   'netAmount',coalesce(billing_private.decimal_text(t.net_amount),''),'billingPending',t.pending_load_count>0,'pendingLoadCount',t.pending_load_count),
  'groups',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'contractId',g.contract_id,'contractNumber',g.contract_number,'contractTitle',g.contract_title,'clientName',g.client_name,
   'totals',jsonb_build_object('loadCount',g.load_count,'farmCount',g.farm_count,'plotCount',g.plot_count,
    'volume',billing_private.decimal_text(g.volume),'averageAtr',coalesce(billing_private.decimal_text(g.average_atr),''),
    'grossAmount',coalesce(billing_private.decimal_text(g.gross_amount),''),'discountAmount',billing_private.decimal_text(g.discount_amount),
    'netAmount',coalesce(billing_private.decimal_text(g.net_amount),''),'billingPending',g.pending_load_count>0,'pendingLoadCount',g.pending_load_count),
   'loads',g.loads) ORDER BY billing_private.name_key(g.client_name),billing_private.name_key(g.contract_number),g.contract_id) FROM groups g),'[]'::jsonb)
 ) INTO v_result FROM report_totals t;
 RETURN v_result;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
 RAISE EXCEPTION 'Informe datas e identificadores válidos.' USING ERRCODE='22023';
END $$;

CREATE OR REPLACE FUNCTION billing_private.reports_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_company uuid; v_kind text; v_data jsonb;
BEGIN
 IF p_action<>'list' THEN RAISE EXCEPTION 'Operação de relatório inválida.' USING ERRCODE='22023'; END IF;
 v_kind=p_payload->>'kind';
 IF v_kind='loads' THEN RETURN billing_private.reports_loads_dispatch(p_payload); END IF;
 v_company=billing_private.overview_scope(p_payload,ARRAY['companyId','month','kind']);
 IF v_kind='farms' THEN
  PERFORM billing_private.authorize_resource('farms','list');
  v_data=billing_private.farm_summary_list();
  RETURN jsonb_build_object('kind',v_kind,'scope','workspace','rows',v_data->'farms','totals',v_data->'summary','total',v_data->'summary'->'farmCount');
 END IF;
 PERFORM billing_private.authorize_resource('contracts','list');
 IF v_kind IN ('contracts','financial') THEN
  PERFORM billing_private.overview_month(p_payload->>'month');
  v_data=billing_private.summary_dispatch('list',p_payload-'kind');
  RETURN jsonb_build_object('kind',v_kind,'scope','company','rows',v_data->'contracts','totals',v_data->'totals',
   'total',v_data->'totals'->'contractCount','month',p_payload->>'month');
 END IF;
 RAISE EXCEPTION 'Selecione um relatório válido.' USING ERRCODE='22023';
END $$;

REVOKE ALL ON FUNCTION billing_private.reports_loads_dispatch(jsonb),billing_private.reports_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.reports_dispatch(text,jsonb) TO authenticated;

COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS 'Authenticated workspace RPC. Detailed load reports use inclusive periods, origin filters and server-calculated financial subtotals.';
