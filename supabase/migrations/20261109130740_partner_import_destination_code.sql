BEGIN;

ALTER TABLE public.billing_clients ADD COLUMN destination_code text NOT NULL DEFAULT ''
 CHECK(destination_code='' OR destination_code~'^[0-9]{1,30}$');
COMMENT ON COLUMN public.billing_clients.destination_code IS 'ERP COD_DESTINO default for this partner; text preserves leading zeros.';

-- Reuse the existing generic presentation, without changing other resources.
DO $$
DECLARE definition text:=pg_get_functiondef('billing_private.present(jsonb)'::regprocedure);
 anchor text:=$a$WHEN 'client_id' THEN 'clientId'$a$;
BEGIN
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected registration projection';END IF;
 EXECUTE replace(definition,anchor,$a$WHEN 'destination_code' THEN 'destinationCode' WHEN 'client_id' THEN 'clientId'$a$);
END $$;

-- Callers hold the account's import lock. Only empty cells receive the default;
-- explicit destination values, source evidence and finished status are retained.
CREATE FUNCTION billing_private.import_fill_partner_destination(p_owner uuid,p_document uuid)
RETURNS integer LANGUAGE plpgsql SET search_path='' AS $$
DECLARE d public.billing_import_documents;code text;changed uuid[];
BEGIN
 IF auth.uid() IS NULL OR billing_private.current_owner_id() IS DISTINCT FROM p_owner THEN
  RAISE EXCEPTION 'Entre para atualizar as importações.' USING ERRCODE='28000';END IF;
 SELECT * INTO d FROM public.billing_import_documents WHERE owner_id=p_owner AND id=p_document FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Importação não encontrada.' USING ERRCODE='P0002';END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d.profile_snapshot->'fields') f WHERE f->>'key'='COD_DESTINO' AND f->>'type'='text') THEN RETURN 0;END IF;
 SELECT destination_code INTO code FROM public.billing_clients WHERE owner_id=p_owner AND id=d.client_id FOR SHARE;
 IF coalesce(code,'')='' THEN RETURN 0;END IF;
 WITH filled AS (
  INSERT INTO public.billing_import_entry_values(owner_id,entry_id,field_key,text_value)
  SELECT p_owner,e.id,'COD_DESTINO',code FROM public.billing_import_entries e
  WHERE e.owner_id=p_owner AND e.document_id=d.id
  ON CONFLICT(owner_id,entry_id,field_key) DO UPDATE SET text_value=excluded.text_value,decimal_value=NULL,date_value=NULL
   WHERE coalesce(billing_import_entry_values.text_value,billing_import_entry_values.decimal_value::text,billing_import_entry_values.date_value::text,'')=''
  RETURNING entry_id
 ) SELECT array_agg(entry_id) INTO changed FROM filled;
 IF coalesce(cardinality(changed),0)=0 THEN RETURN 0;END IF;
 UPDATE public.billing_import_entries SET reviewed=false WHERE owner_id=p_owner AND id=ANY(changed) AND reviewed;
 UPDATE public.billing_import_documents SET updated_at=clock_timestamp() WHERE owner_id=p_owner AND id=d.id;
 RETURN cardinality(changed);
END $$;
REVOKE ALL ON FUNCTION billing_private.import_fill_partner_destination(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.client_fill_import_destinations(p_owner uuid,p_client uuid)
RETURNS integer LANGUAGE plpgsql SET search_path='' AS $$
DECLARE document_id uuid;filled integer:=0;
BEGIN
 IF auth.uid() IS NULL OR billing_private.current_owner_id() IS DISTINCT FROM p_owner THEN
  RAISE EXCEPTION 'Entre para atualizar o parceiro.' USING ERRCODE='28000';END IF;
 FOR document_id IN SELECT id FROM public.billing_import_documents WHERE owner_id=p_owner AND client_id=p_client ORDER BY id FOR UPDATE LOOP
  filled=filled+billing_private.import_fill_partner_destination(p_owner,document_id);
 END LOOP;
 RETURN filled;
END $$;
REVOKE ALL ON FUNCTION billing_private.client_fill_import_destinations(uuid,uuid) FROM PUBLIC,anon,authenticated;

-- Extend only the original clients branch. Older bundles may omit this optional
-- field; their ordinary edits must preserve the stored destination code.
DO $$
DECLARE definition text:=pg_get_functiondef('billing_private.dispatch_before_fleet(text,text,jsonb)'::regprocedure);
 lock_anchor text:=$a$IF p_action IN ('save','delete') THEN PERFORM pg_advisory_xact_lock(hashtextextended('billing:'||v_owner::text,0)); END IF;$a$;
 field_anchor text:=$a$IF v_resource='companies' THEN$a$;
 saved_anchor text:=$a$IF v_resource IN ('companies','cultures') THEN RETURN jsonb_build_object('id',v_id); END IF;$a$;
BEGIN
 IF strpos(definition,lock_anchor)=0 OR strpos(definition,field_anchor)=0 OR strpos(definition,saved_anchor)=0 THEN
  RAISE EXCEPTION 'Unexpected partner registration implementation';END IF;
 definition=replace(definition,lock_anchor,$a$IF v_resource='clients' AND p_action='save' AND p_payload?'destinationCode' THEN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para salvar o parceiro.' USING ERRCODE='28000';END IF;
  PERFORM billing_private.authorize_resource('clients','save');
  PERFORM billing_private.lock_request_actor();
  PERFORM pg_advisory_xact_lock(hashtextextended('billing:imports:'||v_owner::text,0));
 END IF;
 $a$||lock_anchor);
 definition=replace(definition,field_anchor,$a$IF v_resource='clients' AND p_payload?'destinationCode' THEN
    IF jsonb_typeof(p_payload->'destinationCode') IS DISTINCT FROM 'string' THEN
     RAISE EXCEPTION 'Informe o código de destino como texto.' USING ERRCODE='22023';END IF;
    v_text=btrim(p_payload->>'destinationCode');
    IF v_text<>'' AND v_text!~'^[0-9]{1,30}$' THEN
     RAISE EXCEPTION 'O código de destino deve conter até 30 dígitos.' USING ERRCODE='22023';END IF;
    v_data=v_data||jsonb_build_object('destination_code',v_text);
   END IF;
   $a$||field_anchor);
 definition=replace(definition,saved_anchor,$a$IF v_resource='clients' AND p_payload?'destinationCode' THEN
   PERFORM billing_private.client_fill_import_destinations(v_owner,v_id);
  END IF;
  $a$||saved_anchor);
 EXECUTE definition;
END $$;

ALTER FUNCTION billing_private.import_documents_dispatch(text,jsonb) RENAME TO import_documents_before_partner_destination_dispatch;
REVOKE ALL ON FUNCTION billing_private.import_documents_before_partner_destination_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.import_documents_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();result jsonb;d public.billing_import_documents;
BEGIN
 IF p_action IS NULL OR NOT(p_action IN ('import','append-source-entries') OR (p_action='save-entry' AND nullif(p_payload->>'entryId','') IS NULL)) THEN
  RETURN billing_private.import_documents_before_partner_destination_dispatch(p_action,p_payload);
 END IF;
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Entre para importar documentos.' USING ERRCODE='28000';END IF;
 PERFORM billing_private.authorize('imports.write');
 PERFORM billing_private.lock_request_actor();
 PERFORM pg_advisory_xact_lock(hashtextextended('billing:imports:'||v_owner::text,0));
 result=billing_private.import_documents_before_partner_destination_dispatch(p_action,p_payload);
 -- A repeated upload returns its historical document without changing cells.
 IF p_action='import' AND result->>'created'='false' THEN RETURN result;END IF;
 IF result->'document' IS NOT NULL THEN
  PERFORM billing_private.import_fill_partner_destination(v_owner,(result->'document'->>'id')::uuid);
  SELECT * INTO d FROM public.billing_import_documents t WHERE t.owner_id=v_owner AND t.id=(result->'document'->>'id')::uuid;
  result=jsonb_set(result,'{document}',billing_private.import_document_json(d));
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION billing_private.import_documents_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;

COMMIT;
