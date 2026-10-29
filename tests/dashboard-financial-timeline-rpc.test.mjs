import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';
test('daily financial timeline uses official load values and cash dates, filters tenants and preserves monthly output',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb(),rpc=async(resource,action,payload)=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 try{
  await db.exec('RESET ROLE');
  const insert=async(sql,args)=>(await db.query(sql,args)).rows[0].id;
  const farm=await insert("INSERT INTO public.billing_farms(owner_id,name,area_ha,city,state) VALUES($1,'Financeiro diário',10,'Japaratuba','SE') RETURNING id",[ids.owner]);
  const kind=await insert("INSERT INTO public.billing_contract_types(owner_id,name,stages) VALUES($1,'Financeiro diário','[]') RETURNING id",[ids.owner]);
  const contract=async(company,status='Ativo')=>insert("INSERT INTO public.billing_contracts(owner_id,title,company_id,client_id,type_id,type_name,stages,status,start_date,contracted_volume) VALUES($1,'Financeiro diário',$2,$3,$4,'Financeiro diário','[]',$5,'2026-09-01',1000) RETURNING id",[ids.owner,company,ids.partner,kind,status]);
  const a=await contract(ids.company),b=await contract(ids.company),sibling=await contract(ids.siblingCompany);
  const load=async(id,date,atr,volume='10')=>insert('INSERT INTO public.billing_contract_loads(owner_id,contract_id,farm_id,loaded_at,volume,atr) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[ids.owner,id,farm,date,volume,atr]);
  await load(a,'2026-09-15','120');await load(a,'2026-09-15','130','20');await load(a,'2026-09-17','125');await load(b,'2026-09-18',null);await load(sibling,'2026-09-15','999','999');
  await db.query('INSERT INTO public.billing_atr_records(owner_id,year,month,monthly_gross_value,monthly_net_value,accumulated_gross_value,accumulated_net_value) VALUES($1,2026,9,1.234567,1.234567,1.234567,1.234567)',[ids.owner]);
  await db.query("INSERT INTO public.billing_contract_payments(owner_id,contract_id,request_id,kind,received_at,reference_month,amount) VALUES($1,$2,gen_random_uuid(),'receipt','2026-09-16','2026-09-01',123.45),($1,$2,gen_random_uuid(),'advance','2026-09-17','2026-09-01',22.12)",[ids.owner,a]);
  await setActor();const scope={companyId:ids.company,from:'2026-09-01',to:'2026-09-30'},summary=await rpc('summary','dashboard',scope),daily=summary.financialTimeline;
  assert.deepEqual(daily.map(row=>row.date),['2026-09-15','2026-09-16','2026-09-17','2026-09-18']);assert.equal(daily[0].loadCount,2);assert.equal(daily[1].loadCount,0);assert.equal(daily[1].receivedAmount,'123.45');assert.equal(daily[2].receivedAmount,'22.12');assert.equal(daily[3].billingPending,true);assert.equal(daily[3].grossAmount,'');assert.equal(daily[3].netAmount,'');
  await db.exec('RESET ROLE');const valued=(await db.query('SELECT l.loaded_at::text activity_date, billing_private.decimal_text(sum(f.gross_amount)) gross,billing_private.decimal_text(sum(f.net_amount)) net FROM public.billing_contracts c CROSS JOIN LATERAL billing_private.contract_load_financials(c) f JOIN public.billing_contract_loads l ON l.owner_id=c.owner_id AND l.id=f.load_id WHERE c.id=$1 GROUP BY l.loaded_at ORDER BY l.loaded_at',[a])).rows;await setActor();
  assert.equal(daily[0].grossAmount,valued[0].gross);assert.equal(daily[0].netAmount,valued[0].net);assert.equal(daily[2].grossAmount,valued[1].gross);assert.equal(summary.months.length,1);assert.equal(summary.months[0].billingPending,true);assert.equal(summary.totals.receivedAmount,'145.57');
  const selected=await rpc('summary','dashboard',{...scope,contractId:a});assert.equal(selected.financialTimeline.length,3);assert.equal(selected.financialTimeline.every(row=>!row.billingPending),true);
  const singleDay=await rpc('summary','dashboard',{...scope,from:'2026-09-16',to:'2026-09-16'});assert.equal(singleDay.financialTimeline.length,1);assert.equal(singleDay.financialTimeline[0].receivedAmount,'123.45');assert.equal(singleDay.financialTimeline[0].grossAmount,'0');
  const empty=await rpc('summary','dashboard',{...scope,from:'2026-09-19',to:'2026-09-19'});assert.deepEqual(empty.financialTimeline,[]);
  await assert.rejects(()=>rpc('summary','dashboard',{...scope,contractId:sibling}),error=>error.code==='42501');await setActor(ids.otherOwner);await assert.rejects(()=>rpc('summary','dashboard',scope));const other=await rpc('summary','dashboard',{...scope,companyId:ids.otherCompany});assert.deepEqual(other.financialTimeline,[]);await setActor(ids.reader);await assert.rejects(()=>rpc('summary','dashboard',scope),error=>error.code==='42501');await setActor(null);await assert.rejects(()=>rpc('summary','dashboard',scope),error=>error.code==='28000');
 }finally{await db.close();}
});
