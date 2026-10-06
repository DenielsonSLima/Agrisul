-- Storage RLS must enforce the same first-login gate as billing_rpc. Keep this
-- predicate read-only: temporary_password_change_required() updates its row
-- and locks it, so it is unsuitable for a policy evaluated during SELECT.
CREATE FUNCTION billing_private.temporary_password_ready_for_storage()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM billing_private.password_change_requirements requirement
  JOIN auth.users auth_user ON auth_user.id=requirement.user_id
  WHERE requirement.user_id=auth.uid()
   AND requirement.completed_at IS NULL
   AND auth_user.encrypted_password IS NOT DISTINCT FROM requirement.password_hash_at_issue
 )
$$;
REVOKE ALL ON FUNCTION billing_private.temporary_password_ready_for_storage()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.temporary_password_ready_for_storage()
 TO authenticated;

-- Restrictive policies are ANDed with every existing permissive policy. This
-- closes alternate request/report file policies without changing their normal
-- workspace and permission checks. Other buckets are unaffected.
CREATE POLICY billing_storage_temporary_password_gate ON storage.objects
 AS RESTRICTIVE FOR ALL TO authenticated
 USING (
  bucket_id NOT IN (
   'billing-company-logos','billing-watermarks','billing-signatures',
   'billing-request-files','billing-material-images','billing-quotation-files'
  ) OR billing_private.temporary_password_ready_for_storage()
 )
 WITH CHECK (
  bucket_id NOT IN (
   'billing-company-logos','billing-watermarks','billing-signatures',
   'billing-request-files','billing-material-images','billing-quotation-files'
  ) OR billing_private.temporary_password_ready_for_storage()
 );
