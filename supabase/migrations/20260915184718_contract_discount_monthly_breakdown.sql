-- Expose the existing per-agreement, per-month calculation for screens and reports.
-- Keep monthly rounding, contract ownership and all aggregate amounts unchanged.
CREATE OR REPLACE FUNCTION billing_private.contract_financial_summary(p_contract public.billing_contracts)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH production AS (
  SELECT billing_private.contract_monthly_summary(p_contract) data
 ), loads AS (
  SELECT (item->>'month')||'-01' month_key,item
  FROM production,jsonb_array_elements(data->'months') item
 ), discount_months AS (
  SELECT d.id,m.month_start,coalesce(sum(l.volume),0) volume,
   round(coalesce(sum(l.volume),0)*d.rate_per_ton,2) amount
  FROM public.billing_contract_discounts d
  CROSS JOIN LATERAL unnest(d.months) m(month_start)
  LEFT JOIN public.billing_contract_loads l ON l.owner_id=d.owner_id AND l.contract_id=d.contract_id
   AND l.loaded_at>=m.month_start AND l.loaded_at<m.month_start+interval '1 month'
  WHERE d.owner_id=p_contract.owner_id AND d.contract_id=p_contract.id
  GROUP BY d.id,m.month_start
 ), payments AS (
  SELECT * FROM public.billing_contract_payments WHERE owner_id=p_contract.owner_id AND contract_id=p_contract.id
 ), calendar AS (
  SELECT month_key::date month_start FROM loads
  UNION SELECT reference_month FROM payments
  UNION SELECT month_start FROM discount_months
  UNION SELECT date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo')::date
 ), monthly AS (
  SELECT calendar.month_start,
   coalesce((loads.item->>'loadedVolume')::numeric,0) volume,
   nullif(loads.item->>'averageLoadAtr','')::numeric atr,
   CASE WHEN (loads.item->>'billingPending')::boolean THEN NULL ELSE coalesce((loads.item->>'billingAmount')::numeric,0) END gross,
   coalesce((SELECT sum(amount) FROM discount_months d WHERE d.month_start=calendar.month_start),0) discount,
   coalesce((SELECT sum(amount) FROM payments p WHERE p.reference_month=calendar.month_start AND p.kind='advance'),0) advance,
   coalesce((SELECT sum(amount) FROM payments p WHERE p.reference_month=calendar.month_start AND p.kind='receipt'),0) receipt
  FROM calendar LEFT JOIN loads ON loads.month_key=calendar.month_start::text
 )
 SELECT jsonb_build_object(
  'months',(SELECT jsonb_agg(jsonb_build_object('month',to_char(month_start,'YYYY-MM'))||billing_private.finance_metrics(volume,atr,gross,discount,advance,receipt) ORDER BY month_start) FROM monthly),
  'totals',(SELECT billing_private.finance_metrics(sum(volume),
    (SELECT nullif(data->'totals'->>'averageLoadAtr','')::numeric FROM production),
    CASE WHEN count(*) FILTER(WHERE gross IS NULL)>0 THEN NULL ELSE sum(gross) END,
    sum(discount),sum(advance),sum(receipt)) FROM monthly),
  'emptyMonth',billing_private.finance_metrics(0,NULL,0,0,0,0),
  'payments',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',id,'requestId',request_id,'kind',kind,'receivedAt',received_at::text,'referenceMonth',to_char(reference_month,'YYYY-MM'),
   'amount',billing_private.decimal_text(amount),'document',document,'notes',notes,'revision',revision
  ) ORDER BY received_at DESC,created_at DESC,id) FROM payments),'[]'::jsonb),
  'discounts',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',d.id,'requestId',d.request_id,'title',d.title,'ratePerTon',billing_private.decimal_text(d.rate_per_ton),
   'months',(SELECT jsonb_agg(to_char(m,'YYYY-MM') ORDER BY m) FROM unnest(d.months) m),
   'notes',d.notes,'revision',d.revision,
   'loadedVolume',(SELECT billing_private.decimal_text(sum(volume)) FROM discount_months WHERE id=d.id),
   'amount',(SELECT billing_private.decimal_text(sum(amount)) FROM discount_months WHERE id=d.id),
   'monthlyBreakdown',(SELECT jsonb_agg(jsonb_build_object(
    'month',to_char(month_start,'YYYY-MM'),
    'loadedVolume',billing_private.decimal_text(volume),
    'amount',billing_private.decimal_text(amount)
   ) ORDER BY month_start) FROM discount_months WHERE id=d.id)
  ) ORDER BY d.created_at DESC,d.id) FROM public.billing_contract_discounts d WHERE d.owner_id=p_contract.owner_id AND d.contract_id=p_contract.id),'[]'::jsonb)
 )
$$;
REVOKE ALL ON FUNCTION billing_private.contract_financial_summary(public.billing_contracts) FROM PUBLIC,anon,authenticated;
