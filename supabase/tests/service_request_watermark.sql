BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('74000000-0000-4000-8000-000000000001','watermark-owner@example.invalid'),
 ('74000000-0000-4000-8000-000000000002','watermark-operator@example.invalid'),
 ('74000000-0000-4000-8000-000000000003','watermark-other@example.invalid');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','74000000-0000-4000-8000-000000000001',true);
SELECT public.billing_rpc('settings','get','{}');
SELECT set_config('request.jwt.claim.sub','74000000-0000-4000-8000-000000000003',true);
SELECT public.billing_rpc('settings','get','{}');
RESET ROLE;
INSERT INTO public.billing_access_profiles(id,owner_id,name,permissions) VALUES
 ('74000000-0000-4000-8000-000000000004','74000000-0000-4000-8000-000000000001','Request reader',ARRAY['requests.read']);
INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,is_owner,status) VALUES
 ('74000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000004',false,'active');
INSERT INTO public.billing_watermarks(owner_id,orientation,opacity,size,portrait_image_key,portrait_image_name) VALUES
 ('74000000-0000-4000-8000-000000000001','landscape',23,71,'74000000-0000-4000-8000-000000000001/portrait/test.png','Original.png'),
 ('74000000-0000-4000-8000-000000000003','portrait',47,50,'74000000-0000-4000-8000-000000000003/portrait/other.png','Other.png');
INSERT INTO storage.objects(bucket_id,name) VALUES
 ('billing-watermarks','74000000-0000-4000-8000-000000000001/portrait/test.png'),
 ('billing-watermarks','74000000-0000-4000-8000-000000000003/portrait/other.png');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','74000000-0000-4000-8000-000000000002',true);
DO $$ DECLARE v_settings jsonb; BEGIN
 v_settings=public.billing_rpc('watermarks','get','{}')->'settings';
 IF v_settings->>'opacity'<>'23' OR v_settings->>'size'<>'71' OR v_settings->>'portraitImageName'<>'Original.png' THEN RAISE EXCEPTION 'Request reader did not receive workspace watermark'; END IF;
 IF public.billing_rpc('watermark','list','{}')->'settings'<>v_settings THEN RAISE EXCEPTION 'Legacy watermark alias differs'; END IF;
 IF public.billing_rpc('watermarks','get','{"owner_id":"74000000-0000-4000-8000-000000000003"}')->'settings'<>v_settings THEN RAISE EXCEPTION 'Payload selected foreign watermark'; END IF;
 IF (SELECT count(*) FROM public.billing_watermarks)<>1 THEN RAISE EXCEPTION 'Realtime SELECT is not isolated'; END IF;
 IF (SELECT count(*) FROM storage.objects WHERE bucket_id='billing-watermarks')<>1 THEN RAISE EXCEPTION 'Storage access is not isolated'; END IF;
 BEGIN PERFORM public.billing_rpc('watermarks','save',v_settings); RAISE EXCEPTION 'Request reader edited watermark'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.billing_rpc('watermarks','delete','{}'); RAISE EXCEPTION 'Request reader deleted watermark'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.billing_watermarks SET opacity=100; RAISE EXCEPTION 'Direct DML allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('billing-watermarks','74000000-0000-4000-8000-000000000001/new.png'); RAISE EXCEPTION 'Storage write allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.billing_access_profiles SET permissions=ARRAY[]::text[] WHERE id='74000000-0000-4000-8000-000000000004';
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.billing_rpc('watermarks','get','{}'); RAISE EXCEPTION 'Revoked reader still has RPC access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.billing_watermarks) OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='billing-watermarks') THEN RAISE EXCEPTION 'Revoked reader still has SELECT access'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
