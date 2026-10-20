import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('Cane weighing RPC: actual migration chain, workbook arithmetic, partial data, scope and RLS',async()=>{
 const {db,ids,setActor,rpc}=await createCaneWeighingDb();
 const denied=(fn,code)=>assert.rejects(fn,error=>error.code===code,`Expected PostgreSQL ${code}`);
 try{
  const {control}=await rpc('save',{companyId:ids.company,partnerId:ids.partner,startDate:'2026-10-16'});
  assert.equal(control.season,'2026/2027');
  assert.equal(control.partnerName,'TAQUARI');
  assert.deepEqual(control.summary,{entryCount:0,completeCount:0,pendingCount:0,agrisulNetKg:'0',partnerNetKg:'0',differenceKg:null,differencePercent:null});
  await denied(()=>rpc('save',{companyId:ids.company,partnerId:ids.partner,startDate:'2026-10-16'}),'23505');
  const base={companyId:ids.company,controlId:control.id,weighedAt:'2026-10-16',weighedTime:'18:07',ticket:'TRIP-133',notes:'',
   trailerGrossMode:'combined',combinedTrailerGrossKg:'55.220',components:[
    {fleetNumber:'133',plate:'QMP6D31',kind:'truck',tareKg:'16.400',grossKg:'38.860',partnerNetKg:'22.710'},
    {fleetNumber:'277',plate:'OEK4136',kind:'trailer',tareKg:'10.320',grossKg:null,partnerNetKg:'20.600'},
    {fleetNumber:'267',plate:'OEK4276',kind:'trailer',tareKg:'10.320',grossKg:null,partnerNetKg:'13.150'},
   ]};
  const {entry}=await rpc('save-entry',base);
  assert.equal(entry.agrisulNetKg,'57040');
  assert.equal(entry.partnerNetKg,'56460');
  assert.equal(entry.differenceKg,'-580');
  assert.equal(entry.differencePercent,'-1.01683');
  assert.deepEqual(entry.components.map(c=>[c.grossKg,c.netKg,c.differenceKg]),[
   ['38860','22460','250'],['27610','17290','3310'],['27610','17290','-4140'],
  ]);
  let detail=await rpc('get',{companyId:ids.company,id:control.id});
  assert.equal(detail.summary.agrisulNetKg,'57040');
  assert.equal(detail.summary.differenceKg,'-580');
  assert.equal(detail.daily[0].date,'2026-10-16');
  assert.equal(detail.entries[0].weighedTime,'18:07');
  // Individual trailer weighing gives exactly the same result as shared gross.
  const individual={...base,id:entry.id,trailerGrossMode:'individual',combinedTrailerGrossKg:null,
   components:base.components.map((c,i)=>({...c,grossKg:i===0?c.grossKg:'27.610'}))};
  const updated=(await rpc('save-entry',individual)).entry;
  assert.equal(updated.agrisulNetKg,entry.agrisulNetKg);
  assert.equal(updated.differenceKg,entry.differenceKg);
  assert.equal((await rpc('get',{companyId:ids.company,id:control.id})).entries.length,1);
  // A missing input is not a measured zero. Complete-trip totals remain useful,
  // and differences are withheld until the complete period can be compared.
  const pending=(await rpc('save-entry',{...base,ticket:'PENDING',weighedAt:'2026-10-17',
   components:base.components.map((c,i)=>({...c,tareKg:i===1?null:c.tareKg,partnerNetKg:null}))})).entry;
  assert.equal(pending.agrisulNetKg,null);
  assert.equal(pending.partnerNetKg,null);
  assert.equal(pending.differenceKg,null);
  detail=await rpc('get',{companyId:ids.company,id:control.id});
  assert.equal(detail.summary.agrisulNetKg,'57040');
  assert.equal(detail.summary.partnerNetKg,'56460');
  assert.equal(detail.summary.pendingCount,1);
  assert.equal(detail.summary.differenceKg,null);
  assert.equal(detail.daily[0].differenceKg,'-580');
  assert.equal(detail.daily[1].differenceKg,null);
  const decimal=(await rpc('save-entry',{...base,ticket:'DECIMAL',weighedAt:'2026-10-18',combinedTrailerGrossKg:'55.220,5',
   components:base.components.map((c,i)=>({...c,tareKg:i===0?'16.400,125':c.tareKg}))})).entry;
  assert.equal(decimal.components[0].netKg,'22459.875');
  assert.equal(decimal.components[1].grossKg,'27610.25');
  assert.equal(decimal.agrisulNetKg,'57040.375');
  const exact=(await rpc('save-entry',{...base,ticket:'SIX-DECIMALS',combinedTrailerGrossKg:'55.220,123457',
   components:base.components.map((c,i)=>({...c,tareKg:i===0?'16.400,123456':c.tareKg}))})).entry;
  assert.equal(exact.components[0].netKg,'22459.876544');
  assert.equal(exact.components[1].grossKg,'27610.0617285');
  assert.equal(exact.agrisulNetKg,'57040.000001');
  await rpc('delete-entry',{companyId:ids.company,controlId:control.id,id:exact.id});
  const partial=(await rpc('save-entry',{...base,ticket:'PARTNER-PARTIAL',
   components:base.components.map((c,i)=>({...c,partnerNetKg:i===1?null:c.partnerNetKg}))})).entry;
  assert.equal(partial.agrisulNetKg,'57040');
  assert.equal(partial.partnerNetKg,'35860');
  assert.equal(partial.partnerComplete,false);
  assert.equal(partial.differenceKg,null);
  assert.equal(partial.components[0].differenceKg,'250','A measured component can still be compared while another is pending');
  assert.equal(partial.components[1].differenceKg,null);
  await rpc('delete-entry',{companyId:ids.company,controlId:control.id,id:partial.id});
  const zero=(await rpc('save-entry',{...base,ticket:'MEASURED-ZERO',combinedTrailerGrossKg:'0',
   components:base.components.map((c,i)=>({...c,tareKg:'0',grossKg:i===0?'0':null,partnerNetKg:'0'}))})).entry;
  assert.equal(zero.agrisulNetKg,'0');
  assert.equal(zero.partnerNetKg,'0');
  assert.equal(zero.differenceKg,'0');
  assert.equal(zero.differencePercent,null,'A zero denominator must not produce Infinity');
  assert.equal(zero.agrisulComplete,true);
  await rpc('delete-entry',{companyId:ids.company,controlId:control.id,id:zero.id});
  await denied(()=>rpc('save-entry',{...base,ticket:'BAD',weighedAt:'2026-10-15'}),'22023');
  await denied(()=>rpc('save-entry',{...base,ticket:'BAD',weighedTime:'24:00'}),'22023');
  await denied(()=>rpc('save-entry',{...base,ticket:'BAD',components:base.components.slice(0,2)}),'22023');
  await denied(()=>rpc('save-entry',{...base,ticket:'BAD',components:base.components.map((c,i)=>({...c,plate:i===2?'OEK4136':c.plate}))}),'22023');
  await denied(()=>rpc('save-entry',{...base,ticket:'BAD',components:base.components.map((c,i)=>({...c,grossKg:i===0?'1':c.grossKg}))}),'22023');
  await denied(()=>rpc('save-entry',{...base,ticket:'BAD',combinedTrailerGrossKg:'1'}),'22023');
  await denied(()=>rpc('save-entry',{...base,ticket:'BAD',components:base.components.map((c,i)=>({...c,tareKg:i===0?'NaN':c.tareKg}))}),'22023');
  await denied(()=>rpc('save-entry',{...base,ownerId:ids.otherOwner}),'22023');
  await denied(()=>rpc('save-entry',{...base,ticket:'BAD',components:base.components.map(c=>({...c,ownerId:ids.otherOwner}))}),'22023');
  await denied(()=>rpc('save',{companyId:ids.company,id:control.id,partnerId:ids.partner,startDate:'2026-10-20'}),'22023');
  await denied(()=>rpc('save',{companyId:ids.company,partnerId:ids.otherPartner,startDate:'2026-10-16'}),'22023');
  await denied(()=>rpc('get',{companyId:ids.siblingCompany,id:control.id}),'P0002');
  assert.deepEqual((await rpc('list',{companyId:ids.siblingCompany})).controls,[]);
  assert.equal((await rpc('list',{companyId:ids.company})).controls[0].summary.entryCount,3);
  // SELECT supports Realtime; authenticated table writes are deliberately absent.
  assert.equal((await db.query('SELECT count(*)::int n FROM public.billing_cane_weighing_components')).rows[0].n,9);
  for(const operation of [
   `INSERT INTO public.billing_cane_weighing_controls(owner_id,company_id,partner_id,start_date,season) VALUES('${ids.owner}','${ids.company}','${ids.partner}','2026-10-20','2026/2027')`,
   `UPDATE public.billing_cane_weighing_entries SET notes='bypass'`,
   `DELETE FROM public.billing_cane_weighing_components`,
  ])await denied(()=>db.exec(operation),'42501');
  await setActor(ids.reader);
  assert.equal((await rpc('get',{companyId:ids.company,id:control.id})).canManage,false);
  await denied(()=>rpc('delete-entry',{companyId:ids.company,controlId:control.id,id:entry.id}),'42501');
  await setActor(ids.otherOwner);
  assert.deepEqual((await rpc('list',{companyId:ids.otherCompany})).controls,[]);
  await denied(()=>rpc('get',{companyId:ids.otherCompany,id:control.id}),'P0002');
  await denied(()=>rpc('get',{companyId:ids.company,id:control.id}),'22023');
  for(const table of ['controls','entries','components']){
   assert.equal((await db.query(`SELECT count(*)::int n FROM public.billing_cane_weighing_${table}`)).rows[0].n,0);
  }
  await denied(()=>rpc('save',{companyId:ids.otherCompany,partnerId:ids.partner,startDate:'2026-10-16'}),'22023');
  await setActor(null);
  await denied(()=>rpc('list',{companyId:ids.company}),'28000');
  await db.exec('RESET ROLE');
  await db.exec('SET ROLE anon');
  await denied(()=>rpc('list',{companyId:ids.company}),'42501');
  await setActor(ids.owner);
  await rpc('delete-entry',{companyId:ids.company,controlId:control.id,id:pending.id});
  await rpc('delete',{companyId:ids.company,id:control.id});
  for(const table of ['controls','entries','components']){
   assert.equal((await db.query(`SELECT count(*)::int n FROM public.billing_cane_weighing_${table}`)).rows[0].n,0);
  }
  const wrapper=(await db.query(`SELECT prosecdef FROM pg_proc WHERE oid='public.billing_rpc(text,text,jsonb)'::regprocedure`)).rows[0];
  assert.equal(wrapper.prosecdef,false,'The public wrapper must remain SECURITY INVOKER');
  const published=(await db.query(`SELECT tablename FROM pg_publication_tables
   WHERE pubname='supabase_realtime' AND tablename LIKE 'billing_cane_%' ORDER BY tablename`)).rows.map(row=>row.tablename);
  assert.deepEqual(published,['billing_cane_weighing_components','billing_cane_weighing_controls','billing_cane_weighing_entries']);
  for(const signature of ['cane_weight(jsonb)','cane_entry_json(public.billing_cane_weighing_entries)','cane_summary(jsonb)',
   'cane_control_json(public.billing_cane_weighing_controls)']){
   const result=(await db.query(`SELECT has_function_privilege('authenticated',$1,'EXECUTE') allowed`,[`billing_private.${signature}`])).rows[0];
   assert.equal(result.allowed,false,`Internal helper ${signature} must not be a client API`);
  }
 }finally{await db.close();}
});

test('18/10 workbook: all 15 actual trips count, including the trip omitted by the Excel subtotal',async()=>{
 const {db,ids,rpc}=await createCaneWeighingDb();
 try{
  const fixture=JSON.parse(await readFile(new URL('./fixtures/cane-weighings-2026-10-18.json',import.meta.url),'utf8'));
  const {control}=await rpc('save',{companyId:ids.company,partnerId:ids.partner,startDate:'2026-10-18'});
  const saved=[];
  for(const [index,row] of fixture.entries()){
   const {entry}=await rpc('save-entry',{...row,companyId:ids.company,controlId:control.id,ticket:`XLSX-${index+1}`,
    // The workbook identifies trucks by fleet number; their plates are blank.
    // Synthetic test-only plates satisfy identification without inventing source data.
    components:row.components.map(c=>({...c,plate:c.plate||`TEST${index+1}`}))});
   saved.push(entry);
  }
  let detail=await rpc('get',{companyId:ids.company,id:control.id});
  assert.equal(detail.entries.length,15);
  assert.deepEqual(detail.summary,{entryCount:15,completeCount:15,pendingCount:0,
   agrisulNetKg:'732410',partnerNetKg:'737700',differenceKg:'5290',differencePercent:'0.722273'});
  assert.deepEqual(detail.daily,[{date:'2026-10-18',...detail.summary}]);
  const omitted=saved[13];
  assert.equal(omitted.agrisulNetKg,'48460');
  assert.equal(omitted.partnerNetKg,'51620');
  assert.equal(omitted.components[0].fleetNumber,'135');
  await rpc('delete-entry',{companyId:ids.company,controlId:control.id,id:omitted.id});
  detail=await rpc('get',{companyId:ids.company,id:control.id});
  assert.equal(detail.summary.agrisulNetKg,'683950','Reproduces the workbook error only if the omitted trip is actually removed');
  assert.equal(detail.summary.partnerNetKg,'686080');
  assert.equal(detail.summary.entryCount,14);
 }finally{await db.close();}
});
