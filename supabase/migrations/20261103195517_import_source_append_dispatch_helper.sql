BEGIN;

-- Keep legacy dispatcher depth unchanged, including recursive entry numbering.
-- Only the explicit page-completion action enters the larger append routine.
DO $source_append_helper$
DECLARE
 append_definition text:=pg_get_functiondef('billing_private.import_documents_dispatch(text,jsonb)'::regprocedure);
 original_definition text:=pg_get_functiondef('billing_private.import_documents_dispatch_before_source_append(text,jsonb)'::regprocedure);
 old_header text:='FUNCTION billing_private.import_documents_dispatch(p_action text, p_payload jsonb)';
 original_header text:='FUNCTION billing_private.import_documents_dispatch_before_source_append(p_action text, p_payload jsonb)';
 append_branch text:=$branch$ IF p_action IS DISTINCT FROM 'append-source-entries' THEN
  RETURN billing_private.import_documents_dispatch_before_source_append(p_action,p_payload);
 END IF;
$branch$;
 body_anchor text:=E'\nBEGIN\n';
BEGIN
 IF strpos(append_definition,old_header)=0 OR strpos(append_definition,append_branch)=0
  OR strpos(original_definition,original_header)=0 OR strpos(original_definition,body_anchor)=0 THEN
  RAISE EXCEPTION 'Unexpected import dispatcher; inspect before extracting page completion';
 END IF;
 append_definition=replace(append_definition,old_header,'FUNCTION billing_private.append_import_source_entries(p_payload jsonb)');
 append_definition=replace(append_definition,append_branch,'');
 IF strpos(append_definition,'p_action')>0 THEN RAISE EXCEPTION 'Append helper still references a dispatcher action'; END IF;
 EXECUTE append_definition;
 original_definition=replace(original_definition,original_header,old_header);
 original_definition=replace(original_definition,body_anchor,body_anchor||$route$ IF p_action='append-source-entries' THEN
  RETURN billing_private.append_import_source_entries(p_payload);
 END IF;
$route$);
 EXECUTE original_definition;
END $source_append_helper$;

REVOKE ALL ON FUNCTION billing_private.append_import_source_entries(jsonb),
 billing_private.import_documents_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;

COMMIT;
