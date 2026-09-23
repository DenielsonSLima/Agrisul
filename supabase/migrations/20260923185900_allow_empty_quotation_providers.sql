-- A quotation can be opened with its material scope first. Suppliers are an
-- incremental part of the aggregate and can already be attached later through
-- quotations/add-providers.
DO $$
DECLARE
 v_target regprocedure:='billing_private.quotations_dispatch_before_requester_signature(text,text,jsonb)'::regprocedure;
 v_definition text;
 v_provider_requirement text:=E'\n  OR jsonb_array_length(p_payload->''providers'')=0';
BEGIN
 SELECT pg_get_functiondef(v_target) INTO v_definition;
 IF strpos(v_definition,v_provider_requirement)=0 THEN
  RAISE EXCEPTION 'Unexpected quotation save provider validation';
 END IF;
 v_definition=replace(v_definition,v_provider_requirement,'');
 v_definition=replace(
  v_definition,
  'Informe data, solicitante, materiais e prestadores da cotação.',
  'Informe data, solicitante e materiais da cotação.'
 );
 EXECUTE v_definition;
END $$;

COMMENT ON FUNCTION billing_private.quotations_dispatch_before_requester_signature(text,text,jsonb) IS
 'Owner-scoped quotation persistence. New quotations require materials and an active requester; providers are optional and can be added incrementally.';
