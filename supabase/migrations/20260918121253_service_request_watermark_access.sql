-- Reading a service request includes its configured document identity. It does
-- not grant access to modify that identity or another workspace's files.
CREATE OR REPLACE FUNCTION billing_private.authorize_resource(p_resource text,p_action text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_permission text;
BEGIN
 IF p_resource IN ('watermark','watermarks') AND p_action IN ('get','list')
   AND auth.uid() IS NOT NULL AND billing_private.has_permission('requests.read') THEN
  RETURN;
 END IF;
 v_permission=CASE
  WHEN p_resource='companies' THEN 'companies.'||CASE WHEN p_action IN ('get','list') THEN 'read' ELSE 'write' END
  WHEN p_resource IN ('clients','atr','farms','plots','contract-types','cultures','cultural-practices') THEN 'registrations.'||CASE WHEN p_action IN ('get','list') THEN 'read' ELSE 'write' END
  WHEN p_resource='contracts' THEN 'contracts.'||CASE WHEN p_action IN ('get','list') THEN 'read' ELSE 'write' END
  WHEN p_resource IN ('watermark','watermarks') THEN 'watermarks.'||CASE WHEN p_action IN ('get','list') THEN 'read' ELSE 'write' END
  ELSE NULL END;
 IF v_permission IS NOT NULL THEN PERFORM billing_private.authorize(v_permission); END IF;
END $$;
REVOKE ALL ON FUNCTION billing_private.authorize_resource(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.authorize_resource(text,text) TO authenticated;

-- SELECT lets the existing Realtime subscription invalidate the watermark
-- query for request operators. All direct DML remains revoked.
CREATE POLICY billing_request_watermark_read ON public.billing_watermarks
 FOR SELECT TO authenticated USING(billing_private.can_access_owner(owner_id,'requests.read'));
CREATE POLICY billing_request_watermark_files_read ON storage.objects
 FOR SELECT TO authenticated USING(bucket_id='billing-watermarks'
  AND billing_private.can_access_storage_owner((storage.foldername(name))[1],'requests.read'));
