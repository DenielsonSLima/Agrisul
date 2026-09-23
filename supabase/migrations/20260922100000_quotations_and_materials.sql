-- Materials and supplier quotations use the same owner-scoped RPC boundary as contracts.
CREATE TABLE public.billing_materials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 150),
 code text NOT NULL CHECK(length(btrim(code)) BETWEEN 1 AND 60),
 unit text NOT NULL CHECK(length(btrim(unit)) BETWEEN 1 AND 30),
 application text NOT NULL DEFAULT '' CHECK(length(application)<=1000),
 UNIQUE(owner_id,id),
 UNIQUE(owner_id,code)
);
CREATE INDEX billing_materials_owner_order ON public.billing_materials(owner_id,lower(name),id);
ALTER TABLE public.billing_materials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_materials FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_materials TO authenticated;
CREATE POLICY billing_owner_read ON public.billing_materials FOR SELECT TO authenticated USING(billing_private.can_access_owner(owner_id,'registrations.read'));
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_materials FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();

CREATE TABLE public.billing_quotations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 2 AND 150),
 quotation_number text NOT NULL CHECK(length(btrim(quotation_number)) BETWEEN 1 AND 60),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','finished')),
 UNIQUE(owner_id,id),
 UNIQUE(owner_id,quotation_number)
);
CREATE INDEX billing_quotations_owner_status ON public.billing_quotations(owner_id,status,created_at DESC,id);
ALTER TABLE public.billing_quotations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_quotations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_quotations TO authenticated;
CREATE POLICY billing_owner_read ON public.billing_quotations FOR SELECT TO authenticated USING(billing_private.can_access_owner(owner_id,'quotations.read'));
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_quotations FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();

CREATE TABLE public.billing_quotation_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 quotation_id uuid NOT NULL,
 material_id uuid NOT NULL,
 quantity numeric(15,3) NOT NULL CHECK(quantity>0 AND quantity<1000000000000),
 unit text NOT NULL CHECK(length(btrim(unit)) BETWEEN 1 AND 30),
 unit_price numeric(15,2) NOT NULL CHECK(unit_price>=0 AND unit_price<1000000000000),
 supplier text NOT NULL CHECK(length(btrim(supplier)) BETWEEN 1 AND 200),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=1000),
 UNIQUE(owner_id,id),
 FOREIGN KEY(owner_id,quotation_id) REFERENCES public.billing_quotations(owner_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,material_id) REFERENCES public.billing_materials(owner_id,id)
);
CREATE INDEX billing_quotation_items_quote ON public.billing_quotation_items(owner_id,quotation_id,id);
CREATE INDEX billing_quotation_items_material ON public.billing_quotation_items(owner_id,material_id);
ALTER TABLE public.billing_quotation_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_quotation_items FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.billing_quotation_items TO authenticated;
CREATE POLICY billing_owner_read ON public.billing_quotation_items FOR SELECT TO authenticated USING(billing_private.can_access_owner(owner_id,'quotations.read'));
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_quotation_items FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();

CREATE FUNCTION billing_private.quotations_dispatch(p_resource text,p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id(); v_id uuid; v_quote_id uuid; v_material_id uuid;
 v_quote public.billing_quotations%ROWTYPE; v_item public.billing_quotation_items%ROWTYPE;
 v_material public.billing_materials%ROWTYPE; v_items jsonb; v_item_json jsonb; v_result jsonb;
 v_text text; v_number text; v_quantity numeric; v_price numeric;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Dados inválidos.' USING ERRCODE='22023'; END IF;
 IF p_resource='materials' THEN
  v_id=nullif(p_payload->>'id','')::uuid;
  IF p_action='delete' THEN
   IF v_id IS NULL THEN RAISE EXCEPTION 'Informe o material.' USING ERRCODE='22023'; END IF;
   DELETE FROM public.billing_materials WHERE owner_id=v_owner AND id=v_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Material não encontrado.' USING ERRCODE='P0002'; END IF;
   RETURN jsonb_build_object('id',v_id,'deleted',true);
  END IF;
  IF p_action='save' THEN
   IF jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'code') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'unit') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'application') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Preencha os campos do material.' USING ERRCODE='22023'; END IF;
   v_id=coalesce(v_id,gen_random_uuid());
   INSERT INTO public.billing_materials(id,owner_id,name,code,unit,application)
   VALUES(v_id,v_owner,btrim(p_payload->>'name'),btrim(p_payload->>'code'),btrim(p_payload->>'unit'),btrim(p_payload->>'application'))
   ON CONFLICT(id) DO UPDATE SET name=excluded.name,code=excluded.code,unit=excluded.unit,application=excluded.application WHERE billing_materials.owner_id=v_owner;
  END IF;
  IF p_action NOT IN ('list','get','save') THEN RAISE EXCEPTION 'Operação de material inválida.' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(billing_private.present(to_jsonb(m)) ORDER BY lower(m.name),m.id),'[]'::jsonb) INTO v_result FROM public.billing_materials m WHERE m.owner_id=v_owner AND (p_action<>'get' OR m.id=v_id);
  IF p_action='get' THEN RETURN jsonb_build_object('material',v_result->0); END IF;
  IF p_action='save' THEN RETURN jsonb_build_object('material',v_result->0); END IF;
  RETURN jsonb_build_object('materials',v_result);
 END IF;
 IF p_resource<>'quotations' OR p_action NOT IN ('list','get','save','toggle-status','delete') THEN RAISE EXCEPTION 'Operação de cotação inválida.' USING ERRCODE='22023'; END IF;
 v_id=nullif(p_payload->>'id','')::uuid;
 IF p_action='list' THEN
  SELECT coalesce(jsonb_agg(billing_private.present(to_jsonb(q))||jsonb_build_object('number',q.quotation_number,'items',(SELECT coalesce(jsonb_agg(billing_private.present(to_jsonb(i))||jsonb_build_object('materialName',m.name,'materialId',i.material_id,'quantity',billing_private.decimal_text(i.quantity),'unitPrice',billing_private.decimal_text(i.unit_price),'supplier',i.supplier,'notes',i.notes) ORDER BY i.created_at,i.id),'[]'::jsonb) FROM public.billing_quotation_items i JOIN public.billing_materials m ON m.owner_id=i.owner_id AND m.id=i.material_id WHERE i.owner_id=q.owner_id AND i.quotation_id=q.id)) ORDER BY q.created_at DESC,q.id),'[]'::jsonb) INTO v_result FROM public.billing_quotations q WHERE q.owner_id=v_owner AND q.status=coalesce(nullif(p_payload->>'status',''),'open');
  RETURN jsonb_build_object('quotes',v_result,'total',jsonb_array_length(v_result));
 END IF;
 IF v_id IS NULL THEN RAISE EXCEPTION 'Informe a cotação.' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_quote FROM public.billing_quotations WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
 IF p_action='get' THEN
  IF NOT FOUND THEN RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE='P0002'; END IF;
  SELECT coalesce(jsonb_agg(billing_private.present(to_jsonb(i))||jsonb_build_object('materialName',m.name,'materialId',i.material_id,'quantity',billing_private.decimal_text(i.quantity),'unitPrice',billing_private.decimal_text(i.unit_price),'supplier',i.supplier,'notes',i.notes) ORDER BY i.created_at,i.id),'[]'::jsonb) INTO v_items FROM public.billing_quotation_items i JOIN public.billing_materials m ON m.owner_id=i.owner_id AND m.id=i.material_id WHERE i.owner_id=v_owner AND i.quotation_id=v_id;
  RETURN jsonb_build_object('quote',billing_private.present(to_jsonb(v_quote))||jsonb_build_object('number',v_quote.quotation_number,'items',v_items));
 END IF;
 IF p_action='delete' THEN
  IF NOT FOUND THEN RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE='P0002'; END IF;
  DELETE FROM public.billing_quotations WHERE owner_id=v_owner AND id=v_id;
  RETURN jsonb_build_object('id',v_id,'deleted',true);
 END IF;
 IF p_action='toggle-status' THEN
  IF NOT FOUND THEN RAISE EXCEPTION 'Cotação não encontrada.' USING ERRCODE='P0002'; END IF;
  UPDATE public.billing_quotations SET status=CASE WHEN status='open' THEN 'finished' ELSE 'open' END WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_quote;
  RETURN jsonb_build_object('quote',billing_private.present(to_jsonb(v_quote))||jsonb_build_object('number',v_quote.quotation_number));
 END IF;
 IF jsonb_typeof(p_payload->'title') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'number') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'items')=0 THEN RAISE EXCEPTION 'Informe a cotação e pelo menos um item.' USING ERRCODE='22023'; END IF;
 v_number=nullif(btrim(p_payload->>'number'),'');
 IF v_number IS NULL THEN SELECT 'COT-'||lpad((count(*)+1)::text,3,'0') INTO v_number FROM public.billing_quotations WHERE owner_id=v_owner; END IF;
 v_id=coalesce(v_id,gen_random_uuid());
 INSERT INTO public.billing_quotations(id,owner_id,title,quotation_number,status) VALUES(v_id,v_owner,btrim(p_payload->>'title'),v_number,'open') ON CONFLICT(id) DO UPDATE SET title=excluded.title,quotation_number=excluded.quotation_number WHERE billing_quotations.owner_id=v_owner RETURNING * INTO v_quote;
 DELETE FROM public.billing_quotation_items WHERE owner_id=v_owner AND quotation_id=v_id;
 FOR v_item_json IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
  v_material_id=nullif(v_item_json->>'materialId','')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.billing_materials WHERE owner_id=v_owner AND id=v_material_id) THEN RAISE EXCEPTION 'Selecione materiais cadastrados.' USING ERRCODE='22023'; END IF;
  v_quantity=replace(btrim(v_item_json->>'quantity'),',','.')::numeric; v_price=replace(btrim(v_item_json->>'unitPrice'),',','.')::numeric;
  IF v_quantity<=0 OR v_price<0 OR nullif(btrim(v_item_json->>'supplier'),'') IS NULL THEN RAISE EXCEPTION 'Confira quantidade, preço e fornecedor dos itens.' USING ERRCODE='22023'; END IF;
  SELECT unit INTO v_text FROM public.billing_materials WHERE owner_id=v_owner AND id=v_material_id;
  INSERT INTO public.billing_quotation_items(owner_id,quotation_id,material_id,quantity,unit,unit_price,supplier,notes) VALUES(v_owner,v_id,v_material_id,v_quantity,v_text,v_price,btrim(v_item_json->>'supplier'),btrim(coalesce(v_item_json->>'notes','')));
 END LOOP;
 RETURN jsonb_build_object('quote',billing_private.present(to_jsonb(v_quote))||jsonb_build_object('number',v_quote.quotation_number));
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Já existe um cadastro com este código ou número.' USING ERRCODE='23505'; WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'Informe valores numéricos válidos.' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.quotations_dispatch(text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION billing_private.authorize_resource(p_resource text,p_action text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_permission text;
BEGIN
 v_permission=CASE
  WHEN p_resource='companies' THEN 'companies.'||CASE WHEN p_action IN ('get','list') THEN 'read' ELSE 'write' END
  WHEN p_resource IN ('clients','atr','farms','plots','contract-types','cultures','cultural-practices','materials') THEN 'registrations.'||CASE WHEN p_action IN ('get','list') THEN 'read' ELSE 'write' END
  WHEN p_resource='contracts' THEN 'contracts.'||CASE WHEN p_action IN ('get','list') THEN 'read' ELSE 'write' END
  WHEN p_resource='quotations' THEN 'quotations.'||CASE WHEN p_action IN ('get','list') THEN 'read' ELSE 'write' END
  WHEN p_resource IN ('watermark','watermarks') THEN 'watermarks.'||CASE WHEN p_action IN ('get','list') THEN 'read' ELSE 'write' END
  ELSE NULL
 END;
 IF v_permission IS NOT NULL THEN PERFORM billing_private.authorize(v_permission); END IF;
END $$;

CREATE OR REPLACE FUNCTION public.billing_rpc(p_resource text,p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 IF p_resource='onboarding' THEN RETURN billing_private.onboarding_dispatch(p_action,p_payload); END IF;
 PERFORM billing_private.ensure_actor_workspace();
 IF p_resource IN ('settings','profile') THEN RETURN billing_private.workspace_settings(p_action,p_payload); END IF;
 IF p_resource='users' THEN RETURN billing_private.users_dispatch(p_action,p_payload); END IF;
 IF p_resource='access-profiles' THEN RETURN billing_private.access_profiles_dispatch(p_action,p_payload); END IF;
 IF p_resource='report-headers' THEN RETURN billing_private.report_headers_dispatch(p_action,p_payload); END IF;
 IF p_resource='agenda' THEN RETURN billing_private.agenda_dispatch(p_action,p_payload); END IF;
 IF p_resource='summary' THEN RETURN billing_private.summary_dispatch(p_action,p_payload); END IF;
 IF p_resource='reports' THEN RETURN billing_private.reports_dispatch(p_action,p_payload); END IF;
 IF p_resource='planning' THEN RETURN billing_private.planning_v9_dispatch(p_action,p_payload); END IF;
 IF p_resource IN ('planning-goals','planning-executions') THEN RAISE EXCEPTION 'Este contrato antigo de planejamento permanece desativado.' USING ERRCODE='22023'; END IF;
 PERFORM billing_private.authorize_resource(p_resource,p_action);
 IF p_resource IN ('materials','quotations') THEN RETURN billing_private.quotations_dispatch(p_resource,p_action,p_payload); END IF;
 IF p_resource='contracts' THEN RETURN billing_private.contracts_company_dispatch(p_action,p_payload); END IF;
 IF p_resource='cultural-practices' AND p_action='bootstrap-sugarcane' THEN RETURN billing_private.bootstrap_sugarcane_management(p_payload); END IF;
 IF p_resource='cultural-practices' THEN RETURN billing_private.management_dispatch(p_action,p_payload); END IF;
 IF p_resource='atr' THEN RETURN billing_private.atr_dispatch(p_action,p_payload); END IF;
 IF p_resource='farms' AND p_action='list' THEN RETURN billing_private.farm_summary_list(); END IF;
 IF p_resource='companies' AND p_action='save' THEN RETURN billing_private.save_company(p_payload); END IF;
 IF p_resource IN ('watermark','watermarks') THEN RETURN billing_private.watermark_variants(p_action,p_payload); END IF;
 RETURN billing_private.dispatch(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION public.billing_rpc(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_rpc(text,text,jsonb) TO authenticated;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['billing_materials','billing_quotations','billing_quotation_items'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t); END IF;
 END LOOP;
END $$;