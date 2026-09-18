-- Contract closure is an explicit operation. Excess advances are returned as
-- auditable negative advance entries, so every existing cash projection keeps
-- using the net cash amount while contract detail exposes the gross advance
-- and refund separately.
ALTER TABLE public.billing_contract_payments
 DROP CONSTRAINT billing_contract_payments_amount_check,
 ADD CONSTRAINT billing_contract_payments_amount_check
  CHECK(amount<>0 AND abs(amount)<1000000000000000);

CREATE FUNCTION billing_private.finance_metrics(
 p_volume numeric,p_atr numeric,p_gross numeric,p_discount numeric,
 p_advance numeric,p_receipt numeric,p_refund numeric
)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
  'loadedVolume',billing_private.decimal_text(p_volume),
  'averageAtr',coalesce(billing_private.decimal_text(p_atr),''),
  'grossAmount',coalesce(billing_private.decimal_text(p_gross),''),
  'billingPending',p_gross IS NULL,
  'discountAmount',billing_private.decimal_text(p_discount),
  'netAmount',coalesce(billing_private.decimal_text(p_gross-p_discount),''),
  'advanceAmount',billing_private.decimal_text(p_advance),
  'receiptAmount',billing_private.decimal_text(p_receipt),
  'refundedAmount',billing_private.decimal_text(p_refund),
  'receivedAmount',billing_private.decimal_text(p_advance+p_receipt-p_refund),
  'pendingAmount',CASE WHEN p_gross IS NULL THEN '' ELSE billing_private.decimal_text(greatest(p_gross-p_discount-p_advance-p_receipt+p_refund,0)) END,
  'creditAmount',CASE WHEN p_gross IS NULL THEN '' ELSE billing_private.decimal_text(greatest(p_advance+p_receipt-p_refund-(p_gross-p_discount),0)) END,
  'refundableAmount',CASE WHEN p_gross IS NULL THEN '' ELSE billing_private.decimal_text(greatest(least(
   p_advance-p_refund,
   p_advance+p_receipt-p_refund-(p_gross-p_discount)
  ),0)) END
 )
$$;
REVOKE ALL ON FUNCTION billing_private.finance_metrics(numeric,numeric,numeric,numeric,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.finance_metrics(p_volume numeric,p_atr numeric,p_gross numeric,p_discount numeric,p_advance numeric,p_receipt numeric)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT billing_private.finance_metrics(p_volume,p_atr,p_gross,p_discount,p_advance,p_receipt,0)
$$;
REVOKE ALL ON FUNCTION billing_private.finance_metrics(numeric,numeric,numeric,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION billing_private.contract_financial_summary(p_contract public.billing_contracts)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH production AS (
  SELECT billing_private.contract_monthly_summary(p_contract) data
 ), loads AS (
  SELECT (item->>'month')||'-01' month_key,item
  FROM production,jsonb_array_elements(data->'months') item
 ), discount_months AS (
  SELECT d.id,m.month_start,coalesce(sum(l.volume),0) volume,
   round(coalesce(sum(l.volume),0)*d.rate_per_ton,2) amount
  FROM public.billing_contract_discounts d
  CROSS JOIN LATERAL unnest(d.months) m(month_start)
  LEFT JOIN public.billing_contract_loads l ON l.owner_id=d.owner_id AND l.contract_id=d.contract_id
   AND l.loaded_at>=m.month_start AND l.loaded_at<m.month_start+interval '1 month'
  WHERE d.owner_id=p_contract.owner_id AND d.contract_id=p_contract.id
  GROUP BY d.id,m.month_start
 ), payments AS (
  SELECT * FROM public.billing_contract_payments WHERE owner_id=p_contract.owner_id AND contract_id=p_contract.id
 ), calendar AS (
  SELECT month_key::date month_start FROM loads
  UNION SELECT reference_month FROM payments
  UNION SELECT month_start FROM discount_months
  UNION SELECT date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo')::date
 ), monthly AS (
  SELECT calendar.month_start,
   coalesce((loads.item->>'loadedVolume')::numeric,0) volume,
   nullif(loads.item->>'averageLoadAtr','')::numeric atr,
   CASE WHEN (loads.item->>'billingPending')::boolean THEN NULL ELSE coalesce((loads.item->>'billingAmount')::numeric,0) END gross,
   coalesce((SELECT sum(amount) FROM discount_months d WHERE d.month_start=calendar.month_start),0) discount,
   coalesce((SELECT sum(amount) FROM payments p WHERE p.reference_month=calendar.month_start AND p.kind='advance' AND p.amount>0),0) advance,
   coalesce((SELECT sum(amount) FROM payments p WHERE p.reference_month=calendar.month_start AND p.kind='receipt'),0) receipt,
   coalesce((SELECT sum(-amount) FROM payments p WHERE p.reference_month=calendar.month_start AND p.kind='advance' AND p.amount<0),0) refund
  FROM calendar LEFT JOIN loads ON loads.month_key=calendar.month_start::text
 )
 SELECT jsonb_build_object(
  'months',(SELECT jsonb_agg(jsonb_build_object('month',to_char(month_start,'YYYY-MM'))||billing_private.finance_metrics(volume,atr,gross,discount,advance,receipt,refund) ORDER BY month_start) FROM monthly),
  'totals',(SELECT billing_private.finance_metrics(sum(volume),
    (SELECT nullif(data->'totals'->>'averageLoadAtr','')::numeric FROM production),
    CASE WHEN count(*) FILTER(WHERE gross IS NULL)>0 THEN NULL ELSE sum(gross) END,
    sum(discount),sum(advance),sum(receipt),sum(refund)) FROM monthly),
  'emptyMonth',billing_private.finance_metrics(0,NULL,0,0,0,0,0),
  'payments',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',id,'requestId',request_id,'kind',kind,'receivedAt',received_at::text,'referenceMonth',to_char(reference_month,'YYYY-MM'),
   'amount',billing_private.decimal_text(amount),'document',document,'notes',notes,'revision',revision
  ) ORDER BY received_at DESC,created_at DESC,id) FROM payments WHERE amount>0),'[]'::jsonb),
  'refunds',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',id,'requestId',request_id,'refundedAt',received_at::text,'referenceMonth',to_char(reference_month,'YYYY-MM'),
   'amount',billing_private.decimal_text(-amount),'document',document,'notes',notes,'revision',revision
  ) ORDER BY received_at DESC,created_at DESC,id) FROM payments WHERE kind='advance' AND amount<0),'[]'::jsonb),
  'discounts',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',d.id,'requestId',d.request_id,'title',d.title,'ratePerTon',billing_private.decimal_text(d.rate_per_ton),
   'months',(SELECT jsonb_agg(to_char(m,'YYYY-MM') ORDER BY m) FROM unnest(d.months) m),
   'notes',d.notes,'revision',d.revision,
   'loadedVolume',(SELECT billing_private.decimal_text(sum(volume)) FROM discount_months WHERE id=d.id),
   'amount',(SELECT billing_private.decimal_text(sum(amount)) FROM discount_months WHERE id=d.id),
   'monthlyBreakdown',(SELECT jsonb_agg(jsonb_build_object(
    'month',to_char(month_start,'YYYY-MM'),
    'loadedVolume',billing_private.decimal_text(volume),
    'amount',billing_private.decimal_text(amount)
   ) ORDER BY month_start) FROM discount_months WHERE id=d.id)
  ) ORDER BY d.created_at DESC,d.id) FROM public.billing_contract_discounts d WHERE d.owner_id=p_contract.owner_id AND d.contract_id=p_contract.id),'[]'::jsonb)
 )
$$;
REVOKE ALL ON FUNCTION billing_private.contract_financial_summary(public.billing_contracts) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.assert_contract_refunds_valid(p_contract public.billing_contracts)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_totals jsonb:=billing_private.contract_financial_summary(p_contract)->'totals';
 v_refunded numeric:=coalesce((v_totals->>'refundedAmount')::numeric,0);
 v_advance numeric:=coalesce((v_totals->>'advanceAmount')::numeric,0);
 v_receipt numeric:=coalesce((v_totals->>'receiptAmount')::numeric,0);
 v_net numeric:=nullif(v_totals->>'netAmount','')::numeric;
BEGIN
 IF v_refunded=0 THEN RETURN; END IF;
 IF (v_totals->>'billingPending')::boolean OR v_net IS NULL THEN
  RAISE EXCEPTION 'Regularize o ATR e as cotações antes de manter um estorno neste contrato.' USING ERRCODE='22023';
 END IF;
 IF v_refunded>v_advance OR v_refunded>greatest(v_advance+v_receipt-v_net,0) THEN
  RAISE EXCEPTION 'O estorno excede o saldo de adiantamento disponível. Atualize a tela e confira os lançamentos.' USING ERRCODE='22023';
 END IF;
END $$;
REVOKE ALL ON FUNCTION billing_private.assert_contract_refunds_valid(public.billing_contracts) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION billing_private.contracts_company_dispatch(text,jsonb) RENAME TO contracts_before_closure_refunds_dispatch;
REVOKE ALL ON FUNCTION billing_private.contracts_before_closure_refunds_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.contracts_company_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_contract public.billing_contracts%ROWTYPE;
 v_entry public.billing_contract_payments%ROWTYPE;
 v_result jsonb;v_totals jsonb;
 v_company uuid;v_contract_id uuid;v_id uuid;v_request uuid;
 v_date date;v_month date;v_amount numeric;v_available numeric;
 v_notes text;v_document text;v_revision integer;v_edit boolean;
 v_refunded numeric;v_refundable numeric;
 v_allowed text[];
BEGIN
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize_resource('contracts',p_action);
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Confira os dados do contrato.' USING ERRCODE='22023'; END IF;

 IF p_action IN ('close','save-refund','delete-refund') THEN
  v_allowed=CASE p_action
   WHEN 'close' THEN ARRAY['companyId','contractId']
   WHEN 'delete-refund' THEN ARRAY['companyId','contractId','id','expectedRevision']
   ELSE ARRAY['companyId','contractId','id','expectedRevision','requestId','refundedAt','referenceMonth','amount','document','notes'] END;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) key WHERE NOT key=ANY(v_allowed)) OR
     EXISTS(SELECT 1 FROM jsonb_each(p_payload) e WHERE e.key<>'expectedRevision' AND jsonb_typeof(e.value)<>'string') THEN
   RAISE EXCEPTION 'O lançamento contém campos não permitidos.' USING ERRCODE='22023';
  END IF;
  v_company=nullif(p_payload->>'companyId','')::uuid;
  v_contract_id=nullif(p_payload->>'contractId','')::uuid;
  SELECT * INTO v_contract FROM public.billing_contracts
   WHERE owner_id=v_owner AND id=v_contract_id AND company_id=v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado para a empresa ativa.' USING ERRCODE='P0002'; END IF;

  IF p_action='close' THEN
   IF v_contract.status='Concluído' THEN
    RETURN billing_private.contracts_before_closure_refunds_dispatch('get',jsonb_build_object('id',v_contract.id,'companyId',v_contract.company_id));
   END IF;
   IF v_contract.status<>'Ativo' THEN RAISE EXCEPTION 'Somente um contrato ativo pode ser encerrado.' USING ERRCODE='22023'; END IF;
   v_totals=billing_private.contract_financial_summary(v_contract)->'totals';
   IF (v_totals->>'billingPending')::boolean THEN
    RAISE EXCEPTION 'Regularize o ATR e as cotações pendentes antes de encerrar o contrato.' USING ERRCODE='22023';
   END IF;
   UPDATE public.billing_contracts SET status='Concluído' WHERE owner_id=v_owner AND id=v_contract.id RETURNING * INTO v_contract;
   RETURN billing_private.contracts_before_closure_refunds_dispatch('get',jsonb_build_object('id',v_contract.id,'companyId',v_contract.company_id));
  END IF;

  IF v_contract.status<>'Concluído' THEN RAISE EXCEPTION 'Encerre o contrato antes de registrar um estorno.' USING ERRCODE='22023'; END IF;
  v_id=nullif(p_payload->>'id','')::uuid;v_edit=v_id IS NOT NULL;
  v_revision=(p_payload->>'expectedRevision')::integer;
  IF p_action='delete-refund' THEN
   SELECT * INTO v_entry FROM public.billing_contract_payments
    WHERE owner_id=v_owner AND contract_id=v_contract_id AND id=v_id AND kind='advance' AND amount<0;
   IF NOT FOUND THEN RAISE EXCEPTION 'Estorno não encontrado.' USING ERRCODE='P0002'; END IF;
   IF v_revision IS DISTINCT FROM v_entry.revision THEN RAISE EXCEPTION 'O estorno foi alterado. Atualize a tela antes de excluir.' USING ERRCODE='40001'; END IF;
   DELETE FROM public.billing_contract_payments WHERE owner_id=v_owner AND contract_id=v_contract_id AND id=v_id;
   RETURN jsonb_build_object('id',v_id,'deleted',true);
  END IF;

  v_request=nullif(p_payload->>'requestId','')::uuid;
  IF v_request IS NULL THEN RAISE EXCEPTION 'Identificador do estorno ausente. Reabra o formulário.' USING ERRCODE='22023'; END IF;
  v_notes=btrim(coalesce(p_payload->>'notes',''));v_document=btrim(coalesce(p_payload->>'document',''));
  IF length(v_notes)>1000 OR length(v_document)>100 THEN RAISE EXCEPTION 'Confira o documento e as observações do estorno.' USING ERRCODE='22023'; END IF;
  IF coalesce(p_payload->>'refundedAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR coalesce(p_payload->>'referenceMonth','')!~'^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
   RAISE EXCEPTION 'Informe a data do estorno e o mês de referência.' USING ERRCODE='22023';
  END IF;
  v_date=(p_payload->>'refundedAt')::date;v_month=((p_payload->>'referenceMonth')||'-01')::date;
  IF coalesce(replace(btrim(p_payload->>'amount'),',','.'),'')!~'^[0-9]{1,15}([.][0-9]{1,2})?$' THEN
   RAISE EXCEPTION 'Informe um valor de estorno positivo com até duas casas decimais.' USING ERRCODE='22023';
  END IF;
  v_amount=replace(btrim(p_payload->>'amount'),',','.')::numeric;
  IF v_amount<=0 OR v_amount>=1000000000000000 OR v_amount<>round(v_amount,2) THEN
   RAISE EXCEPTION 'Informe um valor de estorno positivo com até duas casas decimais.' USING ERRCODE='22023';
  END IF;
  IF v_edit THEN
   SELECT * INTO v_entry FROM public.billing_contract_payments
    WHERE owner_id=v_owner AND contract_id=v_contract_id AND id=v_id AND kind='advance' AND amount<0;
   IF NOT FOUND THEN RAISE EXCEPTION 'Estorno não encontrado.' USING ERRCODE='P0002'; END IF;
   IF v_revision IS DISTINCT FROM v_entry.revision THEN RAISE EXCEPTION 'O estorno foi alterado. Atualize a tela antes de salvar.' USING ERRCODE='40001'; END IF;
   IF v_request<>v_entry.request_id THEN RAISE EXCEPTION 'A identificação do estorno não pode ser alterada.' USING ERRCODE='22023'; END IF;
  ELSE
   SELECT * INTO v_entry FROM public.billing_contract_payments
    WHERE owner_id=v_owner AND contract_id=v_contract_id AND request_id=v_request;
   IF FOUND THEN
    IF v_entry.kind<>'advance' OR (v_entry.received_at,v_entry.reference_month,v_entry.amount,v_entry.document,v_entry.notes)
      IS DISTINCT FROM (v_date,v_month,-v_amount,v_document,v_notes) THEN
     RAISE EXCEPTION 'Este envio já foi registrado com outros dados. Reabra o formulário.' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('id',v_entry.id,'saved',true);
   END IF;
  END IF;
  v_totals=billing_private.contract_financial_summary(v_contract)->'totals';
  IF (v_totals->>'billingPending')::boolean THEN RAISE EXCEPTION 'Regularize o ATR e as cotações antes de estornar.' USING ERRCODE='22023'; END IF;
  v_available=coalesce(nullif(v_totals->>'refundableAmount','')::numeric,0)+CASE WHEN v_edit THEN -v_entry.amount ELSE 0 END;
  IF v_amount>v_available THEN
   RAISE EXCEPTION 'O estorno máximo disponível é R$ %.',replace(to_char(v_available,'FM999999999999990D00'),'.',',') USING ERRCODE='22023';
  END IF;
  IF v_edit THEN
   UPDATE public.billing_contract_payments SET received_at=v_date,reference_month=v_month,amount=-v_amount,
    document=v_document,notes=v_notes,revision=revision+1 WHERE id=v_id;
  ELSE
   INSERT INTO public.billing_contract_payments(owner_id,contract_id,request_id,kind,received_at,reference_month,amount,document,notes)
    VALUES(v_owner,v_contract_id,v_request,'advance',v_date,v_month,-v_amount,v_document,v_notes) RETURNING id INTO v_id;
  END IF;
  PERFORM billing_private.assert_contract_refunds_valid(v_contract);
  RETURN jsonb_build_object('id',v_id,'saved',true);
 END IF;

 -- Lifecycle transitions use the dedicated operation, and finalized production
 -- cannot receive new loading or discount changes.
 IF p_action='save' AND nullif(p_payload->>'id','') IS NOT NULL THEN
  v_id=(p_payload->>'id')::uuid;v_company=nullif(p_payload->>'companyId','')::uuid;
  SELECT * INTO v_contract FROM public.billing_contracts WHERE owner_id=v_owner AND id=v_id AND company_id=v_company FOR UPDATE;
  IF FOUND AND v_contract.status='Ativo' AND p_payload->>'status'='Concluído' THEN
   RAISE EXCEPTION 'Use a opção Encerrar contrato para concluir esta operação.' USING ERRCODE='22023';
  END IF;
  IF FOUND AND v_contract.status='Concluído' AND p_payload->>'status'<>'Concluído' AND
     EXISTS(SELECT 1 FROM public.billing_contract_payments WHERE owner_id=v_owner AND contract_id=v_contract.id AND amount<0) THEN
   RAISE EXCEPTION 'Exclua os estornos antes de reabrir ou cancelar o contrato.' USING ERRCODE='22023';
  END IF;
 END IF;
 IF p_action IN ('save-load','delete-load','save-discount','delete-discount') THEN
  v_company=nullif(p_payload->>'companyId','')::uuid;v_contract_id=nullif(p_payload->>'contractId','')::uuid;
  SELECT * INTO v_contract FROM public.billing_contracts WHERE owner_id=v_owner AND id=v_contract_id AND company_id=v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado para a empresa ativa.' USING ERRCODE='P0002'; END IF;
  IF v_contract.status<>'Ativo' THEN RAISE EXCEPTION 'Reabra o contrato para alterar carregamentos ou descontos.' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_action IN ('save-payment','delete-payment') AND nullif(p_payload->>'id','') IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.billing_contract_payments WHERE owner_id=v_owner AND id=(p_payload->>'id')::uuid AND amount<0
 ) THEN RAISE EXCEPTION 'Use a operação de estorno para alterar ou excluir esta devolução.' USING ERRCODE='22023'; END IF;

 v_result=billing_private.contracts_before_closure_refunds_dispatch(p_action,p_payload);
 IF p_action='list' AND coalesce(p_payload->>'view','')='' THEN
  SELECT coalesce(sum(coalesce(nullif(item->'financialTotals'->>'refundedAmount','')::numeric,0)),0),
   coalesce(sum(coalesce(nullif(item->'financialTotals'->>'refundableAmount','')::numeric,0)),0)
   INTO v_refunded,v_refundable FROM jsonb_array_elements(v_result->'contracts') item;
  v_result=jsonb_set(jsonb_set(v_result,'{summary,refundedAmount}',to_jsonb(billing_private.decimal_text(v_refunded)),true),
   '{summary,refundableAmount}',to_jsonb(billing_private.decimal_text(v_refundable)),true);
 END IF;
 IF p_action IN ('save','save-payment','delete-payment') THEN
  v_contract_id=CASE WHEN p_action='save' THEN nullif(v_result->'contract'->>'id','')::uuid ELSE nullif(p_payload->>'contractId','')::uuid END;
  SELECT * INTO v_contract FROM public.billing_contracts WHERE owner_id=v_owner AND id=v_contract_id;
  IF FOUND THEN PERFORM billing_private.assert_contract_refunds_valid(v_contract); END IF;
 END IF;
 RETURN v_result;
EXCEPTION
 WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Confira as datas, os valores e os identificadores informados.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.contracts_company_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.contracts_company_dispatch(text,jsonb) TO authenticated;

-- Refunds remain visible in the business-date calendar instead of appearing as
-- a negative advance.
CREATE OR REPLACE FUNCTION billing_private.agenda_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id(); v_company uuid; v_month date; v_from date; v_to date;
 v_kind text; v_result jsonb;
BEGIN
 v_company=billing_private.overview_scope(p_payload,ARRAY['companyId','month','kind']);
 PERFORM billing_private.authorize_resource('contracts','list');
 IF p_action<>'list' THEN RAISE EXCEPTION 'Operação da agenda inválida.' USING ERRCODE='22023'; END IF;
 v_month=billing_private.overview_month(p_payload->>'month');
 v_kind=coalesce(p_payload->>'kind','');
 IF v_kind NOT IN ('','contract','start','end','load','receipt','advance','refund') THEN RAISE EXCEPTION 'Tipo de evento inválido.' USING ERRCODE='22023'; END IF;
 v_from=v_month;v_to=(v_month+interval '1 month')::date-1;
 WITH contracts AS MATERIALIZED (
  SELECT c.*,cl.legal_name client_name FROM public.billing_contracts c
  JOIN public.billing_clients cl ON cl.owner_id=c.owner_id AND cl.id=c.client_id
  WHERE c.owner_id=v_owner AND c.company_id=v_company
 ), events AS (
  SELECT 'contract:'||c.id id,(c.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,'contract' kind,
   'Contrato cadastrado' title,c.client_name detail,c.id contract_id,c.contract_number,''::text amount,''::text volume,c.status FROM contracts c
  UNION ALL SELECT 'start:'||c.id,c.start_date,'start','Início de contrato',c.client_name,c.id,c.contract_number,'','',c.status FROM contracts c WHERE c.start_date IS NOT NULL AND c.status<>'Cancelado'
  UNION ALL SELECT 'end:'||c.id,c.end_date,'end','Término previsto do contrato',c.client_name,c.id,c.contract_number,'','',c.status FROM contracts c WHERE c.end_date IS NOT NULL AND c.status<>'Cancelado'
  UNION ALL SELECT 'load:'||l.id,l.loaded_at,'load','Carregamento',concat_ws(' · ',c.client_name,f.name,p.name),c.id,c.contract_number,'',billing_private.decimal_text(l.volume),c.status
   FROM public.billing_contract_loads l JOIN contracts c ON c.owner_id=l.owner_id AND c.id=l.contract_id
   JOIN public.billing_farms f ON f.owner_id=l.owner_id AND f.id=l.farm_id JOIN public.billing_farm_plots p ON p.owner_id=l.owner_id AND p.id=l.plot_id
  UNION ALL SELECT 'payment:'||p.id,p.received_at,
   CASE WHEN p.amount<0 THEN 'refund' WHEN p.kind='advance' THEN 'advance' ELSE 'receipt' END,
   CASE WHEN p.amount<0 THEN 'Estorno de adiantamento' WHEN p.kind='advance' THEN 'Adiantamento' ELSE 'Recebimento' END,
   c.client_name,c.id,c.contract_number,billing_private.decimal_text(abs(p.amount)),'',c.status
   FROM public.billing_contract_payments p JOIN contracts c ON c.owner_id=p.owner_id AND c.id=p.contract_id
 ), selected AS MATERIALIZED (
  SELECT * FROM events WHERE day BETWEEN v_from AND v_to AND (v_kind='' OR kind=v_kind)
 ), calendar AS (SELECT v_from+i AS day FROM generate_series(0,v_to-v_from) i)
 SELECT jsonb_build_object('month',p_payload->>'month','eventCount',(SELECT count(*) FROM selected WHERE day>=v_month AND day<v_month+interval '1 month'),
  'days',(SELECT jsonb_agg(jsonb_build_object('date',cal.day,'dayNumber',extract(day FROM cal.day)::integer,'gridColumn',extract(dow FROM cal.day)::integer+1,
   'inMonth',date_trunc('month',cal.day)=v_month,'isToday',cal.day=(now() AT TIME ZONE 'America/Sao_Paulo')::date,
   'eventCount',(SELECT count(*) FROM selected s WHERE s.day=cal.day),
   'kinds',coalesce((SELECT jsonb_agg(k.kind ORDER BY k.kind) FROM (SELECT DISTINCT s.kind FROM selected s WHERE s.day=cal.day) k),'[]'::jsonb),
   'summary',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',g.kind,'count',g.event_count,'volume',coalesce(billing_private.decimal_text(g.volume),''),'amount',coalesce(billing_private.decimal_text(g.amount),'')) ORDER BY g.kind)
    FROM (SELECT s.kind,count(*) event_count,sum(nullif(s.volume,'')::numeric) volume,sum(nullif(s.amount,'')::numeric) amount FROM selected s WHERE s.day=cal.day GROUP BY s.kind) g),'[]'::jsonb),
   'events',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'date',s.day,'kind',s.kind,'title',s.title,'detail',s.detail,'contractId',s.contract_id,
    'contractNumber',s.contract_number,'amount',s.amount,'volume',s.volume,'status',s.status) ORDER BY s.kind,s.detail,s.id) FROM selected s WHERE s.day=cal.day),'[]'::jsonb)
  ) ORDER BY cal.day) FROM calendar cal)) INTO v_result;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION billing_private.agenda_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.agenda_dispatch(text,jsonb) TO authenticated;

COMMENT ON FUNCTION public.billing_rpc(text,text,jsonb) IS
 'Authenticated workspace RPC. Contract closure and advance refunds are owner-scoped, transactionally validated and reflected in net cash totals.';
