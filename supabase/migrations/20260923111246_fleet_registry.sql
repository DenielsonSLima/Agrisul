-- Owner-scoped fleet registry exposed only through billing_rpc.
CREATE TABLE public.billing_fleet_vehicles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 internal_code text NOT NULL CHECK(length(btrim(internal_code)) BETWEEN 1 AND 60),
 model text NOT NULL CHECK(length(btrim(model)) BETWEEN 2 AND 150),
 brand text NOT NULL CHECK(length(btrim(brand)) BETWEEN 2 AND 100),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=1000),
 UNIQUE(owner_id,id),
 UNIQUE(owner_id,internal_code)
);
CREATE INDEX billing_fleet_vehicles_owner_order
 ON public.billing_fleet_vehicles(owner_id,lower(brand),lower(model),id);
ALTER TABLE public.billing_fleet_vehicles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_fleet_vehicles FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_fleet_vehicles TO authenticated;
CREATE POLICY billing_fleet_vehicles_read ON public.billing_fleet_vehicles
 FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'registrations.read'));
CREATE TRIGGER billing_touch_updated_at
 BEFORE UPDATE ON public.billing_fleet_vehicles
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();

CREATE FUNCTION billing_private.fleet_vehicle_json(p_vehicle public.billing_fleet_vehicles)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT (billing_private.present(to_jsonb(p_vehicle))-'internal_code')
  || jsonb_build_object('internalCode',p_vehicle.internal_code)
$$;
REVOKE ALL ON FUNCTION billing_private.fleet_vehicle_json(public.billing_fleet_vehicles)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.fleet_vehicle_json(public.billing_fleet_vehicles) TO authenticated;

CREATE FUNCTION billing_private.fleet_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;
 v_vehicle public.billing_fleet_vehicles;
 v_result jsonb;
BEGIN
 IF v_owner IS NULL OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR p_action NOT IN ('list','get','save','delete') THEN
  RAISE EXCEPTION 'Operação de frota inválida.' USING ERRCODE='22023';
 END IF;

 IF p_action IN ('list','get') THEN
  PERFORM billing_private.authorize('registrations.read');
 ELSE
  PERFORM billing_private.lock_request_actor();
  PERFORM billing_private.authorize('registrations.write');
 END IF;

 IF p_action='list' THEN
  PERFORM billing_private.request_payload(p_payload,ARRAY[]::text[]);
  SELECT coalesce(
   jsonb_agg(billing_private.fleet_vehicle_json(v) ORDER BY lower(v.brand),lower(v.model),v.id),
   '[]'::jsonb
  ) INTO v_result
  FROM public.billing_fleet_vehicles v WHERE v.owner_id=v_owner;
  RETURN jsonb_build_object(
   'vehicles',v_result,
   'canManage',billing_private.has_permission('registrations.write')
  );
 END IF;

 PERFORM billing_private.request_payload(
  p_payload,
  CASE WHEN p_action='save'
   THEN ARRAY['id','internalCode','model','brand','description']
   ELSE ARRAY['id'] END
 );
 v_id=nullif(p_payload->>'id','')::uuid;
 IF v_id IS NULL AND p_action<>'save' THEN
  RAISE EXCEPTION 'Informe o veículo.' USING ERRCODE='22023';
 END IF;

 IF p_action='get' THEN
  SELECT * INTO v_vehicle FROM public.billing_fleet_vehicles
   WHERE owner_id=v_owner AND id=v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Veículo não encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('vehicle',billing_private.fleet_vehicle_json(v_vehicle));
 END IF;

 IF p_action='delete' THEN
  DELETE FROM public.billing_fleet_vehicles WHERE owner_id=v_owner AND id=v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Veículo não encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('id',v_id,'deleted',true);
 END IF;

 IF jsonb_typeof(p_payload->'internalCode') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'model') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'brand') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'description') IS DISTINCT FROM 'string'
  OR length(btrim(p_payload->>'internalCode')) NOT BETWEEN 1 AND 60
  OR length(btrim(p_payload->>'model')) NOT BETWEEN 2 AND 150
  OR length(btrim(p_payload->>'brand')) NOT BETWEEN 2 AND 100
  OR length(p_payload->>'description')>1000 THEN
  RAISE EXCEPTION 'Preencha código interno, modelo e marca corretamente.' USING ERRCODE='22023';
 END IF;

 IF v_id IS NULL THEN
  INSERT INTO public.billing_fleet_vehicles(owner_id,internal_code,model,brand,description)
  VALUES(
   v_owner,btrim(p_payload->>'internalCode'),btrim(p_payload->>'model'),
   btrim(p_payload->>'brand'),btrim(p_payload->>'description')
  ) RETURNING * INTO v_vehicle;
 ELSE
  UPDATE public.billing_fleet_vehicles SET
   internal_code=btrim(p_payload->>'internalCode'),model=btrim(p_payload->>'model'),
   brand=btrim(p_payload->>'brand'),description=btrim(p_payload->>'description')
  WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_vehicle;
  IF NOT FOUND THEN RAISE EXCEPTION 'Veículo não encontrado.' USING ERRCODE='P0002'; END IF;
 END IF;
 RETURN jsonb_build_object('vehicle',billing_private.fleet_vehicle_json(v_vehicle));
EXCEPTION
 WHEN unique_violation THEN
  RAISE EXCEPTION 'Já existe um veículo com este código interno.' USING ERRCODE='23505';
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Informe um veículo válido.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.fleet_dispatch(text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.fleet_dispatch(text,jsonb) TO authenticated;

ALTER FUNCTION billing_private.dispatch(text,text,jsonb)
 RENAME TO dispatch_before_fleet;
REVOKE ALL ON FUNCTION billing_private.dispatch_before_fleet(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.dispatch(p_resource text,p_action text,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_resource='fleet' THEN
  RETURN billing_private.fleet_dispatch(p_action,p_payload);
 END IF;
 RETURN billing_private.dispatch_before_fleet(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION billing_private.dispatch(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.dispatch(text,text,jsonb) TO authenticated;
