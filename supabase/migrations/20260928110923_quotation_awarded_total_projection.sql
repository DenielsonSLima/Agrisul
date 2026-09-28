ALTER FUNCTION billing_private.quotation_json(public.billing_quotations)
 RENAME TO quotation_json_before_awarded_total;
REVOKE ALL ON FUNCTION billing_private.quotation_json_before_awarded_total(
 public.billing_quotations
) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotation_json(
 p_quote public.billing_quotations
) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT billing_private.quotation_json_before_awarded_total(p_quote)
  || jsonb_build_object(
   'awardedTotal',billing_private.decimal_text(coalesce((
    SELECT sum(billing_private.quotation_line_total(
     i.quantity,qv.unit_price,qv.discount_type,qv.discount_value
    ))
    FROM public.billing_quotation_item_awards a
    JOIN public.billing_quotation_items i
     ON i.owner_id=a.owner_id AND i.quotation_id=a.quotation_id
     AND i.id=a.quotation_item_id
    JOIN public.billing_quotation_provider_values qv
     ON qv.owner_id=a.owner_id AND qv.quotation_id=a.quotation_id
     AND qv.quotation_provider_id=a.quotation_provider_id
     AND qv.quotation_item_id=a.quotation_item_id
    WHERE a.owner_id=p_quote.owner_id AND a.quotation_id=p_quote.id
   ),0::numeric))
  )
$$;
REVOKE ALL ON FUNCTION billing_private.quotation_json(public.billing_quotations)
 FROM PUBLIC,anon,authenticated;

COMMENT ON FUNCTION billing_private.quotation_json(public.billing_quotations) IS
 'Owner-scoped quotation projection. Item discounts, supplier totals and the overall awarded total are calculated in Postgres.';
