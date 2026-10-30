ALTER FUNCTION billing_private.overtime_dispatch(text,jsonb) RENAME TO overtime_dispatch_before_preview;
REVOKE ALL ON FUNCTION billing_private.overtime_dispatch_before_preview(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.overtime_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();v_company uuid;v_row jsonb;v_50 bigint:=0;v_100 bigint:=0;v_result jsonb;
BEGIN
 IF p_action='options' THEN
  v_result=billing_private.overtime_dispatch_before_preview(p_action,p_payload);
  RETURN v_result||jsonb_build_object('canRegisterEmployees',billing_private.has_permission('registrations.write'));
 END IF;
 IF p_action IS DISTINCT FROM 'preview' THEN RETURN billing_private.overtime_dispatch_before_preview(p_action,p_payload); END IF;
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para consultar o resumo.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize('requests.read');
 PERFORM billing_private.request_payload(p_payload,ARRAY['companyId','rows']);
 IF jsonb_typeof(p_payload->'companyId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Selecione a empresa.' USING ERRCODE='22023'; END IF;
 v_company=(p_payload->>'companyId')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.billing_companies WHERE owner_id=v_owner AND id=v_company) THEN RAISE EXCEPTION 'Empresa não encontrada neste espaço.' USING ERRCODE='P0002'; END IF;
 IF jsonb_typeof(p_payload->'rows') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Informe as horas para calcular o resumo.' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_payload->'rows')>500 THEN RAISE EXCEPTION 'O relatório deve ter até 500 funcionários.' USING ERRCODE='22023'; END IF;
 FOR v_row IN SELECT value FROM jsonb_array_elements(p_payload->'rows') LOOP
  PERFORM billing_private.request_payload(v_row,ARRAY['hours50','hours100']);
  v_50=v_50+billing_private.overtime_seconds(v_row->'hours50');
  v_100=v_100+billing_private.overtime_seconds(v_row->'hours100');
 END LOOP;
 RETURN jsonb_build_object('total50',billing_private.overtime_hours(v_50),'total100',billing_private.overtime_hours(v_100));
EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Confira os dados do resumo.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.overtime_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
