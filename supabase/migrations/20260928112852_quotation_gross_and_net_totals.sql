ALTER FUNCTION billing_private.quotation_json(public.billing_quotations)
 RENAME TO quotation_json_before_gross_and_net_totals;
REVOKE ALL ON FUNCTION billing_private.quotation_json_before_gross_and_net_totals(
 public.billing_quotations
) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotation_json(
 p_quote public.billing_quotations
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE
 v_result jsonb:=billing_private.quotation_json_before_gross_and_net_totals(p_quote);
 v_providers jsonb;
 v_awarded_gross_total numeric;
BEGIN
 WITH provider_totals AS (
  SELECT qp.id,
   coalesce(sum(i.quantity*qv.unit_price),0::numeric) AS gross_total,
   coalesce(sum(i.quantity*qv.unit_price)
    FILTER(WHERE a.quotation_item_id IS NOT NULL),0::numeric) AS awarded_gross_total
  FROM public.billing_quotation_providers qp
  LEFT JOIN public.billing_quotation_provider_values qv
   ON qv.owner_id=qp.owner_id AND qv.quotation_id=qp.quotation_id
   AND qv.quotation_provider_id=qp.id
  LEFT JOIN public.billing_quotation_items i
   ON i.owner_id=qv.owner_id AND i.quotation_id=qv.quotation_id
   AND i.id=qv.quotation_item_id
  LEFT JOIN public.billing_quotation_item_awards a
   ON a.owner_id=qv.owner_id AND a.quotation_id=qv.quotation_id
   AND a.quotation_provider_id=qv.quotation_provider_id
   AND a.quotation_item_id=qv.quotation_item_id
  WHERE qp.owner_id=p_quote.owner_id AND qp.quotation_id=p_quote.id
  GROUP BY qp.id
 )
 SELECT coalesce(jsonb_agg(entry.value || jsonb_build_object(
  'grossTotal',billing_private.decimal_text(totals.gross_total),
  'awardedGrossTotal',billing_private.decimal_text(totals.awarded_gross_total)
 ) ORDER BY entry.position),'[]'::jsonb) INTO v_providers
 FROM jsonb_array_elements(v_result->'providers') WITH ORDINALITY entry(value,position)
 JOIN provider_totals totals ON totals.id=(entry.value->>'id')::uuid;

 SELECT coalesce(sum(i.quantity*qv.unit_price),0::numeric)
 INTO v_awarded_gross_total
 FROM public.billing_quotation_item_awards a
 JOIN public.billing_quotation_items i
  ON i.owner_id=a.owner_id AND i.quotation_id=a.quotation_id
  AND i.id=a.quotation_item_id
 JOIN public.billing_quotation_provider_values qv
  ON qv.owner_id=a.owner_id AND qv.quotation_id=a.quotation_id
  AND qv.quotation_provider_id=a.quotation_provider_id
  AND qv.quotation_item_id=a.quotation_item_id
 WHERE a.owner_id=p_quote.owner_id AND a.quotation_id=p_quote.id;

 RETURN v_result || jsonb_build_object(
  'providers',v_providers,
  'awardedGrossTotal',billing_private.decimal_text(v_awarded_gross_total)
 );
END $$;
REVOKE ALL ON FUNCTION billing_private.quotation_json(public.billing_quotations)
 FROM PUBLIC,anon,authenticated;

COMMENT ON FUNCTION billing_private.quotation_json(public.billing_quotations) IS
 'Owner-scoped quotation projection. Gross and discounted supplier and awarded totals are calculated in Postgres.';
