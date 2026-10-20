import assert from 'node:assert/strict';
import test from 'node:test';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('partner fleet, measurement snapshots, pending plates and atomic idempotent import obey RPC ownership',async()=>{
 const {db,ids,setActor,rpc}=await createCaneWeighingDb();
 const fleet=async(action,payload={})=>(await db.query(`SELECT public.billing_rpc('fleet',$1,$2::jsonb) result`,[action,JSON.stringify(payload)])).rows[0].result;
 const denied=(fn,code)=>assert.rejects(fn,e=>e.code===code);
 try{
  const vehicles=[];
  for(const [internalCode,plate,kind,tareKg] of [['133','','truck','16.400,123456'],['277','OEK4136','trailer','10320'],['267','OEK4276','trailer','10320']]){
   const {vehicle}=await fleet('save',{partnerId:ids.partner,internalCode,plate,kind,tareKg});vehicles.push(vehicle);
   assert.equal(vehicle.partnerId,ids.partner);assert.equal(vehicle.partnerName,'TAQUARI');
  }
  assert.equal(vehicles[0].tareKg,'16400.123456');
  assert.equal((await fleet('list',{partnerId:ids.partner})).vehicles.length,3);
  const legacy=(await fleet('save',{internalCode:'133',model:'FH 540',brand:'Volvo',description:''})).vehicle;
  assert.equal(legacy.partnerId,null,'Existing own fleet can use the same number as a partner');
  await denied(()=>fleet('save',{partnerId:ids.partner,internalCode:'133',kind:'truck',plate:'QMP6D31'}),'23505');
  await denied(()=>fleet('save',{partnerId:ids.otherPartner,internalCode:'BAD',kind:'truck',plate:'BAD'}),'22023');
  await denied(()=>fleet('save',{internalCode:'BAD'}),'22023');
  const {control}=await rpc('save',{companyId:ids.company,partnerId:ids.partner,startDate:'2026-10-16'});
  const base={companyId:ids.company,controlId:control.id,weighedAt:'2026-10-16',weighedTime:'18:07',
   trailerGrossMode:'combined',combinedTrailerGrossKg:'55.220,123457',components:vehicles.map((v,i)=>({vehicleId:v.id,grossKg:i===0?'38860':null,partnerNetKg:'20000'}))};
  const {entry}=await rpc('save-entry',base);
  assert.equal(entry.components[0].fleetNumber,'133');assert.equal(entry.components[0].plate,'');
  assert.equal(entry.components[0].tareKg,'16400.123456');assert.equal(entry.components[1].grossKg,'27610.0617285');
  assert.equal(entry.agrisulNetKg,'57040.000001');assert.equal(entry.tareKg,'37040.123456');assert.equal(entry.grossKg,'94080.123457');
  assert.deepEqual(entry.components.map(c=>c.vehicleId),vehicles.map(v=>v.id));
  await fleet('save',{...vehicles[0],id:vehicles[0].id,internalCode:'133',tareKg:'17000',partnerName:undefined,createdAt:undefined,updatedAt:undefined,ownerId:undefined});
  let detail=await rpc('get',{companyId:ids.company,id:control.id});
  assert.equal(detail.entries[0].components[0].tareKg,'16400.123456','Registry change must not rewrite historical tare');
  const edited=(await rpc('save-entry',{...base,id:entry.id})).entry;
  assert.equal(edited.components[0].tareKg,'16400.123456','Omitted tare on edit retains the historical snapshot');
  const explicit=(await rpc('save-entry',{...base,id:entry.id,components:base.components.map((c,i)=>i===0?{...c,tareKg:null}:c)})).entry;
  assert.equal(explicit.components[0].tareKg,null,'Explicitly unknown measurement remains pending');
  await denied(()=>fleet('delete',{id:vehicles[0].id}),'23503');
  await denied(()=>rpc('save-entry',{...base,components:[base.components[1],base.components[0],base.components[2]]}),'22023');
  await denied(()=>rpc('save-entry',{...base,components:[base.components[0],base.components[1],{...base.components[1],plate:'DIFFERENT',fleetNumber:'999'}]}),'22023');
  await denied(()=>rpc('save-entry',{...base,components:vehicles.map((v,i)=>({fleetNumber:i===2?'277':v.internalCode,plate:'',kind:v.kind,tareKg:'10000',grossKg:i===0?'30000':null}))}),'22023');
  await denied(()=>rpc('save-entry',{...base,components:base.components.map((c,i)=>i===0?{...c,ownerId:ids.otherOwner}:c)}),'22023');
  const importPayload={companyId:ids.company,partnerId:ids.partner,startDate:'2026-10-16',season:'2026/2027',notes:'Fonte conferida',sourceId:'workbook-v1',vehicles:[
   {internalCode:'198',plate:'SHF7G41',kind:'truck',tareKg:'16060'},
  ],entries:[{sourceId:'sheet1-row20',weighedAt:'2026-10-17',weighedTime:'04:40',notes:'',ticket:'',trailerGrossMode:'combined',combinedTrailerGrossKg:'55240',components:[
   {fleetNumber:'198',plate:'SHF7E41',kind:'truck',tareKg:'16060',grossKg:'34800',partnerNetKg:'18000'},
   {fleetNumber:'277',plate:'OEK4136',kind:'trailer',tareKg:'10320',grossKg:null,partnerNetKg:'17000'},
   {fleetNumber:'267',plate:'OEK4276',kind:'trailer',tareKg:'10320',grossKg:null,partnerNetKg:'17000'},
  ]}]};
  const imported=await rpc('import',importPayload);
  assert.deepEqual(imported,{controlId:control.id,importedCount:1,skippedCount:0,vehiclesCreated:1});
  assert.deepEqual(await rpc('import',importPayload),{controlId:control.id,importedCount:0,skippedCount:1,vehiclesCreated:0});
  detail=await rpc('get',{companyId:ids.company,id:control.id});
  const source=detail.entries.find(e=>e.sourceId==='workbook-v1/sheet1-row20');assert.ok(source);
  assert.equal(source.components[0].plate,'SHF7E41','A source plate variant remains a historical snapshot');
  assert.equal(source.components[0].vehicleId,(await fleet('list',{partnerId:ids.partner})).vehicles.find(v=>v.internalCode==='198').id);
  await rpc('save-entry',{...importPayload.entries[0],sourceId:undefined,id:source.id,companyId:ids.company,controlId:control.id,notes:'Conferido depois da importação'});
  await rpc('import',importPayload);
  detail=await rpc('get',{companyId:ids.company,id:control.id});assert.equal(detail.entries.find(e=>e.id===source.id).notes,'Conferido depois da importação');
  const before=detail.entries.length;
  await denied(()=>rpc('import',{...importPayload,vehicles:[{internalCode:'ROLLBACK',plate:'ABC1234',kind:'truck',tareKg:'10000'}],entries:[{...importPayload.entries[0],sourceId:'invalid-row',components:[]}]}),'22023');
  assert.equal((await rpc('get',{companyId:ids.company,id:control.id})).entries.length,before);
  assert.equal((await fleet('list')).vehicles.some(v=>v.internalCode==='ROLLBACK'),false,'Failed import must rollback registry and trips atomically');
  for(const table of ['billing_fleet_vehicles','billing_cane_weighing_components','billing_cane_weighing_entries']){
   await denied(()=>db.query(`DELETE FROM public.${table}`),'42501');
  }
  await setActor(ids.reader);await denied(()=>rpc('import',importPayload),'42501');await denied(()=>fleet('list'),'42501');
  await setActor(ids.otherOwner);
  assert.equal((await fleet('list')).vehicles.length,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM public.billing_fleet_vehicles')).rows[0].n,0);
  await denied(()=>rpc('get',{companyId:ids.company,id:control.id}),'22023');
  const otherControl=(await rpc('save',{companyId:ids.otherCompany,partnerId:ids.otherPartner,startDate:'2026-10-16'})).control;
  await denied(()=>rpc('save-entry',{...base,companyId:ids.otherCompany,controlId:otherControl.id}),'22023');
  await denied(()=>rpc('import',importPayload),'22023');
  await setActor(null);await denied(()=>rpc('import',importPayload),'28000');
  await db.exec('RESET ROLE');await db.exec('SET ROLE anon');await denied(()=>rpc('import',importPayload),'42501');
 }finally{await db.close();}
});

test('populated days with no measurements retain null totals; measured zeros and partial sums remain distinct',async()=>{
 const {db,ids,rpc}=await createCaneWeighingDb();
 try{
  const {control}=await rpc('save',{companyId:ids.company,partnerId:ids.partner,startDate:'2026-10-16'});
  const base={companyId:ids.company,controlId:control.id,weighedAt:'2026-10-19',trailerGrossMode:'individual',
   components:[['133','truck'],['277','trailer'],['267','trailer']].map(([fleetNumber,kind])=>({fleetNumber,plate:'',kind,tareKg:null,grossKg:null,partnerNetKg:null}))};
  await rpc('save-entry',base);
  let detail=await rpc('get',{companyId:ids.company,id:control.id});
  for(const summary of [detail.summary,detail.control.summary,detail.daily[0]]){
   for(const field of ['agrisulNetKg','partnerNetKg','tareKg','grossKg','differenceKg','differencePercent']) assert.equal(summary[field],null,`${field} must be unknown on a fully pending day`);
   assert.equal(summary.entryCount,1);assert.equal(summary.pendingCount,1);
  }
  // A day can have complete AGRISUL measurements while all partner values are absent.
  await rpc('save-entry',{...base,weighedAt:'2026-10-18',components:base.components.map(c=>({...c,tareKg:'10000',grossKg:'20000'}))});
  detail=await rpc('get',{companyId:ids.company,id:control.id});
  const measured=detail.daily.find(d=>d.date==='2026-10-18');
  assert.equal(measured.agrisulNetKg,'30000');assert.equal(measured.tareKg,'30000');assert.equal(measured.grossKg,'60000');
  assert.equal(measured.partnerNetKg,null);assert.equal(measured.differenceKg,null);assert.equal(measured.differencePercent,null);
  assert.equal(detail.summary.agrisulNetKg,'30000','Partial summaries preserve existing measurements');assert.equal(detail.summary.partnerNetKg,null);
  await rpc('save-entry',{...base,weighedAt:'2026-10-17',components:base.components.map(c=>({...c,tareKg:'0',grossKg:'0',partnerNetKg:'0'}))});
  detail=await rpc('get',{companyId:ids.company,id:control.id});
  const zero=detail.daily.find(d=>d.date==='2026-10-17');
  for(const field of ['agrisulNetKg','partnerNetKg','tareKg','grossKg','differenceKg']) assert.equal(zero[field],'0',`${field} is a measured zero`);
  assert.equal(zero.differencePercent,null);assert.equal(detail.summary.partnerNetKg,'0');assert.equal(detail.summary.differenceKg,null);
 }finally{await db.close();}
});
