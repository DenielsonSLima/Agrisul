-- Normalize quotation requests, selected providers and their per-item prices.
-- The first quotation migration is already deployed, so this migration evolves
-- that schema without rewriting applied history or any unrelated RPC route.

ALTER TABLE public.billing_quotations
 ADD COLUMN request_date date,
 ADD COLUMN requester text,
 ADD COLUMN notes text NOT NULL DEFAULT '';
UPDATE public.billing_quotations
 SET request_date=created_at::date,
     requester='Não informado'
 WHERE request_date IS NULL OR requester IS NULL;
ALTER TABLE public.billing_quotations
 ALTER COLUMN request_date SET NOT NULL,
 ALTER COLUMN request_date SET DEFAULT current_date,
 ALTER COLUMN requester SET NOT NULL,
 ADD CONSTRAINT billing_quotations_requester_check CHECK(length(btrim(requester)) BETWEEN 2 AND 150),
 ADD CONSTRAINT billing_quotations_notes_check CHECK(length(notes)<=4000);

ALTER TABLE public.billing_quotation_items
 ADD COLUMN material_name text,
 ALTER COLUMN unit_price DROP NOT NULL,
 ALTER COLUMN supplier SET DEFAULT '';
UPDATE public.billing_quotation_items i
 SET material_name=m.name
 FROM public.billing_materials m
 WHERE m.owner_id=i.owner_id AND m.id=i.material_id AND i.material_name IS NULL;
ALTER TABLE public.billing_quotation_items
 ALTER COLUMN material_name SET NOT NULL,
 DROP CONSTRAINT billing_quotation_items_supplier_check,
 ADD CONSTRAINT billing_quotation_items_material_name_check CHECK(length(btrim(material_name)) BETWEEN 2 AND 150),
 ADD CONSTRAINT billing_quotation_items_supplier_check CHECK(length(supplier)<=200),
 ADD CONSTRAINT billing_quotation_items_owner_quote_id_key UNIQUE(owner_id,quotation_id,id);

CREATE TABLE public.billing_quotation_providers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 quotation_id uuid NOT NULL,
 provider_id uuid NOT NULL,
 provider_snapshot jsonb NOT NULL,
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id),
 UNIQUE(owner_id,quotation_id,id),
 UNIQUE(owner_id,quotation_id,provider_id),
 FOREIGN KEY(owner_id,quotation_id) REFERENCES public.billing_quotations(owner_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,provider_id) REFERENCES public.billing_service_providers(owner_id,id),
 CHECK(jsonb_typeof(provider_snapshot)='object' AND provider_snapshot->>'id'=provider_id::text)
);
CREATE INDEX billing_quotation_providers_provider ON public.billing_quotation_providers(owner_id,provider_id);
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_quotation_providers
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();

CREATE TABLE public.billing_quotation_provider_values (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 quotation_id uuid NOT NULL,
 quotation_provider_id uuid NOT NULL,
 quotation_item_id uuid NOT NULL,
 unit_price numeric(15,2) NOT NULL CHECK(unit_price>=0 AND unit_price<1000000000000),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id),
 UNIQUE(owner_id,quotation_id,quotation_provider_id,quotation_item_id),
 FOREIGN KEY(owner_id,quotation_id) REFERENCES public.billing_quotations(owner_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,quotation_id,quotation_provider_id)
  REFERENCES public.billing_quotation_providers(owner_id,quotation_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,quotation_id,quotation_item_id)
  REFERENCES public.billing_quotation_items(owner_id,quotation_id,id) ON DELETE CASCADE
);
CREATE INDEX billing_quotation_values_item ON public.billing_quotation_provider_values(owner_id,quotation_id,quotation_item_id);
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_quotation_provider_values
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();

ALTER TABLE public.billing_quotation_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_quotation_provider_values ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_quotation_providers,public.billing_quotation_provider_values FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_quotation_providers,public.billing_quotation_provider_values TO authenticated;
CREATE POLICY billing_quotation_provider_read ON public.billing_quotation_providers FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'registrations.read'));
CREATE POLICY billing_quotation_value_read ON public.billing_quotation_provider_values FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'registrations.read'));

-- Quotations use the existing registration permissions. The previous temporary
-- `quotations.*` permission names were never valid values in access profiles.
DROP POLICY billing_owner_read ON public.billing_quotations;
CREATE POLICY billing_owner_read ON public.billing_quotations FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'registrations.read'));
DROP POLICY billing_owner_read ON public.billing_quotation_items;
CREATE POLICY billing_owner_read ON public.billing_quotation_items FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'registrations.read'));

CREATE FUNCTION billing_private.quotation_json(p_quote public.billing_quotations) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p_quote.id,'title',p_quote.title,'number',p_quote.quotation_number,
  'requestDate',p_quote.request_date,'requester',p_quote.requester,'notes',p_quote.notes,
  'status',p_quote.status,'createdAt',p_quote.created_at,'updatedAt',p_quote.updated_at,
  'items',coalesce((
   SELECT jsonb_agg(jsonb_build_object(
    'id',i.id,'materialId',i.material_id,'materialName',i.material_name,
    'quantity',billing_private.decimal_text(i.quantity),'unit',i.unit,'notes',i.notes
   ) ORDER BY i.created_at,i.id)
   FROM public.billing_quotation_items i
   WHERE i.owner_id=p_quote.owner_id AND i.quotation_id=p_quote.id
  ),'[]'::jsonb),
  'providers',coalesce((
   SELECT jsonb_agg(jsonb_build_object(
    'id',qp.id,'providerId',qp.provider_id,
    'providerName',qp.provider_snapshot->>'legalName',
    'providerEmail',coalesce(qp.provider_snapshot->>'email',''),
    'providerPhone',coalesce(qp.provider_snapshot->>'phone',''),
    'provider',qp.provider_snapshot,'notes',qp.notes,'sentAt',qp.sent_at,
    'values',coalesce((
     SELECT jsonb_object_agg(i.id::text,coalesce(billing_private.decimal_text(qv.unit_price),'') ORDER BY i.created_at,i.id)
     FROM public.billing_quotation_items i
     LEFT JOIN public.billing_quotation_provider_values qv
      ON qv.owner_id=i.owner_id AND qv.quotation_id=i.quotation_id
      AND qv.quotation_provider_id=qp.id AND qv.quotation_item_id=i.id
     WHERE i.owner_id=p_quote.owner_id AND i.quotation_id=p_quote.id
    ),'{}'::jsonb),
    'total',billing_private.decimal_text(coalesce((
     SELECT sum(i.quantity*qv.unit_price)
     FROM public.billing_quotation_provider_values qv
     JOIN public.billing_quotation_items i
      ON i.owner_id=qv.owner_id AND i.quotation_id=qv.quotation_id AND i.id=qv.quotation_item_id
     WHERE qv.owner_id=p_quote.owner_id AND qv.quotation_id=p_quote.id AND qv.quotation_provider_id=qp.id
    ),0::numeric))
   ) ORDER BY lower(coalesce(qp.provider_snapshot->>'legalName','')),qp.id)
   FROM public.billing_quotation_providers qp
   WHERE qp.owner_id=p_quote.owner_id AND qp.quotation_id=p_quote.id
  ),'[]'::jsonb)
 )
$$;
REVOKE ALL ON FUNCTION billing_private.quotation_json(public.billing_quotations) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.quotations_dispatch(p_resource text,p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;v_material_id uuid;v_provider_id uuid;v_item_id uuid;v_quote_provider_id uuid;
 v_quote public.billing_quotations;v_material public.billing_materials;v_provider public.billing_service_providers;
 v_item public.billing_quotation_items;v_item_json jsonb;v_provider_json jsonb;v_values jsonb;
 v_result jsonb;v_number text;v_quantity numeric;v_price numeric;v_price_text text;v_sent_at timestamptz;
 v_existing boolean:=false;v_definition text;v_key text;
BEGIN
 IF v_owner IS NULL OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Dados inválidos.' USING ERRCODE='22023'; END IF;

 IF p_resource='materials' THEN
  IF p_action NOT IN ('list','get','save','delete') THEN RAISE EXCEPTION 'Operação de material inválida.' USING ERRCODE='22023'; END IF;
  IF p_action IN ('list','get') THEN PERFORM billing_private.authorize('registrations.read');
  ELSE PERFORM billing_private.lock_request_actor();PERFORM billing_private.authorize('registrations.write'); END IF;
  IF p_action='list' THEN
   PERFORM billing_private.request_payload(p_payload,ARRAY[]::text[]);
   SELECT coalesce(jsonb_agg(billing_private.present(to_jsonb(m)) ORDER BY lower(m.name),m.id),'[]'::jsonb)
    INTO v_result FROM public.billing_materials m WHERE m.owner_id=v_owner;
   RETURN jsonb_build_object('materials',v_result);
  END IF;
  PERFORM billing_private.request_payload(p_payload,CASE WHEN p_action='save' THEN ARRAY['id','name','code','unit','application'] ELSE ARRAY['id'] END);
  v_id=nullif(p_payload->>'id','')::uuid;
  IF p_action='get' THEN
   SELECT * INTO v_material FROM public.billing_materials WHERE owner_id=v_owner AND id=v_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Material não encontrado.' USING ERRCODE='P0002'; END IF;
   RETURN jsonb_build_object('material',billing_private.present(to_jsonb(v_material)));
  END IF;
  IF p_action='delete' THEN
   DELETE FROM public.billing_materials WHERE owner_id=v_owner AND id=v_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Material não encontrado.' USING ERRCODE='P0002'; END IF;
   RETURN jsonb_build_object('id',v_id,'deleted',true);
  END IF;
  IF jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_payload->'code') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_payload->'unit') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_payload->'application') IS DISTINCT FROM 'string'
   OR length(btrim(p_payload->>'name')) NOT BETWEEN 2 AND 150
   OR length(btrim(p_payload->>'code')) NOT BETWEEN 1 AND 60
   OR length(btrim(p_payload->>'unit')) NOT BETWEEN 1 AND 30
   OR length(p_payload->>'application')>1000 THEN
   RAISE EXCEPTION 'Preencha corretamente os campos do material.' USING ERRCODE='22023';
  END IF;
  IF v_id IS NULL THEN
   INSERT INTO public.billing_materials(owner_id,name,code,unit,application)
    VALUES(v_owner,btrim(p_payload->>'name'),btrim(p_payload->>'code'),btrim(p_payload->>'unit'),btrim(p_payload->>'application')) RETURNING * INTO v_material;
  ELSE
   UPDATE public.billing_materials SET name=btrim(p_payload->>'name'),code=btrim(p_payload->>'code'),
    unit=btrim(p_payload->>'unit'),application=btrim(p_payload->>'application')
    WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_material;
   IF NOT FOUND THEN RAISE EXCEPTION 'Material não encontrado.' USING ERRCODE='P0002'; END IF;
  END IF;
  RETURN jsonb_build_object('material',billing_private.present(to_jsonb(v_material)));
 END IF;

 IF p_resource<>'quotations' OR p_action NOT IN ('list','get','save','toggle-status','delete') THEN
  RAISE EXCEPTION 'Operação de cotação inválida.' USING ERRCODE='22023';
 END IF;
 IF p_action IN ('list','get') THEN PERFORM billing_private.authorize('registrations.read');
 ELSE PERFORM billing_private.lock_request_actor();PERFORM billing_private.authorize('registrations.write'); END IF;

 IF p_action='list' THEN
  PERFORM billing_private.request_payload(p_payload,ARRAY['status']);
  IF jsonb_typeof(p_payload->'status') IS DISTINCT FROM 'string' OR p_payload->>'status' NOT IN ('open','finished') THEN
   RAISE EXCEPTION 'Situação da cotação inválida.' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(jsonb_agg(billing_private.quotation_json(q) ORDER BY q.created_at DESC,q.id),'[]'::jsonb)
   INTO v_result FROM public.billing_quotations q WHERE q.owner_id=v_owner AND q.status=p_payload->>'status';
  RETURN jsonb_build_object('quotes',v_result,'total',jsonb_array_length(v_result));
 END IF;

 IF p_action IN ('get','toggle-status','delete') THEN
  PERFORM billing_private.request_payload(p_payload,ARRAY['id']);
  v_id=nullif(p_payload->>'id','')::uuid;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Informe a cotação.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_quote FROM public.billing_quotations WHERE owner_id=v_owner AND id=v_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE='P0002'; END IF;
  IF p_action='get' THEN RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote)); END IF;
  IF p_action='delete' THEN
   DELETE FROM public.billing_quotations WHERE owner_id=v_owner AND id=v_id;
   RETURN jsonb_build_object('id',v_id,'deleted',true);
  END IF;
  IF v_quote.status='open' THEN
   IF NOT EXISTS(SELECT 1 FROM public.billing_quotation_providers qp WHERE qp.owner_id=v_owner AND qp.quotation_id=v_id)
    OR EXISTS(
     SELECT 1 FROM public.billing_quotation_items i
     WHERE i.owner_id=v_owner AND i.quotation_id=v_id
      AND NOT EXISTS(SELECT 1 FROM public.billing_quotation_provider_values qv
       WHERE qv.owner_id=i.owner_id AND qv.quotation_id=i.quotation_id AND qv.quotation_item_id=i.id)
    ) THEN
    RAISE EXCEPTION 'Preencha ao menos um valor para cada material antes de finalizar.' USING ERRCODE='23514';
   END IF;
  END IF;
  UPDATE public.billing_quotations SET status=CASE status WHEN 'open' THEN 'finished' ELSE 'open' END
   WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_quote;
  RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote));
 END IF;

 PERFORM billing_private.request_payload(p_payload,ARRAY['id','title','number','requestDate','requester','notes','items','providers']);
 IF jsonb_typeof(p_payload->'title') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'number') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'requestDate') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'requester') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'notes') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array'
  OR jsonb_typeof(p_payload->'providers') IS DISTINCT FROM 'array'
  OR length(btrim(p_payload->>'title')) NOT BETWEEN 2 AND 150
  OR length(btrim(p_payload->>'requester')) NOT BETWEEN 2 AND 150
  OR length(p_payload->>'notes')>4000
  OR jsonb_array_length(p_payload->'items')=0
  OR jsonb_array_length(p_payload->'items')>100
  OR jsonb_array_length(p_payload->'providers')=0
  OR jsonb_array_length(p_payload->'providers')>50 THEN
  RAISE EXCEPTION 'Informe data, solicitante, materiais e prestadores da cotação.' USING ERRCODE='22023';
 END IF;
 v_id=nullif(p_payload->>'id','')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended('billing-quotation:'||v_owner::text,0));
 IF v_id IS NOT NULL THEN
  SELECT * INTO v_quote FROM public.billing_quotations WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE='P0002'; END IF;
  IF v_quote.status<>'open' THEN RAISE EXCEPTION 'Reabra a cotação antes de editá-la.' USING ERRCODE='23514'; END IF;
  v_existing=true;
 ELSE v_id=gen_random_uuid(); END IF;
 v_number=nullif(btrim(p_payload->>'number'),'');
 IF v_number IS NULL AND v_existing THEN v_number=v_quote.quotation_number; END IF;
 IF v_number IS NULL THEN
  SELECT 'COT-'||lpad((coalesce(max((regexp_match(quotation_number,'^COT-([0-9]+)$'))[1]::integer),0)+1)::text,3,'0')
   INTO v_number FROM public.billing_quotations WHERE owner_id=v_owner;
 END IF;
 IF length(v_number)>60 THEN RAISE EXCEPTION 'O número da cotação deve ter até 60 caracteres.' USING ERRCODE='22023'; END IF;
 IF v_existing THEN
  UPDATE public.billing_quotations SET title=btrim(p_payload->>'title'),quotation_number=v_number,
   request_date=(p_payload->>'requestDate')::date,requester=btrim(p_payload->>'requester'),notes=btrim(p_payload->>'notes')
   WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_quote;
 ELSE
  INSERT INTO public.billing_quotations(id,owner_id,title,quotation_number,request_date,requester,notes,status)
   VALUES(v_id,v_owner,btrim(p_payload->>'title'),v_number,(p_payload->>'requestDate')::date,
    btrim(p_payload->>'requester'),btrim(p_payload->>'notes'),'open') RETURNING * INTO v_quote;
 END IF;
 DELETE FROM public.billing_quotation_providers WHERE owner_id=v_owner AND quotation_id=v_id;
 DELETE FROM public.billing_quotation_items WHERE owner_id=v_owner AND quotation_id=v_id;

 FOR v_item_json IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
  PERFORM billing_private.request_payload(v_item_json,ARRAY['id','materialId','materialName','quantity','unit','notes']);
  IF jsonb_typeof(v_item_json->'id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(v_item_json->'materialId') IS DISTINCT FROM 'string'
   OR jsonb_typeof(v_item_json->'quantity') IS DISTINCT FROM 'string'
   OR jsonb_typeof(v_item_json->'notes') IS DISTINCT FROM 'string'
   OR length(v_item_json->>'notes')>1000 THEN
   RAISE EXCEPTION 'Confira os materiais da cotação.' USING ERRCODE='22023';
  END IF;
  v_item_id=nullif(v_item_json->>'id','')::uuid;
  v_material_id=nullif(v_item_json->>'materialId','')::uuid;
  v_quantity=replace(btrim(v_item_json->>'quantity'),',','.')::numeric;
  IF v_item_id IS NULL OR v_material_id IS NULL OR v_quantity<=0 OR v_quantity>=1000000000000 OR v_quantity<>round(v_quantity,3) THEN
   RAISE EXCEPTION 'Informe uma quantidade válida com até três casas decimais.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_material FROM public.billing_materials WHERE owner_id=v_owner AND id=v_material_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecione materiais cadastrados neste espaço.' USING ERRCODE='23514'; END IF;
  INSERT INTO public.billing_quotation_items(id,owner_id,quotation_id,material_id,material_name,quantity,unit,unit_price,supplier,notes)
   VALUES(v_item_id,v_owner,v_id,v_material.id,v_material.name,v_quantity,v_material.unit,NULL,'',btrim(v_item_json->>'notes'));
 END LOOP;

 FOR v_provider_json IN SELECT value FROM jsonb_array_elements(p_payload->'providers') LOOP
  PERFORM billing_private.request_payload(v_provider_json,ARRAY['id','providerId','providerName','providerEmail','providerPhone','provider','values','notes','sentAt','total']);
  IF jsonb_typeof(v_provider_json->'providerId') IS DISTINCT FROM 'string'
   OR jsonb_typeof(v_provider_json->'values') IS DISTINCT FROM 'object'
   OR jsonb_typeof(v_provider_json->'notes') IS DISTINCT FROM 'string'
   OR length(v_provider_json->>'notes')>2000
   OR (v_provider_json?'sentAt' AND jsonb_typeof(v_provider_json->'sentAt') NOT IN ('string','null')) THEN
   RAISE EXCEPTION 'Confira os prestadores da cotação.' USING ERRCODE='22023';
  END IF;
  v_quote_provider_id=coalesce(nullif(v_provider_json->>'id','')::uuid,gen_random_uuid());
  v_provider_id=nullif(v_provider_json->>'providerId','')::uuid;
  SELECT * INTO v_provider FROM public.billing_service_providers WHERE owner_id=v_owner AND id=v_provider_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecione prestadores cadastrados neste espaço.' USING ERRCODE='23514'; END IF;
  v_sent_at=CASE WHEN jsonb_typeof(v_provider_json->'sentAt')='string' AND nullif(btrim(v_provider_json->>'sentAt'),'') IS NOT NULL
   THEN (v_provider_json->>'sentAt')::timestamptz ELSE NULL END;
  INSERT INTO public.billing_quotation_providers(id,owner_id,quotation_id,provider_id,provider_snapshot,notes,sent_at)
   VALUES(v_quote_provider_id,v_owner,v_id,v_provider_id,billing_private.provider_json(v_provider),btrim(v_provider_json->>'notes'),v_sent_at);
  v_values=v_provider_json->'values';
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(v_values) k
   WHERE k !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    OR NOT EXISTS(SELECT 1 FROM public.billing_quotation_items i WHERE i.owner_id=v_owner AND i.quotation_id=v_id AND i.id=k::uuid)) THEN
   RAISE EXCEPTION 'Os valores devem corresponder aos materiais desta cotação.' USING ERRCODE='23514';
  END IF;
  FOR v_item IN SELECT * FROM public.billing_quotation_items i WHERE i.owner_id=v_owner AND i.quotation_id=v_id ORDER BY i.created_at,i.id LOOP
   v_price_text=nullif(btrim(v_values->>v_item.id::text),'');
   IF v_price_text IS NOT NULL THEN
    v_price=replace(v_price_text,',','.')::numeric;
    IF v_price<0 OR v_price>=1000000000000 OR v_price<>round(v_price,2) THEN
     RAISE EXCEPTION 'Informe valores com até duas casas decimais.' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.billing_quotation_provider_values(owner_id,quotation_id,quotation_provider_id,quotation_item_id,unit_price)
     VALUES(v_owner,v_id,v_quote_provider_id,v_item.id,v_price);
   END IF;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('quote',billing_private.quotation_json(v_quote));
EXCEPTION
 WHEN unique_violation THEN RAISE EXCEPTION 'Já existe um material, número, item ou prestador repetido.' USING ERRCODE='23505';
 WHEN foreign_key_violation THEN RAISE EXCEPTION 'Este registro possui vínculos ou pertence a outro espaço.' USING ERRCODE='23503';
 WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Informe datas, identificadores e valores válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb) TO authenticated;

-- Change only the obsolete quotation permission mapping, preserving every route
-- and special authorization added by later operational migrations.
DO $$
DECLARE v_definition text;v_marker text:='WHEN p_resource=''quotations'' THEN ''quotations.''||';
BEGIN
 SELECT pg_get_functiondef('billing_private.authorize_resource(text,text)'::regprocedure) INTO v_definition;
 IF strpos(v_definition,v_marker)=0 THEN RAISE EXCEPTION 'Unexpected resource authorization dispatcher'; END IF;
 v_definition=replace(v_definition,v_marker,'WHEN p_resource=''quotations'' THEN ''registrations.''||');
 EXECUTE v_definition;
END $$;

DO $$ DECLARE t text;BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  FOREACH t IN ARRAY ARRAY['billing_quotation_providers','billing_quotation_provider_values'] LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);
   END IF;
  END LOOP;
 END IF;
END $$;

COMMENT ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb) IS
 'Owner-scoped material and quotation aggregate. Quotation items snapshot materials; selected providers snapshot registry data; all prices and totals use NUMERIC and return decimal text.';
