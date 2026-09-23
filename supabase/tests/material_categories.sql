BEGIN;

INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('97000000-0000-4000-8000-000000000001','category-owner@example.invalid',now()),
 ('97000000-0000-4000-8000-000000000002','category-other@example.invalid',now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true);
SELECT public.billing_rpc('settings','get','{}');

DO $$
DECLARE
 r jsonb;
 category_id uuid;
 material_id uuid;
BEGIN
 r=public.billing_rpc('material-categories','save',jsonb_build_object(
  'name',E'  Filtros\t  hidráulicos  '
 ));
 category_id=(r->'category'->>'id')::uuid;
 IF r->'category'->>'name'<>'Filtros hidráulicos' THEN
  RAISE EXCEPTION 'Category name was not normalized: %',r;
 END IF;

 r=public.billing_rpc('material-categories','save',jsonb_build_object(
  'id',category_id,'name','Filtros hidráulicos'
 ));
 IF r->'category'->>'id'<>category_id::text THEN
  RAISE EXCEPTION 'Category update did not preserve its identifier: %',r;
 END IF;

 BEGIN
  PERFORM public.billing_rpc('material-categories','save',jsonb_build_object(
   'name','filtros hidráulicos'
  ));
  RAISE EXCEPTION 'Case-insensitive duplicate category was accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;

 r=public.billing_rpc('materials','save',jsonb_build_object(
  'name','Filtro de retorno','internalCode','MAT-CAT-001','unit','PC',
  'application','Sistema hidráulico','categoryId',category_id
 ));
 material_id=(r->'material'->>'id')::uuid;
 IF r->'material'->>'categoryId'<>category_id::text
  OR r->'material'->>'categoryName'<>'Filtros hidráulicos' THEN
  RAISE EXCEPTION 'Saved material did not expose its category: %',r;
 END IF;

 r=public.billing_rpc('materials','list','{}');
 IF jsonb_array_length(r->'materials')<>1
  OR r->'materials'->0->>'categoryId'<>category_id::text
  OR r->'materials'->0->>'categoryName'<>'Filtros hidráulicos' THEN
  RAISE EXCEPTION 'Material list did not expose category grouping fields: %',r;
 END IF;

 BEGIN
  PERFORM public.billing_rpc('material-categories','delete',jsonb_build_object('id',category_id));
  RAISE EXCEPTION 'Category linked to a material was deleted';
 EXCEPTION WHEN foreign_key_violation THEN
  IF position('vinculada a materiais' IN SQLERRM)=0 THEN
   RAISE EXCEPTION 'Linked-category error is not clear: %',SQLERRM;
  END IF;
 END;

 -- Omitting categoryId on update preserves it; explicit null clears it.
 r=public.billing_rpc('materials','save',jsonb_build_object(
  'id',material_id,'name','Filtro de retorno','internalCode','MAT-CAT-001',
  'unit','PC','application','Sistema hidráulico'
 ));
 IF r->'material'->>'categoryId'<>category_id::text THEN
  RAISE EXCEPTION 'Omitted categoryId did not preserve the category: %',r;
 END IF;
 r=public.billing_rpc('materials','save',jsonb_build_object(
  'id',material_id,'name','Filtro de retorno','internalCode','MAT-CAT-001',
  'unit','PC','application','Sistema hidráulico','categoryId',NULL
 ));
 IF r->'material'->'categoryId'<>'null'::jsonb OR r->'material'->'categoryName'<>'null'::jsonb THEN
  RAISE EXCEPTION 'Explicit null did not clear the material category: %',r;
 END IF;

 r=public.billing_rpc('material-categories','delete',jsonb_build_object('id',category_id));
 IF r->>'deleted'<>'true' OR r->>'id'<>category_id::text THEN
  RAISE EXCEPTION 'Unlinked category deletion failed: %',r;
 END IF;

 -- Category remains optional for new products.
 r=public.billing_rpc('materials','save',jsonb_build_object(
  'name','Produto sem categoria','internalCode','MAT-CAT-002','unit','UN','application',''
 ));
 IF r->'material'->'categoryId'<>'null'::jsonb OR r->'material'->'categoryName'<>'null'::jsonb THEN
  RAISE EXCEPTION 'New uncategorized material did not return null category fields: %',r;
 END IF;
END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true);
SELECT public.billing_rpc('settings','get','{}');

DO $$
DECLARE
 r jsonb;
 foreign_category uuid;
BEGIN
 r=public.billing_rpc('material-categories','list','{}');
 IF r->'categories'<>'[]'::jsonb THEN
  RAISE EXCEPTION 'Category workspace isolation failed: %',r;
 END IF;

 -- A second workspace may reuse the same normalized category name.
 r=public.billing_rpc('material-categories','save',jsonb_build_object(
  'name','Filtros hidráulicos'
 ));
 foreign_category=(r->'category'->>'id')::uuid;
 IF foreign_category IS NULL THEN RAISE EXCEPTION 'Second owner category was not created'; END IF;

 BEGIN
  INSERT INTO public.billing_material_categories(owner_id,name)
  VALUES('97000000-0000-4000-8000-000000000002','Gravação direta');
  RAISE EXCEPTION 'Direct category write was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;

END $$;

RESET ROLE;

-- Verify cross-owner linkage with a deterministic category while preserving
-- the application role's inability to write tables directly.
INSERT INTO public.billing_material_categories(id,owner_id,name) VALUES(
 '97000000-0000-4000-8000-000000000010',
 '97000000-0000-4000-8000-000000000001','Categoria estrangeira'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.billing_rpc('materials','save',jsonb_build_object(
   'name','Categoria cruzada','internalCode','MAT-CROSS-001','unit','PC',
   'application','','categoryId','97000000-0000-4000-8000-000000000010'
  ));
  RAISE EXCEPTION 'Cross-workspace material category was accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

RESET ROLE;
ROLLBACK;
