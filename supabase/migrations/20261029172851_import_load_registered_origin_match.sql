BEGIN;

-- Numeric external codes ignore leading zeroes (PDF 3 = registered plot 03).
-- Other identifiers retain their literal spelling; no names or fuzzy matches.
CREATE FUNCTION billing_private.import_origin_code_key(p_code text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN btrim(coalesce(p_code,''))='' THEN NULL
  WHEN btrim(p_code) ~ '^[0-9]+$' THEN coalesce(nullif(ltrim(btrim(p_code),'0'),''),'0')
  ELSE btrim(p_code) END
$$;
REVOKE ALL ON FUNCTION billing_private.import_origin_code_key(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.import_load_origin_match(p_owner uuid,p_farm_code text,p_plot_code text)
RETURNS TABLE(matched_farm_id uuid,matched_plot_id uuid,farm_match_status text,plot_match_status text)
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH codes AS (
  SELECT billing_private.import_origin_code_key(p_farm_code) farm_code,
   billing_private.import_origin_code_key(p_plot_code) plot_code
 ), farms AS (
  SELECT count(*) n,CASE WHEN count(*)=1 THEN (array_agg(f.id))[1] END farm_id
  FROM public.billing_farms f CROSS JOIN codes c
  WHERE f.owner_id=p_owner AND c.farm_code IS NOT NULL
   AND billing_private.import_origin_code_key(f.code)=c.farm_code
 ), plots AS (
  SELECT count(*) n,CASE WHEN count(*)=1 THEN (array_agg(p.id))[1] END plot_id
  FROM public.billing_farm_plots p CROSS JOIN codes c CROSS JOIN farms f
  WHERE p.owner_id=p_owner AND p.farm_id=f.farm_id AND c.plot_code IS NOT NULL
   AND billing_private.import_origin_code_key(p.name)=c.plot_code
 )
 SELECT f.farm_id,p.plot_id,
  CASE WHEN c.farm_code IS NULL THEN 'missing-code' WHEN f.n=0 THEN 'not-found'
   WHEN f.n>1 THEN 'ambiguous' ELSE 'matched' END,
  CASE WHEN c.plot_code IS NULL THEN 'missing-code' WHEN f.farm_id IS NULL THEN 'unresolved-farm'
   WHEN p.n=0 THEN 'not-found' WHEN p.n>1 THEN 'ambiguous' ELSE 'matched' END
 FROM codes c CROSS JOIN farms f CROSS JOIN plots p
$$;
REVOKE ALL ON FUNCTION billing_private.import_load_origin_match(uuid,text,text) FROM PUBLIC,anon,authenticated;

-- Only the authorized queue dispatcher supplies the current owner. Suggestions
-- do not change link-load validation or prevent a deliberate manual selection.
DO $$
DECLARE definition text:=pg_get_functiondef('billing_private.import_documents_dispatch(text,jsonb)'::regprocedure);
 fields_anchor text:=$anchor$'farmCode',trip.farm_code,'plotCode',trip.plot_code,'issue',trip.issue$anchor$;
 join_anchor text:=$anchor$CROSS JOIN LATERAL billing_private.import_load_candidates(doc) trip$anchor$;
BEGIN
 IF strpos(definition,fields_anchor)=0 OR strpos(definition,join_anchor)=0 OR strpos(definition,'''matchedFarmId''')>0 THEN
  RAISE EXCEPTION 'Unexpected import load queue; inspect before adding registered origin suggestions.';
 END IF;
 definition=replace(definition,fields_anchor,fields_anchor||$new$,
   'matchedFarmId',origin_match.matched_farm_id,'matchedPlotId',origin_match.matched_plot_id,
   'farmMatchStatus',origin_match.farm_match_status,'plotMatchStatus',origin_match.plot_match_status$new$);
 definition=replace(definition,join_anchor,join_anchor||$new$
  CROSS JOIN LATERAL billing_private.import_load_origin_match(v_owner,trip.farm_code,trip.plot_code) origin_match$new$);
 EXECUTE definition;
END $$;

COMMIT;
