-- Quotations reuse the existing Cadastros permissions. Later attachment and
-- quantity wrappers accidentally required quotations.*, which is not part of
-- the access-profile catalog and denies legitimate non-owner writers.
-- Keep every existing authorization check, ownership check, lock and ACL.
DO $$
DECLARE
 v_target regprocedure;
 v_definition text;
BEGIN
 FOREACH v_target IN ARRAY ARRAY[
  'billing_private.quotations_dispatch_before_item_quantity_update(text,text,jsonb)'::regprocedure,
  'billing_private.quotations_dispatch_before_pdf_create_flow(text,text,jsonb)'::regprocedure,
  'billing_private.quotations_dispatch_before_available_quantity(text,text,jsonb)'::regprocedure
 ] LOOP
  SELECT pg_get_functiondef(v_target) INTO v_definition;
  IF strpos(v_definition,'billing_private.authorize(''quotations.write'')')>0 THEN
   v_definition=replace(v_definition,
    'billing_private.authorize(''quotations.write'')',
    'billing_private.authorize(''registrations.write'')');
   EXECUTE v_definition;
  ELSIF strpos(v_definition,'billing_private.authorize(''registrations.write'')')=0 THEN
   RAISE EXCEPTION 'Unexpected quotation authorization in %',v_target;
  END IF;
 END LOOP;
END $$;

ALTER POLICY billing_quotation_files_read ON storage.objects
 USING(
  bucket_id='billing-quotation-files'
  AND billing_private.can_access_storage_owner(
   (storage.foldername(name))[1],'registrations.read'
  )
 );

ALTER POLICY billing_quotation_files_insert ON storage.objects
 WITH CHECK(
  bucket_id='billing-quotation-files'
  AND storage.extension(name)='pdf'
  AND billing_private.can_access_storage_owner(
   (storage.foldername(name))[1],'registrations.write'
  )
 );

ALTER POLICY billing_quotation_files_delete ON storage.objects
 USING(
  bucket_id='billing-quotation-files'
  AND billing_private.can_access_storage_owner(
   (storage.foldername(name))[1],'registrations.write'
  )
 );
