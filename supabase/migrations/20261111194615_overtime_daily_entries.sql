-- Daily clocks are the source of monthly totals. Historical monthly-only sheets
-- remain untouched until their employee's daily sheet is deliberately saved.
CREATE TABLE public.billing_overtime_daily_sheets(
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 report_id uuid NOT NULL,employee_id uuid NOT NULL,
 activity text NOT NULL DEFAULT '' CHECK(length(activity)<=200),
 sector text NOT NULL DEFAULT '' CHECK(length(sector)<=120),
 adjustment_50 bigint CHECK(adjustment_50>=0),adjustment_100 bigint CHECK(adjustment_100>=0),
 adjustment_reason text NOT NULL DEFAULT '' CHECK(length(adjustment_reason)<=500),
 legacy_50 bigint NOT NULL CHECK(legacy_50>=0),legacy_100 bigint NOT NULL CHECK(legacy_100>=0),
 PRIMARY KEY(owner_id,report_id,employee_id),
 FOREIGN KEY(owner_id,report_id) REFERENCES public.billing_overtime_reports(owner_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,employee_id) REFERENCES public.billing_employees(owner_id,id),
 CHECK((adjustment_50 IS NULL AND adjustment_100 IS NULL AND adjustment_reason='') OR
  (adjustment_50 IS NOT NULL AND adjustment_100 IS NOT NULL AND length(btrim(adjustment_reason))>=3))
);
CREATE TABLE public.billing_overtime_daily_entries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL,report_id uuid NOT NULL,employee_id uuid NOT NULL,
 work_date date NOT NULL,start_time time NOT NULL,break_start time,break_end time,end_time time NOT NULL,
 break_seconds integer NOT NULL CHECK(break_seconds>=0 AND break_seconds<86400),
 rate text NOT NULL CHECK(rate IN ('50','100')),
 reason text NOT NULL DEFAULT '' CHECK(length(reason)<=500),approval text NOT NULL DEFAULT '' CHECK(length(approval)<=120),
 worked_seconds integer NOT NULL CHECK(worked_seconds>0 AND worked_seconds<86400),
 UNIQUE(owner_id,report_id,employee_id,work_date),
 FOREIGN KEY(owner_id,report_id,employee_id) REFERENCES public.billing_overtime_daily_sheets(owner_id,report_id,employee_id) ON DELETE CASCADE,
 CHECK((break_start IS NULL)=(break_end IS NULL))
);
CREATE INDEX billing_overtime_daily_employee ON public.billing_overtime_daily_sheets(owner_id,employee_id);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['billing_overtime_daily_sheets','billing_overtime_daily_entries'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING(billing_private.can_access_owner(owner_id,''overtime.read''))',t||'_read',t);
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND NOT EXISTS(
   SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
   EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);
  END IF;
 END LOOP;
END $$;

CREATE FUNCTION billing_private.overtime_daily_json(p_row public.billing_overtime_rows) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH sheet AS (SELECT * FROM public.billing_overtime_daily_sheets s WHERE s.owner_id=p_row.owner_id AND s.report_id=p_row.report_id AND s.employee_id=p_row.employee_id),
 totals AS (SELECT coalesce(sum(worked_seconds) FILTER(WHERE rate='50'),0)::bigint a,coalesce(sum(worked_seconds) FILTER(WHERE rate='100'),0)::bigint b
  FROM public.billing_overtime_daily_entries e WHERE e.owner_id=p_row.owner_id AND e.report_id=p_row.report_id AND e.employee_id=p_row.employee_id)
 SELECT jsonb_build_object('employeeId',p_row.employee_id,'activity',coalesce((SELECT activity FROM sheet),''),
  'sector',coalesce((SELECT sector FROM sheet),(SELECT sector FROM public.billing_overtime_reports WHERE owner_id=p_row.owner_id AND id=p_row.report_id)),
  'calculated50',billing_private.overtime_hours(t.a),'calculated100',billing_private.overtime_hours(t.b),
  'total50',billing_private.overtime_hours(p_row.seconds_50),'total100',billing_private.overtime_hours(p_row.seconds_100),
  'legacyHours50',billing_private.overtime_hours(coalesce((SELECT legacy_50 FROM sheet),p_row.seconds_50)),
  'legacyHours100',billing_private.overtime_hours(coalesce((SELECT legacy_100 FROM sheet),p_row.seconds_100)),
  'hasDailyEntries',EXISTS(SELECT 1 FROM sheet),
  'adjustment',(SELECT CASE WHEN adjustment_50 IS NULL THEN NULL ELSE jsonb_build_object('hours50',billing_private.overtime_hours(adjustment_50),'hours100',billing_private.overtime_hours(adjustment_100),'reason',adjustment_reason) END FROM sheet),
  'entries',coalesce((SELECT jsonb_agg(jsonb_build_object('date',work_date,'startTime',to_char(start_time,'HH24:MI:SS'),
   'breakStart',coalesce(to_char(break_start,'HH24:MI:SS'),''),'breakEnd',coalesce(to_char(break_end,'HH24:MI:SS'),''),
   'endTime',to_char(end_time,'HH24:MI:SS'),'breakDuration',billing_private.overtime_hours(break_seconds::bigint),
   'rate',rate,'reason',reason,'approval',approval,
   'hours50',billing_private.overtime_hours(CASE WHEN rate='50' THEN worked_seconds ELSE 0 END::bigint),
   'hours100',billing_private.overtime_hours(CASE WHEN rate='100' THEN worked_seconds ELSE 0 END::bigint)) ORDER BY work_date)
   FROM public.billing_overtime_daily_entries e WHERE e.owner_id=p_row.owner_id AND e.report_id=p_row.report_id AND e.employee_id=p_row.employee_id),'[]'::jsonb)) FROM totals t
$$;
REVOKE ALL ON FUNCTION billing_private.overtime_daily_json(public.billing_overtime_rows) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.overtime_report_json(public.billing_overtime_reports,boolean) RENAME TO overtime_report_json_before_daily;
CREATE FUNCTION billing_private.overtime_report_json(p_report public.billing_overtime_reports,p_details boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT billing_private.overtime_report_json_before_daily(p_report,p_details)||CASE WHEN p_details THEN jsonb_build_object('rows',coalesce((
  SELECT jsonb_agg(jsonb_build_object('employeeId',r.employee_id,'employeeName',r.employee_name,'registrationNumber',r.registration_number,'jobTitle',r.job_title,
   'hours50',billing_private.overtime_hours(r.seconds_50),'hours100',billing_private.overtime_hours(r.seconds_100),
   'source',CASE WHEN s.employee_id IS NULL THEN 'legacy' ELSE 'daily' END)||
   CASE WHEN s.employee_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('daily',billing_private.overtime_daily_json(r)) END ORDER BY r.position)
  FROM public.billing_overtime_rows r LEFT JOIN public.billing_overtime_daily_sheets s ON(s.owner_id=r.owner_id AND s.report_id=r.report_id AND s.employee_id=r.employee_id)
  WHERE r.owner_id=p_report.owner_id AND r.report_id=p_report.id),'[]'::jsonb)) ELSE '{}'::jsonb END
$$;
REVOKE ALL ON FUNCTION billing_private.overtime_report_json(public.billing_overtime_reports,boolean) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.overtime_dispatch(text,jsonb) RENAME TO overtime_dispatch_before_daily;
CREATE FUNCTION billing_private.overtime_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_report public.billing_overtime_reports;v_row public.billing_overtime_rows;
 v_company uuid;v_id uuid;v_employee uuid;v_result jsonb;v_payload jsonb:=p_payload;v_rows jsonb;
 v_entry jsonb;v_date date;v_start time;v_end time;v_bs time;v_be time;v_start_sec integer;v_end_sec integer;v_bs_sec integer;v_be_sec integer;
 v_break bigint;v_work integer;v_activity text;v_sector text;v_reason text;v_approval text;v_rate text;
 v_adjust50 bigint;v_adjust100 bigint;v_adjust_reason text:='';v_total50 bigint;v_total100 bigint;
BEGIN
 IF p_action NOT IN ('daily-get','daily-save','save') OR p_action IS NULL THEN RETURN billing_private.overtime_dispatch_before_daily(p_action,p_payload); END IF;
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar as horas extras.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize('overtime.'||CASE WHEN p_action='daily-get' THEN 'read' ELSE 'write' END);
 -- Preserve the existing save contract, but calculated totals cannot be overwritten by a stale browser draft.
 IF p_action='save' THEN
  IF jsonb_typeof(p_payload->'id')='string' AND jsonb_typeof(p_payload->'companyId')='string' THEN
   PERFORM billing_private.lock_request_actor();
   IF billing_private.current_owner_id() IS DISTINCT FROM v_owner THEN RAISE EXCEPTION 'O espaço foi alterado. Reabra a tela.' USING ERRCODE='23514'; END IF;
   v_id=(p_payload->>'id')::uuid;v_company=(p_payload->>'companyId')::uuid;
   SELECT * INTO v_report FROM public.billing_overtime_reports WHERE owner_id=v_owner AND id=v_id AND company_id=v_company FOR UPDATE;
   IF FOUND THEN
    IF EXISTS(SELECT 1 FROM public.billing_overtime_daily_entries WHERE owner_id=v_owner AND report_id=v_id AND
     (work_date<(p_payload->>'dateFrom')::date OR work_date>(p_payload->>'dateTo')::date)) THEN
     RAISE EXCEPTION 'O período precisa incluir todos os lançamentos diários. Ajuste os lançamentos antes de reduzir o período.' USING ERRCODE='23514'; END IF;
    IF jsonb_typeof(p_payload->'rows')='array' THEN
     SELECT coalesce(jsonb_agg(CASE WHEN s.employee_id IS NULL THEN x.value ELSE
      x.value||jsonb_build_object('hours50',billing_private.overtime_hours(r.seconds_50),'hours100',billing_private.overtime_hours(r.seconds_100)) END ORDER BY x.ord),'[]'::jsonb)
      INTO v_rows FROM jsonb_array_elements(p_payload->'rows') WITH ORDINALITY x(value,ord)
      LEFT JOIN public.billing_overtime_rows r ON(r.owner_id=v_owner AND r.report_id=v_id AND r.employee_id=(x.value->>'employeeId')::uuid)
      LEFT JOIN public.billing_overtime_daily_sheets s ON(s.owner_id=r.owner_id AND s.report_id=r.report_id AND s.employee_id=r.employee_id);
     v_payload=jsonb_set(v_payload,'{rows}',v_rows);
    END IF;
   END IF;
  END IF;
  v_result=billing_private.overtime_dispatch_before_daily(p_action,v_payload);
  v_id=(v_result->'report'->>'id')::uuid;
  DELETE FROM public.billing_overtime_daily_sheets s WHERE s.owner_id=v_owner AND s.report_id=v_id AND NOT EXISTS(
   SELECT 1 FROM public.billing_overtime_rows r WHERE r.owner_id=s.owner_id AND r.report_id=s.report_id AND r.employee_id=s.employee_id);
  RETURN v_result;
 END IF;
 PERFORM billing_private.request_payload(p_payload,CASE WHEN p_action='daily-get' THEN ARRAY['companyId','id','employeeId'] ELSE
  ARRAY['companyId','id','employeeId','expectedUpdatedAt','activity','sector','entries','adjustment'] END);
 IF jsonb_typeof(p_payload->'companyId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'employeeId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Informe o relatório e o funcionário.' USING ERRCODE='22023'; END IF;
 v_company=(p_payload->>'companyId')::uuid;v_id=(p_payload->>'id')::uuid;v_employee=(p_payload->>'employeeId')::uuid;
 IF p_action='daily-save' THEN
  PERFORM billing_private.lock_request_actor();
  IF billing_private.current_owner_id() IS DISTINCT FROM v_owner THEN RAISE EXCEPTION 'O espaço foi alterado. Reabra a tela.' USING ERRCODE='23514'; END IF;
  PERFORM billing_private.authorize('overtime.write');
  SELECT * INTO v_report FROM public.billing_overtime_reports WHERE owner_id=v_owner AND id=v_id AND company_id=v_company FOR UPDATE;
 ELSE SELECT * INTO v_report FROM public.billing_overtime_reports WHERE owner_id=v_owner AND id=v_id AND company_id=v_company; END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Relatório não encontrado.' USING ERRCODE='P0002'; END IF;
 SELECT * INTO v_row FROM public.billing_overtime_rows WHERE owner_id=v_owner AND report_id=v_id AND employee_id=v_employee;
 IF NOT FOUND THEN RAISE EXCEPTION 'Funcionário não encontrado neste relatório.' USING ERRCODE='P0002'; END IF;
 IF p_action='daily-get' THEN RETURN jsonb_build_object('daily',billing_private.overtime_daily_json(v_row),'report',billing_private.overtime_report_json(v_report,true)); END IF;
 IF v_report.status<>'open' THEN RAISE EXCEPTION 'Abra novamente o relatório antes de alterar os lançamentos.' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(p_payload->'expectedUpdatedAt') IS DISTINCT FROM 'string' OR
  (p_payload->>'expectedUpdatedAt')::timestamptz IS DISTINCT FROM v_report.updated_at THEN
  RAISE EXCEPTION 'Este relatório foi alterado em outra sessão. Atualize a tela.' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(p_payload->'activity') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'sector') IS DISTINCT FROM 'string' OR
  jsonb_typeof(p_payload->'entries') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Confira a atividade, o setor e os lançamentos.' USING ERRCODE='22023'; END IF;
 v_activity=btrim(p_payload->>'activity');v_sector=btrim(p_payload->>'sector');
 IF length(v_activity)>200 OR length(v_sector)>120 OR jsonb_array_length(p_payload->'entries')>366 THEN RAISE EXCEPTION 'Confira os limites da atividade, setor e lançamentos (até 366 dias).' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'adjustment' AND jsonb_typeof(p_payload->'adjustment')<>'null' THEN
  PERFORM billing_private.request_payload(p_payload->'adjustment',ARRAY['hours50','hours100','reason']);
  IF jsonb_typeof(p_payload->'adjustment'->'hours50') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'adjustment'->'hours100') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_payload->'adjustment'->'reason') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Informe os totais e o motivo do ajuste.' USING ERRCODE='22023'; END IF;
  v_adjust50=billing_private.overtime_seconds(p_payload->'adjustment'->'hours50');v_adjust100=billing_private.overtime_seconds(p_payload->'adjustment'->'hours100');
  v_adjust_reason=btrim(p_payload->'adjustment'->>'reason');
  IF length(v_adjust_reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Justifique o ajuste com 3 a 500 caracteres.' USING ERRCODE='22023'; END IF;
 END IF;
 INSERT INTO public.billing_overtime_daily_sheets(owner_id,report_id,employee_id,activity,sector,adjustment_50,adjustment_100,adjustment_reason,legacy_50,legacy_100)
 VALUES(v_owner,v_id,v_employee,v_activity,v_sector,v_adjust50,v_adjust100,v_adjust_reason,v_row.seconds_50,v_row.seconds_100)
 ON CONFLICT(owner_id,report_id,employee_id) DO UPDATE SET activity=excluded.activity,sector=excluded.sector,
  adjustment_50=excluded.adjustment_50,adjustment_100=excluded.adjustment_100,adjustment_reason=excluded.adjustment_reason;
 DELETE FROM public.billing_overtime_daily_entries WHERE owner_id=v_owner AND report_id=v_id AND employee_id=v_employee;
 FOR v_entry IN SELECT value FROM jsonb_array_elements(p_payload->'entries') LOOP
  PERFORM billing_private.request_payload(v_entry,ARRAY['date','startTime','breakStart','breakEnd','endTime','breakDuration','rate','reason','approval']);
  IF jsonb_typeof(v_entry->'date') IS DISTINCT FROM 'string' OR (v_entry->>'date')!~'^\d{4}-\d{2}-\d{2}$' OR
   jsonb_typeof(v_entry->'startTime') IS DISTINCT FROM 'string' OR (v_entry->>'startTime')!~'^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' OR
   jsonb_typeof(v_entry->'endTime') IS DISTINCT FROM 'string' OR (v_entry->>'endTime')!~'^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' OR
   jsonb_typeof(v_entry->'rate') IS DISTINCT FROM 'string' OR (v_entry->>'rate') NOT IN ('50','100') THEN
   RAISE EXCEPTION 'Informe a data, os horários inicial/final e a faixa de 50%% ou 100%%.' USING ERRCODE='22023'; END IF;
  v_date=(v_entry->>'date')::date;v_start=(v_entry->>'startTime')::time;v_end=(v_entry->>'endTime')::time;v_rate=v_entry->>'rate';
  IF v_date<v_report.date_from OR v_date>v_report.date_to THEN RAISE EXCEPTION 'O lançamento deve estar dentro do período do relatório.' USING ERRCODE='22023'; END IF;
  v_start_sec=extract(epoch FROM v_start)::integer;v_end_sec=extract(epoch FROM v_end)::integer;
  IF v_end_sec=v_start_sec THEN RAISE EXCEPTION 'Os horários inicial e final devem ser diferentes.' USING ERRCODE='22023'; END IF;
  IF v_end_sec<v_start_sec THEN v_end_sec=v_end_sec+86400; END IF;
  v_bs=NULL;v_be=NULL;
  IF (v_entry ? 'breakStart' AND jsonb_typeof(v_entry->'breakStart') IS DISTINCT FROM 'string') OR
   (v_entry ? 'breakEnd' AND jsonb_typeof(v_entry->'breakEnd') IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'Confira os horários do intervalo.' USING ERRCODE='22023'; END IF;
  IF coalesce(v_entry->>'breakStart','')<>'' OR coalesce(v_entry->>'breakEnd','')<>'' THEN
   IF coalesce(v_entry->>'breakStart','')!~'^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' OR
    coalesce(v_entry->>'breakEnd','')!~'^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' THEN RAISE EXCEPTION 'Preencha a saída e o retorno do intervalo.' USING ERRCODE='22023'; END IF;
   v_bs=(v_entry->>'breakStart')::time;v_be=(v_entry->>'breakEnd')::time;
   v_bs_sec=extract(epoch FROM v_bs)::integer;v_be_sec=extract(epoch FROM v_be)::integer;
   IF v_bs_sec<v_start_sec THEN v_bs_sec=v_bs_sec+86400; END IF;
   IF v_be_sec<v_bs_sec THEN v_be_sec=v_be_sec+86400; END IF;
   IF v_bs_sec<v_start_sec OR v_be_sec<=v_bs_sec OR v_be_sec>v_end_sec THEN RAISE EXCEPTION 'O intervalo deve estar dentro dos horários inicial e final.' USING ERRCODE='22023'; END IF;
   v_break=v_be_sec-v_bs_sec;
  ELSE
   IF jsonb_typeof(v_entry->'breakDuration') IS DISTINCT FROM 'string' OR btrim(v_entry->>'breakDuration')='' THEN
    RAISE EXCEPTION 'Informe a duração do intervalo (00:00 se não houve intervalo).' USING ERRCODE='22023'; END IF;
   v_break=billing_private.overtime_seconds(v_entry->'breakDuration');
  END IF;
  IF v_break>=v_end_sec-v_start_sec THEN RAISE EXCEPTION 'O intervalo deve ser menor que o período trabalhado.' USING ERRCODE='22023'; END IF;
  v_work=v_end_sec-v_start_sec-v_break;
  IF (v_entry ? 'reason' AND jsonb_typeof(v_entry->'reason') IS DISTINCT FROM 'string') OR
   (v_entry ? 'approval' AND jsonb_typeof(v_entry->'approval') IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'Confira o motivo e o visto.' USING ERRCODE='22023'; END IF;
  v_reason=btrim(coalesce(v_entry->>'reason',''));v_approval=btrim(coalesce(v_entry->>'approval',''));
  IF length(v_reason)>500 OR length(v_approval)>120 THEN RAISE EXCEPTION 'O motivo deve ter até 500 caracteres e o visto até 120.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.billing_overtime_daily_entries(owner_id,report_id,employee_id,work_date,start_time,break_start,break_end,end_time,break_seconds,rate,reason,approval,worked_seconds)
   VALUES(v_owner,v_id,v_employee,v_date,v_start,v_bs,v_be,v_end,v_break::integer,v_rate,v_reason,v_approval,v_work);
 END LOOP;
 SELECT coalesce(sum(worked_seconds) FILTER(WHERE rate='50'),0)::bigint,coalesce(sum(worked_seconds) FILTER(WHERE rate='100'),0)::bigint INTO v_total50,v_total100
  FROM public.billing_overtime_daily_entries WHERE owner_id=v_owner AND report_id=v_id AND employee_id=v_employee;
 UPDATE public.billing_overtime_rows SET seconds_50=coalesce(v_adjust50,v_total50),seconds_100=coalesce(v_adjust100,v_total100)
  WHERE owner_id=v_owner AND report_id=v_id AND employee_id=v_employee RETURNING * INTO v_row;
 UPDATE public.billing_overtime_reports SET updated_at=clock_timestamp() WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_report;
 RETURN jsonb_build_object('daily',billing_private.overtime_daily_json(v_row),'report',billing_private.overtime_report_json(v_report,true));
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Existe mais de um lançamento para o mesmo dia ou funcionário.' USING ERRCODE='23505';
 WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Confira os dados, as datas e os horários dos lançamentos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.overtime_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
COMMENT ON TABLE public.billing_overtime_daily_sheets IS 'Daily employee sheet and explicitly justified total override; historical monthly values are retained for traceability.';
COMMENT ON TABLE public.billing_overtime_daily_entries IS 'One overtime interval per employee/date; exact seconds and rate are validated/calculated exclusively by the billing RPC.';
