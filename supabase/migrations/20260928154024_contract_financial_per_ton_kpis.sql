-- Expose realized gross and net sale values per delivered tonne. The UI and
-- reports consume these values without duplicating financial arithmetic.
CREATE OR REPLACE FUNCTION billing_private.finance_metrics(
 p_volume numeric,p_atr numeric,p_gross numeric,p_discount numeric,
 p_advance numeric,p_receipt numeric,p_refund numeric
)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
  'loadedVolume',billing_private.decimal_text(p_volume),
  'averageAtr',coalesce(billing_private.decimal_text(p_atr),''),
  'grossAmount',coalesce(billing_private.decimal_text(p_gross),''),
  'grossPerTon',CASE WHEN p_gross IS NULL OR p_volume IS NULL OR p_volume=0 THEN '' ELSE billing_private.decimal_text(round(p_gross/p_volume,6)) END,
  'billingPending',p_gross IS NULL,
  'discountAmount',billing_private.decimal_text(p_discount),
  'netAmount',coalesce(billing_private.decimal_text(p_gross-p_discount),''),
  'netPerTon',CASE WHEN p_gross IS NULL OR p_volume IS NULL OR p_volume=0 THEN '' ELSE coalesce(billing_private.decimal_text(round((p_gross-p_discount)/p_volume,6)),'') END,
  'advanceAmount',billing_private.decimal_text(p_advance),
  'receiptAmount',billing_private.decimal_text(p_receipt),
  'refundedAmount',billing_private.decimal_text(p_refund),
  'receivedAmount',billing_private.decimal_text(p_advance+p_receipt-p_refund),
  'pendingAmount',CASE WHEN p_gross IS NULL THEN '' ELSE billing_private.decimal_text(greatest(p_gross-p_discount-p_advance-p_receipt+p_refund,0)) END,
  'creditAmount',CASE WHEN p_gross IS NULL THEN '' ELSE billing_private.decimal_text(greatest(p_advance+p_receipt-p_refund-(p_gross-p_discount),0)) END,
  'refundableAmount',CASE WHEN p_gross IS NULL THEN '' ELSE billing_private.decimal_text(greatest(least(
   p_advance-p_refund,
   p_advance+p_receipt-p_refund-(p_gross-p_discount)
  ),0)) END
 )
$$;
REVOKE ALL ON FUNCTION billing_private.finance_metrics(numeric,numeric,numeric,numeric,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;
