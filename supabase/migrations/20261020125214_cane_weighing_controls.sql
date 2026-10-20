-- Cane weighing controls reproduce the AGRISUL / partner comparison workbook.
-- All inputs are kilograms; the shared gross of two trailers is divided equally,
-- as in the workbook. Missing measurements remain pending rather than zero.
CREATE TABLE public.billing_cane_weighing_controls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 company_id uuid NOT NULL,
 partner_id uuid NOT NULL,
 start_date date NOT NULL,
 season text NOT NULL CHECK(length(season) BETWEEN 4 AND 30),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id),
 UNIQUE(owner_id,company_id,partner_id,start_date),
 FOREIGN KEY(owner_id,company_id) REFERENCES public.billing_companies(owner_id,id),
 FOREIGN KEY(owner_id,partner_id) REFERENCES public.billing_clients(owner_id,id)
);
CREATE INDEX billing_cane_controls_company_date ON public.billing_cane_weighing_controls(owner_id,company_id,start_date DESC,id);
CREATE INDEX billing_cane_controls_partner ON public.billing_cane_weighing_controls(owner_id,partner_id);

CREATE TABLE public.billing_cane_weighing_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 control_id uuid NOT NULL,
 weighed_at date NOT NULL,
 weighed_time time(0),
 ticket text NOT NULL DEFAULT '' CHECK(length(ticket)<=100),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 trailer_gross_mode text NOT NULL CHECK(trailer_gross_mode IN ('combined','individual')),
 combined_trailer_gross_kg numeric(18,6) CHECK(combined_trailer_gross_kg>=0 AND combined_trailer_gross_kg<1000000),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id),
 FOREIGN KEY(owner_id,control_id) REFERENCES public.billing_cane_weighing_controls(owner_id,id) ON DELETE CASCADE,
 CHECK(trailer_gross_mode='combined' OR combined_trailer_gross_kg IS NULL)
);
CREATE INDEX billing_cane_entries_control_date ON public.billing_cane_weighing_entries(owner_id,control_id,weighed_at,weighed_time,id);
CREATE UNIQUE INDEX billing_cane_entries_ticket ON public.billing_cane_weighing_entries(owner_id,control_id,lower(ticket)) WHERE ticket<>'';

CREATE TABLE public.billing_cane_weighing_components (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 entry_id uuid NOT NULL,
 position integer NOT NULL CHECK(position BETWEEN 0 AND 2),
 fleet_number text NOT NULL DEFAULT '' CHECK(length(fleet_number)<=60),
 plate text NOT NULL CHECK(length(plate) BETWEEN 1 AND 12),
 kind text NOT NULL CHECK(kind IN ('truck','trailer')),
 tare_kg numeric(18,6) CHECK(tare_kg>=0 AND tare_kg<1000000),
 gross_kg numeric(18,6) CHECK(gross_kg>=0 AND gross_kg<1000000),
 partner_net_kg numeric(18,6) CHECK(partner_net_kg>=0 AND partner_net_kg<1000000),
 UNIQUE(owner_id,entry_id,position),
 UNIQUE(owner_id,entry_id,plate),
 FOREIGN KEY(owner_id,entry_id) REFERENCES public.billing_cane_weighing_entries(owner_id,id) ON DELETE CASCADE,
 CHECK((position=0 AND kind='truck') OR (position IN (1,2) AND kind='trailer')),
 CHECK(tare_kg IS NULL OR gross_kg IS NULL OR gross_kg>=tare_kg)
);

DO $$ DECLARE v_table text; BEGIN
 FOREACH v_table IN ARRAY ARRAY['billing_cane_weighing_controls','billing_cane_weighing_entries','billing_cane_weighing_components'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',v_table);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',v_table);
  EXECUTE format('CREATE POLICY billing_cane_read ON public.%I FOR SELECT TO authenticated USING (billing_private.can_access_owner(owner_id,''contracts.read''))',v_table);
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
   AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=v_table) THEN
   EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',v_table);
  END IF;
 END LOOP;
END $$;
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_cane_weighing_controls
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();
CREATE TRIGGER billing_touch_updated_at BEFORE UPDATE ON public.billing_cane_weighing_entries
 FOR EACH ROW EXECUTE FUNCTION billing_private.touch_updated_at();

-- Inputs follow the paper (16.680 means 16680 kg). Commas mark fractional kg.
-- Canonical decimal strings without a thousands grouping are accepted too.
CREATE FUNCTION billing_private.cane_weight(p_value jsonb) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v_text text;v_value numeric;
BEGIN
 IF p_value IS NULL OR p_value='null'::jsonb THEN RETURN NULL; END IF;
 IF jsonb_typeof(p_value) NOT IN ('string','number') THEN
  RAISE EXCEPTION 'Informe um peso válido em kg.' USING ERRCODE='22023';
 END IF;
 v_text=btrim(p_value#>>'{}');
 IF v_text='' THEN RETURN NULL; END IF;
 IF v_text ~ '^[0-9]{1,3}([.][0-9]{3})+(,[0-9]{1,6})?$' THEN
  v_text=replace(replace(v_text,'.',''),',','.');
 ELSIF v_text ~ '^[0-9]+(,[0-9]{1,6})?$' THEN
  v_text=replace(v_text,',','.');
 ELSIF v_text !~ '^[0-9]+([.][0-9]{1,6})?$' THEN
  RAISE EXCEPTION 'Informe um peso válido em kg.' USING ERRCODE='22023';
 END IF;
 v_value=v_text::numeric;
 IF v_value<0 OR v_value>=1000000 OR scale(v_value)>6 THEN
  RAISE EXCEPTION 'O peso deve ser positivo e inferior a 1.000.000 kg.' USING ERRCODE='22023';
 END IF;
 RETURN v_value;
END $$;

CREATE FUNCTION billing_private.cane_entry_json(p_entry public.billing_cane_weighing_entries) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH measured AS (
  SELECT c.*,CASE WHEN c.kind='trailer' AND p_entry.trailer_gross_mode='combined'
   THEN p_entry.combined_trailer_gross_kg/2 ELSE c.gross_kg END AS measured_gross
  FROM public.billing_cane_weighing_components c
  WHERE c.owner_id=p_entry.owner_id AND c.entry_id=p_entry.id
 ), calculated AS (
  SELECT m.*,measured_gross-tare_kg AS net FROM measured m
 ), totals AS (
  SELECT count(*)=3 AND count(net)=3 AS agrisul_complete,
   count(*)=3 AND count(partner_net_kg)=3 AS partner_complete,
   CASE WHEN count(*)=3 AND count(net)=3 THEN sum(net) END AS agrisul,
   sum(partner_net_kg) AS partner,
   coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'fleetNumber',fleet_number,'plate',plate,'kind',kind,
    'tareKg',billing_private.decimal_text(tare_kg),'grossKg',billing_private.decimal_text(measured_gross),
    'netKg',billing_private.decimal_text(net),'partnerNetKg',billing_private.decimal_text(partner_net_kg),
    'differenceKg',billing_private.decimal_text(partner_net_kg-net),
    'differencePercent',billing_private.decimal_text(round((partner_net_kg/nullif(net,0)-1)*100,6))
   ) ORDER BY position),'[]'::jsonb) AS components
  FROM calculated
 )
 SELECT jsonb_build_object(
  'id',p_entry.id,'controlId',p_entry.control_id,
  'weighedAt',p_entry.weighed_at,'weighedTime',coalesce(to_char(p_entry.weighed_time,'HH24:MI'),''),
  'ticket',p_entry.ticket,'notes',p_entry.notes,'trailerGrossMode',p_entry.trailer_gross_mode,
  'combinedTrailerGrossKg',billing_private.decimal_text(p_entry.combined_trailer_gross_kg),
  'createdAt',p_entry.created_at,'updatedAt',p_entry.updated_at,'components',components,
  'agrisulComplete',agrisul_complete,'partnerComplete',partner_complete,
  'agrisulNetKg',billing_private.decimal_text(agrisul),'partnerNetKg',billing_private.decimal_text(partner),
  'differenceKg',CASE WHEN agrisul_complete AND partner_complete THEN billing_private.decimal_text(partner-agrisul) END,
  'differencePercent',CASE WHEN agrisul_complete AND partner_complete THEN billing_private.decimal_text(round((partner/nullif(agrisul,0)-1)*100,6)) END
 ) FROM totals
$$;

CREATE FUNCTION billing_private.cane_summary(p_entries jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 WITH totals AS (
  SELECT count(*) AS entry_count,
   count(*) FILTER(WHERE (e->>'agrisulComplete')::boolean AND (e->>'partnerComplete')::boolean) AS complete_count,
   coalesce(sum((e->>'agrisulNetKg')::numeric),0) AS agrisul,
   coalesce(sum((e->>'partnerNetKg')::numeric),0) AS partner
  FROM jsonb_array_elements(p_entries) e
 ) SELECT jsonb_build_object(
  'entryCount',entry_count,'completeCount',complete_count,'pendingCount',entry_count-complete_count,
  'agrisulNetKg',billing_private.decimal_text(agrisul),'partnerNetKg',billing_private.decimal_text(partner),
  'differenceKg',CASE WHEN entry_count>0 AND complete_count=entry_count THEN billing_private.decimal_text(partner-agrisul) END,
  'differencePercent',CASE WHEN entry_count>0 AND complete_count=entry_count THEN billing_private.decimal_text(round((partner/nullif(agrisul,0)-1)*100,6)) END
 ) FROM totals
$$;

CREATE FUNCTION billing_private.cane_control_json(p_control public.billing_cane_weighing_controls) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p_control.id,'companyId',p_control.company_id,'partnerId',p_control.partner_id,
  'partnerName',coalesce(nullif(c.trade_name,''),c.legal_name),
  'startDate',p_control.start_date,'season',p_control.season,'notes',p_control.notes,
  'createdAt',p_control.created_at,'updatedAt',p_control.updated_at,
  'summary',billing_private.cane_summary(coalesce((
   SELECT jsonb_agg(billing_private.cane_entry_json(e))
   FROM public.billing_cane_weighing_entries e WHERE e.owner_id=p_control.owner_id AND e.control_id=p_control.id
  ),'[]'::jsonb))
 ) FROM public.billing_clients c WHERE c.owner_id=p_control.owner_id AND c.id=p_control.partner_id
$$;

CREATE FUNCTION billing_private.cane_weighings_dispatch(p_action text,p_payload jsonb) RETURNS jsonb
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
  IF v_plate !~ '^[A-Z0-9]{1,12}$' OR length(v_fleet)>60
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
 IF (SELECT count(DISTINCT value->>'plate') FROM jsonb_array_elements(v_normalized))<>3 THEN
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

REVOKE ALL ON FUNCTION billing_private.cane_weight(jsonb),billing_private.cane_entry_json(public.billing_cane_weighing_entries),
 billing_private.cane_summary(jsonb),billing_private.cane_control_json(public.billing_cane_weighing_controls),
 billing_private.cane_weighings_dispatch(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.cane_weighings_dispatch(text,jsonb) TO authenticated;

-- Extend the existing dispatcher chain; the public SECURITY INVOKER wrapper and
-- its onboarding/session guards are left intact.
ALTER FUNCTION billing_private.dispatch(text,text,jsonb) RENAME TO dispatch_before_cane_weighings;
REVOKE ALL ON FUNCTION billing_private.dispatch_before_cane_weighings(text,text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION billing_private.dispatch(p_resource text,p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_resource='cane-weighings' THEN RETURN billing_private.cane_weighings_dispatch(p_action,p_payload); END IF;
 RETURN billing_private.dispatch_before_cane_weighings(p_resource,p_action,p_payload);
END $$;
REVOKE ALL ON FUNCTION billing_private.dispatch(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION billing_private.dispatch(text,text,jsonb) TO authenticated;
COMMENT ON TABLE public.billing_cane_weighing_controls IS 'Company and partner weighing controls, created from an initial date. RPC-only writes.';
COMMENT ON TABLE public.billing_cane_weighing_entries IS 'Truck plus two trailers. Shared trailer gross is allocated equally to reproduce the source workbook; all measurements are kilograms.';
