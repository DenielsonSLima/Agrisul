-- Partner fleet extends the existing registry. Weighings retain measurement
-- snapshots: editing a vehicle never changes an already saved weighing.
ALTER TABLE public.billing_fleet_vehicles
 ADD COLUMN partner_id uuid,
 ADD COLUMN plate text NOT NULL DEFAULT '' CHECK(plate='' OR plate ~ '^[A-Z0-9]{1,12}$'),
 ADD COLUMN kind text CHECK(kind IN ('truck','trailer')),
 ADD COLUMN tare_kg numeric(18,6) CHECK(tare_kg>=0 AND tare_kg<1000000),
 ADD CONSTRAINT billing_fleet_partner_fk FOREIGN KEY(owner_id,partner_id) REFERENCES public.billing_clients(owner_id,id);
ALTER TABLE public.billing_fleet_vehicles DROP CONSTRAINT billing_fleet_vehicles_owner_id_internal_code_key;
CREATE UNIQUE INDEX billing_fleet_legacy_code ON public.billing_fleet_vehicles(owner_id,internal_code) WHERE partner_id IS NULL;
CREATE UNIQUE INDEX billing_fleet_partner_code ON public.billing_fleet_vehicles(owner_id,partner_id,internal_code) WHERE partner_id IS NOT NULL;
CREATE UNIQUE INDEX billing_fleet_partner_plate ON public.billing_fleet_vehicles(owner_id,partner_id,plate) WHERE partner_id IS NOT NULL AND plate<>'';
CREATE INDEX billing_fleet_partner ON public.billing_fleet_vehicles(owner_id,partner_id);
ALTER TABLE public.billing_cane_weighing_components ADD COLUMN vehicle_id uuid,
 ADD CONSTRAINT billing_cane_vehicle_fk FOREIGN KEY(owner_id,vehicle_id) REFERENCES public.billing_fleet_vehicles(owner_id,id);
CREATE INDEX billing_cane_component_vehicle ON public.billing_cane_weighing_components(owner_id,vehicle_id);
ALTER TABLE public.billing_cane_weighing_entries ADD COLUMN source_id text NOT NULL DEFAULT '' CHECK(length(source_id)<=300);
CREATE UNIQUE INDEX billing_cane_entry_source ON public.billing_cane_weighing_entries(owner_id,control_id,source_id) WHERE source_id<>'';

CREATE OR REPLACE FUNCTION billing_private.fleet_vehicle_json(p_vehicle public.billing_fleet_vehicles)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT (billing_private.present(to_jsonb(p_vehicle))-'internal_code'-'partner_id'-'tare_kg')
 ||jsonb_build_object('internalCode',p_vehicle.internal_code,'partnerId',p_vehicle.partner_id,
 'partnerName',(SELECT coalesce(nullif(c.trade_name,''),c.legal_name) FROM public.billing_clients c WHERE c.owner_id=p_vehicle.owner_id AND c.id=p_vehicle.partner_id),
 'tareKg',billing_private.decimal_text(p_vehicle.tare_kg))
$$;

CREATE OR REPLACE FUNCTION billing_private.fleet_dispatch(p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_id uuid;v_partner uuid;v_vehicle public.billing_fleet_vehicles;
 v_old public.billing_fleet_vehicles;v_result jsonb;v_code text;v_plate text;v_kind text;v_tare numeric;
 v_model text;v_brand text;v_description text;
BEGIN
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('list','get','save','delete') THEN RAISE EXCEPTION 'Operação de frota inválida.' USING ERRCODE='22023'; END IF;
 PERFORM billing_private.request_payload(p_payload,CASE WHEN p_action='list' THEN ARRAY['partnerId']
  WHEN p_action='save' THEN ARRAY['id','internalCode','model','brand','description','partnerId','plate','kind','tareKg'] ELSE ARRAY['id'] END);
 IF p_action IN ('list','get') THEN PERFORM billing_private.authorize('registrations.read');
 ELSE PERFORM billing_private.lock_request_actor();PERFORM billing_private.authorize('registrations.write'); END IF;
 v_partner=nullif(p_payload->>'partnerId','')::uuid;
 IF p_action='list' THEN
  SELECT coalesce(jsonb_agg(billing_private.fleet_vehicle_json(v) ORDER BY v.partner_id NULLS FIRST,lower(v.internal_code),v.id),'[]')
   INTO v_result FROM public.billing_fleet_vehicles v WHERE v.owner_id=v_owner AND (NOT p_payload?'partnerId' OR v.partner_id IS NOT DISTINCT FROM v_partner);
  RETURN jsonb_build_object('vehicles',v_result,'canManage',billing_private.has_permission('registrations.write'));
 END IF;
 v_id=nullif(p_payload->>'id','')::uuid;
 IF v_id IS NOT NULL THEN
  SELECT * INTO v_old FROM public.billing_fleet_vehicles WHERE owner_id=v_owner AND id=v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Veículo não encontrado.' USING ERRCODE='P0002'; END IF;
 ELSIF p_action<>'save' THEN RAISE EXCEPTION 'Informe o veículo.' USING ERRCODE='22023'; END IF;
 IF p_action='get' THEN RETURN jsonb_build_object('vehicle',billing_private.fleet_vehicle_json(v_old)); END IF;
 IF p_action='delete' THEN
  IF EXISTS(SELECT 1 FROM public.billing_cane_weighing_components WHERE owner_id=v_owner AND vehicle_id=v_id) THEN
   RAISE EXCEPTION 'Este veículo possui pesagens vinculadas e não pode ser excluído.' USING ERRCODE='23503';
  END IF;
  DELETE FROM public.billing_fleet_vehicles WHERE owner_id=v_owner AND id=v_id;
  RETURN jsonb_build_object('id',v_id,'deleted',true);
 END IF;
 IF NOT p_payload?'partnerId' THEN v_partner=v_old.partner_id; END IF;
 IF v_partner IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.billing_clients WHERE owner_id=v_owner AND id=v_partner) THEN
  RAISE EXCEPTION 'Selecione um parceiro válido.' USING ERRCODE='22023';
 END IF;
 v_code=btrim(p_payload->>'internalCode');
 v_plate=CASE WHEN p_payload?'plate' THEN upper(regexp_replace(btrim(coalesce(p_payload->>'plate','')),'[-[:space:]]','','g')) ELSE coalesce(v_old.plate,'') END;
 v_kind=CASE WHEN p_payload?'kind' THEN nullif(p_payload->>'kind','') ELSE v_old.kind END;
 v_tare=CASE WHEN p_payload?'tareKg' THEN billing_private.cane_weight(p_payload->'tareKg') ELSE v_old.tare_kg END;
 v_model=coalesce(nullif(btrim(p_payload->>'model'),''),CASE WHEN v_partner IS NOT NULL THEN CASE WHEN v_kind='truck' THEN 'Caminhão' ELSE 'Reboque' END END);
 v_brand=coalesce(nullif(btrim(p_payload->>'brand'),''),CASE WHEN v_partner IS NOT NULL THEN 'Não informada' END);
 v_description=coalesce(p_payload->>'description','');
 IF jsonb_typeof(p_payload->'internalCode') IS DISTINCT FROM 'string' OR length(v_code) NOT BETWEEN 1 AND 60
  OR v_model IS NULL OR length(v_model) NOT BETWEEN 2 AND 150 OR v_brand IS NULL OR length(v_brand) NOT BETWEEN 2 AND 100 OR length(v_description)>1000
  OR (v_plate<>'' AND v_plate!~'^[A-Z0-9]{1,12}$') OR (v_kind IS NOT NULL AND v_kind NOT IN ('truck','trailer'))
  OR (v_partner IS NOT NULL AND v_kind IS NULL) THEN
  RAISE EXCEPTION 'Preencha número de frota, placa e tipo do veículo do parceiro; na frota própria informe também marca e modelo.' USING ERRCODE='22023';
 END IF;
 IF v_id IS NOT NULL AND v_partner IS DISTINCT FROM v_old.partner_id AND EXISTS(SELECT 1 FROM public.billing_cane_weighing_components WHERE owner_id=v_owner AND vehicle_id=v_id) THEN
  RAISE EXCEPTION 'Não é possível trocar o parceiro de um veículo com pesagens vinculadas.' USING ERRCODE='22023';
 END IF;
 IF v_id IS NULL THEN
  INSERT INTO public.billing_fleet_vehicles(owner_id,internal_code,model,brand,description,partner_id,plate,kind,tare_kg)
   VALUES(v_owner,v_code,v_model,v_brand,v_description,v_partner,v_plate,v_kind,v_tare) RETURNING * INTO v_vehicle;
 ELSE
  UPDATE public.billing_fleet_vehicles SET internal_code=v_code,model=v_model,brand=v_brand,description=v_description,
   partner_id=v_partner,plate=v_plate,kind=v_kind,tare_kg=v_tare WHERE owner_id=v_owner AND id=v_id RETURNING * INTO v_vehicle;
 END IF;
 RETURN jsonb_build_object('vehicle',billing_private.fleet_vehicle_json(v_vehicle));
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Já existe um veículo com este número de frota ou placa neste parceiro.' USING ERRCODE='23505';
 WHEN invalid_text_representation THEN RAISE EXCEPTION 'Informe um veículo e parceiro válidos.' USING ERRCODE='22023';
END $$;

-- Atomic import. Repeating a source row skips it, preserving later user edits.
CREATE FUNCTION billing_private.cane_import(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_company uuid;v_partner uuid;v_control_id uuid;
 v_source text;v_key text;v_row jsonb;v_component jsonb;v_components jsonb;v_vehicle_id uuid;v_result jsonb;
 v_imported integer:=0;v_skipped integer:=0;v_fleet integer:=0;v_entry_id uuid;
BEGIN
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 PERFORM billing_private.lock_request_actor();PERFORM billing_private.authorize('contracts.write');PERFORM billing_private.authorize('registrations.write');
 PERFORM billing_private.request_payload(p_payload,ARRAY['companyId','partnerId','startDate','season','notes','sourceId','vehicles','entries']);
 v_company=nullif(p_payload->>'companyId','')::uuid;v_partner=nullif(p_payload->>'partnerId','')::uuid;v_source=btrim(p_payload->>'sourceId');
 IF jsonb_typeof(p_payload->'sourceId') IS DISTINCT FROM 'string' OR v_source IS NULL OR length(v_source) NOT BETWEEN 1 AND 120
  OR jsonb_typeof(p_payload->'vehicles') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'vehicles')>500
  OR jsonb_typeof(p_payload->'entries') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'entries')>1000 THEN
  RAISE EXCEPTION 'Informe uma origem e listas válidas de frota e pesagens.' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.billing_companies WHERE owner_id=v_owner AND id=v_company)
  OR NOT EXISTS(SELECT 1 FROM public.billing_clients WHERE owner_id=v_owner AND id=v_partner) THEN
  RAISE EXCEPTION 'Selecione uma empresa e um parceiro válidos.' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text||v_company::text||v_partner::text||coalesce(p_payload->>'startDate',''),0));
 SELECT id INTO v_control_id FROM public.billing_cane_weighing_controls
  WHERE owner_id=v_owner AND company_id=v_company AND partner_id=v_partner AND start_date=(p_payload->>'startDate')::date FOR UPDATE;
 IF NOT FOUND THEN
  v_result=billing_private.cane_weighings_dispatch('save',p_payload-ARRAY['sourceId','vehicles','entries']);
  v_control_id=(v_result->'control'->>'id')::uuid;
 END IF;
 FOR v_row IN SELECT value FROM jsonb_array_elements(p_payload->'vehicles') LOOP
  PERFORM billing_private.request_payload(v_row,ARRAY['internalCode','plate','kind','tareKg','model','brand','description']);
  -- Replays do not replace a vehicle's current registry data with old source data.
  IF EXISTS(SELECT 1 FROM public.billing_fleet_vehicles WHERE owner_id=v_owner AND partner_id=v_partner
   AND (internal_code=btrim(v_row->>'internalCode') OR (plate<>'' AND plate=upper(regexp_replace(coalesce(v_row->>'plate',''),'[-[:space:]]','','g'))))) THEN CONTINUE; END IF;
  PERFORM billing_private.fleet_dispatch('save',v_row||jsonb_build_object('partnerId',v_partner));v_fleet=v_fleet+1;
 END LOOP;
 FOR v_row IN SELECT value FROM jsonb_array_elements(p_payload->'entries') LOOP
  PERFORM billing_private.request_payload(v_row,ARRAY['sourceId','weighedAt','weighedTime','ticket','notes','trailerGrossMode','combinedTrailerGrossKg','components']);
  IF jsonb_typeof(v_row->'sourceId') IS DISTINCT FROM 'string' OR length(btrim(v_row->>'sourceId')) NOT BETWEEN 1 AND 160 THEN
   RAISE EXCEPTION 'Cada lançamento deve ter um identificador de origem.' USING ERRCODE='22023';
  END IF;
  v_key=v_source||'/'||btrim(v_row->>'sourceId');
  IF EXISTS(SELECT 1 FROM public.billing_cane_weighing_entries WHERE owner_id=v_owner AND control_id=v_control_id AND source_id=v_key) THEN
   v_skipped=v_skipped+1;CONTINUE;
  END IF;
  IF jsonb_typeof(v_row->'components') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Informe os componentes da viagem.' USING ERRCODE='22023'; END IF;
  v_components='[]';
  FOR v_component IN SELECT value FROM jsonb_array_elements(v_row->'components') LOOP
   PERFORM billing_private.request_payload(v_component,ARRAY['fleetNumber','plate','kind','tareKg','grossKg','partnerNetKg']);
   v_vehicle_id=NULL;
   SELECT id INTO v_vehicle_id FROM public.billing_fleet_vehicles WHERE owner_id=v_owner AND partner_id=v_partner
    AND kind=v_component->>'kind' AND (
     (plate<>'' AND plate=upper(regexp_replace(coalesce(v_component->>'plate',''),'[-[:space:]]','','g')))
     OR internal_code=btrim(v_component->>'fleetNumber'))
    ORDER BY (plate<>'' AND plate=upper(regexp_replace(coalesce(v_component->>'plate',''),'[-[:space:]]','','g'))) DESC LIMIT 1;
   v_components=v_components||jsonb_build_array(v_component||jsonb_build_object('vehicleId',v_vehicle_id));
  END LOOP;
  v_result=billing_private.cane_weighings_dispatch('save-entry',(v_row-'sourceId')||jsonb_build_object(
   'companyId',v_company,'controlId',v_control_id,'components',v_components));
  v_entry_id=(v_result->'entry'->>'id')::uuid;
  UPDATE public.billing_cane_weighing_entries SET source_id=v_key WHERE owner_id=v_owner AND id=v_entry_id;
  v_imported=v_imported+1;
 END LOOP;
 RETURN jsonb_build_object('controlId',v_control_id,'importedCount',v_imported,'skippedCount',v_skipped,'vehiclesCreated',v_fleet);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Verifique os identificadores e as datas da importação.' USING ERRCODE='22023';
END $$;

ALTER FUNCTION billing_private.cane_entry_json(public.billing_cane_weighing_entries) RENAME TO cane_entry_json_before_fleet;
CREATE FUNCTION billing_private.cane_entry_json(p_entry public.billing_cane_weighing_entries) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH base AS (SELECT billing_private.cane_entry_json_before_fleet(p_entry) AS j),
 components AS (SELECT coalesce(jsonb_agg(c||jsonb_build_object('vehicleId',v.vehicle_id) ORDER BY n),'[]') AS items
  FROM base,jsonb_array_elements(j->'components') WITH ORDINALITY x(c,n)
  LEFT JOIN public.billing_cane_weighing_components v ON v.owner_id=p_entry.owner_id AND v.entry_id=p_entry.id AND v.id=(c->>'id')::uuid),
 totals AS (SELECT CASE WHEN count(*)=3 AND count(c->>'tareKg')=3 THEN sum((c->>'tareKg')::numeric) END AS tare,
  CASE WHEN count(*)=3 AND count(c->>'grossKg')=3 THEN sum((c->>'grossKg')::numeric) END AS gross FROM components,jsonb_array_elements(items) c)
 SELECT j||jsonb_build_object('components',items,'sourceId',p_entry.source_id,'tareKg',billing_private.decimal_text(tare),'grossKg',billing_private.decimal_text(gross))
 FROM base,components,totals
$$;
ALTER FUNCTION billing_private.cane_summary(jsonb) RENAME TO cane_summary_before_fleet;
CREATE FUNCTION billing_private.cane_summary(p_entries jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT billing_private.cane_summary_before_fleet(p_entries)||jsonb_build_object(
 'tareKg',billing_private.decimal_text(coalesce(sum((e->>'tareKg')::numeric),0)),
 'grossKg',billing_private.decimal_text(coalesce(sum((e->>'grossKg')::numeric),0))) FROM jsonb_array_elements(p_entries) e
$$;

ALTER FUNCTION billing_private.cane_weighings_dispatch(text,jsonb) RENAME TO cane_weighings_before_fleet;
CREATE FUNCTION billing_private.cane_weighings_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_control public.billing_cane_weighing_controls;
 v_vehicle public.billing_fleet_vehicles;v_component jsonb;v_components jsonb:='[]';v_vehicle_ids uuid[]:='{}';
 v_result jsonb;v_entry_id uuid;v_id uuid;v_index integer:=0;v_old public.billing_cane_weighing_components;
BEGIN
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000'; END IF;
 IF p_action='import' THEN RETURN billing_private.cane_import(p_payload); END IF;
 IF p_action<>'save-entry' THEN
  IF p_action='save' AND nullif(p_payload->>'id','') IS NOT NULL THEN
   PERFORM billing_private.lock_request_actor();PERFORM billing_private.authorize('contracts.write');
   SELECT * INTO v_control FROM public.billing_cane_weighing_controls WHERE owner_id=v_owner AND id=(p_payload->>'id')::uuid FOR UPDATE;
   IF FOUND AND v_control.partner_id IS DISTINCT FROM nullif(p_payload->>'partnerId','')::uuid
    AND EXISTS(SELECT 1 FROM public.billing_cane_weighing_components c JOIN public.billing_cane_weighing_entries e ON e.owner_id=c.owner_id AND e.id=c.entry_id
     WHERE e.owner_id=v_owner AND e.control_id=v_control.id AND c.vehicle_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Não é possível trocar o parceiro de um controle com veículos vinculados.' USING ERRCODE='22023';
   END IF;
  END IF;
  RETURN billing_private.cane_weighings_before_fleet(p_action,p_payload);
 END IF;
 PERFORM billing_private.lock_request_actor();PERFORM billing_private.authorize('contracts.write');
 SELECT * INTO v_control FROM public.billing_cane_weighing_controls
  WHERE owner_id=v_owner AND company_id=nullif(p_payload->>'companyId','')::uuid AND id=nullif(p_payload->>'controlId','')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Controle não encontrado.' USING ERRCODE='P0002'; END IF;
 IF jsonb_typeof(p_payload->'components') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Informe os três veículos.' USING ERRCODE='22023'; END IF;
 FOR v_component IN SELECT value FROM jsonb_array_elements(p_payload->'components') LOOP
  PERFORM billing_private.request_payload(v_component,ARRAY['vehicleId','fleetNumber','plate','kind','tareKg','grossKg','partnerNetKg']);
  v_id=nullif(v_component->>'vehicleId','')::uuid;
  IF v_id IS NOT NULL THEN
   SELECT * INTO v_vehicle FROM public.billing_fleet_vehicles WHERE owner_id=v_owner AND id=v_id AND partner_id=v_control.partner_id FOR SHARE;
   IF NOT FOUND OR v_vehicle.kind IS DISTINCT FROM (CASE WHEN v_index=0 THEN 'truck' ELSE 'trailer' END) THEN
    RAISE EXCEPTION 'O veículo deve pertencer ao parceiro do controle e ter o tipo correto.' USING ERRCODE='22023';
   END IF;
   -- Explicit measurements take precedence. Missing fields use the registry.
   -- An existing snapshot reuses its own tare if a client omits it on edit.
   SELECT * INTO v_old FROM public.billing_cane_weighing_components WHERE owner_id=v_owner
    AND entry_id=nullif(p_payload->>'id','')::uuid AND position=v_index AND vehicle_id=v_id;
   v_component=jsonb_build_object('fleetNumber',v_vehicle.internal_code,'plate',v_vehicle.plate,'kind',v_vehicle.kind,
    'tareKg',billing_private.decimal_text(CASE WHEN v_old.id IS NOT NULL THEN v_old.tare_kg ELSE v_vehicle.tare_kg END))||(v_component-'vehicleId');
  ELSE v_component=v_component-'vehicleId'; END IF;
  v_vehicle_ids=array_append(v_vehicle_ids,v_id);v_components=v_components||jsonb_build_array(v_component);v_index=v_index+1;
 END LOOP;
 IF (SELECT count(DISTINCT id) FROM unnest(v_vehicle_ids) AS ids(id) WHERE id IS NOT NULL)
   <>(SELECT count(*) FROM unnest(v_vehicle_ids) AS ids(id) WHERE id IS NOT NULL)
  OR (SELECT count(DISTINCT btrim(c->>'fleetNumber')) FROM jsonb_array_elements(v_components) c WHERE btrim(coalesce(c->>'fleetNumber',''))<>'')
   <>(SELECT count(*) FROM jsonb_array_elements(v_components) c WHERE btrim(coalesce(c->>'fleetNumber',''))<>'') THEN
  RAISE EXCEPTION 'Os três veículos e números de frota da viagem devem ser diferentes.' USING ERRCODE='22023';
 END IF;
 v_result=billing_private.cane_weighings_before_fleet(p_action,jsonb_set(p_payload,'{components}',v_components));
 v_entry_id=(v_result->'entry'->>'id')::uuid;
 UPDATE public.billing_cane_weighing_components SET vehicle_id=v_vehicle_ids[position+1] WHERE owner_id=v_owner AND entry_id=v_entry_id;
 SELECT * INTO v_control FROM public.billing_cane_weighing_controls WHERE owner_id=v_owner AND id=v_control.id;
 RETURN jsonb_build_object('entry',(SELECT billing_private.cane_entry_json(e) FROM public.billing_cane_weighing_entries e WHERE owner_id=v_owner AND id=v_entry_id));
EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Informe identificadores válidos.' USING ERRCODE='22023';
END $$;

-- A known fleet number may identify a vehicle while its plate is pending.
ALTER TABLE public.billing_cane_weighing_components DROP CONSTRAINT billing_cane_weighing_components_plate_check;
ALTER TABLE public.billing_cane_weighing_components ADD CONSTRAINT billing_cane_component_plate CHECK(length(plate)<=12 AND (plate<>'' OR fleet_number<>''));
ALTER TABLE public.billing_cane_weighing_components DROP CONSTRAINT billing_cane_weighing_components_owner_id_entry_id_plate_key;
CREATE UNIQUE INDEX billing_cane_component_known_plate ON public.billing_cane_weighing_components(owner_id,entry_id,plate) WHERE plate<>'';
CREATE OR REPLACE FUNCTION billing_private.cane_weighings_before_fleet(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_owner uuid:=billing_private.current_owner_id();v_company uuid;v_id uuid;v_control_id uuid;v_partner uuid;
 v_control public.billing_cane_weighing_controls;v_entry public.billing_cane_weighing_entries;
 v_start date;v_day date;v_time time;v_season text;v_notes text;v_mode text;v_ticket text;
 v_combined numeric;v_tare numeric;v_gross numeric;v_partner_net numeric;
 v_components jsonb;v_component jsonb;v_normalized jsonb:='[]';v_index integer:=0;
 v_plate text;v_fleet text;v_kind text;v_entries jsonb;v_daily jsonb;v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR v_owner IS NULL THEN
  RAISE EXCEPTION 'Faça login para acessar o sistema.' USING ERRCODE='28000';
 END IF;
 IF p_action IS NULL OR p_action NOT IN ('list','get','save','delete','save-entry','delete-entry') THEN
  RAISE EXCEPTION 'Operação de pesagem inválida.' USING ERRCODE='22023';
 END IF;
 PERFORM billing_private.request_payload(p_payload,CASE
  WHEN p_action='list' THEN ARRAY['companyId']
  WHEN p_action IN ('get','delete') THEN ARRAY['companyId','id']
  WHEN p_action='save' THEN ARRAY['companyId','id','partnerId','startDate','season','notes']
  WHEN p_action='delete-entry' THEN ARRAY['companyId','id','controlId']
  ELSE ARRAY['companyId','id','controlId','weighedAt','weighedTime','ticket','notes','trailerGrossMode','combinedTrailerGrossKg','components'] END);
 IF p_action IN ('list','get') THEN
  PERFORM billing_private.authorize('contracts.read');
 ELSE
  PERFORM billing_private.lock_request_actor();
  PERFORM billing_private.authorize('contracts.write');
 END IF;
 v_company=nullif(p_payload->>'companyId','')::uuid;
 IF v_company IS NULL OR NOT EXISTS(SELECT 1 FROM public.billing_companies WHERE owner_id=v_owner AND id=v_company) THEN
  RAISE EXCEPTION 'Selecione uma empresa válida.' USING ERRCODE='22023';
 END IF;
 IF p_action='list' THEN
  SELECT coalesce(jsonb_agg(billing_private.cane_control_json(c) ORDER BY c.start_date DESC,c.created_at DESC,c.id),'[]')
   INTO v_result FROM public.billing_cane_weighing_controls c WHERE owner_id=v_owner AND company_id=v_company;
  RETURN jsonb_build_object('controls',v_result,'canManage',billing_private.has_permission('contracts.write'));
 END IF;
 v_id=nullif(p_payload->>'id','')::uuid;
 IF p_action='save' THEN
  IF jsonb_typeof(p_payload->'startDate') IS DISTINCT FROM 'string'
   OR (p_payload->>'startDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
   RAISE EXCEPTION 'Informe a data inicial.' USING ERRCODE='22023';
  END IF;
  v_start=(p_payload->>'startDate')::date;
  v_partner=nullif(p_payload->>'partnerId','')::uuid;
  IF v_partner IS NULL OR NOT EXISTS(SELECT 1 FROM public.billing_clients WHERE owner_id=v_owner AND id=v_partner) THEN
   RAISE EXCEPTION 'Selecione um parceiro válido.' USING ERRCODE='22023';
  END IF;
  v_season=coalesce(nullif(btrim(p_payload->>'season'),''),extract(year FROM v_start)::integer||'/'||(extract(year FROM v_start)::integer+1));
  v_notes=coalesce(p_payload->>'notes','');
  IF length(v_season) NOT BETWEEN 4 AND 30 OR length(v_notes)>2000 THEN
   RAISE EXCEPTION 'Verifique a safra e as observações.' USING ERRCODE='22023';
  END IF;
  IF v_id IS NULL THEN
   INSERT INTO public.billing_cane_weighing_controls(owner_id,company_id,partner_id,start_date,season,notes)
   VALUES(v_owner,v_company,v_partner,v_start,v_season,v_notes) RETURNING * INTO v_control;
  ELSE
   SELECT * INTO v_control FROM public.billing_cane_weighing_controls
    WHERE owner_id=v_owner AND company_id=v_company AND id=v_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Controle não encontrado.' USING ERRCODE='P0002'; END IF;
   IF EXISTS(SELECT 1 FROM public.billing_cane_weighing_entries WHERE owner_id=v_owner AND control_id=v_id AND weighed_at<v_start) THEN
    RAISE EXCEPTION 'A data inicial não pode ser posterior aos lançamentos existentes.' USING ERRCODE='22023';
   END IF;
   UPDATE public.billing_cane_weighing_controls SET partner_id=v_partner,start_date=v_start,season=v_season,notes=v_notes
    WHERE owner_id=v_owner AND company_id=v_company AND id=v_id RETURNING * INTO v_control;
  END IF;
  RETURN jsonb_build_object('control',billing_private.cane_control_json(v_control));
 END IF;
 v_control_id=CASE WHEN p_action IN ('save-entry','delete-entry') THEN nullif(p_payload->>'controlId','')::uuid ELSE v_id END;
 IF v_control_id IS NULL THEN RAISE EXCEPTION 'Informe o controle de pesagem.' USING ERRCODE='22023'; END IF;
 -- Locking the parent serializes edits, start-date changes and deletes together.
 SELECT * INTO v_control FROM public.billing_cane_weighing_controls
  WHERE owner_id=v_owner AND company_id=v_company AND id=v_control_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Controle não encontrado.' USING ERRCODE='P0002'; END IF;
 IF p_action='get' THEN
  SELECT coalesce(jsonb_agg(billing_private.cane_entry_json(e) ORDER BY e.weighed_at,e.weighed_time NULLS LAST,e.created_at,e.id),'[]')
   INTO v_entries FROM public.billing_cane_weighing_entries e WHERE owner_id=v_owner AND control_id=v_control_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('date',day)||billing_private.cane_summary(entries) ORDER BY day),'[]')
   INTO v_daily FROM (SELECT e->>'weighedAt' AS day,jsonb_agg(e) AS entries FROM jsonb_array_elements(v_entries) e GROUP BY e->>'weighedAt') days;
  RETURN jsonb_build_object('control',billing_private.cane_control_json(v_control),'entries',v_entries,
   'daily',v_daily,'summary',billing_private.cane_summary(v_entries),'canManage',billing_private.has_permission('contracts.write'));
 END IF;
 IF p_action='delete' THEN
  DELETE FROM public.billing_cane_weighing_controls WHERE owner_id=v_owner AND company_id=v_company AND id=v_id;
  RETURN jsonb_build_object('id',v_id,'deleted',true);
 END IF;
 IF p_action='delete-entry' THEN
  DELETE FROM public.billing_cane_weighing_entries WHERE owner_id=v_owner AND control_id=v_control_id AND id=v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE='P0002'; END IF;
  UPDATE public.billing_cane_weighing_controls SET updated_at=clock_timestamp() WHERE owner_id=v_owner AND id=v_control_id;
  RETURN jsonb_build_object('id',v_id,'deleted',true);
 END IF;
 IF jsonb_typeof(p_payload->'weighedAt') IS DISTINCT FROM 'string'
  OR (p_payload->>'weighedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
  RAISE EXCEPTION 'Informe a data da pesagem.' USING ERRCODE='22023';
 END IF;
 v_day=(p_payload->>'weighedAt')::date;
 IF v_day<v_control.start_date THEN RAISE EXCEPTION 'A pesagem não pode ser anterior ao início do controle.' USING ERRCODE='22023'; END IF;
 IF coalesce(p_payload->>'weighedTime','')<>'' AND (p_payload->>'weighedTime') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
  RAISE EXCEPTION 'Informe um horário válido.' USING ERRCODE='22023';
 END IF;
 v_time=nullif(p_payload->>'weighedTime','')::time;
 v_mode=p_payload->>'trailerGrossMode';
 v_ticket=btrim(coalesce(p_payload->>'ticket',''));v_notes=coalesce(p_payload->>'notes','');
 IF v_mode IS NULL OR v_mode NOT IN ('combined','individual') OR length(v_ticket)>100 OR length(v_notes)>2000 THEN
  RAISE EXCEPTION 'Verifique o modo de pesagem e as observações.' USING ERRCODE='22023';
 END IF;
 v_combined=billing_private.cane_weight(p_payload->'combinedTrailerGrossKg');
 IF v_mode='individual' AND v_combined IS NOT NULL THEN
  RAISE EXCEPTION 'O bruto conjunto só é utilizado no modo conjunto.' USING ERRCODE='22023';
 END IF;
 v_components=p_payload->'components';
 IF jsonb_typeof(v_components) IS DISTINCT FROM 'array' OR jsonb_array_length(v_components)<>3 THEN
  RAISE EXCEPTION 'Informe um caminhão e dois reboques para a viagem.' USING ERRCODE='22023';
 END IF;
 FOR v_component IN SELECT value FROM jsonb_array_elements(v_components) LOOP
  PERFORM billing_private.request_payload(v_component,ARRAY['fleetNumber','plate','kind','tareKg','grossKg','partnerNetKg']);
  IF jsonb_typeof(v_component->'plate') IS DISTINCT FROM 'string'
   OR jsonb_typeof(v_component->'kind') IS DISTINCT FROM 'string'
   OR (v_component ? 'fleetNumber' AND jsonb_typeof(v_component->'fleetNumber')<>'string') THEN
   RAISE EXCEPTION 'Informe a identificação de cada veículo.' USING ERRCODE='22023';
  END IF;
  v_plate=upper(regexp_replace(btrim(v_component->>'plate'),'[-[:space:]]','','g'));
  v_fleet=btrim(coalesce(v_component->>'fleetNumber',''));v_kind=v_component->>'kind';
  IF (v_plate<>'' AND v_plate !~ '^[A-Z0-9]{1,12}$') OR (v_plate='' AND v_fleet='') OR length(v_fleet)>60
   OR v_kind IS DISTINCT FROM (CASE WHEN v_index=0 THEN 'truck' ELSE 'trailer' END) THEN
   RAISE EXCEPTION 'Informe o caminhão seguido dos dois reboques e placas válidas.' USING ERRCODE='22023';
  END IF;
  v_tare=billing_private.cane_weight(v_component->'tareKg');
  v_gross=billing_private.cane_weight(v_component->'grossKg');
  v_partner_net=billing_private.cane_weight(v_component->'partnerNetKg');
  IF v_kind='trailer' AND v_mode='combined' THEN
   -- The original shared measurement stays on the entry; no rounded copy is stored.
   IF v_gross IS NOT NULL THEN RAISE EXCEPTION 'Use o campo bruto conjunto para os reboques.' USING ERRCODE='22023'; END IF;
   IF v_tare IS NOT NULL AND v_combined IS NOT NULL AND v_combined/2<v_tare THEN
    RAISE EXCEPTION 'O bruto de cada reboque não pode ser menor que a tara.' USING ERRCODE='22023';
   END IF;
  ELSIF v_tare IS NOT NULL AND v_gross IS NOT NULL AND v_gross<v_tare THEN
   RAISE EXCEPTION 'O peso bruto não pode ser menor que a tara.' USING ERRCODE='22023';
  END IF;
  v_normalized=v_normalized||jsonb_build_array(jsonb_build_object('position',v_index,'fleetNumber',v_fleet,'plate',v_plate,
   'kind',v_kind,'tareKg',v_tare,'grossKg',v_gross,'partnerNetKg',v_partner_net));
  v_index=v_index+1;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'plate') FROM jsonb_array_elements(v_normalized) WHERE value->>'plate'<>'')<>(SELECT count(*) FROM jsonb_array_elements(v_normalized) WHERE value->>'plate'<>'') THEN
  RAISE EXCEPTION 'As três placas da viagem devem ser diferentes.' USING ERRCODE='22023';
 END IF;
 IF v_id IS NULL THEN
  INSERT INTO public.billing_cane_weighing_entries(owner_id,control_id,weighed_at,weighed_time,ticket,notes,trailer_gross_mode,combined_trailer_gross_kg)
   VALUES(v_owner,v_control_id,v_day,v_time,v_ticket,v_notes,v_mode,v_combined) RETURNING * INTO v_entry;
 ELSE
  UPDATE public.billing_cane_weighing_entries SET weighed_at=v_day,weighed_time=v_time,ticket=v_ticket,notes=v_notes,
   trailer_gross_mode=v_mode,combined_trailer_gross_kg=v_combined
   WHERE owner_id=v_owner AND control_id=v_control_id AND id=v_id RETURNING * INTO v_entry;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE='P0002'; END IF;
  DELETE FROM public.billing_cane_weighing_components WHERE owner_id=v_owner AND entry_id=v_id;
 END IF;
 INSERT INTO public.billing_cane_weighing_components(owner_id,entry_id,position,fleet_number,plate,kind,tare_kg,gross_kg,partner_net_kg)
 SELECT v_owner,v_entry.id,(value->>'position')::integer,value->>'fleetNumber',value->>'plate',value->>'kind',
  (value->>'tareKg')::numeric,(value->>'grossKg')::numeric,(value->>'partnerNetKg')::numeric FROM jsonb_array_elements(v_normalized);
 UPDATE public.billing_cane_weighing_controls SET updated_at=clock_timestamp() WHERE owner_id=v_owner AND id=v_control_id;
 RETURN jsonb_build_object('entry',billing_private.cane_entry_json(v_entry));
EXCEPTION
 WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Verifique os identificadores, datas e pesos informados.' USING ERRCODE='22023';
 WHEN unique_violation THEN
  RAISE EXCEPTION 'Já existe um controle para este parceiro e data, ou um lançamento com este comprovante.' USING ERRCODE='23505';
END $$;


REVOKE ALL ON FUNCTION billing_private.cane_entry_json_before_fleet(public.billing_cane_weighing_entries),
 billing_private.cane_summary_before_fleet(jsonb),billing_private.cane_weighings_before_fleet(text,jsonb),
 billing_private.cane_import(jsonb),billing_private.cane_entry_json(public.billing_cane_weighing_entries),
 billing_private.cane_summary(jsonb),billing_private.cane_weighings_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.cane_weighings_dispatch(text,jsonb) TO authenticated;

