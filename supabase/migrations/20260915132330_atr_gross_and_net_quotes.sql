-- CONSECANA-AL/SE publishes four values for every reference month: gross and
-- net prices, both for the month and accumulated in the crop year. The former
-- columns held the two net values; rename them to remove that ambiguity.
ALTER TABLE public.billing_atr_records RENAME COLUMN value TO monthly_net_value;
ALTER TABLE public.billing_atr_records RENAME COLUMN accumulated_value TO accumulated_net_value;
ALTER TABLE public.billing_atr_records
 ADD COLUMN monthly_gross_value numeric(15,6)
  CHECK(monthly_gross_value>=0 AND monthly_gross_value<1000000000),
 ADD COLUMN accumulated_gross_value numeric(15,6)
  CHECK(accumulated_gross_value>=0 AND accumulated_gross_value<1000000000);

COMMENT ON COLUMN public.billing_atr_records.monthly_gross_value IS 'Gross monthly R$/kg ATR before statutory deductions.';
COMMENT ON COLUMN public.billing_atr_records.monthly_net_value IS 'Net monthly R$/kg ATR after statutory deductions.';
COMMENT ON COLUMN public.billing_atr_records.accumulated_gross_value IS 'Gross accumulated crop-year R$/kg ATR before statutory deductions.';
COMMENT ON COLUMN public.billing_atr_records.accumulated_net_value IS 'Net accumulated crop-year R$/kg ATR after statutory deductions.';

CREATE OR REPLACE FUNCTION billing_private.present_atr(p_record public.billing_atr_records)
RETURNS jsonb LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p_record.id,
  'year',p_record.year,
  'month',p_record.month,
  'monthlyGrossValue',billing_private.decimal_text(p_record.monthly_gross_value),
  'monthlyNetValue',billing_private.decimal_text(p_record.monthly_net_value),
  'accumulatedGrossValue',billing_private.decimal_text(p_record.accumulated_gross_value),
  'accumulatedNetValue',billing_private.decimal_text(p_record.accumulated_net_value),
  'createdAt',p_record.created_at,
  'updatedAt',p_record.updated_at
 )
$$;
REVOKE ALL ON FUNCTION billing_private.present_atr(public.billing_atr_records) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.atr_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_id uuid;
 v_monthly_gross_text text;
 v_monthly_net_text text;
 v_accumulated_gross_text text;
 v_accumulated_net_text text;
 v_record public.billing_atr_records%ROWTYPE;
 v_records jsonb;
 v_page integer;
 v_page_size integer;
 v_offset bigint;
 v_total bigint;
 v_total_pages integer;
BEGIN
 PERFORM billing_private.authorize_resource('atr',p_action);
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_action NOT IN ('list','get','save','delete') THEN
  RAISE EXCEPTION 'Operação inválida.' USING ERRCODE='22023';
 END IF;

 IF p_action='list' THEN
  IF coalesce(p_payload->>'page','1')!~'^[1-9][0-9]{0,8}$'
   OR coalesce(p_payload->>'pageSize','12')!~'^[1-9][0-9]{0,2}$' THEN
   RAISE EXCEPTION 'Informe uma página válida.' USING ERRCODE='22023';
  END IF;
  v_page=coalesce((p_payload->>'page')::integer,1);
  v_page_size=coalesce((p_payload->>'pageSize')::integer,12);
  IF v_page_size>100 THEN
   RAISE EXCEPTION 'A página pode ter no máximo 100 registros.' USING ERRCODE='22023';
  END IF;
  SELECT count(*) INTO v_total FROM public.billing_atr_records t WHERE t.owner_id=v_owner;
  v_total_pages=greatest(1,((v_total+v_page_size-1)/v_page_size)::integer);
  v_page=least(v_page,v_total_pages);
  v_offset=(v_page::bigint-1)*v_page_size;
  SELECT coalesce(jsonb_agg(billing_private.present_atr(t) ORDER BY t.year DESC,t.month DESC,t.id),'[]'::jsonb)
   INTO v_records
   FROM (
    SELECT * FROM public.billing_atr_records
     WHERE owner_id=v_owner ORDER BY year DESC,month DESC,id
     LIMIT v_page_size OFFSET v_offset
   ) t;
  RETURN jsonb_build_object(
   'records',v_records,
   'pagination',jsonb_build_object(
    'page',v_page,'pageSize',v_page_size,'total',v_total,'totalPages',v_total_pages,
    'hasPrevious',v_page>1,'hasNext',v_page<v_total_pages
   )
  );
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
 IF jsonb_typeof(p_payload->'monthlyGrossValue') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'monthlyNetValue') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'accumulatedGrossValue') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'accumulatedNetValue') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'Informe as quatro cotações bruta e líquida do ATR.' USING ERRCODE='22023';
 END IF;
 v_monthly_gross_text=replace(btrim(p_payload->>'monthlyGrossValue'),',','.');
 v_monthly_net_text=replace(btrim(p_payload->>'monthlyNetValue'),',','.');
 v_accumulated_gross_text=replace(btrim(p_payload->>'accumulatedGrossValue'),',','.');
 v_accumulated_net_text=replace(btrim(p_payload->>'accumulatedNetValue'),',','.');
 IF v_monthly_gross_text!~'^[0-9]{1,9}([.][0-9]{1,6})?$' THEN
  RAISE EXCEPTION 'Informe uma cotação mensal bruta válida, com até seis casas decimais.' USING ERRCODE='22023';
 END IF;
 IF v_monthly_net_text!~'^[0-9]{1,9}([.][0-9]{1,6})?$' THEN
  RAISE EXCEPTION 'Informe uma cotação mensal líquida válida, com até seis casas decimais.' USING ERRCODE='22023';
 END IF;
 IF v_accumulated_gross_text!~'^[0-9]{1,9}([.][0-9]{1,6})?$' THEN
  RAISE EXCEPTION 'Informe uma cotação acumulada bruta válida, com até seis casas decimais.' USING ERRCODE='22023';
 END IF;
 IF v_accumulated_net_text!~'^[0-9]{1,9}([.][0-9]{1,6})?$' THEN
  RAISE EXCEPTION 'Informe uma cotação acumulada líquida válida, com até seis casas decimais.' USING ERRCODE='22023';
 END IF;

 IF v_id IS NULL THEN
  INSERT INTO public.billing_atr_records(
   owner_id,year,month,monthly_gross_value,monthly_net_value,accumulated_gross_value,accumulated_net_value
  ) VALUES(
   v_owner,(p_payload->>'year')::integer,(p_payload->>'month')::integer,
   v_monthly_gross_text::numeric,v_monthly_net_text::numeric,
   v_accumulated_gross_text::numeric,v_accumulated_net_text::numeric
  ) RETURNING * INTO v_record;
 ELSE
  UPDATE public.billing_atr_records SET
   year=(p_payload->>'year')::integer,
   month=(p_payload->>'month')::integer,
   monthly_gross_value=v_monthly_gross_text::numeric,
   monthly_net_value=v_monthly_net_text::numeric,
   accumulated_gross_value=v_accumulated_gross_text::numeric,
   accumulated_net_value=v_accumulated_net_text::numeric
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

COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS 'Authenticated workspace RPC. ATR exposes monthly and crop-year accumulated quotations, each gross and net, with newest-first server pagination.';
