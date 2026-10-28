BEGIN;

CREATE OR REPLACE FUNCTION billing_private.normalize_pinheiro_analyses(p_entries jsonb,p_fields jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
 e jsonb;s jsonb;v_start timestamp;v_end timestamp;v_ba timestamp;v_tare timestamp;
 v_result jsonb;
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
 -- A timestamp pair may contain any positive number of analyses.
 -- Sequence/tare is 1..N in original PDF order; all arithmetic stays NUMERIC.
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

COMMIT;
