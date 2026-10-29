BEGIN;
ALTER TABLE public.billing_contract_loads ADD COLUMN harvest_method text CHECK(harvest_method IN ('1','2'));
CREATE TABLE public.billing_import_load_links (
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 document_id uuid NOT NULL,trip_key text NOT NULL,load_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,document_id,trip_key),UNIQUE(owner_id,load_id),
 FOREIGN KEY(owner_id,document_id) REFERENCES public.billing_import_documents(owner_id,id),
 FOREIGN KEY(owner_id,load_id) REFERENCES public.billing_contract_loads(owner_id,id) ON DELETE CASCADE
);
ALTER TABLE public.billing_import_load_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_import_load_links FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_import_load_links TO authenticated;
CREATE POLICY import_load_link_read ON public.billing_import_load_links FOR SELECT TO authenticated
 USING(billing_private.can_access_owner(owner_id,'contracts.read'));
ALTER TABLE public.billing_import_load_links REPLICA IDENTITY FULL;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
 ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_import_load_links;
END IF; END $$;

-- Current typed cells are authoritative. Weights from these PDF models are tonnes.
-- Original source groups prevent reboques/analyses becoming duplicate trips.
CREATE FUNCTION billing_private.import_load_candidates(p_document public.billing_import_documents)
RETURNS TABLE(trip_key text,loaded_at date,volume numeric,harvest_method text,entry_count bigint,entry_number text,farm_code text,plot_code text,issue text)
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH entries AS (
  SELECT coalesce(nullif(e->>'groupKey',''),'entry:'||(e->>'id')) trip,
   (e->>'date')::date movement_date,e->'values' vals
  FROM jsonb_array_elements(billing_private.import_document_json(p_document)->'entries') e
 ), typed AS (
  SELECT *,CASE WHEN (vals->>'PESOBRUTO')~'^[0-9]+([.][0-9]+)?$'
   AND (vals->>'TARA')~'^[0-9]+([.][0-9]+)?$'
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_document.profile_snapshot->'fields') f WHERE f->>'key'='PESOBRUTO' AND f->>'type'='decimal')
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_document.profile_snapshot->'fields') f WHERE f->>'key'='TARA' AND f->>'type'='decimal')
   THEN (vals->>'PESOBRUTO')::numeric-(vals->>'TARA')::numeric END net
  FROM entries
 ), grouped AS (
  SELECT trip,min(movement_date) movement_date,sum(net) tons,count(*) n,min(vals->>'COD_ENTRADA') entry,
   min(vals->>'COD_FAZENDA') farm,min(vals->>'COD_TALHAO') plot,min(vals->>'COD_TIPOCOLHEITA') method,
   count(DISTINCT movement_date) dates,count(*) FILTER(WHERE net IS NULL OR net<=0) missing,
   count(DISTINCT vals->>'COD_TIPOCOLHEITA') methods,
   count(*) FILTER(WHERE coalesce(vals->>'COD_TIPOCOLHEITA','') NOT IN ('1','2')) invalid_method,
   count(DISTINCT coalesce(vals->>'COD_FAZENDA','')) farms,count(DISTINCT coalesce(vals->>'COD_TALHAO','')) plots
  FROM typed GROUP BY trip
 )
 SELECT trip,movement_date,tons,CASE WHEN methods=1 AND invalid_method=0 THEN method END,n,entry,farm,plot,
  CASE WHEN p_document.profile_snapshot->>'parser' NOT IN ('taquari-equipment-v1','pinheiro-usjp-v1') THEN 'Este modelo não possui unidade de peso em toneladas confirmada.'
   WHEN missing>0 THEN 'Confira os pesos bruto e tara de todas as linhas do conjunto.'
   WHEN dates<>1 OR farms<>1 OR plots<>1 THEN 'O conjunto possui datas ou origens divergentes. Reabra e confira o PDF.'
   WHEN methods<>1 OR invalid_method>0 THEN 'Confira a coluna K: 1 = manual; 2 = mecanizada.'
   WHEN tons<>round(tons,3) OR tons>=1000000000000 THEN 'O volume deve ter até três casas decimais e estar no limite do contrato.'
   ELSE '' END
 FROM grouped
$$;
REVOKE ALL ON FUNCTION billing_private.import_load_candidates(public.billing_import_documents) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.import_documents_dispatch(text,jsonb) RENAME TO import_documents_dispatch_before_load_queue;
REVOKE ALL ON FUNCTION billing_private.import_documents_dispatch_before_load_queue(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.import_documents_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=billing_private.current_owner_id();c public.billing_contracts;d public.billing_import_documents;
 candidate record;l public.billing_contract_loads;v_result jsonb;v_farm uuid;v_plot uuid;v_link uuid;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('pending-loads','link-load') THEN
  IF p_action='reopen' THEN
   PERFORM billing_private.lock_request_actor();
   PERFORM pg_advisory_xact_lock(hashtextextended('billing:imports:'||v_owner::text,0));
   IF EXISTS(SELECT 1 FROM public.billing_import_load_links WHERE owner_id=v_owner AND document_id=nullif(p_payload->>'id','')::uuid) THEN
    RAISE EXCEPTION 'Este documento possui carregamentos vinculados. Exclua os vínculos nos contratos antes de reabrir.' USING ERRCODE='23514';
   END IF;
  END IF;
  RETURN billing_private.import_documents_dispatch_before_load_queue(p_action,p_payload);
 END IF;
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Entre para acessar os carregamentos.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize('contracts.read');
 IF p_action='link-load' THEN PERFORM billing_private.authorize('contracts.write');END IF;
 PERFORM billing_private.request_payload(p_payload,CASE WHEN p_action='pending-loads' THEN ARRAY['companyId','contractId']
  ELSE ARRAY['companyId','contractId','id','tripKey','expectedUpdatedAt','farmId','plotId'] END);
 IF EXISTS(SELECT 1 FROM jsonb_each(p_payload) field WHERE jsonb_typeof(field.value)<>'string') THEN
  RAISE EXCEPTION 'Envie os identificadores e a revisão como texto.' USING ERRCODE='22023'; END IF;
 IF p_action='link-load' THEN
  PERFORM billing_private.lock_request_actor();
  PERFORM pg_advisory_xact_lock(hashtextextended('billing:imports:'||v_owner::text,0));
 END IF;
 SELECT * INTO c FROM public.billing_contracts WHERE owner_id=v_owner AND id=nullif(p_payload->>'contractId','')::uuid
  AND company_id=nullif(p_payload->>'companyId','')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado para a empresa ativa.' USING ERRCODE='P0002'; END IF;
 IF p_action='pending-loads' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('documentId',doc.id,'sourceName',doc.source_name,'updatedAt',doc.updated_at,
   'tripKey',trip.trip_key,'loadedAt',trip.loaded_at,'volume',billing_private.decimal_text(trip.volume),
   'harvestMethod',trip.harvest_method,'entryCount',trip.entry_count,'entryNumber',trip.entry_number,
   'farmCode',trip.farm_code,'plotCode',trip.plot_code,'issue',trip.issue) ORDER BY trip.loaded_at DESC,doc.id,trip.trip_key),'[]'::jsonb) INTO v_result
  FROM public.billing_import_documents doc CROSS JOIN LATERAL billing_private.import_load_candidates(doc) trip
  WHERE doc.owner_id=v_owner AND doc.client_id=c.client_id AND doc.status='finished'
   AND NOT EXISTS(SELECT 1 FROM public.billing_import_load_links link WHERE link.owner_id=v_owner AND link.document_id=doc.id AND link.trip_key=trip.trip_key);
  RETURN jsonb_build_object('loads',v_result,'canManage',billing_private.has_permission('contracts.write'));
 END IF;
 SELECT * INTO c FROM public.billing_contracts WHERE owner_id=v_owner AND id=c.id FOR UPDATE;
 IF c.status<>'Ativo' THEN RAISE EXCEPTION 'Vincule o carregamento a um contrato ativo.' USING ERRCODE='23514'; END IF;
 SELECT * INTO d FROM public.billing_import_documents WHERE owner_id=v_owner AND id=nullif(p_payload->>'id','')::uuid AND client_id=c.client_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Documento não encontrado para o parceiro do contrato.' USING ERRCODE='P0002'; END IF;
 SELECT load_id INTO v_link FROM public.billing_import_load_links WHERE owner_id=v_owner AND document_id=d.id AND trip_key=p_payload->>'tripKey';
 IF v_link IS NOT NULL THEN
  SELECT * INTO l FROM public.billing_contract_loads WHERE owner_id=v_owner AND id=v_link;
  IF l.contract_id<>c.id THEN RAISE EXCEPTION 'O conjunto já foi vinculado a outro contrato.' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('load',billing_private.present_contract_load(l),'created',false);
 END IF;
 IF d.status<>'finished' THEN RAISE EXCEPTION 'Finalize o documento antes de vincular.' USING ERRCODE='23514';END IF;
 IF nullif(p_payload->>'expectedUpdatedAt','')::timestamptz IS DISTINCT FROM d.updated_at THEN
  RAISE EXCEPTION 'O documento foi alterado. Atualize a fila antes de vincular.' USING ERRCODE='40001'; END IF;
 SELECT * INTO candidate FROM billing_private.import_load_candidates(d) WHERE trip_key=p_payload->>'tripKey';
 IF NOT FOUND THEN RAISE EXCEPTION 'Conjunto não encontrado.' USING ERRCODE='P0002';END IF;
 IF candidate.issue<>'' THEN RAISE EXCEPTION '%',candidate.issue USING ERRCODE='23514'; END IF;
 v_farm=nullif(p_payload->>'farmId','')::uuid;v_plot=nullif(p_payload->>'plotId','')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.billing_farms WHERE owner_id=v_owner AND id=v_farm) THEN
  RAISE EXCEPTION 'Selecione uma fazenda válida.' USING ERRCODE='22023'; END IF;
 IF v_plot IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.billing_farm_plots WHERE owner_id=v_owner AND farm_id=v_farm AND id=v_plot) THEN
  RAISE EXCEPTION 'Selecione um talhão válido para a fazenda.' USING ERRCODE='22023'; END IF;
 INSERT INTO public.billing_contract_loads(owner_id,contract_id,farm_id,plot_id,loaded_at,volume,atr,document,notes,harvest_method)
 VALUES(v_owner,c.id,v_farm,v_plot,candidate.loaded_at,candidate.volume,NULL,left(coalesce(candidate.entry_number,d.source_name),100),
  left('Importado de '||d.source_name||' · '||candidate.entry_count||' linha(s) · Colheita '||CASE candidate.harvest_method WHEN '1' THEN 'manual' ELSE 'mecanizada' END,1000),candidate.harvest_method) RETURNING * INTO l;
 INSERT INTO public.billing_import_load_links(owner_id,document_id,trip_key,load_id) VALUES(v_owner,d.id,candidate.trip_key,l.id);
 RETURN jsonb_build_object('load',billing_private.present_contract_load(l),'created',true);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Confira os identificadores e a revisão do documento.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.import_documents_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;

-- Allow edits to imported loads before their measured ATR is available.
DO $$ DECLARE definition text:=pg_get_functiondef('billing_private.contracts_dispatch(text,jsonb)'::regprocedure);
BEGIN
 IF strpos(definition,'IF v_atr_text!~')=0 THEN RAISE EXCEPTION 'Unexpected contract ATR validation';END IF;
 definition=replace(definition,'IF v_atr_text!~','IF v_atr_text<>'''' AND (v_atr_text!~');
 definition=replace(definition,$old$OR v_atr_text::numeric<=0 THEN RAISE EXCEPTION 'Informe um ATR válido$old$, $new$OR v_atr_text::numeric<=0) THEN RAISE EXCEPTION 'Informe um ATR válido$new$);
 definition=replace(definition,'v_atr_text::numeric,','nullif(v_atr_text,'''')::numeric,');
 EXECUTE definition;
END $$;
COMMIT;
