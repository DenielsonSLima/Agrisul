ALTER TABLE public.billing_planning_field_logs
 ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD CONSTRAINT billing_planning_field_logs_details_object CHECK(jsonb_typeof(details)='object');

CREATE FUNCTION billing_private.planning_v8_normalize_field_log_details(p_details jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE
 v_details jsonb:=coalesce(p_details,'{}'::jsonb);v_materials jsonb:='[]'::jsonb;v_item jsonb;
 v_hour_start_text text;v_hour_end_text text;v_hour_start numeric;v_hour_end numeric;v_quantity text;
BEGIN
 IF jsonb_typeof(v_details)<>'object' OR EXISTS(
  SELECT 1 FROM jsonb_object_keys(v_details) keys(key) WHERE key NOT IN(
   'operatorName','responsibleName','shift','startedAt','endedAt','applicationNumber','serviceOrderNumber',
   'applicationServiceOrderNumber','laborDescription','equipmentCode','equipmentDescription','implementCode',
   'implementDescription','hourMeterStart','hourMeterEnd','areaScope','materials')) THEN
  RAISE EXCEPTION 'Os detalhes do boletim de campo são inválidos.' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(v_details) keys(key)
  WHERE key<>'materials' AND jsonb_typeof(v_details->key) NOT IN('string','null')) THEN
  RAISE EXCEPTION 'Preencha os detalhes textuais do boletim corretamente.' USING ERRCODE='22023';
 END IF;
 IF length(btrim(coalesce(v_details->>'operatorName','')))>160
    OR length(btrim(coalesce(v_details->>'responsibleName','')))>160
    OR length(btrim(coalesce(v_details->>'shift','')))>60
    OR length(btrim(coalesce(v_details->>'applicationNumber','')))>80
    OR length(btrim(coalesce(v_details->>'serviceOrderNumber','')))>80
    OR length(btrim(coalesce(v_details->>'applicationServiceOrderNumber','')))>80
    OR length(btrim(coalesce(v_details->>'laborDescription','')))>200
    OR length(btrim(coalesce(v_details->>'equipmentCode','')))>80
    OR length(btrim(coalesce(v_details->>'equipmentDescription','')))>200
    OR length(btrim(coalesce(v_details->>'implementCode','')))>80
    OR length(btrim(coalesce(v_details->>'implementDescription','')))>200 THEN
  RAISE EXCEPTION 'Um dos detalhes do boletim excede o tamanho permitido.' USING ERRCODE='22023';
 END IF;
 IF btrim(coalesce(v_details->>'startedAt',''))<>'' AND btrim(v_details->>'startedAt')!~'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' THEN
  RAISE EXCEPTION 'Informe a hora inicial no formato HH:MM.' USING ERRCODE='22023';
 END IF;
 IF btrim(coalesce(v_details->>'endedAt',''))<>'' AND btrim(v_details->>'endedAt')!~'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' THEN
  RAISE EXCEPTION 'Informe a hora final no formato HH:MM.' USING ERRCODE='22023';
 END IF;
 IF btrim(coalesce(v_details->>'areaScope','')) NOT IN('','total','partial') THEN
  RAISE EXCEPTION 'Informe se a área trabalhada foi total ou parcial.' USING ERRCODE='22023';
 END IF;
 v_hour_start_text=btrim(coalesce(v_details->>'hourMeterStart',''));
 v_hour_end_text=btrim(coalesce(v_details->>'hourMeterEnd',''));
 IF v_hour_start_text<>'' AND v_hour_start_text!~'^[0-9]+([,.][0-9]{1,6})?$' THEN
  RAISE EXCEPTION 'Informe o horímetro inicial corretamente.' USING ERRCODE='22023';
 END IF;
 IF v_hour_end_text<>'' AND v_hour_end_text!~'^[0-9]+([,.][0-9]{1,6})?$' THEN
  RAISE EXCEPTION 'Informe o horímetro final corretamente.' USING ERRCODE='22023';
 END IF;
 IF v_hour_start_text<>'' THEN v_hour_start=replace(v_hour_start_text,',','.')::numeric; END IF;
 IF v_hour_end_text<>'' THEN v_hour_end=replace(v_hour_end_text,',','.')::numeric; END IF;
 IF v_hour_start IS NOT NULL AND v_hour_end IS NOT NULL AND v_hour_end<v_hour_start THEN
  RAISE EXCEPTION 'O horímetro final não pode ser menor que o inicial.' USING ERRCODE='23514';
 END IF;
 IF v_details?'materials' AND jsonb_typeof(v_details->'materials')<>'array' THEN
  RAISE EXCEPTION 'A lista de materiais do boletim é inválida.' USING ERRCODE='22023';
 END IF;
 IF jsonb_array_length(coalesce(v_details->'materials','[]'::jsonb))>20 THEN
  RAISE EXCEPTION 'Informe no máximo 20 materiais por boletim.' USING ERRCODE='22023';
 END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(v_details->'materials','[]'::jsonb)) LOOP
  IF jsonb_typeof(v_item)<>'object' OR EXISTS(
   SELECT 1 FROM jsonb_object_keys(v_item) keys(key) WHERE key NOT IN('code','description','quantity','unit','recommendedDose'))
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_item) keys(key) WHERE jsonb_typeof(v_item->key) NOT IN('string','null')) THEN
   RAISE EXCEPTION 'Um material do boletim é inválido.' USING ERRCODE='22023';
  END IF;
  v_quantity=btrim(coalesce(v_item->>'quantity',''));
  IF v_quantity<>'' AND v_quantity!~'^[0-9]+([,.][0-9]{1,6})?$' THEN
   RAISE EXCEPTION 'Informe a quantidade do material corretamente.' USING ERRCODE='22023';
  END IF;
  IF length(btrim(coalesce(v_item->>'code','')))>80 OR length(btrim(coalesce(v_item->>'description','')))>200
     OR length(btrim(coalesce(v_item->>'unit','')))>30 OR length(btrim(coalesce(v_item->>'recommendedDose','')))>100 THEN
   RAISE EXCEPTION 'Um material do boletim excede o tamanho permitido.' USING ERRCODE='22023';
  END IF;
  IF btrim(coalesce(v_item->>'description',''))='' AND concat_ws('',v_item->>'code',v_quantity,v_item->>'unit',v_item->>'recommendedDose')<>'' THEN
   RAISE EXCEPTION 'Informe a descrição do material utilizado.' USING ERRCODE='22023';
  END IF;
  IF btrim(coalesce(v_item->>'description',''))<>'' THEN
   v_materials=v_materials||jsonb_build_array(jsonb_build_object(
    'code',btrim(coalesce(v_item->>'code','')),'description',btrim(v_item->>'description'),
    'quantity',CASE WHEN v_quantity='' THEN '' ELSE billing_private.decimal_text(replace(v_quantity,',','.')::numeric) END,
    'unit',btrim(coalesce(v_item->>'unit','')),'recommendedDose',btrim(coalesce(v_item->>'recommendedDose',''))));
  END IF;
 END LOOP;
 RETURN jsonb_build_object(
  'operatorName',btrim(coalesce(v_details->>'operatorName','')),
  'responsibleName',btrim(coalesce(v_details->>'responsibleName','')),
  'shift',btrim(coalesce(v_details->>'shift','')),
  'startedAt',btrim(coalesce(v_details->>'startedAt','')),
  'endedAt',btrim(coalesce(v_details->>'endedAt','')),
  'applicationNumber',btrim(coalesce(v_details->>'applicationNumber','')),
  'serviceOrderNumber',btrim(coalesce(v_details->>'serviceOrderNumber','')),
  'applicationServiceOrderNumber',btrim(coalesce(v_details->>'applicationServiceOrderNumber','')),
  'laborDescription',btrim(coalesce(v_details->>'laborDescription','')),
  'equipmentCode',btrim(coalesce(v_details->>'equipmentCode','')),
  'equipmentDescription',btrim(coalesce(v_details->>'equipmentDescription','')),
  'implementCode',btrim(coalesce(v_details->>'implementCode','')),
  'implementDescription',btrim(coalesce(v_details->>'implementDescription','')),
  'hourMeterStart',CASE WHEN v_hour_start IS NULL THEN '' ELSE billing_private.decimal_text(v_hour_start) END,
  'hourMeterEnd',CASE WHEN v_hour_end IS NULL THEN '' ELSE billing_private.decimal_text(v_hour_end) END,
  'areaScope',btrim(coalesce(v_details->>'areaScope','')),
  'materials',v_materials);
EXCEPTION
 WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Confira os valores numéricos do boletim de campo.' USING ERRCODE='22023';
END $$;

CREATE OR REPLACE FUNCTION billing_private.present_planning_field_log(p_log public.billing_planning_field_logs) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p_log.id,'periodId',p_log.period_id,'allocationId',p_log.allocation_id,
  'farmId',p_log.farm_id,'farmName',f.name,'plotId',p_log.plot_id,'plotName',p.name,
  'occurredOn',p_log.occurred_on,'kind',p_log.kind,'practiceId',coalesce(p_log.practice_id::text,''),
  'practiceName',coalesce(cp.name,''),'areaHa',billing_private.decimal_text(p_log.area_ha),'notes',p_log.notes,
  'details',p_log.details,
  'createdBy',p_log.created_by,'createdByName',coalesce(nullif(s.name,''),u.email,''),'createdAt',p_log.created_at,
  'voidedAt',p_log.voided_at,'voidedBy',p_log.voided_by,'voidReason',p_log.void_reason)
 FROM public.billing_farms f JOIN public.billing_farm_plots p
  ON p.owner_id=f.owner_id AND p.farm_id=f.id AND p.id=p_log.plot_id
 LEFT JOIN public.billing_cultural_practices cp ON cp.owner_id=p_log.owner_id AND cp.id=p_log.practice_id
 LEFT JOIN public.billing_user_settings s ON s.user_id=p_log.created_by
 LEFT JOIN auth.users u ON u.id=p_log.created_by
 WHERE f.owner_id=p_log.owner_id AND f.id=p_log.farm_id
$$;

CREATE FUNCTION billing_private.planning_v8_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_payload jsonb:=coalesce(p_payload,'{}'::jsonb);
 v_result jsonb;v_details jsonb;v_id uuid;v_log public.billing_planning_field_logs%ROWTYPE;
BEGIN
 IF p_action<>'save-field-log' OR NOT(v_payload?'details') THEN
  RETURN billing_private.planning_v7_dispatch(p_action,p_payload);
 END IF;
 v_details=billing_private.planning_v8_normalize_field_log_details(v_payload->'details');
 v_result=billing_private.planning_v7_dispatch(p_action,v_payload-'details');
 v_id=(v_result->'fieldLog'->>'id')::uuid;
 SELECT * INTO v_log FROM public.billing_planning_field_logs WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'O apontamento salvo não foi encontrado.' USING ERRCODE='P0002'; END IF;
 IF v_log.details<>'{}'::jsonb AND v_log.details<>v_details THEN
  RAISE EXCEPTION 'Este boletim já foi registrado com outros detalhes.' USING ERRCODE='PT409';
 END IF;
 IF v_log.details='{}'::jsonb THEN
  UPDATE public.billing_planning_field_logs SET details=v_details WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_log;
  UPDATE public.billing_planning_history SET snapshot=billing_private.present_planning_field_log(v_log)
   WHERE owner_id=v_owner AND entity_type='field-log' AND action='logged' AND snapshot->>'id'=v_id::text;
 END IF;
 RETURN jsonb_build_object('fieldLog',billing_private.present_planning_field_log(v_log));
EXCEPTION
 WHEN invalid_text_representation OR numeric_value_out_of_range OR array_subscript_error THEN
  RAISE EXCEPTION 'Confira os dados do boletim diário.' USING ERRCODE='22023';
END $$;

REVOKE ALL ON FUNCTION billing_private.planning_v8_normalize_field_log_details(jsonb),
 billing_private.planning_v8_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.planning_v8_dispatch(text,jsonb) TO authenticated;

DO $$
DECLARE v_definition text;v_old text;v_new text;
BEGIN
 v_definition=pg_get_functiondef('public.billing_rpc(text,text,jsonb)'::regprocedure);
 v_old='IF p_resource=''planning'' THEN RETURN billing_private.planning_v7_dispatch(p_action,p_payload); END IF;';
 v_new='IF p_resource=''planning'' THEN RETURN billing_private.planning_v8_dispatch(p_action,p_payload); END IF;';
 IF strpos(v_definition,v_old)=0 THEN
  IF strpos(v_definition,v_new)=0 THEN RAISE EXCEPTION 'O contrato RPC instalado não corresponde ao Planejamento esperado.'; END IF;
 ELSE EXECUTE replace(v_definition,v_old,v_new);
 END IF;
END $$;

REVOKE ALL ON FUNCTION public.billing_rpc(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_rpc(text,text,jsonb) TO authenticated;
