-- CONSECANA publishes two independent ATR quotations for each reference month:
-- the price for the month and the weighted price accumulated in the crop year.
-- Existing records keep their known monthly price; their unknown accumulated
-- price remains NULL until a user edits them instead of receiving fabricated data.
ALTER TABLE public.billing_atr_records
  ADD COLUMN accumulated_value numeric(15,6)
  CHECK(accumulated_value>=0 AND accumulated_value<1000000000);

CREATE FUNCTION billing_private.present_atr(p_record public.billing_atr_records)
RETURNS jsonb LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p_record.id,
  'year',p_record.year,
  'month',p_record.month,
  'monthlyValue',billing_private.decimal_text(p_record.value),
  'accumulatedValue',billing_private.decimal_text(p_record.accumulated_value),
  'createdAt',p_record.created_at,
  'updatedAt',p_record.updated_at
 )
$$;
REVOKE ALL ON FUNCTION billing_private.present_atr(public.billing_atr_records) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.atr_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;
 v_monthly_text text;
 v_accumulated_text text;
 v_record public.billing_atr_records%ROWTYPE;
 v_records jsonb;
BEGIN
 PERFORM billing_private.authorize_resource('atr',p_action);
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_action NOT IN ('list','get','save','delete') THEN
  RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023';
 END IF;

 IF p_action='list' THEN
  SELECT coalesce(jsonb_agg(billing_private.present_atr(t) ORDER BY t.year DESC,t.month,t.id),'[]'::jsonb)
   INTO v_records FROM public.billing_atr_records t WHERE t.owner_id=v_owner;
  RETURN jsonb_build_object('records',v_records);
 END IF;

 v_id=nullif(p_payload->>'id','')::uuid;
 IF p_action IN ('get','delete') AND v_id IS NULL THEN
  RAISE EXCEPTION 'Informe o registro de ATR.' USING ERRCODE='22023';
 END IF;

 IF p_action='get' THEN
  SELECT * INTO v_record FROM public.billing_atr_records WHERE owner_id=v_owner AND id=v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro não encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('record',billing_private.present_atr(v_record));
 END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended('billing:'||v_owner::text,0));
 IF p_action='delete' THEN
  DELETE FROM public.billing_atr_records WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_record;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro não encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('id',v_id,'deleted',true);
 END IF;

 IF coalesce(p_payload->>'year','')!~'^[0-9]{4}$' OR coalesce(p_payload->>'month','')!~'^[0-9]{1,2}$' THEN
  RAISE EXCEPTION 'Informe ano e mês válidos.' USING ERRCODE='22023';
 END IF;
 IF jsonb_typeof(p_payload->'monthlyValue') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Informe a cotação mensal do ATR.' USING ERRCODE='22023';
 END IF;
 IF jsonb_typeof(p_payload->'accumulatedValue') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Informe a cotação acumulada do ATR.' USING ERRCODE='22023';
 END IF;
 v_monthly_text=replace(btrim(p_payload->>'monthlyValue'),',','.');
 v_accumulated_text=replace(btrim(p_payload->>'accumulatedValue'),',','.');
 IF v_monthly_text!~'^[0-9]{1,9}([.][0-9]{1,6})?$' THEN
  RAISE EXCEPTION 'Informe uma cotação mensal válida, com até seis casas decimais.' USING ERRCODE='22023';
 END IF;
 IF v_accumulated_text!~'^[0-9]{1,9}([.][0-9]{1,6})?$' THEN
  RAISE EXCEPTION 'Informe uma cotação acumulada válida, com até seis casas decimais.' USING ERRCODE='22023';
 END IF;

 IF v_id IS NULL THEN
  INSERT INTO public.billing_atr_records(owner_id,year,month,value,accumulated_value)
   VALUES(v_owner,(p_payload->>'year')::integer,(p_payload->>'month')::integer,v_monthly_text::numeric,v_accumulated_text::numeric)
   RETURNING * INTO v_record;
 ELSE
  UPDATE public.billing_atr_records SET
   year=(p_payload->>'year')::integer,
   month=(p_payload->>'month')::integer,
   value=v_monthly_text::numeric,
   accumulated_value=v_accumulated_text::numeric
   WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_record;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro não encontrado.' USING ERRCODE='P0002'; END IF;
 END IF;
 RETURN jsonb_build_object('record',billing_private.present_atr(v_record));
EXCEPTION
 WHEN unique_violation THEN
  RAISE EXCEPTION 'Este mês já está cadastrado nesse ano. Abra o registro para editar as cotações.' USING ERRCODE='23505';
 WHEN not_null_violation OR check_violation THEN
  RAISE EXCEPTION 'Verifique as cotações, o ano e o mês informados.' USING ERRCODE='22023';
 WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Informe valores e identificadores válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.atr_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.atr_dispatch(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.billing_rpc(p_resource text,p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.ensure_actor_workspace();
 IF p_resource IN ('settings','profile') THEN RETURN billing_private.workspace_settings(p_action,p_payload); END IF;
 IF p_resource='users' THEN RETURN billing_private.users_dispatch(p_action,p_payload); END IF;
 IF p_resource='access-profiles' THEN RETURN billing_private.access_profiles_dispatch(p_action,p_payload); END IF;
 IF p_resource='report-headers' THEN RETURN billing_private.report_headers_dispatch(p_action,p_payload); END IF;
 PERFORM billing_private.authorize_resource(p_resource,p_action);
 IF p_resource='atr' THEN RETURN billing_private.atr_dispatch(p_action,p_payload); END IF;
 IF p_resource='farms' AND p_action='list' THEN RETURN billing_private.farm_summary_list(); END IF;
 IF p_resource='companies' AND p_action='save' THEN RETURN billing_private.save_company(p_payload); END IF;
 IF p_resource IN ('watermark','watermarks') THEN RETURN billing_private.watermark_variants(p_action,p_payload); END IF;
 RETURN billing_private.dispatch(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION public.billing_rpc(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_rpc(text,text,jsonb) TO authenticated;
COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS 'Authenticated workspace RPC. ATR monthly and crop-year accumulated quotations are validated and stored independently on the server.';
