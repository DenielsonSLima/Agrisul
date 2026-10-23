BEGIN;
CREATE TABLE public.billing_purchase_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 requested_on date NOT NULL,
 request_number text NOT NULL CHECK(length(btrim(request_number)) BETWEEN 1 AND 60),
 item_type text NOT NULL CHECK(item_type IN ('material','service')),
 material_id uuid,
 category_id uuid,
 description text NOT NULL CHECK(length(btrim(description)) BETWEEN 2 AND 300),
 reference text NOT NULL DEFAULT '' CHECK(length(reference)<=150),
 quantity numeric(18,6) NOT NULL CHECK(quantity>0 AND quantity<1000000000),
 unit text NOT NULL CHECK(length(btrim(unit)) BETWEEN 1 AND 30),
 application text NOT NULL DEFAULT '' CHECK(length(application)<=1000),
 urgent boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','ordered','received','cancelled')),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=3000),
 source_key text NOT NULL DEFAULT '' CHECK(length(source_key)<=200),
 created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id),
 FOREIGN KEY(owner_id,material_id) REFERENCES public.billing_materials(owner_id,id),
 FOREIGN KEY(owner_id,category_id) REFERENCES public.billing_material_categories(owner_id,id),
 CHECK(item_type='material' OR material_id IS NULL)
);
CREATE UNIQUE INDEX billing_purchase_request_source ON public.billing_purchase_requests(owner_id,source_key) WHERE source_key<>'';
CREATE INDEX billing_purchase_request_period ON public.billing_purchase_requests(owner_id,requested_on DESC,request_number,id);
CREATE TABLE public.billing_purchase_request_vehicles (
 owner_id uuid NOT NULL,
 request_id uuid NOT NULL,
 vehicle_id uuid NOT NULL,
 PRIMARY KEY(owner_id,request_id,vehicle_id),
 FOREIGN KEY(owner_id,request_id) REFERENCES public.billing_purchase_requests(owner_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,vehicle_id) REFERENCES public.billing_fleet_vehicles(owner_id,id)
);
CREATE INDEX billing_purchase_request_vehicle ON public.billing_purchase_request_vehicles(owner_id,vehicle_id);
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_purchase_requests
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();

CREATE FUNCTION billing_private.purchase_request_json(r public.billing_purchase_requests)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',r.id,'requestedOn',r.requested_on,'requestNumber',r.request_number,
 'itemType',r.item_type,'materialId',r.material_id,'categoryId',r.category_id,
 'categoryName',coalesce((SELECT c.name FROM public.billing_material_categories c WHERE c.owner_id=r.owner_id AND c.id=r.category_id),''),
 'description',r.description,'reference',r.reference,'quantity',billing_private.decimal_text(r.quantity),'unit',r.unit,
 'application',r.application,'urgent',r.urgent,'status',r.status,'notes',r.notes,'sourceKey',r.source_key,
 'createdAt',r.created_at,'updatedAt',r.updated_at,
 'vehicles',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'internalCode',v.internal_code,'brand',v.brand,'model',v.model) ORDER BY v.internal_code)
  FROM public.billing_purchase_request_vehicles l JOIN public.billing_fleet_vehicles v ON v.owner_id=l.owner_id AND v.id=l.vehicle_id
  WHERE l.owner_id=r.owner_id AND l.request_id=r.id),'[]'::jsonb))
$$;

CREATE FUNCTION billing_private.purchase_requests_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_id uuid;v_material uuid;v_category uuid;
 v_row public.billing_purchase_requests;v_old public.billing_purchase_requests;
 v_vehicles uuid[];v_quantity numeric;v_date date;v_from date;v_to date;
 v_page integer;v_size integer;v_total integer;v_result jsonb;v_search text;v_status text;
BEGIN
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Entre para acessar suas compras.' USING ERRCODE='28000'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('list','save','delete') THEN RAISE EXCEPTION 'Operação de compra inválida.' USING ERRCODE='22023'; END IF;
 PERFORM billing_private.authorize(CASE WHEN p_action='list' THEN 'registrations.read' ELSE 'registrations.write' END);
 PERFORM billing_private.request_payload(p_payload,CASE WHEN p_action='list'
  THEN ARRAY['search','status','categoryId','dateFrom','dateTo','page','pageSize']
  WHEN p_action='save' THEN ARRAY['id','requestedOn','requestNumber','itemType','materialId','categoryId','description','reference','quantity','unit','application','urgent','status','notes','vehicleIds','sourceKey','expectedUpdatedAt']
  ELSE ARRAY['id','expectedUpdatedAt'] END);
 IF p_action='list' THEN
  v_search=btrim(coalesce(p_payload->>'search',''));v_status=coalesce(p_payload->>'status','all');
  v_category=nullif(p_payload->>'categoryId','')::uuid;
  v_from=nullif(p_payload->>'dateFrom','')::date;v_to=nullif(p_payload->>'dateTo','')::date;
  IF length(v_search)>160 OR v_status NOT IN ('all','open','ordered','received','cancelled')
    OR (v_from IS NOT NULL AND v_to IS NOT NULL AND v_from>v_to)
    OR coalesce(p_payload->>'page','1')!~'^[1-9][0-9]{0,6}$'
    OR coalesce(p_payload->>'pageSize','50')!~'^[1-9][0-9]{0,2}$' THEN
   RAISE EXCEPTION 'Confira os filtros e o período.' USING ERRCODE='22023'; END IF;
  v_page=coalesce((p_payload->>'page')::int,1);v_size=coalesce((p_payload->>'pageSize')::int,50);
  IF v_size>100 THEN RAISE EXCEPTION 'Use até 100 itens por página.' USING ERRCODE='22023'; END IF;
  WITH filtered AS (
   SELECT r.* FROM public.billing_purchase_requests r
   WHERE r.owner_id=v_owner AND (v_status='all' OR r.status=v_status)
    AND (v_category IS NULL OR r.category_id=v_category)
    AND (v_from IS NULL OR r.requested_on>=v_from) AND (v_to IS NULL OR r.requested_on<=v_to)
    AND (v_search='' OR strpos(lower(r.description||' '||r.reference||' '||r.application||' '||r.request_number||' '||r.notes),lower(v_search))>0
     OR EXISTS(SELECT 1 FROM public.billing_purchase_request_vehicles l JOIN public.billing_fleet_vehicles v ON v.owner_id=l.owner_id AND v.id=l.vehicle_id
      WHERE l.owner_id=r.owner_id AND l.request_id=r.id AND strpos(lower(v.internal_code||' '||v.model||' '||v.brand),lower(v_search))>0))
  ), paged AS (SELECT * FROM filtered ORDER BY requested_on DESC,request_number,created_at,id LIMIT v_size OFFSET (v_page::bigint-1)*v_size)
  SELECT (SELECT count(*) FROM filtered),coalesce(jsonb_agg(billing_private.purchase_request_json(p) ORDER BY p.requested_on DESC,p.request_number,p.created_at,p.id),'[]'::jsonb)
   INTO v_total,v_result FROM paged p;
  RETURN jsonb_build_object('items',v_result,'total',v_total,'page',v_page,'pageSize',v_size,'canManage',billing_private.has_permission('registrations.write'));
 END IF;
 PERFORM billing_private.lock_request_actor();
 PERFORM pg_advisory_xact_lock(hashtextextended('billing:purchase-requests:'||v_owner::text,0));
 v_id=nullif(p_payload->>'id','')::uuid;
 IF v_id IS NOT NULL THEN
  SELECT * INTO v_old FROM public.billing_purchase_requests WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
  IF v_old.id IS NULL AND EXISTS(SELECT 1 FROM public.billing_purchase_requests WHERE id=v_id) THEN
   RAISE EXCEPTION 'Solicitação não encontrada.' USING ERRCODE='P0002'; END IF;
 END IF;
 IF v_old.id IS NOT NULL AND (nullif(p_payload->>'expectedUpdatedAt','')::timestamptz IS DISTINCT FROM v_old.updated_at) THEN
  RAISE EXCEPTION 'A solicitação foi alterada. Atualize a lista antes de salvar.' USING ERRCODE='40001'; END IF;
 IF p_action='delete' THEN
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'Solicitação não encontrada.' USING ERRCODE='P0002'; END IF;
  DELETE FROM public.billing_purchase_requests WHERE owner_id=v_owner AND id=v_id;
  RETURN jsonb_build_object('id',v_id,'deleted',true);
 END IF;
 IF coalesce(p_payload->>'sourceKey','')<>'' AND v_old.id IS NULL THEN
  SELECT * INTO v_row FROM public.billing_purchase_requests WHERE owner_id=v_owner AND source_key=p_payload->>'sourceKey';
  IF FOUND THEN RETURN jsonb_build_object('request',billing_private.purchase_request_json(v_row),'created',false); END IF;
 END IF;
 IF jsonb_typeof(p_payload->'quantity') IS DISTINCT FROM 'string' OR coalesce(p_payload->>'quantity','')!~'^[0-9]{1,9}([.,][0-9]{1,6})?$'
   OR jsonb_typeof(p_payload->'vehicleIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'vehicleIds')>100
   OR jsonb_typeof(p_payload->'urgent') IS DISTINCT FROM 'boolean'
   OR jsonb_typeof(p_payload->'description') IS DISTINCT FROM 'string'
   OR length(btrim(p_payload->>'description')) NOT BETWEEN 2 AND 300
   OR jsonb_typeof(p_payload->'requestNumber') IS DISTINCT FROM 'string'
   OR length(btrim(p_payload->>'requestNumber')) NOT BETWEEN 1 AND 60
   OR jsonb_typeof(p_payload->'unit') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'unit')) NOT BETWEEN 1 AND 30
   OR coalesce(p_payload->>'itemType','') NOT IN ('material','service')
   OR coalesce(p_payload->>'status','') NOT IN ('open','ordered','received','cancelled')
   OR length(coalesce(p_payload->>'reference',''))>150 OR length(coalesce(p_payload->>'application',''))>1000
   OR length(coalesce(p_payload->>'notes',''))>3000 OR length(coalesce(p_payload->>'sourceKey',''))>200
   OR coalesce(p_payload->>'requestedOn','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
  RAISE EXCEPTION 'Confira data, número, descrição, quantidade, unidade e veículos.' USING ERRCODE='22023'; END IF;
 v_date=(p_payload->>'requestedOn')::date;v_quantity=replace(p_payload->>'quantity',',','.')::numeric;
 IF v_quantity<=0 OR v_quantity>=1000000000 THEN RAISE EXCEPTION 'Informe uma quantidade maior que zero.' USING ERRCODE='22023'; END IF;
 v_material=nullif(p_payload->>'materialId','')::uuid;v_category=nullif(p_payload->>'categoryId','')::uuid;
 IF p_payload->>'itemType'='service' AND v_material IS NOT NULL THEN RAISE EXCEPTION 'Serviços não usam vínculo com um produto.' USING ERRCODE='22023'; END IF;
 IF v_material IS NOT NULL THEN
  SELECT category_id INTO v_category FROM public.billing_materials WHERE owner_id=v_owner AND id=v_material FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecione um material deste espaço.' USING ERRCODE='22023'; END IF;
 END IF;
 IF v_category IS NOT NULL THEN
  PERFORM 1 FROM public.billing_material_categories WHERE owner_id=v_owner AND id=v_category FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecione um grupo deste espaço.' USING ERRCODE='22023'; END IF;
 END IF;
 SELECT coalesce(array_agg(DISTINCT value::uuid),'{}'::uuid[]) INTO v_vehicles FROM jsonb_array_elements_text(p_payload->'vehicleIds');
 IF EXISTS(SELECT 1 FROM unnest(v_vehicles) v WHERE v IS NULL OR NOT EXISTS(SELECT 1 FROM public.billing_fleet_vehicles f WHERE f.owner_id=v_owner AND f.id=v)) THEN
  RAISE EXCEPTION 'Selecione veículos deste espaço.' USING ERRCODE='22023'; END IF;
 IF v_old.id IS NULL THEN
  INSERT INTO public.billing_purchase_requests(id,owner_id,requested_on,request_number,item_type,material_id,category_id,description,reference,quantity,unit,application,urgent,status,notes,source_key,created_by)
  VALUES(coalesce(v_id,gen_random_uuid()),v_owner,v_date,btrim(p_payload->>'requestNumber'),p_payload->>'itemType',v_material,v_category,btrim(p_payload->>'description'),coalesce(p_payload->>'reference',''),v_quantity,btrim(p_payload->>'unit'),coalesce(p_payload->>'application',''),(p_payload->>'urgent')::boolean,p_payload->>'status',coalesce(p_payload->>'notes',''),coalesce(p_payload->>'sourceKey',''),auth.uid()) RETURNING * INTO v_row;
 ELSE
  UPDATE public.billing_purchase_requests SET requested_on=v_date,request_number=btrim(p_payload->>'requestNumber'),item_type=p_payload->>'itemType',material_id=v_material,category_id=v_category,
   description=btrim(p_payload->>'description'),reference=coalesce(p_payload->>'reference',''),quantity=v_quantity,unit=btrim(p_payload->>'unit'),application=coalesce(p_payload->>'application',''),urgent=(p_payload->>'urgent')::boolean,status=p_payload->>'status',notes=coalesce(p_payload->>'notes','')
   WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_row;
 END IF;
 DELETE FROM public.billing_purchase_request_vehicles WHERE owner_id=v_owner AND request_id=v_row.id;
 INSERT INTO public.billing_purchase_request_vehicles(owner_id,request_id,vehicle_id) SELECT v_owner,v_row.id,unnest(v_vehicles);
 RETURN jsonb_build_object('request',billing_private.purchase_request_json(v_row),'created',v_old.id IS NULL);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'Confira as datas, quantidades e vínculos informados.' USING ERRCODE='22023';
END $$;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['billing_purchase_requests','billing_purchase_request_vehicles'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('CREATE POLICY purchase_requests_read ON public.%I FOR SELECT TO authenticated USING(billing_private.can_access_owner(owner_id,''registrations.read''))',t);
  EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL',t);
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t); END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION billing_private.purchase_request_json(public.billing_purchase_requests),billing_private.purchase_requests_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
ALTER FUNCTION billing_private.dispatch(text,text,jsonb) RENAME TO dispatch_before_purchase_requests;
REVOKE ALL ON FUNCTION billing_private.dispatch_before_purchase_requests(text,text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.dispatch(p_resource text,p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_resource='purchase-requests' THEN RETURN billing_private.purchase_requests_dispatch(p_action,p_payload); END IF;
 RETURN billing_private.dispatch_before_purchase_requests(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION billing_private.dispatch(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.dispatch(text,text,jsonb) TO authenticated;
COMMIT;
