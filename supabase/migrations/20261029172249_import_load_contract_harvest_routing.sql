BEGIN;

-- The contract keeps a snapshot of its type name. Route known harvest types
-- using that snapshot; other contract types retain their existing queue.
CREATE FUNCTION billing_private.contract_import_harvest_method(p_type_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 WITH flags AS (
  SELECT lower(coalesce(p_type_name,'')) ~ '(^|[^[:alpha:]])manual([^[:alpha:]]|$)' manual,
   lower(coalesce(p_type_name,'')) ~ '(^|[^[:alpha:]])m[ae]canizad[oa]([^[:alpha:]]|$)' mechanized
 )
 SELECT CASE WHEN manual AND NOT mechanized THEN '1' WHEN mechanized AND NOT manual THEN '2' END FROM flags
$$;
REVOKE ALL ON FUNCTION billing_private.contract_import_harvest_method(text) FROM PUBLIC,anon,authenticated;

DO $$
DECLARE definition text:=pg_get_functiondef('billing_private.import_documents_dispatch(text,jsonb)'::regprocedure);
 queue_anchor text:=$anchor$WHERE doc.owner_id=v_owner AND doc.client_id=c.client_id AND doc.status='finished'$anchor$;
 link_anchor text:=$anchor$IF candidate.issue<>'' THEN RAISE EXCEPTION '%',candidate.issue USING ERRCODE='23514'; END IF;$anchor$;
BEGIN
 IF strpos(definition,queue_anchor)=0 OR strpos(definition,link_anchor)=0 THEN
  RAISE EXCEPTION 'Unexpected import load queue dispatcher';
 END IF;
 definition=replace(definition,queue_anchor,queue_anchor||$new$
   AND (billing_private.contract_import_harvest_method(c.type_name) IS NULL
    OR trip.harvest_method IS NULL
    OR trip.harvest_method=billing_private.contract_import_harvest_method(c.type_name))$new$);
 definition=replace(definition,link_anchor,link_anchor||$new$
 IF billing_private.contract_import_harvest_method(c.type_name) IS NOT NULL
  AND candidate.harvest_method IS DISTINCT FROM billing_private.contract_import_harvest_method(c.type_name) THEN
  RAISE EXCEPTION 'A coluna K indica outra colheita: 1 = manual; 2 = mecanizada. Selecione o contrato correspondente.' USING ERRCODE='23514';
 END IF;$new$);
 EXECUTE definition;
END $$;

COMMIT;
