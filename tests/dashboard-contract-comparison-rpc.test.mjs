import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('contract comparison uses contract snapshots, exact weighted ATR and every authorized Dashboard filter',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async payload=>(await db.query("SELECT public.billing_rpc('summary','dashboard',$1::jsonb) result",[JSON.stringify(payload)])).rows[0].result;
 const deny=(payload,code)=>assert.rejects(()=>rpc(payload),error=>error.code===code);
 const byCode=(comparison,code)=>comparison.types.find(row=>row.code===code);
 const byClient=(comparison,id)=>comparison.clients.find(row=>row.id===id);
 try{
  await db.exec('RESET ROLE');
  const insert=async(sql,args)=>(await db.query(sql,args)).rows[0].id;
  const kind=await insert("INSERT INTO public.billing_contract_types(owner_id,name,stages) VALUES($1,'Tipo atual renomeado','[]') RETURNING id",[ids.owner]);
  const partner=await insert("INSERT INTO public.billing_clients(owner_id,legal_name,cnpj) VALUES($1,'Segundo cliente comparativo','11111111111111') RETURNING id",[ids.owner]);
  const siblingPartner=await insert("INSERT INTO public.billing_clients(owner_id,legal_name,cnpj) VALUES($1,'Cliente exclusivo da filial','22222222222222') RETURNING id",[ids.owner]);
  const farm=async name=>insert("INSERT INTO public.billing_farms(owner_id,name,area_ha,city,state) VALUES($1,$2,100,'Capela','SE') RETURNING id",[ids.owner,name]);
  const plot=async(farmId,name)=>insert('INSERT INTO public.billing_farm_plots(owner_id,farm_id,name,area_ha) VALUES($1,$2,$3,10) RETURNING id',[ids.owner,farmId,name]);
  const farmA=await farm('Origem comparação A'),farmB=await farm('Origem comparação B'),siblingFarm=await farm('Origem exclusiva filial');
  const pa1=await plot(farmA,'Talhão A1'),pa2=await plot(farmA,'Talhão A2'),pb1=await plot(farmB,'Talhão B1'),siblingPlot=await plot(siblingFarm,'Talhão filial');
  const contract=async(clientId,typeName,status='Ativo',companyId=ids.company)=>insert("INSERT INTO public.billing_contracts(owner_id,title,company_id,client_id,type_id,type_name,stages,status,start_date,contracted_volume) VALUES($1,'Contrato comparação',$2,$3,$4,$5,'[]',$6,'2026-01-01',1000) RETURNING id",[ids.owner,companyId,clientId,kind,typeName,status]);
  const manualA=await contract(ids.partner,'MANUAL'),manualB=await contract(partner,'MANUAL','Concluído'),mechanizedA=await contract(ids.partner,'Mecanizada'),mechanizedB=await contract(partner,'MACANIZADO','Concluído');
  const unclassified=await contract(ids.partner,'Cana'),ambiguous=await contract(partner,'Manual e Mecanizado'),empty=await contract(ids.partner,'MANUAL'),sibling=await contract(siblingPartner,'MANUAL','Ativo',ids.siblingCompany);
  await db.query("UPDATE public.billing_contracts SET title='MANUAL no título não define modalidade' WHERE id=$1",[unclassified]);
  const load=async(contractId,farmId,plotId,date,volume,atr,method)=>insert('INSERT INTO public.billing_contract_loads(owner_id,contract_id,farm_id,plot_id,loaded_at,volume,atr,harvest_method) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[ids.owner,contractId,farmId,plotId,date,volume,atr,method]);
  // These deliberately disagree with the contract snapshot. The comparison is
  // about contract types, while harvestMethods continues to classify each load.
  await load(manualA,farmA,pa1,'2026-10-01','10.001','100.123456','2');
  await load(manualA,farmA,pa2,'2026-10-02','30.002','140.654321',null);
  await load(manualB,farmB,pb1,'2026-10-03','20.003','160.765432','1');
  await load(mechanizedA,farmA,pa1,'2026-10-04','20.004','150.876543','1');
  await load(mechanizedB,farmB,pb1,'2026-10-05','30.005',null,'2');
  await load(unclassified,farmA,pa2,'2026-10-06','5.006','110.987654','1');
  await load(ambiguous,farmB,pb1,'2026-10-07','7.007','120.234567','2');
  await load(manualA,farmB,pb1,'2026-09-10','90','999','1');
  await load(sibling,siblingFarm,siblingPlot,'2026-10-01','999','999','1');
  await setActor();
  const scope={companyId:ids.company,from:'2026-10-01',to:'2026-10-31'},summary=await rpc(scope),all=summary.contractComparison;
  assert.ok(all,'The Dashboard must return its authorized contract comparison');
  assert.deepEqual(all.overall,{loadedVolume:'122.028',averageAtr:'',loadCount:7,contractCount:7});
  assert.deepEqual(all.types.map(row=>[row.code,row.label]),[['1','Manual'],['2','Mecanizada'],['unknown','Não classificado']]);
  const manual=byCode(all,'1'),mechanized=byCode(all,'2'),unknown=byCode(all,'unknown');
  assert.equal(manual.loadedVolume,'60.006');assert.equal(manual.averageAtr,'140.603216');assert.equal(manual.loadCount,3);assert.equal(manual.contractCount,3);assert.equal(manual.sharePercent,'49.17');
  assert.equal(mechanized.loadedVolume,'50.009');assert.equal(mechanized.averageAtr,'');assert.equal(mechanized.loadCount,2);assert.equal(mechanized.contractCount,2);assert.equal(mechanized.sharePercent,'40.98');
  assert.equal(unknown.loadedVolume,'12.013');assert.equal(unknown.averageAtr,'116.381238');assert.equal(unknown.loadCount,2);assert.equal(unknown.contractCount,2);assert.equal(unknown.sharePercent,'9.84');
  assert.equal(summary.operationalTotals.loadedVolume,all.overall.loadedVolume);assert.equal(summary.operationalTotals.averageAtr,all.overall.averageAtr);
  assert.notEqual(summary.harvestMethods.find(row=>row.code==='1').loadedVolume,manual.loadedVolume,'Load modality and contract classification remain distinct');
  const a=byClient(all,ids.partner),b=byClient(all,partner);
  assert.deepEqual(a.overall,{loadedVolume:'65.013',averageAtr:'135.280393',loadCount:4,contractCount:4});
  assert.equal(byCode(a,'1').loadedVolume,'40.003');assert.equal(byCode(a,'1').averageAtr,'130.521351');assert.equal(byCode(a,'1').contractCount,2);assert.equal(byCode(a,'1').sharePercent,'61.53');
  assert.equal(byCode(a,'2').averageAtr,'150.876543');assert.equal(byCode(a,'unknown').loadedVolume,'5.006');
  assert.equal(b.overall.loadedVolume,'57.015');assert.equal(b.overall.averageAtr,'');assert.equal(byCode(b,'1').averageAtr,'160.765432');assert.equal(byCode(b,'2').averageAtr,'');
  assert.equal(all.contracts.length,7);
  const classified=id=>all.contracts.find(row=>row.id===id);
  assert.equal(classified(manualA).typeCode,'1');assert.equal(classified(manualA).typeName,'MANUAL');assert.equal(classified(manualA).clientId,ids.partner);
  assert.equal(classified(mechanizedA).typeCode,'2');assert.equal(classified(mechanizedA).typeName,'Mecanizada');assert.equal(classified(mechanizedB).typeCode,'2');
  assert.equal(classified(unclassified).typeCode,'unknown');assert.equal(classified(ambiguous).typeCode,'unknown');
  assert.equal(classified(sibling),undefined);assert.equal(classified(empty).typeCode,'1');

  // Prices and financial pending states never decide whether a measured ATR is known.
  assert.equal(summary.totals.billingPending,true);
  await db.exec('RESET ROLE');
  await db.query('INSERT INTO public.billing_atr_records(owner_id,year,month,monthly_gross_value,monthly_net_value,accumulated_gross_value,accumulated_net_value) VALUES($1,2026,10,1.234567,1.234567,1.234567,1.234567)',[ids.owner]);
  await setActor();assert.deepEqual((await rpc(scope)).contractComparison,all);
  const clientA=(await rpc({...scope,partnerIds:[ids.partner]})).contractComparison;
  assert.equal(clientA.clients.length,1);assert.deepEqual(clientA.overall,a.overall);assert.equal(byCode(clientA,'2').averageAtr,'150.876543');
  const combined=(await rpc({...scope,partnerIds:[ids.partner],contractIds:[manualA,manualB,mechanizedA],farmIds:[farmA],plotIds:[pb1]})).contractComparison;
  assert.deepEqual(combined.overall,{loadedVolume:'60.007',averageAtr:'137.306981',loadCount:3,contractCount:2});
  assert.equal(byCode(combined,'1').loadedVolume,'40.003');assert.equal(byCode(combined,'2').loadedVolume,'20.004');assert.equal(byCode(combined,'unknown').loadedVolume,'0');
  assert.equal(combined.clients.length,1);assert.deepEqual(combined.contracts.map(row=>row.id).sort(),[manualA,mechanizedA].sort());
  const farmUnion=(await rpc({...scope,farmIds:[farmA,farmA],plotIds:[pb1,pb1]})).contractComparison;assert.equal(farmUnion.overall.loadedVolume,'122.028');assert.equal(farmUnion.overall.loadCount,7);
  const child=(await rpc({...scope,plotIds:[pa2]})).contractComparison;assert.equal(child.overall.loadedVolume,'35.008');assert.equal(child.overall.loadCount,2);assert.equal(byCode(child,'1').averageAtr,'140.654321');assert.equal(byCode(child,'unknown').averageAtr,'110.987654');
  const concluded=(await rpc({...scope,status:'Concluído'})).contractComparison;assert.equal(concluded.overall.loadedVolume,'50.008');assert.equal(concluded.overall.contractCount,2);assert.equal(byCode(concluded,'unknown').loadedVolume,'0');
  const day=(await rpc({...scope,from:'2026-10-01',to:'2026-10-01'})).contractComparison;assert.equal(day.overall.loadedVolume,'10.001');assert.equal(day.overall.averageAtr,'100.123456');assert.equal(day.overall.contractCount,7);
  const idle=(await rpc({...scope,contractIds:[empty]})).contractComparison;
  assert.deepEqual(idle.overall,{loadedVolume:'0',averageAtr:'',loadCount:0,contractCount:1});assert.equal(idle.clients.length,1);assert.equal(byCode(idle,'1').contractCount,1);
  for(const row of idle.types){assert.equal(row.loadedVolume,'0');assert.equal(row.averageAtr,'');assert.equal(row.sharePercent,'0');}
  const noPeriod=(await rpc({...scope,from:'2026-11-01',to:'2026-11-01'})).contractComparison;
  assert.deepEqual(noPeriod.overall,{loadedVolume:'0',averageAtr:'',loadCount:0,contractCount:7});assert.equal(noPeriod.clients.length,2);assert.equal(noPeriod.types.length,3);
  const filial=(await rpc({...scope,companyId:ids.siblingCompany})).contractComparison;
  assert.equal(filial.overall.loadedVolume,'999');assert.equal(filial.overall.averageAtr,'999');assert.equal(filial.clients[0].id,siblingPartner);
  for(const [field,valid,foreign] of [['partnerIds',ids.partner,siblingPartner],['contractIds',manualA,sibling],['farmIds',farmA,siblingFarm],['plotIds',pa1,siblingPlot]])await deny({...scope,[field]:[valid,foreign]},'42501');
  await assert.rejects(()=>db.query('SELECT billing_private.summary_contract_comparison($1::jsonb,$2::jsonb)',[JSON.stringify(scope),JSON.stringify(summary)]),error=>error.code==='42501');
  await deny({...scope,ownerId:ids.otherOwner},'22023');await deny({...scope,contractIds:[1]},'22023');await deny({...scope,to:'2026-09-01'},'22023');
  await setActor(ids.otherOwner);await deny(scope,'22023');
  const other=(await rpc({...scope,companyId:ids.otherCompany})).contractComparison;
  assert.deepEqual(other.overall,{loadedVolume:'0',averageAtr:'',loadCount:0,contractCount:0});assert.deepEqual(other.clients,[]);assert.deepEqual(other.contracts,[]);assert.equal(other.types.length,3);
  await deny({...scope,companyId:ids.otherCompany,contractIds:[manualA]},'42501');
  await setActor(ids.reader);await deny(scope,'42501');await setActor(null);await deny(scope,'28000');
 }finally{await db.close();}
});
