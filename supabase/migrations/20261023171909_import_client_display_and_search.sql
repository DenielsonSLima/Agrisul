BEGIN;
DO $$
DECLARE definition text;
BEGIN
 definition=pg_get_functiondef('billing_private.import_document_json(public.billing_import_documents)'::regprocedure);
 IF strpos(definition,$before$(SELECT c.legal_name FROM public.billing_clients c$before$)=0 THEN
  RAISE EXCEPTION 'Expected import client display projection was not found.';
 END IF;
 EXECUTE replace(definition,
  $before$(SELECT c.legal_name FROM public.billing_clients c$before$,
  $after$(SELECT coalesce(nullif(c.trade_name,''),c.legal_name) FROM public.billing_clients c$after$);

 definition=pg_get_functiondef('billing_private.import_documents_dispatch(text,jsonb)'::regprocedure);
 IF strpos(definition,$before$c.legal_name||' '||d.source_name$before$)=0
  OR strpos(definition,$before$days AS(SELECT d.client_id,c.legal_name,e.entry_date$before$)=0
  OR strpos(definition,$before$GROUP BY d.client_id,c.legal_name,e.entry_date$before$)=0 THEN
  RAISE EXCEPTION 'Expected import client list projection was not found.';
 END IF;
 definition=replace(definition,$before$c.legal_name||' '||d.source_name$before$,$after$c.legal_name||' '||c.trade_name||' '||d.source_name$after$);
 definition=replace(definition,$before$days AS(SELECT d.client_id,c.legal_name,e.entry_date$before$,$after$days AS(SELECT d.client_id,coalesce(nullif(c.trade_name,''),c.legal_name) AS legal_name,e.entry_date$after$);
 definition=replace(definition,$before$GROUP BY d.client_id,c.legal_name,e.entry_date$before$,$after$GROUP BY d.client_id,c.legal_name,c.trade_name,e.entry_date$after$);
 EXECUTE definition;
END $$;
REVOKE ALL ON FUNCTION billing_private.import_document_json(public.billing_import_documents),billing_private.import_documents_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
COMMIT;
