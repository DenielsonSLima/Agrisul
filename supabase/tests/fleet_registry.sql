BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('96000000-0000-4000-8000-000000000001','fleet-owner@example.invalid',now()),
 ('96000000-0000-4000-8000-000000000002','fleet-other@example.invalid',now()),
 ('96000000-0000-4000-8000-000000000003','fleet-reader@example.invalid',now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000001',true);
SELECT public.billing_rpc('settings','get','{}');
DO $$
DECLARE r jsonb;vehicle_id uuid;
BEGIN
 r=public.billing_rpc('fleet','save','{"internalCode":"CAM-001","model":"FH 540 6x4","brand":"Volvo","description":""}');
 vehicle_id=(r->'vehicle'->>'id')::uuid;
 IF r->'vehicle'->>'internalCode'<>'CAM-001' OR r->'vehicle'->>'model'<>'FH 540 6x4'
  OR r->'vehicle'->>'brand'<>'Volvo' OR r->'vehicle'->>'description'<>'' THEN
  RAISE EXCEPTION 'Fleet vehicle envelope is invalid: %',r;
 END IF;
 r=public.billing_rpc('fleet','list','{}');
 IF jsonb_array_length(r->'vehicles')<>1 OR NOT (r->>'canManage')::boolean THEN
  RAISE EXCEPTION 'Fleet list is invalid: %',r;
 END IF;
 BEGIN
  PERFORM public.billing_rpc('fleet','save','{"internalCode":"CAM-001","model":"Outro modelo","brand":"Scania","description":""}');
  RAISE EXCEPTION 'Duplicate fleet internal code was accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 PERFORM set_config('test.fleet.vehicle',vehicle_id::text,true);
END $$;

SELECT set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000002',true);
SELECT public.billing_rpc('settings','get','{}');
DO $$
DECLARE r jsonb;foreign_id uuid:=current_setting('test.fleet.vehicle')::uuid;
BEGIN
 r=public.billing_rpc('fleet','list','{}');
 IF jsonb_array_length(r->'vehicles')<>0 OR EXISTS(SELECT 1 FROM public.billing_fleet_vehicles) THEN
  RAISE EXCEPTION 'Fleet workspace isolation failed';
 END IF;
 BEGIN
  PERFORM public.billing_rpc('fleet','get',jsonb_build_object('id',foreign_id));
  RAISE EXCEPTION 'Foreign fleet vehicle was exposed';
 EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;

RESET ROLE;
INSERT INTO public.billing_access_profiles(id,owner_id,name,description,permissions)
VALUES('96000000-0000-4000-8000-000000000010','96000000-0000-4000-8000-000000000001','Leitor de frota','',ARRAY['registrations.read']);
INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,is_owner,status)
VALUES('96000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000003','96000000-0000-4000-8000-000000000010',false,'active');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000003',true);
DO $$
DECLARE r jsonb;
BEGIN
 r=public.billing_rpc('fleet','list','{}');
 IF jsonb_array_length(r->'vehicles')<>1 OR (r->>'canManage')::boolean THEN
  RAISE EXCEPTION 'Read-only fleet permissions are invalid: %',r;
 END IF;
 BEGIN
  PERFORM public.billing_rpc('fleet','save','{"internalCode":"DENIED","model":"Negado","brand":"Marca","description":""}');
  RAISE EXCEPTION 'Read-only member wrote a fleet vehicle';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.billing_rpc('fleet','list','{}');RAISE EXCEPTION 'Anonymous fleet RPC was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
