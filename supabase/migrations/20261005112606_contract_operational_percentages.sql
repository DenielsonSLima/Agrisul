-- Percentages use each contract's commercial quantity, independently of the
-- common tonne scale used by the report's comparative bars. Keep excess visible.
CREATE OR REPLACE FUNCTION billing_private.present_contract(p_contract public.billing_contracts) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (billing_private.present(to_jsonb(p_contract))-'contract_number') || jsonb_build_object(
  'contractNumber',p_contract.contract_number,
  'companyName',coalesce(company.name,''),
  'companyCnpj',coalesce(company.cnpj,''),
  'clientName',client.legal_name,
  'clientCnpj',client.cnpj,
  'startDate',coalesce(p_contract.start_date::text,''),
  'endDate',coalesce(p_contract.end_date::text,''),
  'contractedVolume',billing_private.decimal_text(p_contract.contracted_volume),
  'atrPriceType',p_contract.atr_price_type,
  'atrPeriodType',p_contract.atr_period_type,
  'value',coalesce(billing_private.decimal_text(p_contract.value),''),
  'loadedVolume',summary.data->'totals'->>'loadedVolume',
  'remainingVolume',summary.data->'totals'->>'remainingVolume',
  'operationalPercentages',jsonb_build_object(
   'contracted',CASE WHEN p_contract.contracted_volume>0 THEN '100' ELSE '' END,
   'loaded',coalesce(billing_private.decimal_text(round(
    (summary.data->'totals'->>'loadedVolume')::numeric*100/nullif(p_contract.contracted_volume,0),2)),''),
   'remaining',coalesce(billing_private.decimal_text(round(
    (summary.data->'totals'->>'remainingVolume')::numeric*100/nullif(p_contract.contracted_volume,0),2)),'')
  ),
  'averageAtr',summary.data->'totals'->>'averageLoadAtr',
  'billingAmount',summary.data->'totals'->>'billingAmount',
  'billingPending',(summary.data->'totals'->>'billingPending')::boolean
 )
 FROM public.billing_clients client
 LEFT JOIN public.billing_companies company ON company.owner_id=p_contract.owner_id AND company.id=p_contract.company_id
 CROSS JOIN LATERAL (SELECT billing_private.contract_monthly_summary(p_contract) data) summary
 WHERE client.owner_id=p_contract.owner_id AND client.id=p_contract.client_id
$$;
REVOKE ALL ON FUNCTION billing_private.present_contract(public.billing_contracts) FROM PUBLIC,anon,authenticated;
