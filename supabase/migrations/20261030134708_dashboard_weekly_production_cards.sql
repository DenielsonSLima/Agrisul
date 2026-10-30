BEGIN;

DO $migration$
DECLARE
 definition text:=pg_get_functiondef('billing_private.summary_weekly(jsonb)'::regprocedure);
 load_anchor text:='SELECT l.id,l.loaded_at,l.volume,l.atr,finance.gross_amount,finance.net_amount';
 row_anchor text:='), rows AS MATERIALIZED (';
 days_anchor text:='''days'',(SELECT jsonb_agg(value||jsonb_build_object(''date'',from_date::text) ORDER BY from_date) FROM rows WHERE kind=''day''),';
BEGIN
 IF strpos(definition,load_anchor)=0 OR strpos(definition,row_anchor)=0 OR strpos(definition,days_anchor)=0
  OR strpos(definition,'contractMethods')>0 THEN
  RAISE EXCEPTION 'Unexpected weekly projection before production cards';
 END IF;
 definition=replace(definition,load_anchor,load_anchor||','||E'\n   coalesce(billing_private.contract_import_harvest_method(s.type_name),''unknown'') contract_method');
 definition=replace(definition,row_anchor,$methods$), method_statistics AS (
  SELECT method.code,method.label,method.ordinal,count(l.id)::integer load_count,
   coalesce(sum(l.volume),0) loaded_volume,
   CASE WHEN count(l.id)=0 OR count(l.id) FILTER(WHERE l.atr IS NULL)>0 THEN NULL
    ELSE round(sum(l.volume*l.atr)/nullif(sum(l.volume),0),6) END average_atr
  FROM (VALUES('1','Manual',1),('2','Mecanizada',2),('unknown','Não classificado',3)) method(code,label,ordinal)
  LEFT JOIN financial_loads l ON l.contract_method=method.code AND l.loaded_at BETWEEN v_from AND v_to
  GROUP BY method.code,method.label,method.ordinal
 ), rows AS MATERIALIZED ($methods$);
 definition=replace(definition,days_anchor,$json$'days',coalesce((SELECT jsonb_agg(value||jsonb_build_object('date',from_date::text) ORDER BY from_date)
   FROM rows WHERE kind='day' AND load_count>0 AND loaded_volume>0),'[]'::jsonb),
  'contractMethods',(SELECT jsonb_agg(jsonb_build_object('code',code,'label',label,'loadCount',load_count,
   'loadedVolume',billing_private.decimal_text(loaded_volume),
   'averageAtr',coalesce(billing_private.decimal_text(average_atr),'')) ORDER BY ordinal) FROM method_statistics),$json$);
 EXECUTE definition;
END $migration$;

COMMENT ON FUNCTION billing_private.summary_weekly(jsonb) IS
 'Rolling seven calendar days with only productive dates plotted. Owner-isolated NUMERIC totals and volume-weighted ATR by saved contract modality, including unclassified contracts. Full-contract financial valuation precedes date/origin slicing; preceding seven-day comparison keeps identical selections.';

COMMIT;
