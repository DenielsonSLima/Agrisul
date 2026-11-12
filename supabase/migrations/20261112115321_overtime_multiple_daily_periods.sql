-- Multiple independently rated overtime periods may share a date. Existing rows and ids are preserved.
ALTER TABLE public.billing_overtime_daily_entries DROP CONSTRAINT billing_overtime_daily_entrie_owner_id_report_id_employee_i_key;
CREATE INDEX billing_overtime_daily_periods ON public.billing_overtime_daily_entries(owner_id,report_id,employee_id,work_date,start_time,id);

CREATE OR REPLACE FUNCTION billing_private.overtime_daily_json(p_row public.billing_overtime_rows)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 WITH sheet AS (SELECT * FROM public.billing_overtime_daily_sheets s WHERE s.owner_id=p_row.owner_id AND s.report_id=p_row.report_id AND s.employee_id=p_row.employee_id),
 totals AS (SELECT coalesce(sum(worked_seconds) FILTER(WHERE rate='50'),0)::bigint a,coalesce(sum(worked_seconds) FILTER(WHERE rate='100'),0)::bigint b
  FROM public.billing_overtime_daily_entries e WHERE e.owner_id=p_row.owner_id AND e.report_id=p_row.report_id AND e.employee_id=p_row.employee_id)
 SELECT jsonb_build_object('employeeId',p_row.employee_id,'activity',coalesce((SELECT activity FROM sheet),''),
  'sector',coalesce((SELECT sector FROM sheet),(SELECT sector FROM public.billing_overtime_reports WHERE owner_id=p_row.owner_id AND id=p_row.report_id)),
  'calculated50',billing_private.overtime_hours(t.a),'calculated100',billing_private.overtime_hours(t.b),
  'totalHours',billing_private.overtime_hours(p_row.seconds_50+p_row.seconds_100),
  'entryCount',(SELECT count(DISTINCT work_date) FROM public.billing_overtime_daily_entries e WHERE e.owner_id=p_row.owner_id AND e.report_id=p_row.report_id AND e.employee_id=p_row.employee_id),
  'total50',billing_private.overtime_hours(p_row.seconds_50),'total100',billing_private.overtime_hours(p_row.seconds_100),
  'legacyHours50',billing_private.overtime_hours(coalesce((SELECT legacy_50 FROM sheet),p_row.seconds_50)),
  'legacyHours100',billing_private.overtime_hours(coalesce((SELECT legacy_100 FROM sheet),p_row.seconds_100)),
  'hasDailyEntries',EXISTS(SELECT 1 FROM sheet),
  'adjustment',(SELECT CASE WHEN adjustment_50 IS NULL THEN NULL ELSE jsonb_build_object('hours50',billing_private.overtime_hours(adjustment_50),'hours100',billing_private.overtime_hours(adjustment_100),'reason',adjustment_reason) END FROM sheet),
  'entries',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'date',work_date,'startTime',to_char(start_time,'HH24:MI:SS'),
   'breakStart',coalesce(to_char(break_start,'HH24:MI:SS'),''),'breakEnd',coalesce(to_char(break_end,'HH24:MI:SS'),''),
   'endTime',to_char(end_time,'HH24:MI:SS'),'breakDuration',billing_private.overtime_hours(break_seconds::bigint),
   'rate',rate,'reason',reason,'approval',approval,
   'hours50',billing_private.overtime_hours(CASE WHEN rate='50' THEN worked_seconds ELSE 0 END::bigint),
   'hours100',billing_private.overtime_hours(CASE WHEN rate='100' THEN worked_seconds ELSE 0 END::bigint)) ORDER BY work_date,start_time,id)
   FROM public.billing_overtime_daily_entries e WHERE e.owner_id=p_row.owner_id AND e.report_id=p_row.report_id AND e.employee_id=p_row.employee_id),'[]'::jsonb)) FROM totals t
$function$
;
REVOKE ALL ON FUNCTION billing_private.overtime_daily_json(public.billing_overtime_rows) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.overtime_dispatch(p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_report public.billing_overtime_reports;v_row public.billing_overtime_rows;
 v_company uuid;v_id uuid;v_employee uuid;v_result jsonb;v_payload jsonb:=p_payload;v_rows jsonb;
 v_entry jsonb;v_entry_id uuid;v_legacy_ids jsonb;v_span tsrange;v_date date;v_start time;v_end time;v_bs time;v_be time;v_start_sec integer;v_end_sec integer;v_bs_sec integer;v_be_sec integer;
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
 IF length(v_activity)>200 OR length(v_sector)>120 OR jsonb_array_length(p_payload->'entries')>2928 THEN RAISE EXCEPTION 'Confira os limites da atividade, setor e lançamentos (até 366 dias e 8 períodos por dia).' USING ERRCODE='22023'; END IF;
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
 -- An older single-row-per-date client must not silently collapse an already split date.
 IF EXISTS(SELECT 1 FROM (
  SELECT work_date FROM public.billing_overtime_daily_entries WHERE owner_id=v_owner AND report_id=v_id AND employee_id=v_employee
  GROUP BY work_date HAVING count(*)>1
 ) split JOIN jsonb_array_elements(p_payload->'entries') x ON x.value->>'date'=split.work_date::text WHERE NOT (x.value ? 'id')) THEN
  RAISE EXCEPTION 'Esta data possui vários períodos. Atualize a página antes de salvar.' USING ERRCODE='23514'; END IF;
 -- Compatibility with older clients: keep an existing single daily period's identity when no id was sent.
 SELECT coalesce(jsonb_object_agg(work_date::text,id),'{}'::jsonb) INTO v_legacy_ids FROM (
  SELECT work_date,id,count(*) OVER(PARTITION BY work_date) daily_count FROM public.billing_overtime_daily_entries
  WHERE owner_id=v_owner AND report_id=v_id AND employee_id=v_employee
 ) previous WHERE daily_count=1 AND (SELECT count(*) FROM jsonb_array_elements(p_payload->'entries') x WHERE x.value->>'date'=previous.work_date::text)=1;
 -- A client may choose an id for a new period, but cannot take one from another employee/report/owner.
 FOR v_entry IN SELECT value FROM jsonb_array_elements(p_payload->'entries') LOOP
  IF v_entry ? 'id' THEN
   IF jsonb_typeof(v_entry->'id') IS DISTINCT FROM 'string' OR btrim(v_entry->>'id')='' THEN
    RAISE EXCEPTION 'Confira a identificação dos períodos.' USING ERRCODE='22023'; END IF;
   v_entry_id=(v_entry->>'id')::uuid;
   IF EXISTS(SELECT 1 FROM public.billing_overtime_daily_entries e WHERE e.id=v_entry_id AND
    (e.owner_id<>v_owner OR e.report_id<>v_id OR e.employee_id<>v_employee)) THEN
    RAISE EXCEPTION 'A identificação do período não pertence a este funcionário e relatório.' USING ERRCODE='22023'; END IF;
  END IF;
 END LOOP;
 DELETE FROM public.billing_overtime_daily_entries WHERE owner_id=v_owner AND report_id=v_id AND employee_id=v_employee;
 FOR v_entry IN SELECT value FROM jsonb_array_elements(p_payload->'entries') LOOP
  PERFORM billing_private.request_payload(v_entry,ARRAY['id','date','startTime','breakStart','breakEnd','endTime','breakDuration','rate','reason','approval']);
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
  v_entry_id=coalesce((v_entry->>'id')::uuid,(v_legacy_ids->>v_date::text)::uuid,gen_random_uuid());
  IF EXISTS(SELECT 1 FROM public.billing_overtime_daily_entries e WHERE e.id=v_entry_id) THEN
   RAISE EXCEPTION 'Existe mais de um período com a mesma identificação.' USING ERRCODE='23505'; END IF;
  IF (SELECT count(*) FROM public.billing_overtime_daily_entries e WHERE e.owner_id=v_owner AND e.report_id=v_id AND
   e.employee_id=v_employee AND e.work_date=v_date)>=8 THEN
   RAISE EXCEPTION 'Informe no máximo 8 períodos de hora extra por dia.' USING ERRCODE='22023'; END IF;
  v_span=tsrange(v_date+v_start,(v_date+v_start)+make_interval(secs=>v_end_sec-v_start_sec),'[)');
  IF EXISTS(SELECT 1 FROM public.billing_overtime_daily_entries e WHERE e.owner_id=v_owner AND e.report_id=v_id AND e.employee_id=v_employee AND e.work_date BETWEEN v_date-1 AND v_date+1 AND
   tsrange(e.work_date+e.start_time,e.work_date+e.end_time+CASE WHEN e.end_time<e.start_time THEN interval '1 day' ELSE interval '0' END,'[)') && v_span) THEN
   RAISE EXCEPTION 'Os períodos de hora extra se cruzam. Divida os horários sem sobreposição, inclusive na virada do dia.' USING ERRCODE='23514'; END IF;
  INSERT INTO public.billing_overtime_daily_entries(id,owner_id,report_id,employee_id,work_date,start_time,break_start,break_end,end_time,break_seconds,rate,reason,approval,worked_seconds)
   VALUES(v_entry_id,v_owner,v_id,v_employee,v_date,v_start,v_bs,v_be,v_end,v_break::integer,v_rate,v_reason,v_approval,v_work);
 END LOOP;
 IF (SELECT count(DISTINCT work_date) FROM public.billing_overtime_daily_entries WHERE owner_id=v_owner AND report_id=v_id AND employee_id=v_employee)>366 THEN
  RAISE EXCEPTION 'Informe lançamentos em no máximo 366 dias por funcionário.' USING ERRCODE='22023'; END IF;
 SELECT coalesce(sum(worked_seconds) FILTER(WHERE rate='50'),0)::bigint,coalesce(sum(worked_seconds) FILTER(WHERE rate='100'),0)::bigint INTO v_total50,v_total100
  FROM public.billing_overtime_daily_entries WHERE owner_id=v_owner AND report_id=v_id AND employee_id=v_employee;
 UPDATE public.billing_overtime_rows SET seconds_50=coalesce(v_adjust50,v_total50),seconds_100=coalesce(v_adjust100,v_total100)
  WHERE owner_id=v_owner AND report_id=v_id AND employee_id=v_employee RETURNING * INTO v_row;
 UPDATE public.billing_overtime_reports SET updated_at=clock_timestamp() WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_report;
 RETURN jsonb_build_object('daily',billing_private.overtime_daily_json(v_row),'report',billing_private.overtime_report_json(v_report,true));
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Existe mais de um período com a mesma identificação.' USING ERRCODE='23505';
 WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Confira os dados, as datas e os horários dos lançamentos.' USING ERRCODE='22023';
END $function$
;
REVOKE ALL ON FUNCTION billing_private.overtime_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
COMMENT ON TABLE public.billing_overtime_daily_entries IS 'Multiple non-overlapping overtime periods per employee/date; stable ids, exact seconds and rates are validated/calculated exclusively by the billing RPC.';
