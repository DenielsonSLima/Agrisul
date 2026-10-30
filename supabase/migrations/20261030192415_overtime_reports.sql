-- Employee roles feed the overtime report; existing clients may omit jobTitle.
ALTER TABLE public.billing_employees ADD COLUMN job_title text NOT NULL DEFAULT '' CHECK(length(job_title)<=100);
CREATE OR REPLACE FUNCTION billing_private.employee_json(p_employee public.billing_employees)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',p_employee.id,'fullName',p_employee.full_name,
  'registrationNumber',p_employee.registration_number,'jobTitle',p_employee.job_title,
  'createdAt',p_employee.created_at,'updatedAt',p_employee.updated_at)
$$;
CREATE OR REPLACE FUNCTION billing_private.employees_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_id uuid;v_employee public.billing_employees;
 v_name text;v_registration text;v_job text;v_rows jsonb;
BEGIN
 IF auth.uid() IS NULL OR v_owner IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar os funcionários.' USING ERRCODE='28000';
 END IF;
 IF p_action IS NULL OR p_action NOT IN ('list','save','delete') OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
  RAISE EXCEPTION 'Operação de funcionário inválida.' USING ERRCODE='22023';
 END IF;
 IF p_action='list' THEN
  PERFORM billing_private.authorize('registrations.read');
  PERFORM billing_private.request_payload(p_payload,ARRAY[]::text[]);
  SELECT coalesce(jsonb_agg(billing_private.employee_json(e) ORDER BY lower(e.full_name),e.registration_number,e.id),'[]'::jsonb)
   INTO v_rows FROM public.billing_employees e WHERE e.owner_id=v_owner;
  RETURN jsonb_build_object('employees',v_rows,'canManage',billing_private.has_permission('registrations.write'));
 END IF;
 PERFORM billing_private.lock_request_actor();v_owner=billing_private.current_owner_id();
 PERFORM billing_private.authorize('registrations.write');
 PERFORM billing_private.request_payload(p_payload,CASE WHEN p_action='save' THEN ARRAY['id','fullName','registrationNumber','jobTitle'] ELSE ARRAY['id'] END);
 IF jsonb_typeof(p_payload->'id')='string' THEN v_id=nullif(p_payload->>'id','')::uuid;
 ELSIF p_payload ? 'id' AND jsonb_typeof(p_payload->'id')<>'null' THEN
  RAISE EXCEPTION 'Informe um funcionário válido.' USING ERRCODE='22023';
 END IF;
 IF p_action='delete' THEN
  IF v_id IS NULL THEN RAISE EXCEPTION 'Informe o funcionário.' USING ERRCODE='22023'; END IF;
  DELETE FROM public.billing_employees WHERE owner_id=v_owner AND id=v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário não encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('id',v_id,'deleted',true);
 END IF;
 IF jsonb_typeof(p_payload->'fullName') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'registrationNumber') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Informe o nome completo e a matrícula.' USING ERRCODE='22023';
 END IF;
 v_name=btrim(regexp_replace(p_payload->>'fullName','[[:space:]]+',' ','g'));
 v_registration=btrim(regexp_replace(p_payload->>'registrationNumber','[[:space:]]+',' ','g'));
 IF length(v_name) NOT BETWEEN 2 AND 160 THEN RAISE EXCEPTION 'Informe o nome completo com 2 a 160 caracteres.' USING ERRCODE='22023'; END IF;
 IF length(v_registration) NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'Informe a matrícula com até 60 caracteres.' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'jobTitle' THEN
  IF jsonb_typeof(p_payload->'jobTitle') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Informe um cargo válido.' USING ERRCODE='22023'; END IF;
  v_job=btrim(regexp_replace(p_payload->>'jobTitle','[[:space:]]+',' ','g'));
  IF length(v_job)>100 THEN RAISE EXCEPTION 'O cargo deve ter até 100 caracteres.' USING ERRCODE='22023'; END IF;
 END IF;
 IF v_id IS NULL THEN
  INSERT INTO public.billing_employees(owner_id,full_name,registration_number,job_title)
   VALUES(v_owner,v_name,v_registration,coalesce(v_job,'')) RETURNING * INTO v_employee;
 ELSE
  UPDATE public.billing_employees SET full_name=v_name,registration_number=v_registration,job_title=coalesce(v_job,job_title)
   WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_employee;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário não encontrado.' USING ERRCODE='P0002'; END IF;
 END IF;
 RETURN jsonb_build_object('employee',billing_private.employee_json(v_employee));
EXCEPTION
 WHEN unique_violation THEN RAISE EXCEPTION 'Já existe um funcionário com esta matrícula.' USING ERRCODE='23505';
 WHEN foreign_key_violation THEN RAISE EXCEPTION 'Este funcionário está vinculado a relatórios e não pode ser excluído.' USING ERRCODE='23503';
 WHEN invalid_text_representation THEN RAISE EXCEPTION 'Informe um funcionário válido.' USING ERRCODE='22023';
END $$;

CREATE TABLE public.billing_overtime_reports(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 company_id uuid NOT NULL,
 date_from date NOT NULL,
 date_to date NOT NULL CHECK(date_to>=date_from),
 reference_month date NOT NULL CHECK(extract(day FROM reference_month)=1),
 sector text NOT NULL DEFAULT '' CHECK(length(sector)<=120),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id),
 FOREIGN KEY(owner_id,company_id) REFERENCES public.billing_companies(owner_id,id)
);
CREATE INDEX billing_overtime_report_period ON public.billing_overtime_reports(owner_id,company_id,date_from,date_to);
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_overtime_reports
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();
CREATE TABLE public.billing_overtime_rows(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 report_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 employee_name text NOT NULL,
 registration_number text NOT NULL,
 job_title text NOT NULL,
 position integer NOT NULL CHECK(position>0),
 seconds_50 bigint NOT NULL CHECK(seconds_50>=0),
 seconds_100 bigint NOT NULL CHECK(seconds_100>=0),
 CHECK(seconds_50+seconds_100>0),
 UNIQUE(owner_id,report_id,employee_id),
 UNIQUE(owner_id,report_id,position),
 FOREIGN KEY(owner_id,report_id) REFERENCES public.billing_overtime_reports(owner_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,employee_id) REFERENCES public.billing_employees(owner_id,id)
);
CREATE INDEX billing_overtime_row_employee ON public.billing_overtime_rows(owner_id,employee_id);
ALTER TABLE public.billing_overtime_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_overtime_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_overtime_reports REPLICA IDENTITY FULL;
ALTER TABLE public.billing_overtime_rows REPLICA IDENTITY FULL;
REVOKE ALL ON public.billing_overtime_reports,public.billing_overtime_rows FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_overtime_reports,public.billing_overtime_rows TO authenticated;
CREATE POLICY billing_overtime_reports_read ON public.billing_overtime_reports FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'requests.read'));
CREATE POLICY billing_overtime_rows_read ON public.billing_overtime_rows FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'requests.read'));

CREATE FUNCTION billing_private.overtime_seconds(p_value jsonb) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v text;parts text[];
BEGIN
 IF p_value IS NULL THEN RETURN 0; END IF;
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Informe as horas no formato HH:MM ou HH:MM:SS.' USING ERRCODE='22023'; END IF;
 v=btrim(p_value#>>'{}');
 IF v='' THEN RETURN 0; END IF;
 IF v!~'^[0-9]{1,6}:[0-5][0-9](:[0-5][0-9])?$' THEN
  RAISE EXCEPTION 'Informe as horas no formato HH:MM ou HH:MM:SS, como 48:00 ou 21:22:00.' USING ERRCODE='22023';
 END IF;
 parts=string_to_array(v,':');
 RETURN parts[1]::bigint*3600+parts[2]::bigint*60+coalesce(parts[3],'0')::bigint;
END $$;
CREATE FUNCTION billing_private.overtime_hours(p_seconds bigint) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN p_seconds/3600<10 THEN '0' ELSE '' END||(p_seconds/3600)::text||':'||
 lpad(((p_seconds%3600)/60)::text,2,'0')||':'||lpad((p_seconds%60)::text,2,'0')
$$;
REVOKE ALL ON FUNCTION billing_private.overtime_seconds(jsonb),billing_private.overtime_hours(bigint) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.overtime_report_json(p_report public.billing_overtime_reports,p_details boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',p_report.id,'companyId',p_report.company_id,'sector',p_report.sector,
  'dateFrom',p_report.date_from,'dateTo',p_report.date_to,'referenceMonth',to_char(p_report.reference_month,'YYYY-MM'),
  'createdAt',p_report.created_at,'updatedAt',p_report.updated_at,
  'employeeCount',(SELECT count(*) FROM public.billing_overtime_rows r WHERE r.owner_id=p_report.owner_id AND r.report_id=p_report.id),
  'total50',billing_private.overtime_hours(coalesce((SELECT sum(r.seconds_50)::bigint FROM public.billing_overtime_rows r WHERE r.owner_id=p_report.owner_id AND r.report_id=p_report.id),0)),
  'total100',billing_private.overtime_hours(coalesce((SELECT sum(r.seconds_100)::bigint FROM public.billing_overtime_rows r WHERE r.owner_id=p_report.owner_id AND r.report_id=p_report.id),0))
 )||CASE WHEN p_details THEN jsonb_build_object('rows',coalesce((
  SELECT jsonb_agg(jsonb_build_object('employeeId',r.employee_id,'employeeName',r.employee_name,
   'registrationNumber',r.registration_number,'jobTitle',r.job_title,
   'hours50',billing_private.overtime_hours(r.seconds_50),'hours100',billing_private.overtime_hours(r.seconds_100)) ORDER BY r.position)
  FROM public.billing_overtime_rows r WHERE r.owner_id=p_report.owner_id AND r.report_id=p_report.id),'[]'::jsonb))
 ELSE '{}'::jsonb END
$$;
REVOKE ALL ON FUNCTION billing_private.overtime_report_json(public.billing_overtime_reports,boolean) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.overtime_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_company uuid;v_id uuid;
 v_report public.billing_overtime_reports;v_employee public.billing_employees;
 v_from date;v_to date;v_month date;v_sector text;v_items jsonb;v_row jsonb;
 v_index integer:=0;v_50 bigint;v_100 bigint;v_seen uuid[]:=ARRAY[]::uuid[];v_expected timestamptz;
BEGIN
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar os relatórios de hora extra.' USING ERRCODE='28000'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('options','list','get','save','delete') OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
  RAISE EXCEPTION 'Operação de hora extra inválida.' USING ERRCODE='22023';
 END IF;
 PERFORM billing_private.authorize('requests.'||CASE WHEN p_action IN ('options','list','get') THEN 'read' ELSE 'write' END);
 PERFORM billing_private.request_payload(p_payload,CASE WHEN p_action='options' THEN ARRAY['companyId']
  WHEN p_action='list' THEN ARRAY['companyId','dateFrom','dateTo']
  WHEN p_action IN ('get','delete') THEN ARRAY['companyId','id','expectedUpdatedAt']
  ELSE ARRAY['companyId','id','dateFrom','dateTo','referenceMonth','sector','rows','expectedUpdatedAt'] END);
 IF jsonb_typeof(p_payload->'companyId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Selecione a empresa.' USING ERRCODE='22023'; END IF;
 v_company=(p_payload->>'companyId')::uuid;
 PERFORM 1 FROM public.billing_companies WHERE owner_id=v_owner AND id=v_company FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Empresa não encontrada neste espaço.' USING ERRCODE='P0002'; END IF;
 IF p_action='options' THEN
  SELECT coalesce(jsonb_agg(billing_private.employee_json(e) ORDER BY lower(e.full_name),e.registration_number),'[]'::jsonb)
   INTO v_items FROM public.billing_employees e WHERE e.owner_id=v_owner;
  RETURN jsonb_build_object('employees',v_items,'canManage',billing_private.has_permission('requests.write'));
 END IF;
 IF p_action='list' THEN
  IF p_payload ? 'dateFrom' OR p_payload ? 'dateTo' THEN
   IF jsonb_typeof(p_payload->'dateFrom') IS DISTINCT FROM 'string' OR (p_payload->>'dateFrom')!~'^\d{4}-\d{2}-\d{2}$'
    OR jsonb_typeof(p_payload->'dateTo') IS DISTINCT FROM 'string' OR (p_payload->>'dateTo')!~'^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'Informe o período da consulta.' USING ERRCODE='22023';
   END IF;
   v_from=(p_payload->>'dateFrom')::date;v_to=(p_payload->>'dateTo')::date;
   IF v_to<v_from THEN RAISE EXCEPTION 'A data final deve ser igual ou posterior à inicial.' USING ERRCODE='22023'; END IF;
  END IF;
  SELECT coalesce(jsonb_agg(billing_private.overtime_report_json(r) ORDER BY r.date_from DESC,r.created_at DESC,r.id),'[]'::jsonb)
   INTO v_items FROM public.billing_overtime_reports r
   WHERE r.owner_id=v_owner AND r.company_id=v_company AND (v_from IS NULL OR r.date_to>=v_from AND r.date_from<=v_to);
  RETURN jsonb_build_object('reports',v_items,'canManage',billing_private.has_permission('requests.write'));
 END IF;
 IF p_payload ? 'id' THEN
  IF jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Informe um relatório válido.' USING ERRCODE='22023'; END IF;
  v_id=(p_payload->>'id')::uuid;
 END IF;
 IF p_action IN ('save','delete') THEN
  PERFORM billing_private.lock_request_actor();
  IF billing_private.current_owner_id() IS DISTINCT FROM v_owner THEN RAISE EXCEPTION 'O espaço foi alterado. Reabra o relatório.' USING ERRCODE='40001'; END IF;
  PERFORM billing_private.authorize('requests.write');
 END IF;
 IF v_id IS NOT NULL THEN
  IF p_action='get' THEN
   SELECT * INTO v_report FROM public.billing_overtime_reports WHERE owner_id=v_owner AND company_id=v_company AND id=v_id;
  ELSE
   SELECT * INTO v_report FROM public.billing_overtime_reports WHERE owner_id=v_owner AND company_id=v_company AND id=v_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Relatório não encontrado.' USING ERRCODE='P0002'; END IF;
 ELSIF p_action IN ('get','delete') THEN RAISE EXCEPTION 'Informe o relatório.' USING ERRCODE='22023';
 END IF;
 IF p_action='get' THEN RETURN jsonb_build_object('report',billing_private.overtime_report_json(v_report,true),'canManage',billing_private.has_permission('requests.write')); END IF;
 IF v_id IS NOT NULL THEN
  IF jsonb_typeof(p_payload->'expectedUpdatedAt') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Atualize a lista antes de alterar o relatório.' USING ERRCODE='22023'; END IF;
  v_expected=(p_payload->>'expectedUpdatedAt')::timestamptz;
  IF v_expected IS DISTINCT FROM v_report.updated_at THEN RAISE EXCEPTION 'Este relatório foi alterado em outra sessão. Atualize a lista e tente novamente.' USING ERRCODE='40001'; END IF;
 ELSIF p_payload ? 'expectedUpdatedAt' THEN RAISE EXCEPTION 'Informe o relatório que deseja alterar.' USING ERRCODE='22023';
 END IF;
 IF p_action='delete' THEN
  DELETE FROM public.billing_overtime_reports WHERE owner_id=v_owner AND id=v_id;
  RETURN jsonb_build_object('id',v_id,'deleted',true);
 END IF;
 IF jsonb_typeof(p_payload->'dateFrom') IS DISTINCT FROM 'string' OR (p_payload->>'dateFrom')!~'^\d{4}-\d{2}-\d{2}$'
  OR jsonb_typeof(p_payload->'dateTo') IS DISTINCT FROM 'string' OR (p_payload->>'dateTo')!~'^\d{4}-\d{2}-\d{2}$'
  OR jsonb_typeof(p_payload->'referenceMonth') IS DISTINCT FROM 'string' OR (p_payload->>'referenceMonth')!~'^\d{4}-(0[1-9]|1[0-2])$'
  OR jsonb_typeof(p_payload->'sector') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Confira as datas, o mês de referência e o setor.' USING ERRCODE='22023';
 END IF;
 v_from=(p_payload->>'dateFrom')::date;v_to=(p_payload->>'dateTo')::date;
 v_month=((p_payload->>'referenceMonth')||'-01')::date;v_sector=btrim(p_payload->>'sector');
 IF v_to<v_from THEN RAISE EXCEPTION 'A data final deve ser igual ou posterior à inicial.' USING ERRCODE='22023'; END IF;
 IF length(v_sector)>120 THEN RAISE EXCEPTION 'O setor deve ter até 120 caracteres.' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_payload->'rows') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Inclua os funcionários e suas horas.' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_payload->'rows') NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Inclua de 1 a 500 funcionários no relatório.' USING ERRCODE='22023'; END IF;
 IF v_id IS NULL THEN
  INSERT INTO public.billing_overtime_reports(owner_id,company_id,date_from,date_to,reference_month,sector)
   VALUES(v_owner,v_company,v_from,v_to,v_month,v_sector) RETURNING * INTO v_report;
 ELSE
  UPDATE public.billing_overtime_reports SET date_from=v_from,date_to=v_to,reference_month=v_month,sector=v_sector
   WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_report;
  DELETE FROM public.billing_overtime_rows WHERE owner_id=v_owner AND report_id=v_id;
 END IF;
 FOR v_row IN SELECT value FROM jsonb_array_elements(p_payload->'rows') LOOP
  v_index=v_index+1;
  PERFORM billing_private.request_payload(v_row,ARRAY['employeeId','hours50','hours100']);
  IF jsonb_typeof(v_row->'employeeId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Selecione o funcionário da linha %.',v_index USING ERRCODE='22023'; END IF;
  SELECT * INTO v_employee FROM public.billing_employees WHERE owner_id=v_owner AND id=(v_row->>'employeeId')::uuid FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário da linha % não encontrado neste espaço.',v_index USING ERRCODE='P0002'; END IF;
  IF v_employee.id=ANY(v_seen) THEN RAISE EXCEPTION 'O funcionário % foi incluído mais de uma vez.',v_employee.full_name USING ERRCODE='23505'; END IF;
  v_seen=array_append(v_seen,v_employee.id);
  IF btrim(v_employee.job_title)='' THEN RAISE EXCEPTION 'Cadastre o cargo de % em Funcionários antes de salvar o relatório.',v_employee.full_name USING ERRCODE='22023'; END IF;
  v_50=billing_private.overtime_seconds(v_row->'hours50');v_100=billing_private.overtime_seconds(v_row->'hours100');
  IF v_50+v_100=0 THEN RAISE EXCEPTION 'Informe horas de 50%% ou 100%% para %.',v_employee.full_name USING ERRCODE='22023'; END IF;
  INSERT INTO public.billing_overtime_rows(owner_id,report_id,employee_id,employee_name,registration_number,job_title,position,seconds_50,seconds_100)
   VALUES(v_owner,v_report.id,v_employee.id,v_employee.full_name,v_employee.registration_number,v_employee.job_title,v_index,v_50,v_100);
 END LOOP;
 RETURN jsonb_build_object('report',billing_private.overtime_report_json(v_report,true),'created',v_id IS NULL);
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'Confira os dados e as datas do relatório de hora extra.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.overtime_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
ALTER FUNCTION billing_private.dispatch(text,text,jsonb) RENAME TO dispatch_before_overtime;
REVOKE ALL ON FUNCTION billing_private.dispatch_before_overtime(text,text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.dispatch(p_resource text,p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_resource='overtime' THEN RETURN billing_private.overtime_dispatch(p_action,p_payload); END IF;
 RETURN billing_private.dispatch_before_overtime(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION billing_private.dispatch(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.dispatch(text,text,jsonb) TO authenticated;
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['billing_overtime_reports','billing_overtime_rows'] LOOP
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND NOT EXISTS(
   SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
   EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);
  END IF;
 END LOOP;
END $$;
COMMENT ON TABLE public.billing_overtime_reports IS 'Period and sector overtime sheets with separate 50% and 100% quantities. All validation and totals are server-owned.';
COMMENT ON TABLE public.billing_overtime_rows IS 'Ordered employee snapshots and exact duration seconds; job titles and identity come exclusively from the employee registry.';
