BEGIN;
-- Historical service requests may keep the source purchase request number.
-- The source must belong to this workspace, and its items are rebuilt in SQL.
-- Normal service creation keeps its existing automatic numbering and audit time.
CREATE FUNCTION billing_private.service_purchase_source_payload(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_number text;v_count integer;
 v_date date;v_last date;v_items jsonb;v_notes text;v_source_notes text;
BEGIN
 PERFORM billing_private.authorize('registrations.read');
 PERFORM billing_private.authorize('requests.write');
 v_number=p_payload->>'purchaseRequestNumber';
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Entre para importar a solicitação.' USING ERRCODE='28000'; END IF;
 IF jsonb_typeof(p_payload->'purchaseRequestNumber') IS DISTINCT FROM 'string'
  OR coalesce(v_number,'')!~'^[1-9][0-9]{0,8}$' THEN
  RAISE EXCEPTION 'Informe o número original da solicitação de compra.' USING ERRCODE='22023'; END IF;
 SELECT count(*),min(requested_on),max(requested_on),
  jsonb_agg(jsonb_build_object('description',description||' — Quantidade: '||billing_private.decimal_text(quantity)||' '||unit,
   'application',application) ORDER BY source_key,id),
  string_agg(nullif(notes,''),E'\n' ORDER BY source_key,id)
 INTO v_count,v_date,v_last,v_items,v_source_notes
 FROM public.billing_purchase_requests WHERE owner_id=v_owner AND request_number=v_number AND item_type='service';
 IF v_count NOT BETWEEN 1 AND 50 OR v_date IS DISTINCT FROM v_last THEN
  RAISE EXCEPTION 'Não há um grupo válido de serviços com este número neste espaço.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.billing_service_requests WHERE owner_id=v_owner
  AND id=nullif(p_payload->>'requestId','')::uuid AND number<>v_number::bigint) THEN
  RAISE EXCEPTION 'O identificador já foi utilizado em outra solicitação.' USING ERRCODE='23505'; END IF;
 v_notes=concat('Solicitação original nº ',v_number,' — Data original: ',to_char(v_date,'DD/MM/YYYY'),E'.\n',
  'Pedidos urgentes — Unidade Japoatã. Prestador e orçamento pendentes quando não informados.',
  CASE WHEN nullif(p_payload->>'notes','') IS NOT NULL THEN E'\n'||(p_payload->>'notes') ELSE '' END,
  CASE WHEN nullif(v_source_notes,'') IS NOT NULL THEN E'\n'||v_source_notes ELSE '' END);
 RETURN p_payload||jsonb_build_object('items',v_items,'notes',v_notes);
END $$;
REVOKE ALL ON FUNCTION billing_private.service_purchase_source_payload(jsonb) FROM PUBLIC,anon,authenticated;

DO $migration$
DECLARE definition text;old text;new text;
BEGIN
 SELECT pg_get_functiondef('billing_private.service_requests_dispatch(text,jsonb)'::regprocedure) INTO definition;
 old='PERFORM billing_private.request_payload(p_payload,ARRAY[''requestId'',''requesterSignatureId''';
 IF strpos(definition,old)=0 THEN RAISE EXCEPTION 'Unexpected service create payload contract'; END IF;
 definition=replace(definition,old,'PERFORM billing_private.request_payload(p_payload,ARRAY[''purchaseRequestNumber'',''requestId'',''requesterSignatureId''');
 old='IF p_action<>''create'' THEN RAISE EXCEPTION ''Operação inválida.'' USING ERRCODE=''22023''; END IF;';
 IF strpos(definition,old)=0 THEN RAISE EXCEPTION 'Unexpected service create branch'; END IF;
 definition=replace(definition,old,old||E'\n IF p_payload ? ''purchaseRequestNumber'' THEN p_payload=billing_private.service_purchase_source_payload(p_payload); END IF;');
 old='SELECT coalesce(max(number),0)+1 INTO v_number FROM public.billing_service_requests WHERE owner_id=v_owner;';
 IF strpos(definition,old)=0 THEN RAISE EXCEPTION 'Unexpected automatic service numbering'; END IF;
 new='IF p_payload ? ''purchaseRequestNumber'' THEN v_number=(p_payload->>''purchaseRequestNumber'')::bigint; ELSE '||old||' END IF;';
 definition=replace(definition,old,new);
 EXECUTE definition;
END $migration$;
COMMENT ON FUNCTION billing_private.service_purchase_source_payload(jsonb) IS
 'Builds service items and historical references from owner-scoped purchase request lines; never accepts an owner or a client-provided item override.';
COMMIT;
