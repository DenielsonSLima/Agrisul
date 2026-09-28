-- Contract removal is intentionally exposed only through the authenticated RPC.
-- The foreign keys on loads, payments/refunds and discounts cascade from the
-- contract, so one locked, owner-scoped delete removes the full aggregate.

ALTER FUNCTION billing_private.contracts_company_dispatch(text,jsonb)
 RENAME TO contracts_before_contract_deletion_dispatch;
REVOKE ALL ON FUNCTION billing_private.contracts_before_contract_deletion_dispatch(text,jsonb)
 FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.contracts_company_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_contract public.billing_contracts%ROWTYPE;
 v_company uuid;
 v_contract_id uuid;
BEGIN
 IF p_action<>'delete' THEN
  RETURN billing_private.contracts_before_contract_deletion_dispatch(p_action,p_payload);
 END IF;

 IF auth.uid() IS NULL OR v_owner IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 PERFORM billing_private.authorize_resource('contracts',p_action);
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
    OR NOT p_payload ?& ARRAY['companyId','contractId']
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) key WHERE key<>ALL(ARRAY['companyId','contractId']))
    OR EXISTS(SELECT 1 FROM jsonb_each(p_payload) entry WHERE jsonb_typeof(entry.value)<>'string') THEN
  RAISE EXCEPTION 'A exclusão do contrato contém campos inválidos.' USING ERRCODE='22023';
 END IF;

 v_company=nullif(p_payload->>'companyId','')::uuid;
 v_contract_id=nullif(p_payload->>'contractId','')::uuid;
 IF v_company IS NULL OR v_contract_id IS NULL THEN
  RAISE EXCEPTION 'Informe o contrato e a empresa ativa.' USING ERRCODE='22023';
 END IF;

 SELECT * INTO v_contract
 FROM public.billing_contracts
 WHERE owner_id=v_owner AND company_id=v_company AND id=v_contract_id
 FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Contrato não encontrado para a empresa ativa.' USING ERRCODE='P0002';
 END IF;

 DELETE FROM public.billing_contracts
 WHERE owner_id=v_owner AND company_id=v_company AND id=v_contract_id;
 RETURN jsonb_build_object('id',v_contract_id,'deleted',true);
EXCEPTION
 WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Confira os identificadores informados.' USING ERRCODE='22023';
END $$;

REVOKE ALL ON FUNCTION billing_private.contracts_company_dispatch(text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.contracts_company_dispatch(text,jsonb) TO authenticated;
