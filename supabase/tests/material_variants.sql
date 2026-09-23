BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('96000000-0000-4000-8000-000000000001','reference-owner@example.invalid',now()),
 ('96000000-0000-4000-8000-000000000002','reference-other@example.invalid',now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000001',true);
SELECT public.billing_rpc('settings','get','{}');
INSERT INTO storage.objects(id,bucket_id,name) VALUES(
 '96000000-0000-4000-8000-000000000010','billing-material-images',
 '96000000-0000-4000-8000-000000000001/materials/96000000-0000-4000-8000-000000000011.webp'
);

DO $$
DECLARE
 r jsonb;material_id uuid;reference_a uuid;reference_b uuid;
 image_path text:='96000000-0000-4000-8000-000000000001/materials/96000000-0000-4000-8000-000000000011.webp';
BEGIN
 r=public.billing_rpc('materials','save',jsonb_build_object(
  'name','Filtro hidráulico','internalCode','MAT-FH-001','unit','PC','application','Sistema hidráulico',
  'imageKey',image_path,'imageName','filtro-hidraulico.webp'
 ));
 material_id=(r->'material'->>'id')::uuid;
 IF r->'material'->>'internalCode'<>'MAT-FH-001' OR r->'material'->>'imageKey'<>image_path
  OR jsonb_array_length(r->'material'->'references')<>0 THEN
  RAISE EXCEPTION 'Product internal code, photo or empty references are invalid: %',r;
 END IF;

 BEGIN
  PERFORM public.billing_rpc('materials','save',jsonb_build_object(
   'name','Outro filtro','internalCode','mat-fh-001','unit','PC','application',''
  ));
  RAISE EXCEPTION 'Duplicate internal material code was accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;

 r=public.billing_rpc('material-variants','save',jsonb_build_object(
  'materialId',material_id,'brand','MANN','code','H601/10'
 ));
 reference_a=(r->'reference'->>'id')::uuid;
 r=public.billing_rpc('material-variants','save',jsonb_build_object(
  'materialId',material_id,'brand','Baldwin','code','P106HD'
 ));
 reference_b=(r->'reference'->>'id')::uuid;
 IF reference_a=reference_b THEN RAISE EXCEPTION 'Distinct references received the same identifier'; END IF;

 r=public.billing_rpc('materials','get',jsonb_build_object('id',material_id));
 IF r->'material'->>'internalCode'<>'MAT-FH-001' OR r->'material'->>'imageKey'<>image_path
  OR jsonb_array_length(r->'material'->'references')<>2
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'material'->'references') v
   WHERE v->>'brand'='MANN' AND v->>'code'='H601/10')
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'material'->'references') v
   WHERE v->>'brand'='Baldwin' AND v->>'code'='P106HD') THEN
  RAISE EXCEPTION 'Product detail did not return one photo and all references: %',r;
 END IF;

 BEGIN
  PERFORM public.billing_rpc('material-variants','save',jsonb_build_object(
   'materialId',material_id,'brand','mann','code','h601/10'
  ));
  RAISE EXCEPTION 'Duplicate brand/code reference was accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;

 r=public.billing_rpc('material-variants','delete',jsonb_build_object('id',reference_a));
 r=public.billing_rpc('materials','list','{}');
 IF jsonb_array_length(r->'materials')<>1
  OR r->'materials'->0->>'internalCode'<>'MAT-FH-001'
  OR r->'materials'->0->>'imageKey'<>image_path
  OR jsonb_array_length(r->'materials'->0->'references')<>1 THEN
  RAISE EXCEPTION 'Reference deletion changed the product photo or product record: %',r;
 END IF;
 PERFORM set_config('test.material.reference.product',material_id::text,true);
END $$;

SELECT set_config('request.jwt.claim.sub','96000000-0000-4000-8000-000000000002',true);
SELECT public.billing_rpc('settings','get','{}');
DO $$
DECLARE r jsonb;foreign_product uuid:=current_setting('test.material.reference.product')::uuid;
BEGIN
 r=public.billing_rpc('materials','list','{}');
 IF jsonb_array_length(r->'materials')<>0 OR EXISTS(SELECT 1 FROM public.billing_material_variants) THEN
  RAISE EXCEPTION 'Material reference workspace isolation failed';
 END IF;
 BEGIN
  PERFORM public.billing_rpc('materials','get',jsonb_build_object('id',foreign_product));
  RAISE EXCEPTION 'Foreign material detail was accepted';
 EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;

RESET ROLE;
ROLLBACK;
