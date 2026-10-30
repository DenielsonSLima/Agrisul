ALTER TABLE public.billing_overtime_reports
 ADD COLUMN notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 ADD COLUMN status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','finished')),
 ADD COLUMN finished_at timestamptz;
CREATE INDEX billing_overtime_report_status ON public.billing_overtime_reports(owner_id,company_id,status,date_from DESC);

ALTER FUNCTION billing_private.overtime_report_json(public.billing_overtime_reports,boolean)
 RENAME TO overtime_report_json_before_workflow;
REVOKE ALL ON FUNCTION billing_private.overtime_report_json_before_workflow(public.billing_overtime_reports,boolean) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.overtime_report_json(p_report public.billing_overtime_reports,p_details boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT billing_private.overtime_report_json_before_workflow(p_report,p_details)||
  jsonb_build_object('notes',p_report.notes,'status',p_report.status,'finishedAt',p_report.finished_at)
$$;
REVOKE ALL ON FUNCTION billing_private.overtime_report_json(public.billing_overtime_reports,boolean) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.overtime_dispatch(text,jsonb) RENAME TO overtime_dispatch_before_workflow;
REVOKE ALL ON FUNCTION billing_private.overtime_dispatch_before_workflow(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.overtime_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_company uuid;v_id uuid;
 v_report public.billing_overtime_reports;v_from date;v_to date;v_notes text;v_search text;v_status text;
 v_rows jsonb;v_counts jsonb;v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar os relatórios de hora extra.' USING ERRCODE='28000'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('options','list','get','create','save','finish','delete') OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
  RAISE EXCEPTION 'Operação de hora extra inválida.' USING ERRCODE='22023';
 END IF;
 PERFORM billing_private.authorize('requests.'||CASE WHEN p_action IN ('options','list','get') THEN 'read' ELSE 'write' END);
 PERFORM billing_private.request_payload(p_payload,CASE
  WHEN p_action='options' THEN ARRAY['companyId']
  WHEN p_action='list' THEN ARRAY['companyId','dateFrom','dateTo','search','status']
  WHEN p_action='create' THEN ARRAY['companyId','dateFrom','dateTo','notes']
  WHEN p_action='save' THEN ARRAY['companyId','id','dateFrom','dateTo','referenceMonth','sector','rows','expectedUpdatedAt','notes']
  ELSE ARRAY['companyId','id','expectedUpdatedAt'] END);
 IF p_action='options' THEN RETURN billing_private.overtime_dispatch_before_workflow(p_action,p_payload); END IF;
 IF jsonb_typeof(p_payload->'companyId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Selecione a empresa.' USING ERRCODE='22023'; END IF;
 v_company=(p_payload->>'companyId')::uuid;
 PERFORM 1 FROM public.billing_companies WHERE owner_id=v_owner AND id=v_company FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Empresa não encontrada neste espaço.' USING ERRCODE='P0002'; END IF;
 IF p_action='list' THEN
  IF p_payload ? 'dateFrom' OR p_payload ? 'dateTo' THEN
   IF jsonb_typeof(p_payload->'dateFrom') IS DISTINCT FROM 'string' OR (p_payload->>'dateFrom')!~'^\d{4}-\d{2}-\d{2}$'
    OR jsonb_typeof(p_payload->'dateTo') IS DISTINCT FROM 'string' OR (p_payload->>'dateTo')!~'^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'Informe o período da consulta.' USING ERRCODE='22023';
   END IF;
   v_from=(p_payload->>'dateFrom')::date;v_to=(p_payload->>'dateTo')::date;
   IF v_to<v_from THEN RAISE EXCEPTION 'A data final deve ser igual ou posterior à inicial.' USING ERRCODE='22023'; END IF;
  END IF;
  IF p_payload ? 'search' AND jsonb_typeof(p_payload->'search') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Informe uma busca válida.' USING ERRCODE='22023'; END IF;
  v_search=lower(btrim(coalesce(p_payload->>'search','')));
  IF length(v_search)>160 THEN RAISE EXCEPTION 'A busca deve ter até 160 caracteres.' USING ERRCODE='22023'; END IF;
  v_status=coalesce(p_payload->>'status','open');
  IF v_status NOT IN ('open','finished') THEN RAISE EXCEPTION 'Selecione uma situação válida.' USING ERRCODE='22023'; END IF;
  WITH filtered AS (
   SELECT r.* FROM public.billing_overtime_reports r WHERE r.owner_id=v_owner AND r.company_id=v_company
    AND (v_from IS NULL OR r.date_to>=v_from AND r.date_from<=v_to)
    AND (v_search='' OR strpos(lower(r.notes||' '||r.sector||' '||to_char(r.date_from,'DD/MM/YYYY')||' '||to_char(r.date_to,'DD/MM/YYYY')||' '||to_char(r.reference_month,'MM/YYYY')),v_search)>0
     OR EXISTS(SELECT 1 FROM public.billing_overtime_rows e WHERE e.owner_id=r.owner_id AND e.report_id=r.id
      AND strpos(lower(e.employee_name||' '||e.registration_number||' '||e.job_title),v_search)>0))
  ) SELECT
   (SELECT coalesce(jsonb_agg(billing_private.overtime_report_json(r::public.billing_overtime_reports) ORDER BY r.date_from DESC,r.created_at DESC,r.id),'[]'::jsonb) FROM filtered r WHERE r.status=v_status),
   (SELECT jsonb_build_object('open',count(*) FILTER(WHERE status='open'),'finished',count(*) FILTER(WHERE status='finished')) FROM filtered)
   INTO v_rows,v_counts;
  RETURN jsonb_build_object('reports',v_rows,'counts',v_counts,'canManage',billing_private.has_permission('requests.write'));
 END IF;
 IF p_action IN ('create','save','finish','delete') THEN
  PERFORM billing_private.lock_request_actor();
  IF billing_private.current_owner_id() IS DISTINCT FROM v_owner THEN RAISE EXCEPTION 'O espaço foi alterado. Reabra o relatório.' USING ERRCODE='40001'; END IF;
  PERFORM billing_private.authorize('requests.write');
 END IF;
 IF p_payload ? 'notes' THEN
  IF jsonb_typeof(p_payload->'notes') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Informe uma observação válida.' USING ERRCODE='22023'; END IF;
  v_notes=btrim(p_payload->>'notes');
  IF length(v_notes)>2000 THEN RAISE EXCEPTION 'A observação deve ter até 2.000 caracteres.' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_action='create' THEN
  IF jsonb_typeof(p_payload->'dateFrom') IS DISTINCT FROM 'string' OR (p_payload->>'dateFrom')!~'^\d{4}-\d{2}-\d{2}$'
   OR jsonb_typeof(p_payload->'dateTo') IS DISTINCT FROM 'string' OR (p_payload->>'dateTo')!~'^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Informe a data inicial e a data final.' USING ERRCODE='22023'; END IF;
  v_from=(p_payload->>'dateFrom')::date;v_to=(p_payload->>'dateTo')::date;
  IF v_to<v_from THEN RAISE EXCEPTION 'A data final deve ser igual ou posterior à inicial.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.billing_overtime_reports(owner_id,company_id,date_from,date_to,reference_month,notes)
   VALUES(v_owner,v_company,v_from,v_to,date_trunc('month',v_from)::date,coalesce(v_notes,'')) RETURNING * INTO v_report;
  RETURN jsonb_build_object('report',billing_private.overtime_report_json(v_report,true),'created',true);
 END IF;
 IF p_payload ? 'id' THEN
  IF jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Informe o relatório.' USING ERRCODE='22023'; END IF;
  v_id=(p_payload->>'id')::uuid;
  IF p_action='get' THEN SELECT * INTO v_report FROM public.billing_overtime_reports WHERE owner_id=v_owner AND company_id=v_company AND id=v_id;
  ELSE SELECT * INTO v_report FROM public.billing_overtime_reports WHERE owner_id=v_owner AND company_id=v_company AND id=v_id FOR UPDATE; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Relatório não encontrado.' USING ERRCODE='P0002'; END IF;
 ELSIF p_action IN ('get','finish','delete') THEN RAISE EXCEPTION 'Informe o relatório.' USING ERRCODE='22023'; END IF;
 IF p_action='get' THEN RETURN jsonb_build_object('report',billing_private.overtime_report_json(v_report,true),'canManage',billing_private.has_permission('requests.write')); END IF;
 IF p_action IN ('finish','save') AND v_id IS NOT NULL AND v_report.status='finished' THEN
  RAISE EXCEPTION 'Este relatório está finalizado e não pode ser alterado.' USING ERRCODE='23514';
 END IF;
 IF p_action='finish' THEN
  IF jsonb_typeof(p_payload->'expectedUpdatedAt') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Atualize o relatório antes de finalizar.' USING ERRCODE='22023'; END IF;
  IF (p_payload->>'expectedUpdatedAt')::timestamptz IS DISTINCT FROM v_report.updated_at THEN RAISE EXCEPTION 'Este relatório foi alterado em outra sessão. Atualize a lista.' USING ERRCODE='40001'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.billing_overtime_rows WHERE owner_id=v_owner AND report_id=v_id) THEN RAISE EXCEPTION 'Inclua os funcionários e as horas antes de finalizar.' USING ERRCODE='23514'; END IF;
  UPDATE public.billing_overtime_reports SET status='finished',finished_at=now() WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_report;
  RETURN jsonb_build_object('report',billing_private.overtime_report_json(v_report,true));
 END IF;
 v_result=billing_private.overtime_dispatch_before_workflow(p_action,p_payload-'notes');
 IF p_action='delete' THEN RETURN v_result; END IF;
 v_id=(v_result->'report'->>'id')::uuid;
 IF v_notes IS NOT NULL THEN UPDATE public.billing_overtime_reports SET notes=v_notes WHERE owner_id=v_owner AND id=v_id; END IF;
 SELECT * INTO v_report FROM public.billing_overtime_reports WHERE owner_id=v_owner AND id=v_id;
 RETURN jsonb_build_object('report',billing_private.overtime_report_json(v_report,true),'created',v_result->'created');
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
 RAISE EXCEPTION 'Confira as datas e os dados do relatório.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.overtime_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
