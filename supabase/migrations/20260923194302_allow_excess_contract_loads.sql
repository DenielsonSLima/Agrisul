-- Delivered volume may legitimately exceed the commercial quantity when the
-- mill accepts an extra truck. Keep the agreed volume unchanged, but include
-- every accepted load in operational and financial totals.
DO $$
DECLARE
 v_target regprocedure:='billing_private.contracts_dispatch(text,jsonb)'::regprocedure;
 v_definition text;
 v_contract_edit_guard text:='IF v_volume_text::numeric<v_loaded THEN RAISE EXCEPTION ''O volume contratado não pode ficar abaixo do volume já carregado.'' USING ERRCODE=''23514''; END IF;';
 v_load_capacity_guard text:='IF v_loaded-v_existing_volume+v_volume_text::numeric>v_contract.contracted_volume THEN RAISE EXCEPTION ''O carregamento ultrapassa o saldo de volume do contrato.'' USING ERRCODE=''23514''; END IF;';
BEGIN
 SELECT pg_get_functiondef(v_target) INTO v_definition;
 IF strpos(v_definition,v_contract_edit_guard)=0
  OR strpos(v_definition,v_load_capacity_guard)=0 THEN
  RAISE EXCEPTION 'Unexpected contract volume guards';
 END IF;
 v_definition=replace(v_definition,v_contract_edit_guard,'');
 v_definition=replace(v_definition,v_load_capacity_guard,'');
 EXECUTE v_definition;
END $$;

COMMENT ON FUNCTION billing_private.contracts_dispatch(text,jsonb) IS
 'Owner-scoped contract persistence. Contracted volume remains the commercial reference; excess loads are accepted and every load is included in server financial calculations.';

COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS
 'Authenticated workspace RPC. Contract loads may exceed the agreed volume with a client warning; every accepted tonne remains included in server-calculated billing.';
