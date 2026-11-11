import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('daily overtime clocks own monthly totals, explicit breaks, adjustments and legacy preservation',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(action,payload)=>(await db.query("SELECT public.billing_rpc('overtime',$1,$2::jsonb) result",[action,JSON.stringify(payload)])).rows[0].result;
 const denied=(action,payload,code)=>assert.rejects(rpc(action,payload),error=>error.code===code);
 try{
  const person=(await db.query("SELECT public.billing_rpc('employees','save',$1::jsonb) result",[JSON.stringify({fullName:'Pessoa de teste diário',registrationNumber:'D01',jobTitle:'Operador'})])).rows[0].result.employee;
  const base={companyId:ids.company,dateFrom:'2026-09-26',dateTo:'2026-10-25',referenceMonth:'2026-10',sector:'Agrícola',rows:[{employeeId:person.id,hours50:'48:00',hours100:'30:00'}]};
  let report=(await rpc('save',base)).report;
  const scope={companyId:ids.company,id:report.id,employeeId:person.id};
  let read=await rpc('daily-get',scope);
  assert.equal(read.daily.total50,'48:00:00');assert.equal(read.daily.hasDailyEntries,false);assert.equal(report.rows[0].source,'legacy');
  assert.deepEqual(read.daily.entries,[]);assert.equal(read.daily.calculated50,'00:00:00');
  const initial={...scope,expectedUpdatedAt:report.updatedAt,activity:'Moagem',sector:'Indústria',adjustment:null,entries:[
   {date:'2026-09-27',startTime:'06:05',endTime:'18:05',breakStart:'',breakEnd:'',breakDuration:'02:00',rate:'100',reason:'Plantão moagem',approval:'LS'},
   {date:'2026-10-11',startTime:'06:10',breakStart:'12:10',breakEnd:'13:10',endTime:'18:10',breakDuration:'',rate:'50',reason:'Plantão',approval:''},
   {date:'2026-10-12',startTime:'22:00',breakStart:'23:30',breakEnd:'00:00',endTime:'06:00',breakDuration:'',rate:'100',reason:'Noturno',approval:''},
   {date:'2026-10-25',startTime:'06:30:10',endTime:'08:00:15',breakDuration:'00:00:00',rate:'50'},
  ]};
  let result=await rpc('daily-save',initial);report=result.report;
  assert.equal(result.daily.hasDailyEntries,true);assert.equal(result.daily.legacyHours50,'48:00:00');assert.equal(result.daily.legacyHours100,'30:00:00');
  assert.equal(result.daily.total50,'12:30:05');assert.equal(result.daily.total100,'17:30:00');assert.equal(result.daily.calculated50,'12:30:05');
  assert.equal(result.daily.entries[0].breakDuration,'02:00:00');assert.equal(result.daily.entries[0].hours100,'10:00:00');
  assert.equal(report.rows[0].daily.entries.length,4);assert.equal(report.rows[0].source,'daily');assert.equal(report.total50,'12:30:05');
  await denied('daily-save',initial,'23514');
  const current={...initial,expectedUpdatedAt:report.updatedAt};
  for(const patch of [
   {ownerId:ids.otherOwner}, {entries:[{...initial.entries[0],date:'2026-09-25'}]}, {entries:[{...initial.entries[0],startTime:'24:00'}]},
   {entries:[{...initial.entries[0],breakDuration:''}]}, {entries:[{...initial.entries[0],breakStart:'12:00',breakEnd:''}]},
   {entries:[{...initial.entries[0],breakStart:'19:00',breakEnd:'20:00'}]}, {entries:[{...initial.entries[0],breakDuration:'13:00'}]},
   {entries:[{...initial.entries[0],rate:'75'}]}, {entries:[{...initial.entries[0],hours100:'99:00'}]},
   {entries:[{...initial.entries[0],startTime:'06:05',endTime:'06:05'}]}, {adjustment:{hours50:'12:00',hours100:'11:00',reason:''}},
  ])await denied('daily-save',{...current,...patch},'22023');
  await denied('daily-save',{...current,entries:[initial.entries[0],initial.entries[0]]},'23505');
  read=await rpc('daily-get',scope);assert.equal(read.daily.entries.length,4,'Invalid replacements are atomic');assert.equal(read.report.updatedAt,report.updatedAt);
  // A metadata autosave with stale or manipulated totals cannot overwrite the daily projection.
  report=(await rpc('save',{...base,id:report.id,expectedUpdatedAt:report.updatedAt,notes:'Nota atualizada',rows:[{employeeId:person.id,hours50:'999:00',hours100:'888:00'}]})).report;
  assert.equal(report.total50,'12:30:05');assert.equal(report.total100,'17:30:00');assert.equal(report.rows[0].daily.entries.length,4);
  await denied('save',{...base,id:report.id,expectedUpdatedAt:report.updatedAt,dateFrom:'2026-10-01'},'23514');
  result=await rpc('daily-save',{...current,expectedUpdatedAt:report.updatedAt,adjustment:{hours50:'13:00',hours100:'18:00',reason:'Correção autorizada'}});report=result.report;
  assert.equal(result.daily.calculated50,'12:30:05');assert.equal(report.total50,'13:00:00');assert.equal(report.total100,'18:00:00');
  assert.equal(result.daily.adjustment.reason,'Correção autorizada');
  result=await rpc('daily-save',{...current,expectedUpdatedAt:report.updatedAt,adjustment:null});report=result.report;
  assert.equal(report.total50,'12:30:05');assert.equal(result.daily.adjustment,null);
  const finished=(await rpc('finish',{companyId:ids.company,id:report.id,expectedUpdatedAt:report.updatedAt})).report;
  await denied('daily-save',{...current,expectedUpdatedAt:finished.updatedAt},'23514');
  report=(await rpc('reopen',{companyId:ids.company,id:report.id,expectedUpdatedAt:finished.updatedAt})).report;
  await setActor(ids.otherOwner);
  await denied('daily-get',scope,'P0002');await denied('daily-save',{...current,expectedUpdatedAt:report.updatedAt},'P0002');
  for(const table of ['billing_overtime_daily_entries','billing_overtime_daily_sheets'])assert.equal((await db.query('SELECT * FROM public.'+table)).rows.length,0);
  await setActor(ids.owner);
  for(const table of ['billing_overtime_daily_entries','billing_overtime_daily_sheets']){
   await assert.rejects(db.exec('DELETE FROM public.'+table),error=>error.code==='42501');
   await assert.rejects(db.exec('UPDATE public.'+table+' SET owner_id=owner_id'),error=>error.code==='42501');
   await assert.rejects(db.exec('INSERT INTO public.'+table+' DEFAULT VALUES'),error=>error.code==='42501');
  }
  await denied('daily-get',{...scope,companyId:ids.siblingCompany},'P0002');
  await db.exec('RESET ROLE');await db.query("UPDATE public.billing_access_profiles SET permissions=ARRAY['overtime.read'] WHERE id=$1",[ids.readerProfile]);await setActor(ids.reader);
  assert.equal((await rpc('daily-get',scope)).daily.entries.length,4);await denied('daily-save',{...current,expectedUpdatedAt:report.updatedAt},'42501');
  await setActor(null);await denied('daily-get',scope,'28000');
  await setActor(ids.owner);
  result=await rpc('daily-save',{...current,expectedUpdatedAt:report.updatedAt,entries:[]});report=result.report;
  assert.equal(report.total50,'00:00:00');assert.equal(report.canFinish,false);assert.equal(result.daily.legacyHours50,'48:00:00');
  report=(await rpc('save',{...base,id:report.id,expectedUpdatedAt:report.updatedAt,rows:[]})).report;
  assert.equal(report.rows.length,0);assert.equal((await db.query('SELECT * FROM public.billing_overtime_daily_sheets')).rows.length,0);
 }finally{await db.close();}
});
