BEGIN;

-- ERP codes are equivalent across numeric and text columns (01 = 1).
CREATE FUNCTION billing_private.import_plot_code(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN btrim(coalesce(p_value,'')) ~ '^[0-9]{1,15}([.,]0{1,6})?$'
 THEN billing_private.decimal_text(replace(btrim(p_value),',','.')::numeric)
 ELSE btrim(coalesce(p_value,'')) END
$$;
REVOKE ALL ON FUNCTION billing_private.import_plot_code(text) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.import_documents_dispatch(text,jsonb) RENAME TO import_documents_before_harvest_orders_dispatch;
REVOKE ALL ON FUNCTION billing_private.import_documents_before_harvest_orders_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.import_documents_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();d public.billing_import_documents;
 item jsonb;farm text;plot text;new_order text;field_type text;seen text[]:='{}';pair text;
 matched integer;changed integer:=0;row_count integer;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('harvest-order-options','save-harvest-orders') THEN
  RETURN billing_private.import_documents_before_harvest_orders_dispatch(p_action,p_payload);
 END IF;
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Entre para acessar as ordens de colheita.' USING ERRCODE='28000';END IF;
 PERFORM billing_private.authorize(CASE WHEN p_action='harvest-order-options' THEN 'registrations.read' ELSE 'registrations.write' END);
 PERFORM billing_private.request_payload(p_payload,CASE WHEN p_action='harvest-order-options' THEN ARRAY['id'] ELSE ARRAY['id','expectedUpdatedAt','orders'] END);
 IF jsonb_typeof(p_payload->'id') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Informe o documento.' USING ERRCODE='22023';END IF;
 IF p_action='save-harvest-orders' THEN
  PERFORM billing_private.lock_request_actor();
  PERFORM pg_advisory_xact_lock(hashtextextended('billing:imports:'||v_owner::text,0));
  SELECT * INTO d FROM public.billing_import_documents WHERE owner_id=v_owner AND id=(p_payload->>'id')::uuid FOR UPDATE;
 ELSE
  SELECT * INTO d FROM public.billing_import_documents WHERE owner_id=v_owner AND id=(p_payload->>'id')::uuid;
 END IF;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Importação não encontrada.' USING ERRCODE='P0002';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(d.profile_snapshot->'fields') f WHERE f->>'key' IN ('COD_FAZENDA','COD_TALHAO','NR_ORDEM_COLHEITA'))<>3 THEN
  RAISE EXCEPTION 'O modelo precisa das colunas Fazenda, Talhão e Ordem de colheita.' USING ERRCODE='22023';END IF;
 SELECT f->>'type' INTO field_type FROM jsonb_array_elements(d.profile_snapshot->'fields') f WHERE f->>'key'='NR_ORDEM_COLHEITA';
 IF field_type NOT IN ('text','decimal') THEN RAISE EXCEPTION 'Use Texto ou Número para a ordem de colheita.' USING ERRCODE='22023';END IF;
 IF p_action='harvest-order-options' THEN
  RETURN (WITH rows AS (
   SELECT billing_private.import_plot_code(vals->>'COD_FAZENDA') farm,billing_private.import_plot_code(vals->>'COD_TALHAO') plot,
    coalesce(vals->>'NR_ORDEM_COLHEITA','') current_order
   FROM public.billing_import_entries e CROSS JOIN LATERAL billing_private.import_values_json(v_owner,e.id) vals
   WHERE e.owner_id=v_owner AND e.document_id=d.id
  ), groups AS (SELECT r.farm,r.plot,count(*) entry_count,jsonb_agg(DISTINCT r.current_order ORDER BY r.current_order) current_orders
   FROM rows r WHERE r.farm<>'' AND r.plot<>'' GROUP BY r.farm,r.plot)
  SELECT jsonb_build_object('updatedAt',d.updated_at,'missingCount',(SELECT count(*) FROM rows r WHERE r.farm='' OR r.plot=''),
   'orders',coalesce((SELECT jsonb_agg(jsonb_build_object('farm',g.farm,'farmName',coalesce((SELECT f.name FROM public.billing_farms f
    WHERE f.owner_id=v_owner AND billing_private.import_plot_code(f.code)=g.farm ORDER BY f.id LIMIT 1),''),
    'plot',g.plot,'entryCount',g.entry_count,'currentOrders',g.current_orders) ORDER BY g.farm,g.plot) FROM groups g),'[]'::jsonb)));
 END IF;
 IF d.status<>'open' THEN RAISE EXCEPTION 'Reabra a importação para alterar ordens de colheita.' USING ERRCODE='23514';END IF;
 IF jsonb_typeof(p_payload->'expectedUpdatedAt') IS DISTINCT FROM 'string' OR nullif(p_payload->>'expectedUpdatedAt','')::timestamptz IS DISTINCT FROM d.updated_at THEN
  RAISE EXCEPTION 'A importação mudou. Feche e reabra as ordens por talhão antes de salvar.' USING ERRCODE='40001';END IF;
 IF jsonb_typeof(p_payload->'orders') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Informe as ordens por talhão.' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(p_payload->'orders') NOT BETWEEN 1 AND 3000 THEN RAISE EXCEPTION 'Informe entre 1 e 3000 ordens.' USING ERRCODE='22023';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'orders') LOOP
  PERFORM billing_private.request_payload(item,ARRAY['farm','plot','order']);
  IF jsonb_typeof(item->'farm') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'plot') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'order') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Informe fazenda, talhão e ordem como texto.' USING ERRCODE='22023';END IF;
  farm=billing_private.import_plot_code(item->>'farm');plot=billing_private.import_plot_code(item->>'plot');new_order=btrim(item->>'order');
  IF farm='' OR plot='' OR length(farm)>1000 OR length(plot)>1000 OR new_order!~'^[0-9]{1,15}$' OR new_order::numeric<=0 THEN
   RAISE EXCEPTION 'Informe fazenda, talhão e uma ordem inteira positiva de até 15 dígitos.' USING ERRCODE='22023';END IF;
  pair=jsonb_build_array(farm,plot)::text;
  IF pair=ANY(seen) THEN RAISE EXCEPTION 'Não repita a mesma fazenda e talhão.' USING ERRCODE='22023';END IF;
  seen=array_append(seen,pair);
  SELECT count(*) INTO matched FROM public.billing_import_entries e
   CROSS JOIN LATERAL billing_private.import_values_json(v_owner,e.id) vals
   WHERE e.owner_id=v_owner AND e.document_id=d.id AND billing_private.import_plot_code(vals->>'COD_FAZENDA')=farm AND billing_private.import_plot_code(vals->>'COD_TALHAO')=plot;
  IF matched=0 THEN RAISE EXCEPTION 'Fazenda e talhão não encontrados neste documento.' USING ERRCODE='22023';END IF;
  WITH targets AS (
   SELECT e.id FROM public.billing_import_entries e CROSS JOIN LATERAL billing_private.import_values_json(v_owner,e.id) vals
   WHERE e.owner_id=v_owner AND e.document_id=d.id AND billing_private.import_plot_code(vals->>'COD_FAZENDA')=farm AND billing_private.import_plot_code(vals->>'COD_TALHAO')=plot
    AND coalesce(vals->>'NR_ORDEM_COLHEITA','') IS DISTINCT FROM CASE WHEN field_type='decimal' THEN billing_private.decimal_text(new_order::numeric) ELSE new_order END
  ), updated AS (
   INSERT INTO public.billing_import_entry_values(owner_id,entry_id,field_key,text_value,decimal_value)
   SELECT v_owner,id,'NR_ORDEM_COLHEITA',CASE WHEN field_type='text' THEN new_order END,CASE WHEN field_type='decimal' THEN new_order::numeric END FROM targets
   ON CONFLICT ON CONSTRAINT billing_import_entry_values_pkey DO UPDATE SET text_value=excluded.text_value,decimal_value=excluded.decimal_value,date_value=NULL
   RETURNING entry_id
  ) UPDATE public.billing_import_entries SET reviewed=false WHERE owner_id=v_owner AND document_id=d.id AND id IN (SELECT entry_id FROM updated);
  GET DIAGNOSTICS row_count=ROW_COUNT;changed=changed+row_count;
 END LOOP;
 IF changed>0 THEN UPDATE public.billing_import_documents SET updated_at=clock_timestamp() WHERE owner_id=v_owner AND id=d.id RETURNING * INTO d;END IF;
 RETURN jsonb_build_object('document',billing_private.import_document_json(d),'changedCount',changed);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Confira o documento, a revisão e as ordens informadas.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.import_documents_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;

COMMIT;
