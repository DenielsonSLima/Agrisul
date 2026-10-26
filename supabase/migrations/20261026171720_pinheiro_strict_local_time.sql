BEGIN;
-- Reject 24:00 before PostgreSQL can normalize it to the following day. Source
-- dates and hours are projected separately, so normalization would corrupt them.
CREATE OR REPLACE FUNCTION billing_private.pinheiro_local_minute(p_value text)
RETURNS timestamp without time zone LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF p_value IS NULL OR p_value!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RETURN NULL; END IF;
 RETURN replace(p_value,'T',' ')::timestamp without time zone;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION billing_private.pinheiro_local_minute(text) FROM PUBLIC,anon,authenticated;
COMMIT;
