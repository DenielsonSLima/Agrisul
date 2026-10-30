-- Open reports are drafts and may contain employees whose hours are still being entered.
ALTER TABLE public.billing_overtime_rows DROP CONSTRAINT billing_overtime_rows_check;
DO $migration$
DECLARE definition text;
BEGIN
 definition=pg_get_functiondef('billing_private.overtime_dispatch_before_workflow(text,jsonb)'::regprocedure);
 IF strpos(definition,'NOT BETWEEN 1 AND 500')=0 OR strpos(definition,'IF v_50+v_100=0 THEN')=0 THEN RAISE EXCEPTION 'Review the draft row validation before changing it.'; END IF;
 definition=replace(definition,'NOT BETWEEN 1 AND 500','NOT BETWEEN 0 AND 500');
 definition=replace(definition,'Inclua de 1 a 500 funcionários no relatório.','O relatório deve ter até 500 funcionários.');
 definition=regexp_replace(definition,'IF v_50\+v_100=0 THEN RAISE EXCEPTION [^;]+; END IF;','','g');
 EXECUTE definition;
 definition=pg_get_functiondef('billing_private.overtime_dispatch_before_preview(text,jsonb)'::regprocedure);
 IF strpos(definition,'IF NOT EXISTS(SELECT 1 FROM public.billing_overtime_rows WHERE owner_id=v_owner AND report_id=v_id) THEN')=0 THEN RAISE EXCEPTION 'Review the finalization validation before changing it.'; END IF;
 definition=replace(definition,
  'IF NOT EXISTS(SELECT 1 FROM public.billing_overtime_rows WHERE owner_id=v_owner AND report_id=v_id) THEN',
  'IF NOT EXISTS(SELECT 1 FROM public.billing_overtime_rows WHERE owner_id=v_owner AND report_id=v_id) OR EXISTS(SELECT 1 FROM public.billing_overtime_rows WHERE owner_id=v_owner AND report_id=v_id AND seconds_50+seconds_100=0) THEN');
 definition=replace(definition,'Inclua os funcionários e as horas antes de finalizar.','Preencha as horas de todos os funcionários antes de finalizar.');
 EXECUTE definition;
END $migration$;

ALTER FUNCTION billing_private.overtime_report_json(public.billing_overtime_reports,boolean) RENAME TO overtime_report_json_before_autosave;
REVOKE ALL ON FUNCTION billing_private.overtime_report_json_before_autosave(public.billing_overtime_reports,boolean) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.overtime_report_json(p_report public.billing_overtime_reports,p_details boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT billing_private.overtime_report_json_before_autosave(p_report,p_details)||jsonb_build_object('canFinish',
  p_report.status='open' AND EXISTS(SELECT 1 FROM public.billing_overtime_rows WHERE owner_id=p_report.owner_id AND report_id=p_report.id)
  AND NOT EXISTS(SELECT 1 FROM public.billing_overtime_rows WHERE owner_id=p_report.owner_id AND report_id=p_report.id AND seconds_50+seconds_100=0))
$$;
REVOKE ALL ON FUNCTION billing_private.overtime_report_json(public.billing_overtime_reports,boolean) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.overtime_dispatch(text,jsonb) RENAME TO overtime_dispatch_before_autosave;
REVOKE ALL ON FUNCTION billing_private.overtime_dispatch_before_autosave(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.overtime_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();v_id uuid;v_company uuid;v_report public.billing_overtime_reports;
BEGIN
 IF p_action IS DISTINCT FROM 'reopen' THEN RETURN billing_private.overtime_dispatch_before_autosave(p_action,p_payload); END IF;
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para abrir o relatório.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.lock_request_actor();
 IF billing_private.current_owner_id() IS DISTINCT FROM v_owner THEN RAISE EXCEPTION 'O espaço foi alterado. Reabra a tela.' USING ERRCODE='23514'; END IF;
 PERFORM billing_private.authorize('requests.write');
 PERFORM billing_private.request_payload(p_payload,ARRAY['companyId','id','expectedUpdatedAt']);
 IF jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'companyId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'expectedUpdatedAt') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Atualize o relatório antes de abrir novamente.' USING ERRCODE='22023'; END IF;
 v_id=(p_payload->>'id')::uuid;v_company=(p_payload->>'companyId')::uuid;
 SELECT * INTO v_report FROM public.billing_overtime_reports WHERE owner_id=v_owner AND company_id=v_company AND id=v_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Relatório não encontrado.' USING ERRCODE='P0002'; END IF;
 IF v_report.updated_at IS DISTINCT FROM (p_payload->>'expectedUpdatedAt')::timestamptz THEN RAISE EXCEPTION 'Este relatório foi alterado em outra sessão. Atualize a tela.' USING ERRCODE='23514'; END IF;
 IF v_report.status<>'finished' THEN RAISE EXCEPTION 'Este relatório já está em aberto.' USING ERRCODE='23514'; END IF;
 UPDATE public.billing_overtime_reports SET status='open',finished_at=NULL WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_report;
 RETURN jsonb_build_object('report',billing_private.overtime_report_json(v_report,true));
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'Confira os dados do relatório.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.overtime_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
