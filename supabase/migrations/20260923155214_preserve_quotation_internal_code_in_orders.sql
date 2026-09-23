-- A purchase order must inherit the immutable internal-code snapshot from the
-- quotation, not read the potentially edited material catalog at finalization.
DO $$
DECLARE
 v_definition text;
 v_live_catalog_expression text:=
  'i.material_id,i.material_name,coalesce(m.code,''''),i.material_application';
 v_snapshot_expression text:=
  'i.material_id,i.material_name,i.material_code,i.material_application';
BEGIN
 SELECT pg_get_functiondef(
  'billing_private.create_purchase_order_from_quotation(uuid,uuid,uuid)'::regprocedure
 ) INTO v_definition;
 IF strpos(v_definition,v_live_catalog_expression)=0 THEN
  RAISE EXCEPTION 'Unexpected purchase-order snapshot function definition';
 END IF;
 v_definition=replace(
  v_definition,v_live_catalog_expression,v_snapshot_expression);
 EXECUTE v_definition;
END $$;

REVOKE ALL ON FUNCTION billing_private.create_purchase_order_from_quotation(
 uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;

COMMENT ON COLUMN public.billing_purchase_order_items.material_internal_code IS
 'Immutable internal product code copied from the quotation item snapshot.';
