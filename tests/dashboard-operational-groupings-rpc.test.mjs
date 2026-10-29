import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('operational periods respect calendar boundaries, raw weighted ATR, every selection and account isolation',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async payload=>(await db.query("select public.billing_rpc('summary','dashboard',$1::jsonb) result",[JSON.stringify(payload)])).rows[0].result;
 try{
  await db.exec('RESET ROLE');
  const insert=async(sql,args)=>(await db.query(sql,args)).rows[0].id;
  const farm=await insert("INSERT INTO public.billing_farms(owner_id,name,area_ha,city,state) VALUES($1,'Origem A',10,'Japaratuba','SE') RETURNING id",[ids.owner]);
  const farmB=await insert("INSERT INTO public.billing_farms(owner_id,name,area_ha,city,state) VALUES($1,'Origem B',10,'Japaratuba','SE') RETURNING id",[ids.owner]);
  const plot=await insert("INSERT INTO public.billing_farm_plots(owner_id,farm_id,name,area_ha) VALUES($1,$2,'01',5) RETURNING id",[ids.owner,farm]);
  const plotB=await insert("INSERT INTO public.billing_farm_plots(owner_id,farm_id,name,area_ha) VALUES($1,$2,'02',5) RETURNING id",[ids.owner,farm]);
  const partner=await insert("INSERT INTO public.billing_clients(owner_id,legal_name,cnpj) VALUES($1,'Outro cliente','11111111111111') RETURNING id",[ids.owner]);
  const kind=await insert("INSERT INTO public.billing_contract_types(owner_id,name,stages) VALUES($1,'Operacional','[]') RETURNING id",[ids.owner]);
  const contract=async(company,client=ids.partner,status='Ativo')=>insert("INSERT INTO public.billing_contracts(owner_id,title,company_id,client_id,type_id,type_name,stages,status,start_date,contracted_volume) VALUES($1,'Operacional',$2,$3,$4,'Operacional','[]',$5,'2026-09-01',1000) RETURNING id",[ids.owner,company,client,kind,status]);
  const a=await contract(ids.company),b=await contract(ids.company,partner,'Concluído'),sibling=await contract(ids.siblingCompany);
  const load=async(contract,date,volume,atr,farmId=farm,plotId=null)=>insert('INSERT INTO public.billing_contract_loads(owner_id,contract_id,farm_id,plot_id,loaded_at,volume,atr) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[ids.owner,contract,farmId,plotId,date,volume,atr]);
  await load(a,'2026-09-13','10','100',farm,plot);
  await load(a,'2026-09-14','20','130',farm,plot);await load(a,'2026-09-14','10','100',farm,plot);
  await load(a,'2026-09-15','10','110',farm,plotB);await load(a,'2026-09-16','10','140');
  await load(a,'2026-09-30','5','120',farmB);await load(a,'2026-10-01','15','160',farmB);
  await load(b,'2026-10-02','7',null);await load(sibling,'2026-09-14','999','999');
  await setActor();
  const scope={companyId:ids.company,from:'2026-09-13',to:'2026-10-02'};
  const data=await rpc(scope),days=data.operationalTimeline;
  assert.deepEqual(days.map(r=>[r.date,r.endDate,r.loadedVolume]),[
   ['2026-09-13','2026-09-13','10'],['2026-09-14','2026-09-14','30'],['2026-09-15','2026-09-15','10'],
   ['2026-09-16','2026-09-16','10'],['2026-09-30','2026-09-30','5'],['2026-10-01','2026-10-01','15'],['2026-10-02','2026-10-02','7']]);
  assert.equal(days[1].averageAtr,'120');assert.equal(days[1].loadCount,2);assert.equal(days.at(-1).averageAtr,'');
  assert.deepEqual(data.operationalGroupings.week.map(r=>[r.date,r.endDate,r.loadedVolume,r.averageAtr]),[
   ['2026-09-13','2026-09-13','10','100'],['2026-09-14','2026-09-20','50','122'],['2026-09-28','2026-10-02','27','']]);
  assert.deepEqual(data.operationalGroupings.fortnight.map(r=>[r.date,r.endDate,r.loadedVolume,r.averageAtr]),[
   ['2026-09-13','2026-09-15','50','114'],['2026-09-16','2026-09-30','15','133.333333'],['2026-10-01','2026-10-02','22','']]);
  for(const rows of [days,...Object.values(data.operationalGroupings)]){
   assert.equal(rows.reduce((sum,r)=>sum+Number(r.loadedVolume),0),Number(data.totals.loadedVolume));
   assert.equal(rows.reduce((sum,r)=>sum+r.loadCount,0),data.totals.loadCount);
   assert.ok(rows.every(r=>typeof r.loadedVolume==='string'&&typeof r.averageAtr==='string'));
  }
  for(const selection of [{contractId:a},{contractIds:[a]},{partnerId:ids.partner},{partnerIds:[ids.partner]},{status:'Ativo'}]){
   const selected=await rpc({...scope,...selection});assert.equal(selected.operationalTimeline.length,6);assert.equal(selected.operationalGroupings.week.at(-1).averageAtr,'150');
  }
  for(const selection of [{farmId:farmB},{farmIds:[farmB]}]){
   const selected=await rpc({...scope,...selection});assert.deepEqual(selected.operationalTimeline.map(r=>r.loadedVolume),['5','15']);assert.equal(selected.operationalGroupings.week[0].averageAtr,'150');
  }
  for(const selection of [{farmId:farm,plotId:plot},{plotIds:[plot]}]){
   const selected=await rpc({...scope,...selection});assert.deepEqual(selected.operationalTimeline.map(r=>r.loadedVolume),['10','30']);assert.equal(selected.operationalGroupings.fortnight[0].averageAtr,'115');
  }
  const single=await rpc({...scope,from:'2026-09-14',to:'2026-09-14'});
  for(const rows of [single.operationalTimeline,...Object.values(single.operationalGroupings)]){assert.equal(rows.length,1);assert.equal(rows[0].date,'2026-09-14');assert.equal(rows[0].endDate,'2026-09-14');assert.equal(rows[0].averageAtr,'120');}
  const empty=await rpc({...scope,from:'2026-09-17',to:'2026-09-17'});assert.deepEqual(empty.operationalTimeline,[]);assert.deepEqual(empty.operationalGroupings,{week:[],fortnight:[]});
  await assert.rejects(()=>rpc({...scope,contractId:sibling}),e=>e.code==='42501');
  await setActor(ids.otherOwner);await assert.rejects(()=>rpc(scope));const other=await rpc({...scope,companyId:ids.otherCompany});assert.deepEqual(other.operationalTimeline,[]);
  await setActor(ids.reader);await assert.rejects(()=>rpc(scope),e=>e.code==='42501');
  await setActor(null);await assert.rejects(()=>rpc(scope),e=>e.code==='28000');
 }finally{await db.close();}
});
