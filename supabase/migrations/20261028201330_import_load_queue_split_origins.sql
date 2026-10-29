-- A trip may contain trailers harvested from distinct plots. Preserve the
-- original trip identity and create one idempotent candidate per origin only
-- when necessary; single-origin trip keys remain backwards compatible.
CREATE OR REPLACE FUNCTION billing_private.import_load_candidates(p_document public.billing_import_documents)
RETURNS TABLE(trip_key text,loaded_at date,volume numeric,harvest_method text,entry_count bigint,entry_number text,farm_code text,plot_code text,issue text)
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH entries AS (
  SELECT coalesce(nullif(e->>'groupKey',''),'entry:'||(e->>'id')) trip,
   (e->>'date')::date movement_date,e->'values' vals
  FROM jsonb_array_elements(billing_private.import_document_json(p_document)->'entries') e
 ), typed AS (
  SELECT *,coalesce(vals->>'COD_FAZENDA','') farm,coalesce(vals->>'COD_TALHAO','') plot,
   CASE WHEN (vals->>'PESOBRUTO')~'^[0-9]+([.][0-9]+)?$'
    AND (vals->>'TARA')~'^[0-9]+([.][0-9]+)?$'
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_document.profile_snapshot->'fields') f WHERE f->>'key'='PESOBRUTO' AND f->>'type'='decimal')
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_document.profile_snapshot->'fields') f WHERE f->>'key'='TARA' AND f->>'type'='decimal')
    THEN (vals->>'PESOBRUTO')::numeric-(vals->>'TARA')::numeric END net
  FROM entries
 ), trips AS (
  SELECT trip,count(DISTINCT jsonb_build_array(farm,plot)) origins,count(DISTINCT movement_date) dates
  FROM typed GROUP BY trip
 ), grouped AS (
  SELECT t.trip,t.farm,t.plot,min(t.movement_date) movement_date,sum(t.net) tons,count(*) n,
   min(t.vals->>'COD_ENTRADA') entry,min(t.vals->>'COD_TIPOCOLHEITA') method,
   count(*) FILTER(WHERE t.net IS NULL OR t.net<=0) missing,
   count(DISTINCT t.vals->>'COD_TIPOCOLHEITA') methods,
   count(*) FILTER(WHERE coalesce(t.vals->>'COD_TIPOCOLHEITA','') NOT IN ('1','2')) invalid_method
  FROM typed t GROUP BY t.trip,t.farm,t.plot
 )
 SELECT CASE WHEN t.origins>1 THEN g.trip||'|origin:'||jsonb_build_array(g.farm,g.plot)::text ELSE g.trip END,
  g.movement_date,g.tons,CASE WHEN g.methods=1 AND g.invalid_method=0 THEN g.method END,
  g.n,g.entry,g.farm,g.plot,
  CASE WHEN p_document.profile_snapshot->>'parser' NOT IN ('taquari-equipment-v1','pinheiro-usjp-v1') THEN 'Este modelo não possui unidade de peso em toneladas confirmada.'
   WHEN g.missing>0 THEN 'Confira os pesos bruto e tara de todas as linhas da origem.'
   WHEN t.dates<>1 THEN 'O conjunto possui datas divergentes. Reabra e confira o PDF.'
   WHEN g.methods<>1 OR g.invalid_method>0 THEN 'Confira a coluna K: 1 = manual; 2 = mecanizada.'
   WHEN g.tons<>round(g.tons,3) OR g.tons>=1000000000000 THEN 'O volume deve ter até três casas decimais e estar no limite do contrato.'
   ELSE '' END
 FROM grouped g JOIN trips t ON t.trip=g.trip
$$;
REVOKE ALL ON FUNCTION billing_private.import_load_candidates(public.billing_import_documents) FROM PUBLIC,anon,authenticated;
