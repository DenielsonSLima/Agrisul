BEGIN;

-- Called only inside the existing authorized, revision-checked import transaction.
CREATE FUNCTION billing_private.import_spread_harvest_order(p_document public.billing_import_documents,p_entry uuid,p_values jsonb)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE kind text;order_value text;farm text;plot text;
BEGIN
 SELECT f->>'type' INTO kind FROM jsonb_array_elements(p_document.profile_snapshot->'fields') f WHERE f->>'key'='NR_ORDEM_COLHEITA';
 IF kind IS NULL THEN RETURN; END IF;
 IF kind NOT IN ('text','decimal') THEN RAISE EXCEPTION 'Use Texto ou Número para a ordem de colheita.' USING ERRCODE='22023'; END IF;
 order_value=billing_private.import_equipment_value(p_values->>'NR_ORDEM_COLHEITA',kind);
 IF order_value<>'' AND (billing_private.import_plot_code(order_value)!~'^[0-9]{1,15}$' OR billing_private.import_plot_code(order_value)::numeric<=0) THEN
  RAISE EXCEPTION 'Informe uma ordem de colheita inteira positiva.' USING ERRCODE='22023'; END IF;
 farm=billing_private.import_plot_code(p_values->>'COD_FAZENDA');
 plot=billing_private.import_plot_code(p_values->>'COD_TALHAO');
 -- Missing origins never group unrelated blank rows. Other farms/documents stay isolated.
 WITH targets AS (
  SELECT e.id FROM public.billing_import_entries e CROSS JOIN LATERAL billing_private.import_values_json(e.owner_id,e.id) vals
  WHERE e.owner_id=p_document.owner_id AND e.document_id=p_document.id
   AND (e.id=p_entry OR (farm<>'' AND plot<>'' AND billing_private.import_plot_code(vals->>'COD_FAZENDA')=farm
     AND billing_private.import_plot_code(vals->>'COD_TALHAO')=plot))
   AND coalesce(vals->>'NR_ORDEM_COLHEITA','') IS DISTINCT FROM order_value
 ), updated AS (
  INSERT INTO public.billing_import_entry_values(owner_id,entry_id,field_key,text_value,decimal_value)
  SELECT p_document.owner_id,id,'NR_ORDEM_COLHEITA',CASE WHEN kind='text' OR order_value='' THEN order_value END,
   CASE WHEN kind='decimal' AND order_value<>'' THEN order_value::numeric END FROM targets
  ON CONFLICT ON CONSTRAINT billing_import_entry_values_pkey DO UPDATE
   SET text_value=excluded.text_value,decimal_value=excluded.decimal_value,date_value=NULL RETURNING entry_id
 ) UPDATE public.billing_import_entries SET reviewed=false
   WHERE owner_id=p_document.owner_id AND document_id=p_document.id AND id IN(SELECT entry_id FROM updated);
END $$;

CREATE FUNCTION billing_private.import_group_harvest_values(p_document public.billing_import_documents,p_entry uuid,p_values jsonb,p_previous jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE vals jsonb;kind text;
BEGIN
 vals=billing_private.import_group_equipment_values(p_document,p_entry,p_values,p_previous);
 SELECT f->>'type' INTO kind FROM jsonb_array_elements(p_document.profile_snapshot->'fields') f WHERE f->>'key'='NR_ORDEM_COLHEITA';
 IF kind IS NOT NULL AND vals?'NR_ORDEM_COLHEITA'
  AND billing_private.import_equipment_value(vals->>'NR_ORDEM_COLHEITA',kind) IS DISTINCT FROM billing_private.import_equipment_value(p_previous->>'NR_ORDEM_COLHEITA',kind) THEN
  PERFORM billing_private.import_spread_harvest_order(p_document,p_entry,vals);
 END IF;
 RETURN vals;
END $$;
REVOKE ALL ON FUNCTION billing_private.import_spread_harvest_order(public.billing_import_documents,uuid,jsonb),
 billing_private.import_group_harvest_values(public.billing_import_documents,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;

DO $$
DECLARE definition text:=pg_get_functiondef('billing_private.import_documents_dispatch_before_client_summaries(text,jsonb)'::regprocedure);
 bulk_anchor text:='PERFORM billing_private.import_store_values(v_owner,v_entry,v_fields,v_values,false);';
 entry_anchor text:='billing_private.import_group_equipment_values(r,v_entry,p_payload->''values'',';
BEGIN
 IF (length(definition)-length(replace(definition,bulk_anchor,'')))/length(bulk_anchor)<>1 OR strpos(definition,entry_anchor)=0 THEN
  RAISE EXCEPTION 'Unexpected import write paths for inline harvest order'; END IF;
 definition=replace(definition,bulk_anchor,bulk_anchor||$spread$
 IF p_action='save-bulk' AND 'NR_ORDEM_COLHEITA'=ANY(v_keys) THEN
  PERFORM billing_private.import_spread_harvest_order(r,v_entry,v_values);
 END IF;$spread$);
 definition=replace(definition,entry_anchor,'billing_private.import_group_harvest_values(r,v_entry,p_payload->''values'',');
 EXECUTE definition;
END $$;

COMMIT;
