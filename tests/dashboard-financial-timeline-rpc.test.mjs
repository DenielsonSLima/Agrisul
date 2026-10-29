import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';
test('financial timeline and production-day averages use server valuations, scoped dates and authorized contracts',async()=>{
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
  assert.equal(selected.financialTimeline[0].grossChangeReason,'initial');assert.equal(selected.financialTimeline[1].grossChangeFrom,'2026-09-15');assert.equal(selected.financialTimeline[1].grossChangePercent,'-100');assert.equal(selected.financialTimeline[2].grossChangeReason,'zero-base');assert.equal(summary.financialTimeline[3].grossChangeReason,'pending');
  const weekly=summary.financialGroupings.week,fortnightly=summary.financialGroupings.fortnight;
  assert.equal(weekly.length,1);assert.equal(weekly[0].date,'2026-09-14');assert.equal(weekly[0].endDate,'2026-09-20');assert.equal(weekly[0].loadCount,4);assert.equal(weekly[0].grossAmount,'');assert.equal(weekly[0].receivedAmount,'145.57');
  assert.deepEqual(fortnightly.map(row=>[row.date,row.endDate]),[['2026-09-01','2026-09-15'],['2026-09-16','2026-09-30']]);assert.equal(fortnightly[0].grossAmount,daily[0].grossAmount);assert.equal(fortnightly[1].billingPending,true);assert.equal(fortnightly[1].receivedAmount,'145.57');
  assert.equal(selected.financialGroupings.week[0].grossAmount,selected.months[0].grossAmount);assert.equal(selected.financialGroupings.week[0].netAmount,selected.months[0].netAmount);assert.equal(selected.financialGroupings.week[0].billingPending,false);
  assert.deepEqual(summary.dailyProductivity,{productionDayCount:3,averageLoadedVolume:'16.667',averageNetAmount:'',billingPending:true,pendingLoadCount:1});
  assert.equal(selected.dailyProductivity.productionDayCount,2);assert.equal(selected.dailyProductivity.averageLoadedVolume,'20');assert.equal(selected.dailyProductivity.billingPending,false);
  await db.exec('RESET ROLE');const expectedAverageNet=(await db.query('SELECT billing_private.decimal_text(round(sum(f.net_amount)/2,2)) average FROM public.billing_contracts c CROSS JOIN LATERAL billing_private.contract_load_financials(c) f WHERE c.id=$1',[a])).rows[0].average;await setActor();assert.equal(selected.dailyProductivity.averageNetAmount,expectedAverageNet);
  const productiveDay=await rpc('summary','dashboard',{...scope,contractId:a,from:'2026-09-15',to:'2026-09-15'});assert.equal(productiveDay.dailyProductivity.productionDayCount,1);assert.equal(productiveDay.dailyProductivity.averageLoadedVolume,'30');assert.equal(Number(productiveDay.dailyProductivity.averageNetAmount),Number(Number(productiveDay.totals.netAmount).toFixed(2)));
  const singleDay=await rpc('summary','dashboard',{...scope,from:'2026-09-16',to:'2026-09-16'});assert.equal(singleDay.financialTimeline.length,1);assert.equal(singleDay.financialTimeline[0].receivedAmount,'123.45');assert.equal(singleDay.financialTimeline[0].grossAmount,'0');
  for(const rows of Object.values(singleDay.financialGroupings)){assert.equal(rows.length,1);assert.equal(rows[0].date,'2026-09-16');assert.equal(rows[0].endDate,'2026-09-16');assert.equal(rows[0].receivedAmount,'123.45');}
  assert.deepEqual(singleDay.dailyProductivity,{productionDayCount:0,averageLoadedVolume:'0',averageNetAmount:'0',billingPending:false,pendingLoadCount:0},'Cash alone is not a production day');
  const empty=await rpc('summary','dashboard',{...scope,from:'2026-09-19',to:'2026-09-19'});assert.deepEqual(empty.financialTimeline,[]);
  assert.deepEqual(empty.financialGroupings,{week:[],fortnight:[]});
  assert.deepEqual(empty.dailyProductivity,singleDay.dailyProductivity);
  await db.exec('RESET ROLE');await load(b,'2026-09-15','125','30');await setActor();const sameDate=await rpc('summary','dashboard',scope);assert.equal(sameDate.dailyProductivity.productionDayCount,3,'A shared date across contracts is counted once');assert.equal(sameDate.dailyProductivity.averageLoadedVolume,'26.667');
  await db.exec('RESET ROLE');await db.query("UPDATE public.billing_contracts SET status='Concluído' WHERE id=$1",[b]);await setActor();const active=await rpc('summary','dashboard',{...scope,status:'Ativo'});assert.deepEqual(active.dailyProductivity,selected.dailyProductivity,'Status excludes the other contract from both averages and production dates');
  await assert.rejects(()=>rpc('summary','dashboard',{...scope,contractId:sibling}),error=>error.code==='42501');await setActor(ids.otherOwner);await assert.rejects(()=>rpc('summary','dashboard',scope));const other=await rpc('summary','dashboard',{...scope,companyId:ids.otherCompany});assert.deepEqual(other.financialTimeline,[]);assert.deepEqual(other.dailyProductivity,empty.dailyProductivity);await setActor(ids.reader);await assert.rejects(()=>rpc('summary','dashboard',scope),error=>error.code==='42501');await setActor(null);await assert.rejects(()=>rpc('summary','dashboard',scope),error=>error.code==='28000');
 }finally{await db.close();}
});

test('gross variation preserves decimal amounts, skips idle buckets and protects missing or zero bases',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 try{
  await db.exec('RESET ROLE');
  const row=(month,grossAmount,billingPending=false)=>({month,loadCount:1,grossAmount,netAmount:grossAmount,receivedAmount:'0',billingPending});
  const idle={month:'2026-09',loadCount:0,grossAmount:'0',netAmount:'0',receivedAmount:'0',billingPending:false};
  const enrich=async rows=>(await db.query("SELECT billing_private.dashboard_gross_variations($1::jsonb,'month') result",[JSON.stringify(rows)])).rows[0].result;
  const rows=[row('2026-08','519190.29'),idle,row('2026-10','33681.79'),row('2026-11','0'),row('2026-12','10'),row('2027-01','',true),row('2027-02','20'),row('2027-03','20'),row('2027-04','30')],original=structuredClone(rows),result=await enrich(rows);
  assert.equal(result.length,rows.length);assert.deepEqual(result[1],idle);assert.equal(result[2].grossChangeFrom,'2026-08');assert.equal(result[2].grossChangePercent,'-93.51');assert.equal(result[3].grossChangePercent,'-100');assert.equal(result[4].grossChangeReason,'zero-base');assert.equal(result[4].grossChangePercent,'');assert.equal(result[5].grossChangeReason,'pending');assert.equal(result[6].grossChangeReason,'pending');assert.equal(result[7].grossChangePercent,'0');assert.equal(result[8].grossChangePercent,'50');
  for(let i=0;i<rows.length;i++){assert.equal(result[i].grossAmount,original[i].grossAmount);assert.equal(result[i].netAmount,original[i].netAmount);}assert.deepEqual(rows,original);assert.deepEqual(await enrich([]),[]);
  const precise=await enrich([row('2026-01','100000000000000.000001'),row('2026-02','125000000000000.000001')]);assert.equal(precise[1].grossChangePercent,'25');assert.equal(precise[1].grossAmount,'125000000000000.000001');
  await setActor(ids.owner);await assert.rejects(()=>db.query("SELECT billing_private.dashboard_gross_variations('[]','month')"),error=>error.code==='42501');
 }finally{await db.close();}
});
