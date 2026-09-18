SAVEPOINT request_header_test;
RESET ROLE;
INSERT INTO public.billing_companies(id,owner_id,name,legal_name,is_primary,logo_key) VALUES
 ('72000000-0000-4000-8000-000000000061','72000000-0000-4000-8000-000000000001','Primary fixture','Primary fixture',true,'72000000-0000-4000-8000-000000000001/companies/primary.png'),
 ('72000000-0000-4000-8000-000000000062','72000000-0000-4000-8000-000000000001','Selected fixture','Selected fixture',false,'72000000-0000-4000-8000-000000000001/companies/selected.png');
INSERT INTO public.billing_report_headers(owner_id,orientation,default_company_id,portrait_variant,portrait_logo_alignment,portrait_show_contact,landscape_variant)
 VALUES('72000000-0000-4000-8000-000000000001','landscape','72000000-0000-4000-8000-000000000062','detailed','right',false,'compact')
 ON CONFLICT(owner_id) DO UPDATE SET orientation=EXCLUDED.orientation,default_company_id=EXCLUDED.default_company_id,portrait_variant=EXCLUDED.portrait_variant,portrait_logo_alignment=EXCLUDED.portrait_logo_alignment,portrait_show_contact=EXCLUDED.portrait_show_contact,landscape_variant=EXCLUDED.landscape_variant;
INSERT INTO storage.objects(bucket_id,name) VALUES
 ('billing-company-logos','72000000-0000-4000-8000-000000000001/companies/primary.png'),
 ('billing-company-logos','72000000-0000-4000-8000-000000000001/companies/selected.png');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000002',true);
DO $$ DECLARE v_brand jsonb; BEGIN
 v_brand=public.billing_rpc('service-requests','document-brand','{}');
 IF v_brand->'company'->>'id'<>'72000000-0000-4000-8000-000000000062' THEN RAISE EXCEPTION 'Header must prefer configured company'; END IF;
 IF v_brand->'header'<>'{"variant":"detailed","logoAlignment":"right","showCnpj":true,"showContact":false}'::jsonb THEN RAISE EXCEPTION 'Header must use portrait settings'; END IF;
 IF (SELECT count(*) FROM public.billing_companies)<>1 OR (SELECT count(*) FROM public.billing_report_headers)<>1 THEN RAISE EXCEPTION 'Request reader must see only selected company and own header'; END IF;
 IF (SELECT count(*) FROM storage.objects WHERE bucket_id='billing-company-logos')<>1 THEN RAISE EXCEPTION 'Request reader has excessive logo access'; END IF;
 BEGIN PERFORM public.billing_rpc('service-requests','document-brand','{"owner_id":"72000000-0000-4000-8000-000000000003"}'); RAISE EXCEPTION 'Forged owner accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.billing_rpc('report-headers','save','{}'); RAISE EXCEPTION 'Request reader can change header'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.billing_report_headers SET portrait_variant='compact'; RAISE EXCEPTION 'Header direct DML allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
 IF public.billing_rpc('service-requests','document-brand','{}')->'company'<>'null'::jsonb THEN RAISE EXCEPTION 'Other workspace received company'; END IF;
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='billing-company-logos') THEN RAISE EXCEPTION 'Foreign logo exposed'; END IF;
END $$;
RESET ROLE;
UPDATE public.billing_report_headers SET default_company_id=NULL WHERE owner_id='72000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 IF public.billing_rpc('service-requests','document-brand','{}')->'company'->>'id'<>'72000000-0000-4000-8000-000000000061' THEN RAISE EXCEPTION 'Missing primary fallback'; END IF;
END $$;
RESET ROLE;
UPDATE public.billing_access_profiles SET permissions=ARRAY[]::text[] WHERE id='72000000-0000-4000-8000-000000000011';
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.billing_rpc('service-requests','document-brand','{}'); RAISE EXCEPTION 'Revoked reader still has access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.billing_companies) OR EXISTS(SELECT 1 FROM public.billing_report_headers) OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='billing-company-logos') THEN RAISE EXCEPTION 'Revoked reader retains SELECT access'; END IF;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT request_header_test;
