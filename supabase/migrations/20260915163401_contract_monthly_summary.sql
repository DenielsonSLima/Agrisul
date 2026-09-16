-- Monthly operational and billing summary for a single company-scoped contract.
-- Expenses deliberately remain pending until the Finance module defines their
-- persisted source and authorization rules.
CREATE FUNCTION billing_private.contract_monthly_summary(p_contract public.billing_contracts)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH priced AS (
  SELECT date_trunc('month',load.loaded_at)::date month_start,load.volume,load.atr load_atr,
   CASE p_contract.atr_period_type
    WHEN 'monthly' THEN CASE p_contract.atr_price_type WHEN 'gross' THEN quote.monthly_gross_value ELSE quote.monthly_net_value END
    ELSE CASE p_contract.atr_price_type WHEN 'gross' THEN quote.accumulated_gross_value ELSE quote.accumulated_net_value END
   END atr_quote
  FROM public.billing_contract_loads load
  LEFT JOIN public.billing_atr_records quote ON quote.owner_id=load.owner_id
   AND quote.year=extract(year FROM load.loaded_at)::integer
   AND quote.month=extract(month FROM load.loaded_at)::integer
  WHERE load.owner_id=p_contract.owner_id AND load.contract_id=p_contract.id
 ), monthly AS (
  SELECT month_start,sum(volume) loaded_volume,
   round(sum(volume*load_atr)/nullif(sum(volume),0),6) average_load_atr,
   max(atr_quote) atr_quote,
   count(*) FILTER(WHERE atr_quote IS NULL) missing_quotes,
   CASE WHEN count(*) FILTER(WHERE atr_quote IS NULL)>0 THEN NULL
    ELSE round(sum(volume*load_atr*atr_quote),2) END billing_amount
  FROM priced GROUP BY month_start
 ), overall AS (
  SELECT coalesce(sum(volume),0) loaded_volume,
   round(sum(volume*load_atr)/nullif(sum(volume),0),6) average_load_atr,
   count(*) FILTER(WHERE atr_quote IS NULL) missing_quotes,
   CASE WHEN count(*) FILTER(WHERE atr_quote IS NULL)>0 THEN NULL
    ELSE round(coalesce(sum(volume*load_atr*atr_quote),0),2) END billing_amount
  FROM priced
 )
 SELECT jsonb_build_object(
  'criteria',jsonb_build_object('atrPriceType',p_contract.atr_price_type,'atrPeriodType',p_contract.atr_period_type),
  'months',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'month',to_char(item.month_start,'YYYY-MM'),
   'loadedVolume',billing_private.decimal_text(item.loaded_volume),
   'averageLoadAtr',coalesce(billing_private.decimal_text(item.average_load_atr),''),
   'atrQuote',coalesce(billing_private.decimal_text(item.atr_quote),''),
   'billingAmount',coalesce(billing_private.decimal_text(item.billing_amount),''),
   'billingPending',item.missing_quotes>0,
   'expenseAmount','','expensesPending',true,'resultAmount',''
  ) ORDER BY item.month_start) FROM monthly item),'[]'::jsonb),
  'totals',(SELECT jsonb_build_object(
   'contractedVolume',billing_private.decimal_text(p_contract.contracted_volume),
   'loadedVolume',billing_private.decimal_text(summary.loaded_volume),
   'remainingVolume',billing_private.decimal_text(greatest(p_contract.contracted_volume-summary.loaded_volume,0)),
   'averageLoadAtr',coalesce(billing_private.decimal_text(summary.average_load_atr),''),
   'billingAmount',coalesce(billing_private.decimal_text(summary.billing_amount),''),
   'billingPending',summary.missing_quotes>0,
   'pendingQuoteMonths',(SELECT count(*) FROM monthly WHERE missing_quotes>0),
   'expenseAmount','','expensesPending',true,'resultAmount',''
  ) FROM overall summary)
 )
$$;
REVOKE ALL ON FUNCTION billing_private.contract_monthly_summary(public.billing_contracts) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.contracts_company_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_company_id uuid;
 v_contract_id uuid;
 v_bucket text;
 v_open jsonb;
 v_finished jsonb;
 v_open_contracts jsonb;
 v_finished_contracts jsonb;
 v_contracts jsonb;
 v_result jsonb;
 v_contract public.billing_contracts%ROWTYPE;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR jsonb_typeof(p_payload->'companyId') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Selecione uma empresa cadastrada.' USING ERRCODE='22023';
 END IF;

 v_company_id=nullif(p_payload->>'companyId','')::uuid;
 IF v_company_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.billing_companies WHERE owner_id=v_owner AND id=v_company_id
 ) THEN RAISE EXCEPTION 'Selecione uma empresa cadastrada.' USING ERRCODE='22023'; END IF;

 IF p_action='list' THEN
  v_bucket=coalesce(nullif(p_payload->>'bucket',''),'open');
  IF v_bucket NOT IN ('open','finished') THEN RAISE EXCEPTION 'Confira os filtros dos contratos.' USING ERRCODE='22023'; END IF;
  v_open=billing_private.contracts_active_dispatch('list',p_payload||jsonb_build_object('bucket','open'));
  v_finished=billing_private.contracts_active_dispatch('list',p_payload||jsonb_build_object('bucket','finished'));
  SELECT coalesce(jsonb_agg(item.value),'[]'::jsonb) INTO v_open_contracts
   FROM jsonb_array_elements(v_open->'contracts') item WHERE item.value->>'companyId'=v_company_id::text;
  SELECT coalesce(jsonb_agg(item.value),'[]'::jsonb) INTO v_finished_contracts
   FROM jsonb_array_elements(v_finished->'contracts') item WHERE item.value->>'companyId'=v_company_id::text;
  v_contracts=CASE WHEN v_bucket='finished' THEN v_finished_contracts ELSE v_open_contracts END;
  RETURN jsonb_build_object('contracts',v_contracts,'counts',jsonb_build_object(
   'open',jsonb_array_length(v_open_contracts),'finished',jsonb_array_length(v_finished_contracts)
  ),'total',jsonb_array_length(v_contracts));
 END IF;

 IF p_action='get' THEN
  v_contract_id=nullif(p_payload->>'id','')::uuid;
 ELSIF p_action IN ('save-load','delete-load') THEN
  v_contract_id=nullif(p_payload->>'contractId','')::uuid;
 ELSIF p_action='save' THEN
  v_contract_id=nullif(p_payload->>'id','')::uuid;
 ELSE RAISE EXCEPTION 'Operação de contrato inválida.' USING ERRCODE='22023'; END IF;

 IF v_contract_id IS NOT NULL THEN
  SELECT * INTO v_contract FROM public.billing_contracts
   WHERE owner_id=v_owner AND id=v_contract_id AND company_id=v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado para a empresa ativa.' USING ERRCODE='P0002'; END IF;
 END IF;

 v_result=billing_private.contracts_active_dispatch(p_action,p_payload);
 IF p_action='get' THEN
  RETURN jsonb_set(v_result,'{contract,monthlySummary}',billing_private.contract_monthly_summary(v_contract),true);
 END IF;
 RETURN v_result;
EXCEPTION
 WHEN invalid_text_representation THEN RAISE EXCEPTION 'Informe identificadores válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.contracts_company_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.contracts_company_dispatch(text,jsonb) TO authenticated;

COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS 'Authenticated workspace RPC. Contract detail includes an owner- and company-scoped monthly volume, ATR and billing summary; expenses remain pending for the Finance module.';
