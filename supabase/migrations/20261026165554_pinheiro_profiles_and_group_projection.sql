BEGIN;

-- Local report timestamps have minute precision and no timezone conversion.
CREATE FUNCTION billing_private.pinheiro_local_minute(p_value text)
RETURNS timestamp without time zone LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF p_value IS NULL OR p_value!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$' THEN RETURN NULL; END IF;
 RETURN replace(p_value,'T',' ')::timestamp without time zone;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION billing_private.pinheiro_local_minute(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.import_profile_source_key_allowed(p_parser text,p_key text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(p_key,'')='' OR CASE p_parser
  WHEN 'taquari-equipment-v1' THEN p_key IN (
   'entrada','sequencia','dataChegada','horaChegada','dataSaida','horaSaida','dataMovimento',
   'fazendaOrigem','fazendaNome','zona','talhao','itens','ordemCorte','numeroAnalise','bituca','enc',
   'equipamento','equipamentoPrincipal','fazendaZonaTalhao','quantidadeVeiculosConjunto','notaFiscal','pesoBruto','tara','pesoLiquido')
  WHEN 'pinheiro-usjp-v1' THEN p_key IN (
   'periodoInicio','periodoFim','dataHoraBA','dataHoraTara','dataChegada','horaChegada','dataSaida','horaSaida','dataMovimento',
   'fazendaOrigem','fazendaNome','talhao','numeroAnalise','pesoAnalisado','brixCana','brixCaldo',
   'leituraSacarimetricaCorrigida','pbu','ph','arCana','polCaldo','fibra','purezaCana','purezaCaldo',
   'polCana','atr','umidade','amido','agio','sequencia','quantidadeAnalisesConjunto','taraConvencional','pesoBrutoConvencional')
  ELSE false END
$$;
REVOKE ALL ON FUNCTION billing_private.import_profile_source_key_allowed(text,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.normalize_pinheiro_analyses(p_entries jsonb,p_fields jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
 e jsonb;s jsonb;v_start timestamp;v_end timestamp;v_ba timestamp;v_tare timestamp;
 v_group record;v_result jsonb;
BEGIN
 FOR e IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
  s=e->'source';
  v_start=billing_private.pinheiro_local_minute(s->>'periodoInicio');
  v_end=billing_private.pinheiro_local_minute(s->>'periodoFim');
  v_ba=billing_private.pinheiro_local_minute(s->>'dataHoraBA');
  v_tare=billing_private.pinheiro_local_minute(s->>'dataHoraTara');
  IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR v_start IS NULL OR v_end IS NULL OR v_ba IS NULL OR v_tare IS NULL
   OR v_start::time<>'06:00'::time OR v_end+interval '1 minute'<>v_start+interval '1 day' THEN
   RAISE EXCEPTION 'Confira as datas originais e o período Pinheiro: das 06:00 às 05:59 do dia seguinte.' USING ERRCODE='22023';
  END IF;
  IF v_ba<v_start OR v_ba>=v_end+interval '1 minute' OR v_tare<v_ba THEN
   RAISE EXCEPTION 'O BA deve estar dentro do período agrícola e a data da tara não pode anteceder a análise.' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(s->'numeroAnalise') IS DISTINCT FROM 'string' OR coalesce(s->>'numeroAnalise','')!~'^[0-9]{1,20}$'
   OR jsonb_typeof(s->'pesoAnalisado') IS DISTINCT FROM 'string' OR coalesce(s->>'pesoAnalisado','')!~'^[0-9]{1,15}([.,][0-9]{1,6})?$' THEN
   RAISE EXCEPTION 'Confira o número do BA e o peso analisado originais do relatório Pinheiro.' USING ERRCODE='22023';
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_entries) x
  GROUP BY x->'source'->>'periodoInicio',x->'source'->>'numeroAnalise' HAVING count(*)>1) THEN
  RAISE EXCEPTION 'O relatório Pinheiro contém um BA repetido no mesmo período agrícola.' USING ERRCODE='22023';
 END IF;
 FOR v_group IN SELECT x->'source'->>'dataHoraBA' ba,x->'source'->>'dataHoraTara' tare,count(*) quantity
  FROM jsonb_array_elements(p_entries) x GROUP BY x->'source'->>'dataHoraBA',x->'source'->>'dataHoraTara'
 LOOP
  IF v_group.quantity NOT IN (2,3) THEN
   RAISE EXCEPTION 'Conjunto Pinheiro incompleto ou ambíguo: a convenção de tara exige 2 ou 3 análises com as mesmas datas de BA e tara.' USING ERRCODE='22023';
  END IF;
 END LOOP;
 WITH numbered AS (
  SELECT x.value,x.position,
   row_number() OVER(PARTITION BY x.value->'source'->>'dataHoraBA',x.value->'source'->>'dataHoraTara' ORDER BY x.position) sequence,
   count(*) OVER(PARTITION BY x.value->'source'->>'dataHoraBA',x.value->'source'->>'dataHoraTara') quantity
  FROM jsonb_array_elements(p_entries) WITH ORDINALITY x(value,position)
 ), derived AS (
  SELECT n.*,jsonb_build_object(
   'sequencia',n.sequence::text,'quantidadeAnalisesConjunto',n.quantity::text,
   'taraConvencional',billing_private.decimal_text(n.sequence::numeric),
   'pesoBrutoConvencional',billing_private.decimal_text(replace(n.value->'source'->>'pesoAnalisado',',','.')::numeric+n.sequence::numeric),
   'dataMovimento',left(n.value->'source'->>'periodoInicio',10),
   'dataChegada',left(n.value->'source'->>'dataHoraBA',10),'horaChegada',right(n.value->'source'->>'dataHoraBA',5),
   'dataSaida',left(n.value->'source'->>'dataHoraTara',10),'horaSaida',right(n.value->'source'->>'dataHoraTara',5)
  ) source_values FROM numbered n
 )
 SELECT jsonb_agg(d.value||jsonb_build_object(
  'date',d.source_values->>'dataMovimento','source',(d.value->'source')||d.source_values,
  'values',(d.value->'values')||coalesce((SELECT jsonb_object_agg(f->>'key',d.source_values->>(f->>'sourceKey'))
   FROM jsonb_array_elements(p_fields) f WHERE f->>'source'='pdf' AND d.source_values?(f->>'sourceKey')),'{}'::jsonb)
 ) ORDER BY d.position) INTO v_result FROM derived d;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION billing_private.normalize_pinheiro_analyses(jsonb,jsonb) FROM PUBLIC,anon,authenticated;

-- The parser decides which source identity is meaningful. Pinheiro groups BAs
-- by the exact analysis/tare timestamp pair, never by ERP entry or equipment.
CREATE FUNCTION billing_private.import_source_group_key(p_source jsonb,p_parser text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN p_parser='pinheiro-usjp-v1' THEN
  CASE WHEN billing_private.pinheiro_local_minute(p_source->>'dataHoraBA') IS NOT NULL
   AND billing_private.pinheiro_local_minute(p_source->>'dataHoraTara') IS NOT NULL
  THEN jsonb_build_array('pinheiro-usjp-v1',p_source->>'dataHoraBA',p_source->>'dataHoraTara') END
 ELSE billing_private.import_source_group_key(p_source) END
$$;
REVOKE ALL ON FUNCTION billing_private.import_source_group_key(jsonb,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.import_document_json(r public.billing_import_documents)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 WITH entry_rows AS MATERIALIZED (
  SELECT e.*,billing_private.import_source_group_key(e.source,r.profile_snapshot->>'parser') group_key,
   billing_private.import_entry_pending(r.owner_id,e.id,r.profile_snapshot->'fields') pending
  FROM public.billing_import_entries e WHERE e.owner_id=r.owner_id AND e.document_id=r.id
 ), first_positions AS (
  SELECT group_key,min(position) first_position FROM entry_rows WHERE group_key IS NOT NULL GROUP BY group_key
 ), group_ordinals AS (
  SELECT group_key,dense_rank() OVER(ORDER BY first_position,group_key::text)::integer group_ordinal FROM first_positions
 )
 SELECT jsonb_build_object('id',r.id,'clientId',r.client_id,
  'clientName',(SELECT coalesce(nullif(c.trade_name,''),c.legal_name) FROM public.billing_clients c WHERE c.owner_id=r.owner_id AND c.id=r.client_id),
  'profileId',r.profile_id,'profileSnapshot',r.profile_snapshot,'sourceName',r.source_name,'sourceHash',r.source_hash,
  'status',r.status,'createdAt',r.created_at,'updatedAt',r.updated_at,'finishedAt',r.finished_at,
  'entryCount',(SELECT count(*) FROM entry_rows),'pendingCount',(SELECT count(*) FROM entry_rows WHERE pending),
  'entries',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'date',to_char(e.entry_date,'YYYY-MM-DD'),
   'values',billing_private.import_values_json(e.owner_id,e.id),'source',e.source,
   'sourcePage',e.source_page,'sourceLine',e.source_line,'reviewed',e.reviewed,
   'groupKey',e.group_key::text,'groupOrdinal',g.group_ordinal) ORDER BY e.entry_date,e.position,e.id)
   FROM entry_rows e LEFT JOIN group_ordinals g ON g.group_key=e.group_key),'[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION billing_private.import_document_json(public.billing_import_documents) FROM PUBLIC,anon,authenticated;

DO $$
DECLARE definition text;old_source_guard text := $guard$(coalesce(f->>'sourceKey','')<>'' AND f->>'sourceKey' NOT IN ('entrada','sequencia','dataChegada','horaChegada','dataSaida','horaSaida','dataMovimento','fazendaOrigem','fazendaNome','zona','talhao','itens','ordemCorte','numeroAnalise','bituca','enc','equipamento','equipamentoPrincipal','fazendaZonaTalhao','quantidadeVeiculosConjunto','notaFiscal','pesoBruto','tara','pesoLiquido'))$guard$;
BEGIN
 definition=pg_get_functiondef('billing_private.import_profiles_dispatch_before_lifecycle(text,jsonb)'::regprocedure);
 IF strpos(definition,$old$coalesce(p_payload->>'parser','')<>'taquari-equipment-v1'$old$)=0 OR strpos(definition,old_source_guard)=0 THEN
  RAISE EXCEPTION 'Expected import parser/source whitelist was not found.';
 END IF;
 definition=replace(definition,$old$coalesce(p_payload->>'parser','')<>'taquari-equipment-v1'$old$,
  $new$coalesce(p_payload->>'parser','') NOT IN ('taquari-equipment-v1','pinheiro-usjp-v1')$new$);
 definition=replace(definition,old_source_guard,$new$NOT billing_private.import_profile_source_key_allowed(p_payload->>'parser',f->>'sourceKey')$new$);
 EXECUTE definition;

 definition=pg_get_functiondef('billing_private.import_documents_dispatch_before_client_summaries(text,jsonb)'::regprocedure);
 IF strpos(definition,$old$p_payload=jsonb_set(p_payload,'{entries}',billing_private.normalize_taquari_vehicle_groups(p_payload->'entries',p.config->'fields'));$old$)=0 THEN
  RAISE EXCEPTION 'Expected import normalization was not found.';
 END IF;
 EXECUTE replace(definition,
  $old$p_payload=jsonb_set(p_payload,'{entries}',billing_private.normalize_taquari_vehicle_groups(p_payload->'entries',p.config->'fields'));$old$,
  $new$IF p.config->>'parser'='pinheiro-usjp-v1' THEN
   p_payload=jsonb_set(p_payload,'{entries}',billing_private.normalize_pinheiro_analyses(p_payload->'entries',p.config->'fields'));
  ELSE
   p_payload=jsonb_set(p_payload,'{entries}',billing_private.normalize_taquari_vehicle_groups(p_payload->'entries',p.config->'fields'));
  END IF;$new$);

 definition=pg_get_functiondef('billing_private.import_client_collection(uuid,text,text,uuid)'::regprocedure);
 IF strpos(definition,$old$billing_private.import_source_group_key(e.source) group_key$old$)=0 THEN RAISE EXCEPTION 'Expected client group projection was not found.'; END IF;
 EXECUTE replace(definition,$old$billing_private.import_source_group_key(e.source) group_key$old$,
  $new$billing_private.import_source_group_key(e.source,d.profile_snapshot->>'parser') group_key$new$);

 definition=pg_get_functiondef('billing_private.import_documents_dispatch(text,jsonb)'::regprocedure);
 IF strpos(definition,$old$billing_private.import_source_group_key(e.source) group_key$old$)=0 THEN RAISE EXCEPTION 'Expected document group projection was not found.'; END IF;
 EXECUTE replace(definition,$old$billing_private.import_source_group_key(e.source) group_key$old$,
  $new$billing_private.import_source_group_key(e.source,r.profile_snapshot->>'parser') group_key$new$);
END $$;
REVOKE ALL ON FUNCTION billing_private.import_profiles_dispatch_before_lifecycle(text,jsonb),
 billing_private.import_documents_dispatch_before_client_summaries(text,jsonb),billing_private.import_client_collection(uuid,text,text,uuid),
 billing_private.import_documents_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
COMMIT;
