BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('81818181-8181-4181-8181-818181818181','load-report@example.invalid',now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81818181-8181-4181-8181-818181818181',true);
DO $$
DECLARE
 company uuid;client uuid;kind uuid;farm_a uuid;farm_b uuid;plot_a uuid;plot_b uuid;contract_a uuid;contract_b uuid;
 scope jsonb;input jsonb;r jsonb;full_report jsonb;filtered_gross text;full_gross text;group_item jsonb;key text;
 details jsonb:='{"tradeName":"","cnpj":"","street":"","number":"","complement":"","district":"","city":"","state":"","zipCode":"","phone":"","email":""}';
BEGIN
 company=(public.billing_rpc('companies','save',details||'{"legalName":"Empresa relatório","isPrimary":true}')->'company'->>'id')::uuid;
 client=(public.billing_rpc('clients','save',details||'{"legalName":"Cliente Açúcar","cnpj":"99888777000166","status":"Ativo"}')->'client'->>'id')::uuid;
 PERFORM public.billing_rpc('contract-types','save','{"name":"Tipo relatório","stages":[]}');
 kind=(public.billing_rpc('contract-types','list')->'types'->0->>'id')::uuid;
 farm_a=(public.billing_rpc('farms','save','{"name":"Fazenda São José","areaHa":"30","city":"Cidade","state":"SP"}')->'farm'->>'id')::uuid;
 farm_b=(public.billing_rpc('farms','save','{"name":"Fazenda Boa Vista","areaHa":"20","city":"Cidade","state":"SP"}')->'farm'->>'id')::uuid;
 plot_a=(public.billing_rpc('plots','save',jsonb_build_object('farmId',farm_a,'name','Talhão 01','areaHa','10'))->'data'->'plots'->0->>'id')::uuid;
 plot_b=(public.billing_rpc('plots','save',jsonb_build_object('farmId',farm_b,'name','Talhão 02','areaHa','10'))->'data'->'plots'->0->>'id')::uuid;
 PERFORM public.billing_rpc('atr','save','{"year":2026,"month":10,"monthlyGrossValue":"2","monthlyNetValue":"2","accumulatedGrossValue":"2","accumulatedNetValue":"2"}');
 scope=jsonb_build_object('companyId',company);
 input=jsonb_build_object('title','Contrato Norte','contractNumber','CTR-A','companyId',company,'clientId',client,'typeId',kind,'startDate','2026-01-01','endDate','2026-12-31','contractedVolume','1000','value','','notes','','atrPriceType','gross','atrPeriodType','monthly');
 contract_a=(public.billing_rpc('contracts','save',input)->'contract'->>'id')::uuid;
 contract_b=(public.billing_rpc('contracts','save',input||'{"title":"Contrato Sul","contractNumber":"CTR-B"}')->'contract'->>'id')::uuid;
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('contractId',contract_a,'farmId',farm_a,'plotId',plot_a,'loadedAt','2026-11-15','volume','10','atr','100','document','ROM-15-A','notes','Carga especial'));
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('contractId',contract_a,'farmId',farm_a,'plotId',plot_a,'loadedAt','2026-11-16','volume','5','atr','120','document','ROM-16-A','notes',''));
 PERFORM public.billing_rpc('contracts','save-load',scope||jsonb_build_object('contractId',contract_b,'farmId',farm_b,'plotId',plot_b,'loadedAt','2026-11-15','volume','20','atr','150','document','ROM-15-B','notes',''));
 PERFORM public.billing_rpc('contracts','save-discount',scope||jsonb_build_object('contractId',contract_a,'requestId',gen_random_uuid(),'title','Desconto','ratePerTon','3','months',jsonb_build_array('2026-11'),'notes',''));

 full_report=public.billing_rpc('reports','list',scope||'{"kind":"loads","from":"2026-11-15","to":"2026-11-16","search":"","farmId":"","plotId":""}');
 r=public.billing_rpc('reports','list',scope||'{"kind":"loads","from":"2026-11-15","to":"2026-11-15","search":"","farmId":"","plotId":""}');
 IF r->>'total'<>'2' OR r->'period'->>'from'<>'2026-11-15' OR r->'period'->>'to'<>'2026-11-15' OR jsonb_array_length(r->'groups')<>2 THEN RAISE EXCEPTION 'Inclusive single-day grouping wrong: %',r; END IF;
 IF r->'totals'->>'volume'<>'30' OR r->'totals'->>'averageAtr'<>'133.333333' OR r->'totals'->>'grossAmount'<>'8000' OR r->'totals'->>'discountAmount'<>'30' OR r->'totals'->>'netAmount'<>'7970' THEN RAISE EXCEPTION 'Single-day KPIs wrong: %',r->'totals'; END IF;
 FOREACH key IN ARRAY ARRAY['volume','averageAtr','grossAmount','discountAmount','netAmount'] LOOP
  IF jsonb_typeof(r->'totals'->key)<>'string' THEN RAISE EXCEPTION 'Decimal must remain text: %',key; END IF;
 END LOOP;
 FOR group_item IN SELECT value FROM jsonb_array_elements(r->'groups') LOOP
  IF group_item->'totals'->>'loadCount'<>'1' OR jsonb_array_length(group_item->'loads')<>1 THEN RAISE EXCEPTION 'Contract subtotal wrong: %',group_item; END IF;
 END LOOP;
 IF jsonb_array_length(r->'origins')<>2 THEN RAISE EXCEPTION 'Origins were filtered by current date'; END IF;

 r=public.billing_rpc('reports','list',scope||'{"kind":"loads","from":"2026-11-15","search":"","farmId":"","plotId":""}');
 IF r->>'total'<>'2' OR r->'period'->>'to'<>'2026-11-15' THEN RAISE EXCEPTION 'Single supplied date must become one day'; END IF;
 r=public.billing_rpc('reports','list',scope||jsonb_build_object('kind','loads','from','2026-11-01','to','2026-11-30','search','sao jose','farmId','','plotId',''));
 IF r->>'total'<>'2' THEN RAISE EXCEPTION 'Accent-insensitive search failed'; END IF;
 r=public.billing_rpc('reports','list',scope||jsonb_build_object('kind','loads','from','2026-11-01','to','2026-11-30','search','','farmId',farm_b,'plotId',plot_b));
 IF r->>'total'<>'1' OR r->'groups'->0->>'contractNumber'<>'CTR-B' THEN RAISE EXCEPTION 'Farm/plot filter failed'; END IF;
 r=public.billing_rpc('reports','list',scope||'{"kind":"loads","from":"2026-11-01","to":"2026-11-30","search":"%","farmId":"","plotId":""}');
 IF r->>'total'<>'0' THEN RAISE EXCEPTION 'Search wildcard was not treated literally'; END IF;

 SELECT load->>'grossAmount' INTO full_gross FROM jsonb_array_elements(full_report->'groups') g CROSS JOIN LATERAL jsonb_array_elements(g->'loads') load WHERE load->>'document'='ROM-15-A';
 r=public.billing_rpc('reports','list',scope||'{"kind":"loads","from":"2026-11-15","to":"2026-11-15","search":"ROM-15-A","farmId":"","plotId":""}');
 filtered_gross=r->'groups'->0->'loads'->0->>'grossAmount';
 IF filtered_gross IS DISTINCT FROM full_gross THEN RAISE EXCEPTION 'Filtering changed allocated load value'; END IF;

 BEGIN PERFORM public.billing_rpc('reports','list',scope||jsonb_build_object('kind','loads','from','2026-11-15','to','2026-11-15','search','','farmId','','plotId',plot_a));RAISE EXCEPTION 'Plot without farm accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('reports','list',scope||jsonb_build_object('kind','loads','from','2026-11-15','to','2026-11-15','search','','farmId',farm_a,'plotId',plot_b));RAISE EXCEPTION 'Cross-farm plot accepted';EXCEPTION WHEN no_data_found THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('reports','list',scope||'{"kind":"loads","from":"2026-11-16","to":"2026-11-15","search":"","farmId":"","plotId":""}');RAISE EXCEPTION 'Inverted period accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.billing_rpc('reports','list',scope||'{"kind":"loads","from":"2026-11-15","to":"2026-11-15","search":"","farmId":"","plotId":"","owner_id":"x"}');RAISE EXCEPTION 'Owner injection accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
END $$;
ROLLBACK;
