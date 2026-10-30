BEGIN;
DO $contracts$
DECLARE definition text:=pg_get_functiondef('billing_private.summary_weekly(jsonb)'::regprocedure);
 load_anchor text:='SELECT l.id,l.loaded_at,l.volume';
 json_anchor text:='''totals'',t.value,';
BEGIN
 IF strpos(definition,load_anchor)=0 OR strpos(definition,json_anchor)=0 OR strpos(definition,'contractProgress')>0 THEN RAISE EXCEPTION 'Inspect weekly projection before contract progress.'; END IF;
 definition:=replace(definition,load_anchor,'SELECT l.id,l.contract_id,l.loaded_at,l.volume');
 definition:=replace(definition,json_anchor,json_anchor||$json$
  'contractProgress',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'contractNumber',s.contract_number,'title',s.title,'clientName',s.client_name,
   'contractedVolume',coalesce(billing_private.decimal_text(s.contracted_volume),''),
   'deliveredVolume',billing_private.decimal_text(coalesce((SELECT sum(l.volume) FROM public.billing_contract_loads l WHERE l.owner_id=v_owner AND l.contract_id=s.id AND l.loaded_at<=v_to),0)),
   'weeklyVolume',billing_private.decimal_text(coalesce((SELECT sum(l.volume) FROM financial_loads l WHERE l.contract_id=s.id AND l.loaded_at BETWEEN v_from AND v_to),0)))
   ORDER BY lower(s.client_name),s.contract_number,s.id) FROM selected s),'[]'::jsonb),$json$);
 EXECUTE definition;
END $contracts$;
COMMIT;
