-- Optional owner-provided contract identifier, persisted and presented by the
-- contracts RPC. Existing contracts remain valid with an empty identifier.
ALTER TABLE public.billing_contracts
 ADD COLUMN contract_number text NOT NULL DEFAULT ''
 CHECK(length(contract_number)<=100 AND contract_number=btrim(contract_number) AND contract_number!~'[[:cntrl:]]');

COMMENT ON COLUMN public.billing_contracts.contract_number IS 'Optional external or internal contract identifier supplied by the owner.';

CREATE OR REPLACE FUNCTION billing_private.present_contract(p_contract public.billing_contracts) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (billing_private.present(to_jsonb(p_contract))-'contract_number') || jsonb_build_object(
  'contractNumber',p_contract.contract_number,
  'companyName',coalesce(company.name,''),
  'companyCnpj',coalesce(company.cnpj,''),
  'clientName',client.legal_name,
  'clientCnpj',client.cnpj,
  'startDate',coalesce(p_contract.start_date::text,''),
  'endDate',coalesce(p_contract.end_date::text,''),
  'contractedVolume',billing_private.decimal_text(p_contract.contracted_volume),
  'atrPriceType',p_contract.atr_price_type,
  'atrPeriodType',p_contract.atr_period_type,
  'value',coalesce(billing_private.decimal_text(p_contract.value),''),
  'loadedVolume',billing_private.decimal_text(totals.loaded_volume),
  'remainingVolume',billing_private.decimal_text(greatest(p_contract.contracted_volume-totals.loaded_volume,0)),
  'averageAtr',coalesce(billing_private.decimal_text(totals.average_atr),''),
  'billingAmount',CASE WHEN totals.missing_quotes>0 THEN '' ELSE billing_private.decimal_text(totals.billing_amount) END,
  'billingPending',totals.missing_quotes>0
 )
 FROM public.billing_clients client
 LEFT JOIN public.billing_companies company ON company.owner_id=p_contract.owner_id AND company.id=p_contract.company_id
 CROSS JOIN LATERAL (
  SELECT coalesce(sum(priced.volume),0) loaded_volume,
   sum(priced.volume*priced.atr)/nullif(sum(priced.volume),0) average_atr,
   coalesce(sum(priced.volume*priced.atr*priced.quote),0) billing_amount,
   count(*) FILTER(WHERE priced.quote IS NULL) missing_quotes
  FROM (
   SELECT load.volume,load.atr,
    CASE p_contract.atr_period_type
     WHEN 'monthly' THEN CASE p_contract.atr_price_type WHEN 'gross' THEN quote.monthly_gross_value ELSE quote.monthly_net_value END
     ELSE CASE p_contract.atr_price_type WHEN 'gross' THEN quote.accumulated_gross_value ELSE quote.accumulated_net_value END
    END quote
   FROM public.billing_contract_loads load
   LEFT JOIN public.billing_atr_records quote ON quote.owner_id=load.owner_id
    AND quote.year=extract(year FROM load.loaded_at)::integer
    AND quote.month=extract(month FROM load.loaded_at)::integer
   WHERE load.owner_id=p_contract.owner_id AND load.contract_id=p_contract.id
  ) priced
 ) totals
 WHERE client.owner_id=p_contract.owner_id AND client.id=p_contract.client_id
$$;
REVOKE ALL ON FUNCTION billing_private.present_contract(public.billing_contracts) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.contracts_active_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_payload jsonb:=p_payload;
 v_owner uuid:=billing_private.current_owner_id();
 v_result jsonb;
 v_id uuid;
 v_contract public.billing_contracts%ROWTYPE;
BEGIN
 IF p_action='save' AND jsonb_typeof(v_payload)='object' THEN
  IF v_payload ? 'contractNumber' AND jsonb_typeof(v_payload->'contractNumber') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Confira o número do contrato.' USING ERRCODE='22023';
  END IF;
  IF length(btrim(coalesce(v_payload->>'contractNumber','')))>100 OR btrim(coalesce(v_payload->>'contractNumber',''))~'[[:cntrl:]]' THEN
   RAISE EXCEPTION 'O número do contrato deve ter até 100 caracteres e não pode conter quebras de linha.' USING ERRCODE='22023';
  END IF;
  IF v_payload ? 'atrPriceType' AND jsonb_typeof(v_payload->'atrPriceType') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Selecione se a cotação do ATR será bruta ou líquida.' USING ERRCODE='22023';
  END IF;
  IF v_payload ? 'atrPeriodType' AND jsonb_typeof(v_payload->'atrPeriodType') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Selecione se a cotação do ATR será mensal ou acumulada.' USING ERRCODE='22023';
  END IF;
  IF v_payload ? 'atrPriceType' AND coalesce(v_payload->>'atrPriceType','') NOT IN ('gross','net') THEN
   RAISE EXCEPTION 'Selecione se a cotação do ATR será bruta ou líquida.' USING ERRCODE='22023';
  END IF;
  IF v_payload ? 'atrPeriodType' AND coalesce(v_payload->>'atrPeriodType','') NOT IN ('monthly','accumulated') THEN
   RAISE EXCEPTION 'Selecione se a cotação do ATR será mensal ou acumulada.' USING ERRCODE='22023';
  END IF;
  IF nullif(v_payload->>'id','') IS NULL THEN
   v_payload=jsonb_set(v_payload,'{status}',to_jsonb('Ativo'::text),true);
  ELSIF coalesce(v_payload->>'status','') NOT IN ('Ativo','Concluído','Cancelado') THEN
   RAISE EXCEPTION 'Confira a situação do contrato.' USING ERRCODE='22023';
  END IF;
 END IF;

 v_result=billing_private.contracts_dispatch(p_action,v_payload);
 IF p_action<>'save' THEN RETURN v_result; END IF;

 v_id=(v_result->'contract'->>'id')::uuid;
 SELECT * INTO v_contract FROM public.billing_contracts WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado.' USING ERRCODE='P0002'; END IF;
 UPDATE public.billing_contracts SET
  atr_price_type=coalesce(nullif(v_payload->>'atrPriceType',''),v_contract.atr_price_type),
  atr_period_type=coalesce(nullif(v_payload->>'atrPeriodType',''),v_contract.atr_period_type),
  contract_number=CASE WHEN v_payload ? 'contractNumber' THEN btrim(v_payload->>'contractNumber') ELSE v_contract.contract_number END
 WHERE owner_id=v_owner AND id=v_id
 RETURNING * INTO v_contract;
 RETURN jsonb_build_object('contract',billing_private.present_contract(v_contract));
END $$;
REVOKE ALL ON FUNCTION billing_private.contracts_active_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.contracts_active_dispatch(text,jsonb) TO authenticated;

COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS 'Authenticated workspace RPC. Contract lifecycle, optional contract number, volume capacity, ATR criterion and load-based billing are enforced and calculated in Postgres.';
