-- One optional source PDF can accompany a quotation. The object remains in a
-- private bucket and the quotation RPC only accepts files already uploaded to
-- the current workspace folder.
ALTER TABLE public.billing_quotations
 ADD COLUMN attachment_key text,
 ADD COLUMN attachment_name text NOT NULL DEFAULT '',
 ADD COLUMN attachment_size bigint;

ALTER TABLE public.billing_quotations
 ADD CONSTRAINT billing_quotations_attachment CHECK(
  (attachment_key IS NULL AND attachment_name='' AND attachment_size IS NULL)
  OR (
   attachment_key IS NOT NULL
   AND length(attachment_key)<=500
   AND attachment_key LIKE owner_id::text || '/quotations/' || id::text || '/%.pdf'
   AND length(btrim(attachment_name)) BETWEEN 1 AND 255
   AND attachment_size BETWEEN 1 AND 10485760
  )
 );

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES(
 'billing-quotation-files','billing-quotation-files',false,10485760,
 ARRAY['application/pdf']
)
ON CONFLICT(id) DO UPDATE SET
 public=false,
 file_size_limit=excluded.file_size_limit,
 allowed_mime_types=excluded.allowed_mime_types;

CREATE POLICY billing_quotation_files_read ON storage.objects
 FOR SELECT TO authenticated USING(
  bucket_id='billing-quotation-files'
  AND billing_private.can_access_storage_owner(
   (storage.foldername(name))[1],'quotations.read'
  )
 );
CREATE POLICY billing_quotation_files_insert ON storage.objects
 FOR INSERT TO authenticated WITH CHECK(
  bucket_id='billing-quotation-files'
  AND storage.extension(name)='pdf'
  AND billing_private.can_access_storage_owner(
   (storage.foldername(name))[1],'quotations.write'
  )
 );
CREATE POLICY billing_quotation_files_delete ON storage.objects
 FOR DELETE TO authenticated USING(
  bucket_id='billing-quotation-files'
  AND billing_private.can_access_storage_owner(
   (storage.foldername(name))[1],'quotations.write'
  )
 );

ALTER FUNCTION billing_private.quotation_json(public.billing_quotations)
 RENAME TO quotation_json_before_pdf_attachment;
REVOKE ALL ON FUNCTION billing_private.quotation_json_before_pdf_attachment(
 public.billing_quotations
) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotation_json(
 p_quote public.billing_quotations
) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT billing_private.quotation_json_before_pdf_attachment(p_quote)
  || jsonb_build_object(
   'attachmentKey',p_quote.attachment_key,
   'attachmentName',p_quote.attachment_name,
   'attachmentSize',p_quote.attachment_size
  )
$$;
REVOKE ALL ON FUNCTION billing_private.quotation_json(public.billing_quotations)
 FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 RENAME TO quotations_dispatch_before_pdf_attachment;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch_before_pdf_attachment(
 text,text,jsonb
) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.quotations_dispatch(
 p_resource text,p_action text,p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_quote_id uuid;
 v_attachment_key text;
 v_attachment_name text;
 v_attachment_size bigint;
 v_result jsonb;
 v_quote public.billing_quotations;
BEGIN
 IF p_resource<>'quotations' OR p_action NOT IN ('save','delete') THEN
  RETURN billing_private.quotations_dispatch_before_pdf_attachment(
   p_resource,p_action,p_payload
  );
 END IF;
 IF v_owner IS NULL OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
  RAISE EXCEPTION 'Dados da cotação inválidos.' USING ERRCODE='22023';
 END IF;

 PERFORM billing_private.lock_request_actor();
 v_owner=billing_private.current_owner_id();
 PERFORM billing_private.authorize('quotations.write');
 v_quote_id=nullif(btrim(p_payload->>'id'),'')::uuid;

 IF p_action='delete' THEN
  SELECT q.attachment_key INTO v_attachment_key
  FROM public.billing_quotations q
  WHERE q.owner_id=v_owner AND q.id=v_quote_id;
  v_result=billing_private.quotations_dispatch_before_pdf_attachment(
   p_resource,p_action,p_payload
  );
  RETURN v_result || jsonb_build_object('attachmentKey',v_attachment_key);
 END IF;

 IF NOT (
  p_payload ? 'attachmentKey'
  OR p_payload ? 'attachmentName'
  OR p_payload ? 'attachmentSize'
 ) THEN
  RETURN billing_private.quotations_dispatch_before_pdf_attachment(
   p_resource,p_action,p_payload
  );
 END IF;
 IF v_quote_id IS NULL
  OR jsonb_typeof(p_payload->'attachmentKey') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'attachmentName') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'attachmentSize') IS DISTINCT FROM 'number' THEN
  RAISE EXCEPTION 'Selecione um arquivo PDF válido.' USING ERRCODE='22023';
 END IF;
 v_attachment_key=btrim(p_payload->>'attachmentKey');
 v_attachment_name=btrim(p_payload->>'attachmentName');
 v_attachment_size=(p_payload->>'attachmentSize')::bigint;
 IF length(v_attachment_key)>500
  OR length(v_attachment_name) NOT BETWEEN 1 AND 255
  OR v_attachment_size NOT BETWEEN 1 AND 10485760
  OR v_attachment_key NOT LIKE
   v_owner::text || '/quotations/' || v_quote_id::text || '/%.pdf'
  OR NOT EXISTS(
   SELECT 1 FROM storage.objects o
   WHERE o.bucket_id='billing-quotation-files' AND o.name=v_attachment_key
  ) THEN
  RAISE EXCEPTION 'Envie um arquivo PDF válido para este espaço antes de salvar.'
   USING ERRCODE='23514';
 END IF;

 v_result=billing_private.quotations_dispatch_before_pdf_attachment(
  p_resource,p_action,
  p_payload-ARRAY['attachmentKey','attachmentName','attachmentSize']
 );
 UPDATE public.billing_quotations q SET
  attachment_key=v_attachment_key,
  attachment_name=v_attachment_name,
  attachment_size=v_attachment_size
 WHERE q.owner_id=v_owner AND q.id=v_quote_id
 RETURNING * INTO v_quote;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE='P0002';
 END IF;
 RETURN jsonb_set(
  v_result,'{quote}',billing_private.quotation_json(v_quote),false
 );
EXCEPTION
 WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Selecione um arquivo PDF válido.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb)
 TO authenticated;

COMMENT ON COLUMN public.billing_quotations.attachment_key IS
 'Private billing-quotation-files object path, scoped to workspace and quotation.';
COMMENT ON FUNCTION billing_private.quotation_json(public.billing_quotations) IS
 'Owner-scoped quotation projection including optional private PDF metadata.';
COMMENT ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb) IS
 'Routes quotations and atomically links an optional validated private PDF during creation.';
