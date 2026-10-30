import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('weekly plots only productive dates and returns weighted contract-modality cards, valuation, filters and account isolation',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async payload=>(await db.query("select public.billing_rpc('summary','weekly',$1::jsonb) result",[JSON.stringify(payload)])).rows[0].result;
 const scope={companyId:ids.company,from:'2026-10-24',to:'2026-10-30'};
 try{
  await db.exec('RESET ROLE');
  const insert=async(sql,args)=>(await db.query(sql,args)).rows[0].id;
  const partner=await insert("insert into public.billing_clients(owner_id,legal_name,cnpj) values($1,'Fornecedor B','11111111111111') returning id",[ids.owner]);
  const kind=await insert("insert into public.billing_contract_types(owner_id,name,stages) values($1,'Cadastro renomeado','[]') returning id",[ids.owner]);
  const farm=await insert("insert into public.billing_farms(owner_id,name,area_ha,city,state) values($1,'Origem semanal',100,'Capela','SE') returning id",[ids.owner]);
  const plot=await insert("insert into public.billing_farm_plots(owner_id,farm_id,name,area_ha) values($1,$2,'01',10) returning id",[ids.owner,farm]);
  const contract=async(client,type,company=ids.company)=>insert("insert into public.billing_contracts(owner_id,title,company_id,client_id,type_id,type_name,stages,status,start_date,contracted_volume) values($1,'Semanal',$2,$3,$4,$5,'[]','Ativo','2026-01-01',1000) returning id",[ids.owner,company,client,kind,type]);
  const a=await contract(ids.partner,'MANUAL'),b=await contract(partner,'MACANIZADO'),u=await contract(partner,'Cana'),sibling=await contract(ids.partner,'MANUAL',ids.siblingCompany);
  const load=async(c,date,volume,atr,method='2')=>insert('insert into public.billing_contract_loads(owner_id,contract_id,farm_id,plot_id,loaded_at,volume,atr,harvest_method) values($1,$2,$3,$4,$5,$6,$7,$8) returning id',[ids.owner,c,farm,plot,date,volume,atr,method]);
  await load(a,'2026-10-17','10','100');await load(a,'2026-10-23','10','120');
  await load(a,'2026-10-24','10','100');await load(a,'2026-10-24','30','140');await load(a,'2026-10-30','20','160');
  await load(b,'2026-10-25','5','150','1');await load(u,'2026-10-26','7',null);await load(sibling,'2026-10-24','999','999');
  await db.query('insert into public.billing_atr_records(owner_id,year,month,monthly_gross_value,monthly_net_value,accumulated_gross_value,accumulated_net_value) values($1,2026,10,1,1,1,1)',[ids.owner]);
  await setActor();
  const all=await rpc(scope);assert.deepEqual(all.days.map(r=>r.date),['2026-10-24','2026-10-25','2026-10-26','2026-10-30']);
  assert.deepEqual(all.contractMethods,[{code:'1',label:'Manual',loadCount:3,loadedVolume:'60',averageAtr:'140'},{code:'2',label:'Mecanizada',loadCount:1,loadedVolume:'5',averageAtr:'150'},{code:'unknown',label:'Não classificado',loadCount:1,loadedVolume:'7',averageAtr:''}]);
  assert.equal(all.totals.loadedVolume,'72');assert.equal(all.totals.loadCount,5);assert.equal(all.totals.averageAtr,'');assert.equal(all.totals.grossAmount,'');assert.equal(all.totals.billingPending,true);
  assert.equal(all.days[0].averageAtr,'130');assert.equal(all.days[0].grossAmount,'5200');assert.ok(all.days.every(day=>day.loadCount>0&&Number(day.loadedVolume)>0));
  assert.equal(all.days[2].averageAtr,'');assert.equal(all.days[2].billingPending,true);assert.equal(all.days[2].grossAmount,'');
  const manual=await rpc({...scope,contractMethod:'1'});assert.equal(manual.totals.loadedVolume,'60');assert.equal(manual.totals.averageAtr,'140');assert.equal(manual.totals.grossAmount,'8400');
  assert.equal(manual.comparison.loadedVolume,'20');assert.equal(manual.comparison.averageAtr,'110');assert.equal(manual.comparison.atrChange,'30');assert.equal(manual.comparison.volumeChangePercent,'200');assert.equal(manual.comparison.loadChangePercent,'50');assert.equal(manual.comparison.grossChangePercent,'281.82');
  assert.equal(manual.comparison.from,'2026-10-17');assert.equal(manual.comparison.to,'2026-10-23');
  assert.equal((await rpc({...scope,contractMethod:'2'})).totals.loadedVolume,'5');assert.equal((await rpc({...scope,contractMethod:'unknown'})).totals.loadedVolume,'7');
  const combined=await rpc({...scope,partnerIds:[partner],contractIds:[a,b],farmIds:[farm],plotIds:[plot],contractMethod:'2',status:'Ativo'});assert.equal(combined.totals.loadedVolume,'5');assert.equal(combined.filters.contractMethod,'2');assert.equal(combined.filterOptions.partners.length,2);assert.equal(combined.filterOptions.contracts.length,3);assert.equal(combined.contractMethods[0].loadedVolume,'0');assert.equal(combined.contractMethods[1].averageAtr,'150');
  const none=await rpc({...scope,partnerIds:[partner],contractMethod:'1'});assert.equal(none.totals.loadedVolume,'0');assert.deepEqual(none.days,[]);assert.ok(none.contractMethods.every(row=>row.loadedVolume==='0'&&row.averageAtr===''));assert.equal(none.comparison.volumeChangePercent,'');
  // The weekly projection must match canonical full-contract financial amounts.
  const dashboard=(await db.query("select public.billing_rpc('summary','dashboard',$1::jsonb) result",[JSON.stringify({...scope,contractIds:[a],plotIds:[plot]})])).rows[0].result;
  assert.equal(manual.totals.grossAmount,dashboard.totals.grossAmount);assert.equal(manual.totals.netAmount,dashboard.totals.netAmount);
  for(const payload of [{contractMethod:'bad'},{contractMethod:1},{from:'2026-10-01'},{ownerId:ids.otherOwner},{from:null},{unknown:true}])await assert.rejects(()=>rpc({...scope,...payload}),e=>e.code==='22023');
  await assert.rejects(()=>rpc({...scope,contractIds:[sibling]}),e=>e.code==='42501');
  await assert.rejects(()=>db.query('select billing_private.summary_weekly($1::jsonb)',[JSON.stringify(scope)]),e=>e.code==='42501');
  await setActor(ids.otherOwner);await assert.rejects(()=>rpc(scope));assert.equal((await rpc({...scope,companyId:ids.otherCompany})).totals.loadCount,0);
  await assert.rejects(()=>rpc({...scope,companyId:ids.otherCompany,partnerIds:[ids.partner]}),e=>e.code==='42501');
  await setActor(ids.reader);await assert.rejects(()=>rpc(scope),e=>e.code==='42501');await setActor(null);await assert.rejects(()=>rpc(scope),e=>e.code==='28000');
 }finally{await db.close();}
});
