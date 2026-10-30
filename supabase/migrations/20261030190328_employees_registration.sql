CREATE TABLE public.billing_employees (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 full_name text NOT NULL CHECK(length(btrim(full_name)) BETWEEN 2 AND 160),
 registration_number text NOT NULL CHECK(length(btrim(registration_number)) BETWEEN 1 AND 60),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id)
);
-- Text preserves leading zeroes; the unique index also protects concurrent saves.
CREATE UNIQUE INDEX billing_employees_owner_registration
 ON public.billing_employees(owner_id,lower(registration_number));
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_employees
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();
ALTER TABLE public.billing_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_employees REPLICA IDENTITY FULL;
REVOKE ALL ON public.billing_employees FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_employees TO authenticated;
CREATE POLICY billing_employees_read ON public.billing_employees
 FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'registrations.read'));

CREATE FUNCTION billing_private.employee_json(p_employee public.billing_employees)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',p_employee.id,'fullName',p_employee.full_name,
  'registrationNumber',p_employee.registration_number,
  'createdAt',p_employee.created_at,'updatedAt',p_employee.updated_at)
$$;
REVOKE ALL ON FUNCTION billing_private.employee_json(public.billing_employees)
 FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.employees_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;
 v_employee public.billing_employees;
 v_name text;
 v_registration text;
 v_rows jsonb;
BEGIN
 IF auth.uid() IS NULL OR v_owner IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar os funcionários.' USING ERRCODE='28000';
 END IF;
 IF p_action IS NULL OR p_action NOT IN ('list','save','delete')
  OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
  RAISE EXCEPTION 'Operação de funcionário inválida.' USING ERRCODE='22023';
 END IF;
 IF p_action='list' THEN
  PERFORM billing_private.authorize('registrations.read');
  PERFORM billing_private.request_payload(p_payload,ARRAY[]::text[]);
  SELECT coalesce(jsonb_agg(billing_private.employee_json(e)
   ORDER BY lower(e.full_name),e.registration_number,e.id),'[]'::jsonb)
   INTO v_rows FROM public.billing_employees e WHERE e.owner_id=v_owner;
  RETURN jsonb_build_object('employees',v_rows,
   'canManage',billing_private.has_permission('registrations.write'));
 END IF;
 PERFORM billing_private.lock_request_actor();
 v_owner=billing_private.current_owner_id();
 PERFORM billing_private.authorize('registrations.write');
 PERFORM billing_private.request_payload(p_payload,
  CASE WHEN p_action='save' THEN ARRAY['id','fullName','registrationNumber'] ELSE ARRAY['id'] END);
 IF jsonb_typeof(p_payload->'id')='string' THEN
  v_id=nullif(p_payload->>'id','')::uuid;
 ELSIF p_payload ? 'id' AND jsonb_typeof(p_payload->'id')<>'null' THEN
  RAISE EXCEPTION 'Informe um funcionário válido.' USING ERRCODE='22023';
 END IF;
 IF p_action='delete' THEN
  IF v_id IS NULL THEN
   RAISE EXCEPTION 'Informe o funcionário.' USING ERRCODE='22023';
  END IF;
  DELETE FROM public.billing_employees WHERE owner_id=v_owner AND id=v_id;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Funcionário não encontrado.' USING ERRCODE='P0002';
  END IF;
  RETURN jsonb_build_object('id',v_id,'deleted',true);
 END IF;
 IF jsonb_typeof(p_payload->'fullName') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'registrationNumber') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Informe o nome completo e a matrícula.' USING ERRCODE='22023';
 END IF;
 v_name=btrim(regexp_replace(p_payload->>'fullName','[[:space:]]+',' ','g'));
 v_registration=btrim(regexp_replace(p_payload->>'registrationNumber','[[:space:]]+',' ','g'));
 IF length(v_name) NOT BETWEEN 2 AND 160 THEN
  RAISE EXCEPTION 'Informe o nome completo com 2 a 160 caracteres.' USING ERRCODE='22023';
 END IF;
 IF length(v_registration) NOT BETWEEN 1 AND 60 THEN
  RAISE EXCEPTION 'Informe a matrícula com até 60 caracteres.' USING ERRCODE='22023';
 END IF;
 IF v_id IS NULL THEN
  INSERT INTO public.billing_employees(owner_id,full_name,registration_number)
   VALUES(v_owner,v_name,v_registration) RETURNING * INTO v_employee;
 ELSE
  UPDATE public.billing_employees SET full_name=v_name,registration_number=v_registration
   WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_employee;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Funcionário não encontrado.' USING ERRCODE='P0002';
  END IF;
 END IF;
 RETURN jsonb_build_object('employee',billing_private.employee_json(v_employee));
EXCEPTION
 WHEN unique_violation THEN
  RAISE EXCEPTION 'Já existe um funcionário com esta matrícula.' USING ERRCODE='23505';
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Informe um funcionário válido.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.employees_dispatch(text,jsonb)
 FROM PUBLIC,anon,authenticated;

-- Extend the existing private chain, preserving the public invoker and its guards.
ALTER FUNCTION billing_private.dispatch(text,text,jsonb) RENAME TO dispatch_before_employees;
REVOKE ALL ON FUNCTION billing_private.dispatch_before_employees(text,text,jsonb)
 FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.dispatch(p_resource text,p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_resource='employees' THEN
  RETURN billing_private.employees_dispatch(p_action,p_payload);
 END IF;
 RETURN billing_private.dispatch_before_employees(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION billing_private.dispatch(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.dispatch(text,text,jsonb) TO authenticated;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
  AND NOT EXISTS(SELECT 1 FROM pg_publication_tables
   WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='billing_employees') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_employees;
 END IF;
END $$;
COMMENT ON TABLE public.billing_employees IS
 'Workspace employee registry: full name and unique textual registration number, managed through billing_rpc.';
