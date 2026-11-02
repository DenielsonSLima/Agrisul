-- Count both period endpoints; when months tie, use the latest month.
CREATE FUNCTION billing_private.overtime_reference_month(p_from date,p_to date)
RETURNS date LANGUAGE plpgsql IMMUTABLE STRICT SET search_path='' AS $$
DECLARE result date;
BEGIN
 IF p_to<p_from THEN
  RAISE EXCEPTION 'A data final deve ser igual ou posterior à inicial.' USING ERRCODE='22023';
 END IF;
 SELECT month_start::date INTO result
 FROM pg_catalog.generate_series(
  pg_catalog.date_trunc('month',p_from::timestamp),
  pg_catalog.date_trunc('month',p_to::timestamp),interval '1 month'
 ) AS months(month_start)
 ORDER BY (least(p_to,(month_start+interval '1 month - 1 day')::date)-greatest(p_from,month_start::date)+1) DESC,
  month_start DESC LIMIT 1;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION billing_private.overtime_reference_month(date,date) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.set_overtime_reference_month()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 NEW.reference_month=billing_private.overtime_reference_month(NEW.date_from,NEW.date_to);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION billing_private.set_overtime_reference_month() FROM PUBLIC,anon,authenticated;

CREATE TRIGGER billing_overtime_reference_month
 BEFORE INSERT OR UPDATE OF date_from,date_to,reference_month ON public.billing_overtime_reports
 FOR EACH ROW EXECUTE FUNCTION billing_private.set_overtime_reference_month();

-- Existing reports, including finalized ones, follow the same period rule.
UPDATE public.billing_overtime_reports
 SET reference_month=billing_private.overtime_reference_month(date_from,date_to)
 WHERE reference_month IS DISTINCT FROM billing_private.overtime_reference_month(date_from,date_to);
