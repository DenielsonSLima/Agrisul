-- The applied quotation is independent of the load's measured kg ATR/t.
-- Only months containing deliveries contribute, weighted by delivered tonnes.
-- Resolve each quotation with the same previous-month/criterion helper used by billing.
CREATE FUNCTION billing_private.contract_atr_quote_summary(p_contract public.billing_contracts)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH priced AS MATERIALIZED (
  SELECT load.loaded_at,load.volume,billing_private.contract_atr_quote(p_contract,load.loaded_at) quote
  FROM public.billing_contract_loads load
  WHERE load.owner_id=p_contract.owner_id AND load.contract_id=p_contract.id
 )
 SELECT jsonb_build_object(
  'average',CASE WHEN count(*) FILTER(WHERE quote IS NULL)>0 THEN ''
   ELSE coalesce(billing_private.decimal_text(round(sum(volume*quote)/nullif(sum(volume),0),6)),'') END,
  'pending',count(*) FILTER(WHERE quote IS NULL)>0,
  'loadedMonths',coalesce(jsonb_agg(DISTINCT to_char(loaded_at,'YYYY-MM') ORDER BY to_char(loaded_at,'YYYY-MM')),'[]'::jsonb),
  'referenceMonths',coalesce(jsonb_agg(DISTINCT to_char(date_trunc('month',loaded_at)-interval '1 month','YYYY-MM') ORDER BY to_char(date_trunc('month',loaded_at)-interval '1 month','YYYY-MM')),'[]'::jsonb)
 ) FROM priced
$$;
REVOKE ALL ON FUNCTION billing_private.contract_atr_quote_summary(public.billing_contracts) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.contracts_list_summary(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_company uuid;v_bucket text;v_search text;v_from date;v_to date;v_text text;v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize_resource('contracts','list');
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Confira os filtros dos contratos.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_payload) e WHERE e.key NOT IN ('companyId','bucket','search','from','to') OR jsonb_typeof(e.value)<>'string') THEN
  RAISE EXCEPTION 'Confira os filtros dos contratos.' USING ERRCODE='22023';
 END IF;
 v_company=nullif(p_payload->>'companyId','')::uuid;
 IF v_company IS NULL OR NOT EXISTS(SELECT 1 FROM public.billing_companies WHERE owner_id=v_owner AND id=v_company) THEN
  RAISE EXCEPTION 'Selecione uma empresa cadastrada.' USING ERRCODE='22023';
 END IF;
 v_bucket=coalesce(nullif(p_payload->>'bucket',''),'open');v_search=btrim(coalesce(p_payload->>'search',''));
 IF v_bucket NOT IN ('open','finished') OR length(v_search)>200 THEN RAISE EXCEPTION 'Confira os filtros dos contratos.' USING ERRCODE='22023'; END IF;
 FOREACH v_text IN ARRAY ARRAY[coalesce(p_payload->>'from',''),coalesce(p_payload->>'to','')] LOOP
  IF v_text<>'' AND (v_text!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_text::date<'1900-01-01' OR v_text::date>'9999-12-31') THEN
   RAISE EXCEPTION 'Informe um período válido.' USING ERRCODE='22023';
  END IF;
 END LOOP;
 v_from=nullif(p_payload->>'from','')::date;v_to=nullif(p_payload->>'to','')::date;
 IF v_from>v_to THEN RAISE EXCEPTION 'A data inicial deve ser igual ou anterior à data final.' USING ERRCODE='22023'; END IF;

 WITH filtered AS MATERIALIZED (
  SELECT c.* FROM public.billing_contracts c
  JOIN public.billing_clients client ON client.owner_id=c.owner_id AND client.id=c.client_id
  JOIN public.billing_companies company ON company.owner_id=c.owner_id AND company.id=c.company_id
  WHERE c.owner_id=v_owner AND c.company_id=v_company
   AND (v_search='' OR strpos(lower(concat_ws(' ',c.title,c.contract_number,c.type_name,client.legal_name,client.cnpj,company.name,company.legal_name,company.cnpj)),lower(v_search))>0
    OR (v_search~'^[0-9./ -]+$' AND regexp_replace(v_search,'[^0-9]','','g')<>'' AND strpos(client.cnpj,regexp_replace(v_search,'[^0-9]','','g'))>0))
   AND (v_from IS NULL OR c.start_date>=v_from) AND (v_to IS NULL OR c.start_date<=v_to)
 ), selected AS MATERIALIZED (
  SELECT c.*,billing_private.contract_financial_summary(c) finance FROM filtered c
  WHERE (v_bucket='open' AND c.status='Ativo') OR (v_bucket='finished' AND c.status IN ('Concluído','Cancelado'))
 ), metrics AS MATERIALIZED (
  SELECT finance->'totals' data FROM selected
 ), totals AS (
  SELECT coalesce(sum((data->>'loadedVolume')::numeric),0) volume,
   count(*) FILTER(WHERE (data->>'billingPending')::boolean) missing,
   coalesce(sum(nullif(data->>'grossAmount','')::numeric),0) gross,
   coalesce(sum((data->>'discountAmount')::numeric),0) discount,
   coalesce(sum(nullif(data->>'netAmount','')::numeric),0) net,
   coalesce(sum((data->>'advanceAmount')::numeric),0) advance,
   coalesce(sum((data->>'receiptAmount')::numeric),0) receipt,
   coalesce(sum((data->>'receivedAmount')::numeric),0) received,
   coalesce(sum(nullif(data->>'pendingAmount','')::numeric),0) pending,
   coalesce(sum(nullif(data->>'creditAmount','')::numeric),0) credit
  FROM metrics
 ), atr AS (
  -- Weight original measurements without rounding monthly means first.
  SELECT CASE WHEN count(*) FILTER(WHERE load.atr IS NULL)>0 THEN NULL
   ELSE round(sum(load.volume*load.atr)/nullif(sum(load.volume),0),6) END average
  FROM selected c JOIN public.billing_contract_loads load ON load.owner_id=v_owner AND load.contract_id=c.id
 )
 SELECT jsonb_build_object(
  'contracts',coalesce((SELECT jsonb_agg(
   billing_private.present_contract(c)||jsonb_build_object(
    'atrQuoteSummary',billing_private.contract_atr_quote_summary(c),
    'financialTotals',s.finance->'totals','loadedVolume',s.finance->'totals'->>'loadedVolume',
    'averageAtr',s.finance->'totals'->>'averageAtr','billingAmount',s.finance->'totals'->>'grossAmount',
    'billingPending',s.finance->'totals'->'billingPending'
   ) ORDER BY c.start_date DESC NULLS LAST,c.created_at DESC,c.id)
   FROM selected s JOIN public.billing_contracts c ON c.owner_id=v_owner AND c.id=s.id),'[]'::jsonb),
  'counts',jsonb_build_object('open',(SELECT count(*) FROM filtered WHERE status='Ativo'),'finished',(SELECT count(*) FROM filtered WHERE status IN ('Concluído','Cancelado'))),
  'total',(SELECT count(*) FROM selected),
  'summary',jsonb_build_object(
   'loadedVolume',billing_private.decimal_text(t.volume),'averageAtr',coalesce(billing_private.decimal_text(atr.average),''),
   'grossAmount',CASE WHEN t.missing>0 THEN '' ELSE billing_private.decimal_text(t.gross) END,
   'discountAmount',billing_private.decimal_text(t.discount),
   'netAmount',CASE WHEN t.missing>0 THEN '' ELSE billing_private.decimal_text(t.net) END,
   'advanceAmount',billing_private.decimal_text(t.advance),'receiptAmount',billing_private.decimal_text(t.receipt),
   'receivedAmount',billing_private.decimal_text(t.received),
   'pendingAmount',CASE WHEN t.missing>0 THEN '' ELSE billing_private.decimal_text(t.pending) END,
   'creditAmount',CASE WHEN t.missing>0 THEN '' ELSE billing_private.decimal_text(t.credit) END,
   'billingPending',t.missing>0,'pendingContractCount',t.missing
  )
 ) INTO v_result FROM totals t CROSS JOIN atr;
 RETURN v_result;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
 RAISE EXCEPTION 'Confira as datas e os identificadores informados.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.contracts_list_summary(jsonb) FROM PUBLIC,anon,authenticated;
