BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('95000000-0000-4000-8000-000000000001','material-owner@example.invalid',now()),
 ('95000000-0000-4000-8000-000000000002','material-other@example.invalid',now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000001',true);
SELECT public.billing_rpc('settings','get','{}');
INSERT INTO storage.objects(id,bucket_id,name) VALUES(
 '95000000-0000-4000-8000-000000000010','billing-material-images',
 '95000000-0000-4000-8000-000000000001/materials/95000000-0000-4000-8000-000000000011.webp'
);

DO $$
DECLARE
 r jsonb;material_id uuid;
 image_path text:='95000000-0000-4000-8000-000000000001/materials/95000000-0000-4000-8000-000000000011.webp';
BEGIN
 r=public.billing_rpc('materials','save',jsonb_build_object(
  'name','Filtro lubrificante','unit','PC','application','',
  'imageKey',image_path,'imageName','filtro.webp'
 ));
 material_id=(r->'material'->>'id')::uuid;
 IF r->'material'->>'application'<>'' THEN
  RAISE EXCEPTION 'Optional application was not preserved: %',r;
 END IF;
 IF r->'material'->>'imageKey'<>image_path OR r->'material'->>'imageName'<>'filtro.webp' THEN
  RAISE EXCEPTION 'Material image envelope is invalid: %',r;
 END IF;

 r=public.billing_rpc('materials','save',jsonb_build_object(
  'id',material_id,'name','Filtro lubrificante','unit','PC','application','Caminhão'
 ));
 IF r->'material'->>'imageKey'<>image_path THEN RAISE EXCEPTION 'Unchanged image was not preserved'; END IF;

 BEGIN
  PERFORM public.billing_rpc('materials','save',jsonb_build_object(
   'name','Imagem inexistente','unit','UN','application','',
   'imageKey','95000000-0000-4000-8000-000000000001/materials/missing.webp','imageName','missing.webp'
  ));
  RAISE EXCEPTION 'Missing storage image was accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;

 r=public.billing_rpc('materials','save',jsonb_build_object(
  'id',material_id,'name','Filtro lubrificante','unit','PC','application','',
  'removeImage',true
 ));
 IF r->'material'->>'imageKey' IS NOT NULL OR r->'material'->>'imageName'<>
  '' OR r->>'previousImageKey'<>image_path THEN
  RAISE EXCEPTION 'Explicit material image removal failed: %',r;
 END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000002',true);
SELECT public.billing_rpc('settings','get','{}');
DO $$
DECLARE r jsonb;
BEGIN
 r=public.billing_rpc('materials','list','{}');
 IF jsonb_array_length(r->'materials')<>0 OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='billing-material-images') THEN
  RAISE EXCEPTION 'Material image workspace isolation failed';
 END IF;
END $$;

SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM public.billing_rpc('materials','list','{}');
  RAISE EXCEPTION 'Anonymous material image access was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
