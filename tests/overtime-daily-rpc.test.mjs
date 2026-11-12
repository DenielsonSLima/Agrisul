import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
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
  assert.equal(read.daily.totalHours,'78:00:00');assert.equal(read.daily.entryCount,0);
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
  assert.equal(result.daily.totalHours,'30:00:05');assert.equal(result.daily.entryCount,4);
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
  await denied('daily-save',{...current,entries:[initial.entries[0],initial.entries[0]]},'23514');
  read=await rpc('daily-get',scope);assert.equal(read.daily.entries.length,4,'Invalid replacements are atomic');assert.equal(read.report.updatedAt,report.updatedAt);
  // A metadata autosave with stale or manipulated totals cannot overwrite the daily projection.
  report=(await rpc('save',{...base,id:report.id,expectedUpdatedAt:report.updatedAt,notes:'Nota atualizada',rows:[{employeeId:person.id,hours50:'999:00',hours100:'888:00'}]})).report;
  assert.equal(report.total50,'12:30:05');assert.equal(report.total100,'17:30:00');assert.equal(report.rows[0].daily.entries.length,4);
  await denied('save',{...base,id:report.id,expectedUpdatedAt:report.updatedAt,dateFrom:'2026-10-01'},'23514');
  result=await rpc('daily-save',{...current,expectedUpdatedAt:report.updatedAt,adjustment:{hours50:'13:00',hours100:'18:00',reason:'Correção autorizada'}});report=result.report;
  assert.equal(result.daily.calculated50,'12:30:05');assert.equal(report.total50,'13:00:00');assert.equal(report.total100,'18:00:00');
  assert.equal(result.daily.totalHours,'31:00:00');assert.equal(result.daily.entryCount,4);
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
  assert.equal(result.daily.totalHours,'00:00:00');assert.equal(result.daily.entryCount,0);
  report=(await rpc('save',{...base,id:report.id,expectedUpdatedAt:report.updatedAt,rows:[]})).report;
  assert.equal(report.rows.length,0);assert.equal((await db.query('SELECT * FROM public.billing_overtime_daily_sheets')).rows.length,0);
 }finally{await db.close();}
});

test('same-date overtime periods retain identities, split rates, count distinct days and reject crossed clocks',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(action,payload)=>(await db.query("SELECT public.billing_rpc('overtime',$1,$2::jsonb) result",[action,JSON.stringify(payload)])).rows[0].result;
 const denied=(payload,code)=>assert.rejects(rpc('daily-save',payload),error=>error.code===code);
 const entry=patch=>({date:'2026-10-27',startTime:'08:00',endTime:'10:00',breakStart:'',breakEnd:'',breakDuration:'00:00:00',rate:'50',reason:'Período de teste',approval:'',...patch});
 const idsForPeriods=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003'];
 const inputEntry=({hours50,hours100,...value})=>value;
 try{
  const employee=(await db.query("SELECT public.billing_rpc('employees','save',$1::jsonb) result",[JSON.stringify({fullName:'Pessoa com dois períodos',registrationNumber:'DUO1',jobTitle:'Operador'})])).rows[0].result.employee;
  const base={companyId:ids.company,dateFrom:'2026-10-26',dateTo:'2026-11-25',referenceMonth:'2026-11',sector:'Agrícola',rows:[{employeeId:employee.id,hours50:'00:00',hours100:'00:00'}]};
  let report=(await rpc('save',base)).report;
  const scope={companyId:ids.company,id:report.id,employeeId:employee.id};
  const input={...scope,activity:'Dois períodos',sector:'Agrícola',adjustment:null,entries:[entry({id:idsForPeriods[1],startTime:'10:00',endTime:'13:00',breakDuration:'00:30:00',rate:'100'}),entry({id:idsForPeriods[0]})]};
  let result=await rpc('daily-save',{...input,expectedUpdatedAt:report.updatedAt});report=result.report;
  assert.deepEqual(result.daily.entries.map(value=>value.id),idsForPeriods.slice(0,2),'Stable periods are ordered by date and clock, independent of payload order');
  assert.equal(result.daily.entries.length,2);assert.equal(result.daily.entryCount,1);
  assert.equal(result.daily.total50,'02:00:00');assert.equal(result.daily.total100,'02:30:00');assert.equal(result.daily.totalHours,'04:30:00');
  assert.equal(result.report.rows[0].daily.entries.length,2);assert.equal(result.report.total50,'02:00:00');assert.equal(result.report.total100,'02:30:00');
  result=await rpc('daily-save',{...input,expectedUpdatedAt:report.updatedAt,entries:result.daily.entries.map(inputEntry).reverse()});report=result.report;
  assert.deepEqual(result.daily.entries.map(value=>value.id),idsForPeriods.slice(0,2),'Replacing a sheet preserves explicit period ids');
  const snapshot=result;
  await denied({...input,expectedUpdatedAt:report.updatedAt,entries:[entry({})]},'23514');
  assert.deepEqual((await rpc('daily-get',scope)).daily,snapshot.daily,'An older one-row-per-day client cannot collapse a date with two periods');
  for(const entries of [
   [entry({id:idsForPeriods[0]}),entry({id:idsForPeriods[1],startTime:'09:59:59',endTime:'12:00',rate:'100'})],
   [entry({date:'2026-10-27',startTime:'22:00',endTime:'02:00'}),entry({date:'2026-10-28',startTime:'01:00',endTime:'03:00',rate:'100'})],
   [entry({date:'2026-10-28',startTime:'01:00',endTime:'03:00',rate:'100'}),entry({date:'2026-10-27',startTime:'22:00',endTime:'02:00'})],
   [entry({startTime:'08:00',endTime:'12:00',breakStart:'09:00',breakEnd:'10:00'}),entry({startTime:'09:00',endTime:'10:00',rate:'100'})],
  ])await denied({...input,expectedUpdatedAt:report.updatedAt,entries:entries.map(value=>({id:randomUUID(),...value}))},'23514');
  await denied({...input,expectedUpdatedAt:report.updatedAt,entries:[entry({id:idsForPeriods[0]}),entry({id:idsForPeriods[0],startTime:'10:00',endTime:'11:00',rate:'100'})]},'23505');
  for(const id of [null,'','not-a-uuid'])await denied({...input,expectedUpdatedAt:report.updatedAt,entries:[entry({id})]},'22023');
  const nine=Array.from({length:9},(_,i)=>entry({id:randomUUID(),startTime:String(i).padStart(2,'0')+':00',endTime:String(i+1).padStart(2,'0')+':00',rate:i%2?'100':'50'}));
  await denied({...input,expectedUpdatedAt:report.updatedAt,entries:nine},'22023');
  await denied({...input,expectedUpdatedAt:report.updatedAt,entries:Array.from({length:2929},()=>entry({}))},'22023');
  assert.deepEqual((await rpc('daily-get',scope)).daily,snapshot.daily,'Invalid replacements preserve both periods and the prior totals atomically');
  result=await rpc('daily-save',{...input,expectedUpdatedAt:report.updatedAt,entries:nine.slice(0,8)});report=result.report;
  assert.equal(result.daily.entries.length,8);assert.equal(result.daily.entryCount,1);assert.equal(result.daily.total50,'04:00:00');assert.equal(result.daily.total100,'04:00:00');
  // A date is the period's start date; touching intervals on the following day are valid.
  result=await rpc('daily-save',{...input,expectedUpdatedAt:report.updatedAt,entries:[entry({id:idsForPeriods[0],date:'2026-10-27',startTime:'22:00',endTime:'02:00'}),entry({id:idsForPeriods[1],date:'2026-10-28',startTime:'02:00',endTime:'04:00',rate:'100'})]});report=result.report;
  assert.equal(result.daily.entryCount,2);assert.equal(result.daily.totalHours,'06:00:00');
  // An older client can continue editing one period per day without ids; that identity is kept.
  const withoutIds=result.daily.entries.map(({id,...value})=>inputEntry(value));
  result=await rpc('daily-save',{...input,expectedUpdatedAt:report.updatedAt,entries:withoutIds});report=result.report;
  assert.deepEqual(result.daily.entries.map(value=>value.id),idsForPeriods.slice(0,2));
  const otherReport=(await rpc('save',{...base,companyId:ids.siblingCompany})).report;
  const otherScope={companyId:ids.siblingCompany,id:otherReport.id,employeeId:employee.id};
  await denied({...input,...otherScope,expectedUpdatedAt:otherReport.updatedAt,entries:[entry({id:idsForPeriods[0]})]},'22023');
  assert.equal((await rpc('daily-get',otherScope)).daily.entries.length,0,'An id cannot be moved to another report');
  await setActor(ids.otherOwner);
  const otherEmployee=(await db.query("SELECT public.billing_rpc('employees','save',$1::jsonb) result",[JSON.stringify({fullName:'Outra pessoa',registrationNumber:'DUO2',jobTitle:'Operador'})])).rows[0].result.employee;
  const foreignReport=(await rpc('save',{...base,companyId:ids.otherCompany,rows:[{employeeId:otherEmployee.id,hours50:'00:00',hours100:'00:00'}]})).report;
  await denied({...input,companyId:ids.otherCompany,id:foreignReport.id,employeeId:otherEmployee.id,expectedUpdatedAt:foreignReport.updatedAt,entries:[entry({id:idsForPeriods[0]})]},'22023');
  await setActor(ids.owner);
  assert.deepEqual((await rpc('daily-get',scope)).daily.entries.map(value=>value.id),idsForPeriods.slice(0,2),'Foreign-owner attempts leave original periods intact');
 }finally{await db.close();}
});
