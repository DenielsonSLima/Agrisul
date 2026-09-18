-- Read the configured report identity without requiring request operators to
-- administer companies or headers. Company selection remains in Postgres.
CREATE FUNCTION billing_private.request_report_company_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT c.id FROM public.billing_companies c
 LEFT JOIN public.billing_report_headers h ON h.owner_id=c.owner_id
 WHERE c.owner_id=billing_private.current_owner_id() AND auth.uid() IS NOT NULL
  AND (billing_private.has_permission('requests.read') OR billing_private.has_permission('report-headers.read'))
 ORDER BY (c.id=h.default_company_id) DESC NULLS LAST,c.is_primary DESC,c.name,c.id LIMIT 1
$$;
CREATE FUNCTION billing_private.request_report_brand(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();v_header public.billing_report_headers;v_company jsonb;
BEGIN
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 IF NOT (billing_private.has_permission('requests.read') OR billing_private.has_permission('report-headers.read')) THEN
  RAISE EXCEPTION 'Você não tem permissão para consultar a identidade do documento.' USING ERRCODE='42501'; END IF;
 PERFORM billing_private.request_payload(p_payload,'{}');
 SELECT * INTO v_header FROM public.billing_report_headers WHERE owner_id=v_owner;
 SELECT billing_private.present(to_jsonb(c)) INTO v_company FROM public.billing_companies c
  WHERE c.owner_id=v_owner AND c.id=billing_private.request_report_company_id();
 RETURN jsonb_build_object('company',v_company,'header',jsonb_build_object(
  'variant',coalesce(v_header.portrait_variant,'detailed'),'logoAlignment',coalesce(v_header.portrait_logo_alignment,'left'),
  'showCnpj',coalesce(v_header.portrait_show_cnpj,true),'showContact',coalesce(v_header.portrait_show_contact,true)));
END $$;
CREATE FUNCTION billing_private.can_read_request_company_logo(p_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT billing_private.has_permission('requests.read') AND EXISTS(SELECT 1 FROM public.billing_companies c
  WHERE c.owner_id=billing_private.current_owner_id() AND c.id=billing_private.request_report_company_id() AND c.logo_key=p_path)
$$;
CREATE POLICY billing_request_report_header_read ON public.billing_report_headers FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'requests.read'));
CREATE POLICY billing_request_report_company_read ON public.billing_companies FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'requests.read') AND id=billing_private.request_report_company_id());
CREATE POLICY billing_request_report_logo_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='billing-company-logos' AND billing_private.can_read_request_company_logo(name));
REVOKE ALL ON FUNCTION billing_private.request_report_company_id(),billing_private.request_report_brand(jsonb),billing_private.can_read_request_company_logo(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.request_report_company_id(),billing_private.can_read_request_company_logo(text) TO authenticated;
DO $$
DECLARE v_definition text;v_marker text;
BEGIN
 SELECT pg_get_functiondef('billing_private.service_requests_dispatch(text,jsonb)'::regprocedure) INTO v_definition;
 v_marker=$marker$IF p_action IS NULL OR p_action NOT IN ($marker$;
 IF strpos(v_definition,v_marker)=0 THEN RAISE EXCEPTION 'Dispatcher de solicitações inesperado'; END IF;
 v_definition=replace(v_definition,v_marker,'IF p_action=''document-brand'' THEN RETURN billing_private.request_report_brand(p_payload); END IF;
 '||v_marker);
 EXECUTE v_definition;
END $$;
