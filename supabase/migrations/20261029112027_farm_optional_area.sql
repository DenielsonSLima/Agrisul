-- Unknown farm size is NULL; supplied sizes and plot sizes remain positive.
ALTER TABLE public.billing_farms ALTER COLUMN area_ha DROP NOT NULL;

-- Patch only the existing area parser and optional-capacity projection. Keep
-- field allowlists, owner authorization, advisory locks and farm row locks.
DO $migration$
DECLARE
 definition text:=pg_get_functiondef('billing_private.dispatch_before_fleet(text,text,jsonb)'::regprocedure);
 anchor text:=$anchor$    v_text=replace(btrim(p_payload->>'areaHa'),',','.');
    IF v_text IS NULL OR v_text !~ '^[0-9]{1,9}([.][0-9]{1,6})?$' OR v_text::numeric<=0 THEN RAISE EXCEPTION 'Informe uma área maior que zero, com até seis casas decimais.' USING ERRCODE='22023'; END IF;
    v_area=v_text::numeric; v_data=v_data||jsonb_build_object('area_ha',v_area);$anchor$;
 replacement text:=$replacement$    v_text=replace(btrim(p_payload->>'areaHa'),',','.');
    IF v_resource='farms' AND NOT (p_payload ? 'areaHa') THEN
     v_area=(v_existing->>'area_ha')::numeric;
    ELSIF v_resource='farms' AND coalesce(v_text,'')='' THEN
     v_area=NULL;
    ELSE
     IF v_text IS NULL OR v_text !~ '^[0-9]{1,9}([.][0-9]{1,6})?$' OR v_text::numeric<=0 THEN RAISE EXCEPTION 'Informe uma área maior que zero, com até seis casas decimais.' USING ERRCODE='22023'; END IF;
     v_area=v_text::numeric;
    END IF;
    v_data=v_data||jsonb_build_object('area_ha',v_area);$replacement$;
 capacity_anchor text:=$anchor$'usedPercent',round(v_used/v_total*100,4),'canAddPlot',v_used<v_total$anchor$;
BEGIN
 IF strpos(definition,anchor)=0 OR strpos(definition,capacity_anchor)=0 THEN
  RAISE EXCEPTION 'Farm optional area dispatcher anchors missing';
 END IF;
 definition=replace(definition,anchor,replacement);
 definition=replace(definition,capacity_anchor,$replacement$'usedPercent',coalesce(round(v_used/v_total*100,4),0),'canAddPlot',v_total IS NULL OR v_used<v_total$replacement$);
 EXECUTE definition;
END $migration$;

-- A portfolio with unknown sizes must not present a partial sum as a total.
DO $migration$
DECLARE
 definition text:=pg_get_functiondef('billing_private.farm_summary_list()'::regprocedure);
 anchors text[]:=ARRAY[
  'CASE WHEN f.area_ha=0 THEN 0',
  'billing_private.decimal_text(coalesce(sum(t.area_ha),0))',
  'billing_private.decimal_text(coalesce(sum(t.area_ha-t.used_ha),0))',
  'CASE WHEN coalesce(sum(t.area_ha),0)=0 THEN 0'
 ];
 replacements text[]:=ARRAY[
  'CASE WHEN f.area_ha IS NULL OR f.area_ha=0 THEN 0',
  'billing_private.decimal_text(CASE WHEN count(*)=count(t.area_ha) THEN coalesce(sum(t.area_ha),0) END)',
  'billing_private.decimal_text(CASE WHEN count(*)=count(t.area_ha) THEN coalesce(sum(t.area_ha-t.used_ha),0) END)',
  'CASE WHEN count(*)<>count(t.area_ha) OR coalesce(sum(t.area_ha),0)=0 THEN 0'
 ];
BEGIN
 FOR i IN 1..array_length(anchors,1) LOOP
  IF strpos(definition,anchors[i])=0 THEN RAISE EXCEPTION 'Farm summary anchor % missing',i; END IF;
  definition=replace(definition,anchors[i],replacements[i]);
 END LOOP;
 EXECUTE definition;
END $migration$;
