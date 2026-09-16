-- Contract finance: monetary entries are separate from delivered production.
-- All amounts, weighted ATR, monthly deductions and balances are computed here.
CREATE TABLE public.billing_contract_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 contract_id uuid NOT NULL,
 request_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('advance','receipt')),
 received_at date NOT NULL CHECK(received_at BETWEEN '1900-01-01' AND '9999-12-31'),
 reference_month date NOT NULL CHECK(reference_month BETWEEN '1900-01-01' AND '9999-12-01' AND extract(day FROM reference_month)=1),
 amount numeric(18,2) NOT NULL CHECK(amount>0 AND amount<1000000000000000),
 document text NOT NULL DEFAULT '' CHECK(length(document)<=100),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=1000),
 revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,contract_id,request_id),
 FOREIGN KEY(owner_id,contract_id) REFERENCES public.billing_contracts(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX billing_contract_payments_month ON public.billing_contract_payments(owner_id,contract_id,reference_month);

CREATE TABLE public.billing_contract_discounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 contract_id uuid NOT NULL,
 request_id uuid NOT NULL,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 150),
 rate_per_ton numeric(15,6) NOT NULL CHECK(rate_per_ton>0 AND rate_per_ton<1000000000),
 months date[] NOT NULL CHECK(cardinality(months) BETWEEN 1 AND 120),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=1000),
 revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,contract_id,request_id),
 FOREIGN KEY(owner_id,contract_id) REFERENCES public.billing_contracts(owner_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX billing_contract_discounts_title ON public.billing_contract_discounts(owner_id,contract_id,billing_private.name_key(title));

DO $$ DECLARE v_table text; BEGIN
 FOREACH v_table IN ARRAY ARRAY['billing_contract_payments','billing_contract_discounts'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',v_table);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',v_table);
  EXECUTE format('CREATE POLICY billing_owner_read ON public.%I FOR SELECT TO authenticated USING (billing_private.can_access_owner(owner_id,''contracts.read''))',v_table);
  EXECUTE format('CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at()',v_table);
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
   EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',v_table);
  END IF;
 END LOOP;
END $$;

CREATE FUNCTION billing_private.finance_metrics(p_volume numeric,p_atr numeric,p_gross numeric,p_discount numeric,p_advance numeric,p_receipt numeric)
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
  'receivedAmount',billing_private.decimal_text(p_advance+p_receipt),
  'pendingAmount',CASE WHEN p_gross IS NULL THEN '' ELSE billing_private.decimal_text(greatest(p_gross-p_discount-p_advance-p_receipt,0)) END,
  'creditAmount',CASE WHEN p_gross IS NULL THEN '' ELSE billing_private.decimal_text(greatest(p_advance+p_receipt-(p_gross-p_discount),0)) END
 )
$$;
REVOKE ALL ON FUNCTION billing_private.finance_metrics(numeric,numeric,numeric,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION billing_private.contract_financial_summary(p_contract public.billing_contracts)
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
   coalesce((SELECT sum(amount) FROM payments p WHERE p.reference_month=calendar.month_start AND p.kind='advance'),0) advance,
   coalesce((SELECT sum(amount) FROM payments p WHERE p.reference_month=calendar.month_start AND p.kind='receipt'),0) receipt
  FROM calendar LEFT JOIN loads ON loads.month_key=calendar.month_start::text
 )
 SELECT jsonb_build_object(
  'months',(SELECT jsonb_agg(jsonb_build_object('month',to_char(month_start,'YYYY-MM'))||billing_private.finance_metrics(volume,atr,gross,discount,advance,receipt) ORDER BY month_start) FROM monthly),
  'totals',(SELECT billing_private.finance_metrics(sum(volume),
    (SELECT nullif(data->'totals'->>'averageLoadAtr','')::numeric FROM production),
    CASE WHEN count(*) FILTER(WHERE gross IS NULL)>0 THEN NULL ELSE sum(gross) END,
    sum(discount),sum(advance),sum(receipt)) FROM monthly),
  'emptyMonth',billing_private.finance_metrics(0,NULL,0,0,0,0),
  'payments',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',id,'requestId',request_id,'kind',kind,'receivedAt',received_at::text,'referenceMonth',to_char(reference_month,'YYYY-MM'),
   'amount',billing_private.decimal_text(amount),'document',document,'notes',notes,'revision',revision
  ) ORDER BY received_at DESC,created_at DESC,id) FROM payments),'[]'::jsonb),
  'discounts',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',d.id,'requestId',d.request_id,'title',d.title,'ratePerTon',billing_private.decimal_text(d.rate_per_ton),
   'months',(SELECT jsonb_agg(to_char(m,'YYYY-MM') ORDER BY m) FROM unnest(d.months) m),
   'notes',d.notes,'revision',d.revision,
   'loadedVolume',(SELECT billing_private.decimal_text(sum(volume)) FROM discount_months WHERE id=d.id),
   'amount',(SELECT billing_private.decimal_text(sum(amount)) FROM discount_months WHERE id=d.id)
  ) ORDER BY d.created_at DESC,d.id) FROM public.billing_contract_discounts d WHERE d.owner_id=p_contract.owner_id AND d.contract_id=p_contract.id),'[]'::jsonb)
 )
$$;
REVOKE ALL ON FUNCTION billing_private.contract_financial_summary(public.billing_contracts) FROM PUBLIC,anon,authenticated;

-- Keep the established contract behavior, adding finance to the same authorized resource.
ALTER FUNCTION billing_private.contracts_company_dispatch(text,jsonb) RENAME TO contracts_before_finance_dispatch;
REVOKE ALL ON FUNCTION billing_private.contracts_before_finance_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.contracts_company_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();
 v_contract public.billing_contracts%ROWTYPE;
 v_payment public.billing_contract_payments%ROWTYPE;
 v_discount public.billing_contract_discounts%ROWTYPE;
 v_result jsonb; v_id uuid; v_request uuid; v_contract_id uuid; v_company uuid;
 v_amount numeric; v_date date; v_month date; v_months date[]; v_kind text; v_title text; v_notes text; v_document text;
 v_allowed text[]; v_edit boolean; v_revision integer;
BEGIN
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.authorize_resource('contracts',p_action);
 IF p_action NOT IN ('save-payment','delete-payment','save-discount','delete-discount') THEN
  v_result=billing_private.contracts_before_finance_dispatch(p_action,p_payload);
  IF p_action='get' THEN
   SELECT * INTO STRICT v_contract FROM public.billing_contracts WHERE owner_id=v_owner AND id=(p_payload->>'id')::uuid AND company_id=(p_payload->>'companyId')::uuid;
   v_result=jsonb_set(v_result,'{contract,financialSummary}',billing_private.contract_financial_summary(v_contract),true);
  END IF;
  RETURN v_result;
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Confira os dados do lançamento.' USING ERRCODE='22023'; END IF;
 v_allowed=ARRAY['id','companyId','contractId','expectedRevision'];
 IF p_action='save-payment' THEN v_allowed=v_allowed||ARRAY['requestId','kind','receivedAt','referenceMonth','amount','document','notes']; END IF;
 IF p_action='save-discount' THEN v_allowed=v_allowed||ARRAY['requestId','title','ratePerTon','months','notes']; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT k=ANY(v_allowed)) THEN
  RAISE EXCEPTION 'O lançamento contém campos não permitidos.' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_payload) e WHERE e.key NOT IN ('months','expectedRevision') AND jsonb_typeof(e.value)<>'string') THEN
  RAISE EXCEPTION 'Confira o formato dos campos do lançamento.' USING ERRCODE='22023';
 END IF;
 v_company=nullif(p_payload->>'companyId','')::uuid;
 v_contract_id=nullif(p_payload->>'contractId','')::uuid;
 SELECT * INTO v_contract FROM public.billing_contracts WHERE owner_id=v_owner AND id=v_contract_id AND company_id=v_company FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado para a empresa ativa.' USING ERRCODE='P0002'; END IF;
 v_id=nullif(p_payload->>'id','')::uuid; v_edit=v_id IS NOT NULL;
 v_revision=(p_payload->>'expectedRevision')::integer;
 IF p_action IN ('delete-payment','delete-discount') THEN
  IF p_action='delete-payment' THEN
   SELECT * INTO v_payment FROM public.billing_contract_payments WHERE owner_id=v_owner AND contract_id=v_contract_id AND id=v_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Recebimento não encontrado.' USING ERRCODE='P0002'; END IF;
   IF v_revision IS DISTINCT FROM v_payment.revision THEN RAISE EXCEPTION 'O lançamento foi alterado. Atualize a tela antes de excluir.' USING ERRCODE='40001'; END IF;
   DELETE FROM public.billing_contract_payments WHERE owner_id=v_owner AND contract_id=v_contract_id AND id=v_id;
  ELSE
   SELECT * INTO v_discount FROM public.billing_contract_discounts WHERE owner_id=v_owner AND contract_id=v_contract_id AND id=v_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Desconto não encontrado.' USING ERRCODE='P0002'; END IF;
   IF v_revision IS DISTINCT FROM v_discount.revision THEN RAISE EXCEPTION 'O desconto foi alterado. Atualize a tela antes de excluir.' USING ERRCODE='40001'; END IF;
   DELETE FROM public.billing_contract_discounts WHERE owner_id=v_owner AND contract_id=v_contract_id AND id=v_id;
  END IF;
  RETURN jsonb_build_object('id',v_id,'deleted',true);
 END IF;
 v_request=nullif(p_payload->>'requestId','')::uuid;
 IF v_request IS NULL THEN RAISE EXCEPTION 'Identificador do lançamento ausente. Reabra o formulário.' USING ERRCODE='22023'; END IF;
 v_notes=btrim(coalesce(p_payload->>'notes',''));
 IF length(v_notes)>1000 THEN RAISE EXCEPTION 'Use até 1.000 caracteres nas observações.' USING ERRCODE='22023'; END IF;
 IF p_action='save-payment' THEN
  v_kind=p_payload->>'kind';v_document=btrim(coalesce(p_payload->>'document',''));
  IF v_kind IS NULL OR v_kind NOT IN ('advance','receipt') OR length(v_document)>100 THEN RAISE EXCEPTION 'Confira o tipo e o documento do recebimento.' USING ERRCODE='22023'; END IF;
  IF coalesce(p_payload->>'receivedAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR coalesce(p_payload->>'referenceMonth','')!~'^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
   RAISE EXCEPTION 'Informe a data do recebimento e o mês de referência.' USING ERRCODE='22023';
  END IF;
  v_date=(p_payload->>'receivedAt')::date;v_month=((p_payload->>'referenceMonth')||'-01')::date;
  IF coalesce(replace(btrim(p_payload->>'amount'),',','.'),'')!~'^[0-9]{1,15}([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'Informe um valor positivo com até duas casas decimais, sem separador de milhar.' USING ERRCODE='22023'; END IF;
  v_amount=replace(btrim(p_payload->>'amount'),',','.')::numeric;
  IF v_amount IS NULL OR v_amount<=0 OR v_amount>=1000000000000000 OR v_amount<>round(v_amount,2) THEN RAISE EXCEPTION 'Informe um valor positivo com até duas casas decimais.' USING ERRCODE='22023'; END IF;
  IF v_edit THEN
   SELECT * INTO v_payment FROM public.billing_contract_payments WHERE owner_id=v_owner AND contract_id=v_contract_id AND id=v_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Recebimento não encontrado.' USING ERRCODE='P0002'; END IF;
   IF v_revision IS DISTINCT FROM v_payment.revision THEN RAISE EXCEPTION 'O lançamento foi alterado. Atualize a tela antes de salvar.' USING ERRCODE='40001'; END IF;
   IF v_request<>v_payment.request_id OR v_kind<>v_payment.kind THEN RAISE EXCEPTION 'O tipo e a identificação do lançamento não podem ser alterados.' USING ERRCODE='22023'; END IF;
   UPDATE public.billing_contract_payments SET received_at=v_date,reference_month=v_month,amount=v_amount,document=v_document,notes=v_notes,revision=revision+1 WHERE id=v_id;
  ELSE
   SELECT * INTO v_payment FROM public.billing_contract_payments WHERE owner_id=v_owner AND contract_id=v_contract_id AND request_id=v_request;
   IF FOUND THEN
    IF (v_payment.kind,v_payment.received_at,v_payment.reference_month,v_payment.amount,v_payment.document,v_payment.notes) IS DISTINCT FROM (v_kind,v_date,v_month,v_amount,v_document,v_notes) THEN RAISE EXCEPTION 'Este envio já foi registrado com outros dados. Reabra o formulário.' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('id',v_payment.id,'saved',true);
   END IF;
   INSERT INTO public.billing_contract_payments(owner_id,contract_id,request_id,kind,received_at,reference_month,amount,document,notes)
    VALUES(v_owner,v_contract_id,v_request,v_kind,v_date,v_month,v_amount,v_document,v_notes) RETURNING id INTO v_id;
  END IF;
 ELSE
  v_title=btrim(coalesce(p_payload->>'title',''));
  IF length(v_title) NOT BETWEEN 1 AND 150 THEN RAISE EXCEPTION 'Informe o nome do acordo com até 150 caracteres.' USING ERRCODE='22023'; END IF;
  IF coalesce(replace(btrim(p_payload->>'ratePerTon'),',','.'),'')!~'^[0-9]{1,9}([.][0-9]{1,6})?$' THEN RAISE EXCEPTION 'Informe o desconto por tonelada, sem separador de milhar.' USING ERRCODE='22023'; END IF;
  v_amount=replace(btrim(p_payload->>'ratePerTon'),',','.')::numeric;
  IF v_amount IS NULL OR v_amount<=0 OR v_amount>=1000000000 OR v_amount<>round(v_amount,6) THEN RAISE EXCEPTION 'Informe um desconto positivo por tonelada, com até seis casas decimais.' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_payload->'months') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Selecione os meses de aplicação do desconto.' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(p_payload->'months') NOT BETWEEN 1 AND 120 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'months') m WHERE jsonb_typeof(m)<>'string' OR m#>>'{}'!~'^[0-9]{4}-(0[1-9]|1[0-2])$') THEN RAISE EXCEPTION 'Selecione entre 1 e 120 meses válidos.' USING ERRCODE='22023'; END IF;
  SELECT array_agg(DISTINCT (m||'-01')::date ORDER BY (m||'-01')::date) INTO v_months FROM jsonb_array_elements_text(p_payload->'months') m;
  IF cardinality(v_months)<>jsonb_array_length(p_payload->'months') OR EXISTS(SELECT 1 FROM unnest(v_months) m WHERE m<'1900-01-01' OR m>'9999-12-01') THEN RAISE EXCEPTION 'Confira os meses selecionados, sem repetições.' USING ERRCODE='22023'; END IF;
  IF v_edit THEN
   SELECT * INTO v_discount FROM public.billing_contract_discounts WHERE owner_id=v_owner AND contract_id=v_contract_id AND id=v_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Desconto não encontrado.' USING ERRCODE='P0002'; END IF;
   IF v_revision IS DISTINCT FROM v_discount.revision THEN RAISE EXCEPTION 'O desconto foi alterado. Atualize a tela antes de salvar.' USING ERRCODE='40001'; END IF;
   IF v_request<>v_discount.request_id THEN RAISE EXCEPTION 'A identificação do desconto não pode ser alterada.' USING ERRCODE='22023'; END IF;
   UPDATE public.billing_contract_discounts SET title=v_title,rate_per_ton=v_amount,months=v_months,notes=v_notes,revision=revision+1 WHERE id=v_id;
  ELSE
   SELECT * INTO v_discount FROM public.billing_contract_discounts WHERE owner_id=v_owner AND contract_id=v_contract_id AND request_id=v_request;
   IF FOUND THEN
    IF (v_discount.title,v_discount.rate_per_ton,v_discount.months,v_discount.notes) IS DISTINCT FROM (v_title,v_amount,v_months,v_notes) THEN RAISE EXCEPTION 'Este envio já foi registrado com outros dados. Reabra o formulário.' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('id',v_discount.id,'saved',true);
   END IF;
   INSERT INTO public.billing_contract_discounts(owner_id,contract_id,request_id,title,rate_per_ton,months,notes)
    VALUES(v_owner,v_contract_id,v_request,v_title,v_amount,v_months,v_notes) RETURNING id INTO v_id;
  END IF;
 END IF;
 RETURN jsonb_build_object('id',v_id,'saved',true);
EXCEPTION
 WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Confira as datas, os valores e os identificadores informados.' USING ERRCODE='22023';
 WHEN unique_violation THEN RAISE EXCEPTION 'Já existe um acordo com esse nome ou um lançamento com essa identificação neste contrato.' USING ERRCODE='23505';
END $$;
REVOKE ALL ON FUNCTION billing_private.contracts_company_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.contracts_company_dispatch(text,jsonb) TO authenticated;
