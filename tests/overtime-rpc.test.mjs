import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('period overtime sheets preserve 50/100 quantities, employee roles and historical identities with exact server totals',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(action,payload={})=>(await db.query("SELECT public.billing_rpc('overtime',$1,$2::jsonb) result",[action,JSON.stringify(payload)])).rows[0].result;
 const denied=(action,payload,code)=>assert.rejects(rpc(action,payload),error=>error.code===code);
 const employee=async(input)=>(await db.query("SELECT public.billing_rpc('employees','save',$1::jsonb) result",[JSON.stringify(input)])).rows[0].result.employee;
 try{
  const scope={companyId:ids.company};
  const maria=await employee({fullName:'Maria Aparecida Santos',registrationNumber:'00123',jobTitle:'Motorista'});
  const jose=await employee({fullName:'José Carlos Santos',registrationNumber:'00124',jobTitle:'Operador'});
  const withoutRole=await employee({fullName:'Funcionário sem cargo',registrationNumber:'00125'});
  assert.equal((await rpc('options',scope)).employees.find(e=>e.id===maria.id).jobTitle,'Motorista');
  assert.equal((await rpc('options',scope)).canRegisterEmployees,true);
  assert.deepEqual(await rpc('preview',{...scope,rows:[{hours50:'50:22:30',hours100:'48:00'},{hours50:'49:37:30',hours100:'30:00'}]}),{total50:'100:00:00',total100:'78:00:00'});
  assert.deepEqual(await rpc('preview',{...scope,rows:[]}),{total50:'00:00:00',total100:'00:00:00'});
  await denied('preview',{...scope,rows:[{hours50:'50:75',hours100:''}]},'22023');
  await denied('preview',{...scope,rows:[{hours50:'50:00',hours100:'',total50:'1'}]},'22023');
  await denied('preview',{companyId:ids.otherCompany,rows:[]},'P0002');
  assert.deepEqual((await rpc('list',scope)).reports,[]);
  const input={...scope,dateFrom:'2026-09-26',dateTo:'2026-10-25',referenceMonth:'2026-09',sector:'Agrícola',
   rows:[{employeeId:maria.id,hours50:'21:22:30',hours100:'08:00'},{employeeId:jose.id,hours50:'48:00',hours100:'30:00:45'}]};
  const saved=await rpc('save',input),report=saved.report;assert.equal(saved.created,true);
  assert.equal(report.total50,'69:22:30');assert.equal(report.total100,'38:00:45');assert.equal(report.employeeCount,2);
  assert.equal(report.referenceMonth,'2026-09');assert.equal(report.rows[0].registrationNumber,'00123');
  assert.equal(report.rows[0].jobTitle,'Motorista');assert.equal(report.rows[0].hours100,'08:00:00');
  assert.equal((await rpc('list',{...scope,dateFrom:'2026-10-01',dateTo:'2026-10-30'})).reports.length,1,'Periods that overlap the filter are included');
  assert.equal((await rpc('list',{...scope,dateFrom:'2026-11-01',dateTo:'2026-11-30'})).reports.length,0);
  for(const patch of [
   {dateFrom:'2026-10-26'},{dateTo:'2026-02-30'},{referenceMonth:'2026-13'},{sector:5},{ownerId:ids.otherOwner},
   {rows:[{employeeId:maria.id,hours50:'48:60',hours100:''}]},
   {rows:[{employeeId:maria.id,hours50:'1.5',hours100:''}]},
   {rows:[{employeeId:maria.id,hours50:2,hours100:''}]},
   {rows:[{employeeId:maria.id,hours50:'-01:00',hours100:''}]},
   {rows:[{employeeId:maria.id,hours50:'01:00',hours100:'',jobTitle:'Fiscal'}]},
   {rows:[{employeeId:withoutRole.id,hours50:'01:00',hours100:''}]},
  ])await denied('save',{...input,...patch},'22023');
  await denied('save',{...input,rows:[input.rows[0],input.rows[0]]},'23505');
  assert.equal((await rpc('list',scope)).reports.length,1,'Invalid saves do not leave partial sheets');
  await denied('save',{...input,id:report.id},'22023');
  await employee({id:maria.id,fullName:'Maria Santos Atualizada',registrationNumber:'00123',jobTitle:'Fiscal'});
  let snapshot=(await rpc('get',{...scope,id:report.id})).report;
  assert.equal(snapshot.rows[0].jobTitle,'Motorista');assert.equal(snapshot.rows[0].employeeName,'Maria Aparecida Santos','Saved reports preserve identity snapshots');
  const legacy=await employee({id:maria.id,fullName:'Maria Santos Atualizada',registrationNumber:'00123'});
  assert.equal(legacy.jobTitle,'Fiscal','Older clients preserve jobTitle when omitted');
  const updated=await rpc('save',{...input,id:report.id,expectedUpdatedAt:report.updatedAt});
  assert.equal(updated.created,false);assert.equal(updated.report.rows[0].jobTitle,'Fiscal');
  await denied('save',{...input,id:report.id,expectedUpdatedAt:report.updatedAt},'23514');
  await denied('delete',{...scope,id:report.id,expectedUpdatedAt:report.updatedAt},'23514');
  await denied('save',{...input,id:report.id,expectedUpdatedAt:updated.report.updatedAt,rows:[input.rows[0],input.rows[0]]},'23505');
  snapshot=(await rpc('get',{...scope,id:report.id})).report;assert.equal(snapshot.rows.length,2);assert.equal(snapshot.total50,'69:22:30','Failed edits are atomic');

  // Reproduce the durations from the user's reference sheet without importing personal records.
  const values50=['31:00','48:00','48:00','48:00','48:00','48:00','48:00','02:00','38:00','48:00','48:00','14:00','21:22','48:00','26:00','14:00','12:00'];
  const values100=['','30:00','24:00','40:00','30:00','30:00','40:00','','16:00','30:00','40:00','26:00','08:00','30:00','20:00','10:00','10:00'];
  const rows=[];
  for(let i=0;i<values50.length;i++){const person=await employee({fullName:'Funcionário de teste '+i,registrationNumber:'REF-'+i,jobTitle:'Operador'});rows.push({employeeId:person.id,hours50:values50[i],hours100:values100[i]});}
  const reference=(await rpc('save',{...input,rows})).report;
  assert.equal(reference.total50,'590:22:00');assert.equal(reference.total100,'384:00:00');
  const long=(await rpc('save',{...input,rows:[{employeeId:jose.id,hours50:'999999:59:59',hours100:''},{employeeId:maria.id,hours50:'01:00:01',hours100:''}]})).report;
  assert.equal(long.total50,'1000001:00:00','Totals do not truncate or wrap at 24 or 99 hours');
  await assert.rejects(db.query("SELECT public.billing_rpc('employees','delete',$1::jsonb)",[JSON.stringify({id:jose.id})]),error=>error.code==='23503');
  await denied('get',{companyId:ids.siblingCompany,id:report.id},'P0002');
  await setActor(ids.otherOwner);
  const other=await employee({fullName:'Outro funcionário',registrationNumber:'00123',jobTitle:'Motorista'});
  await denied('get',{...scope,id:report.id},'P0002');
  assert.equal((await db.query('SELECT * FROM public.billing_overtime_reports')).rows.length,0);
  assert.equal((await db.query('SELECT * FROM public.billing_overtime_rows')).rows.length,0);
  await setActor(ids.owner);await denied('save',{...input,rows:[{employeeId:other.id,hours50:'01:00',hours100:''}]},'P0002');
  for(const table of ['billing_overtime_reports','billing_overtime_rows']){
   await assert.rejects(db.exec('DELETE FROM public.'+table),error=>error.code==='42501');
   await assert.rejects(db.exec('UPDATE public.'+table+' SET owner_id=owner_id'),error=>error.code==='42501');
  }
  await assert.rejects(db.exec("INSERT INTO public.billing_overtime_reports(owner_id,company_id,date_from,date_to,reference_month) VALUES('"+ids.owner+"','"+ids.company+"','2026-01-01','2026-01-31','2026-01-01')"),error=>error.code==='42501');
  await setActor(ids.reader);await denied('list',scope,'42501');
  await db.exec('RESET ROLE');await db.query("UPDATE public.billing_access_profiles SET permissions=ARRAY['requests.read'] WHERE id=$1",[ids.readerProfile]);
  await setActor(ids.reader);assert.equal((await rpc('get',{...scope,id:report.id})).canManage,false);
  assert.equal((await rpc('options',scope)).canRegisterEmployees,false);
  assert.ok((await rpc('options',scope)).employees.length);
  await denied('save',input,'42501');await denied('delete',{...scope,id:report.id,expectedUpdatedAt:snapshot.updatedAt},'42501');
  await setActor(null);await denied('list',scope,'28000');
  await setActor(ids.owner);assert.equal((await rpc('delete',{...scope,id:report.id,expectedUpdatedAt:snapshot.updatedAt})).deleted,true);
  assert.equal((await db.query('SELECT * FROM public.billing_overtime_rows WHERE report_id=$1',[report.id])).rows.length,0,'Deletion removes only the selected report rows');
  assert.equal((await rpc('list',scope)).reports.length,2);
  const pendingA=await employee({fullName:'Manildo Santos Honorato',registrationNumber:'',jobTitle:'Fiscal'});
  const pendingB=await employee({fullName:'Outro aguardando matrícula',registrationNumber:' ',jobTitle:'Operador'});
  assert.equal(pendingA.registrationNumber,'');assert.equal(pendingB.registrationNumber,'');
  const pendingReport=(await rpc('save',{...input,rows:[{employeeId:pendingA.id,hours50:'48:00',hours100:'30:00'}]})).report;
  assert.equal(pendingReport.rows[0].registrationNumber,'');assert.equal(pendingReport.rows[0].jobTitle,'Fiscal');
  await employee({id:pendingA.id,fullName:pendingA.fullName,registrationNumber:'09999',jobTitle:'Fiscal'});
  assert.equal((await rpc('get',{...scope,id:pendingReport.id})).report.rows[0].registrationNumber,'','Historical report preserves its saved blank registration');
 }finally{await db.close();}
});

test('overtime opens an empty period, filters by search/date/status, and finalizes only saved employee rows',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(action,payload)=>(await db.query("SELECT public.billing_rpc('overtime',$1,$2::jsonb) result",[action,JSON.stringify(payload)])).rows[0].result;
 const denied=(action,payload,code)=>assert.rejects(rpc(action,payload),error=>error.code===code);
 try{
  const scope={companyId:ids.company};
  const input={...scope,dateFrom:'2026-09-26',dateTo:'2026-10-25',notes:'Equipe de colheita 50%'};
  const created=(await rpc('create',input)).report;
  assert.equal(created.status,'open');assert.equal(created.notes,input.notes);assert.equal(created.referenceMonth,'2026-09');
  assert.equal(created.employeeCount,0);assert.equal(created.total50,'00:00:00');assert.deepEqual(created.rows,[]);
  assert.equal(created.canFinish,false);
  await denied('finish',{...scope,id:created.id,expectedUpdatedAt:created.updatedAt},'23514');
  const person=(await db.query("SELECT public.billing_rpc('employees','save',$1::jsonb) result",[JSON.stringify({fullName:'Maria do Relatório',registrationNumber:'001',jobTitle:'Operadora'})])).rows[0].result.employee;
  const saved=(await rpc('save',{...scope,id:created.id,dateFrom:created.dateFrom,dateTo:created.dateTo,sector:'Agrícola',referenceMonth:created.referenceMonth,notes:created.notes,expectedUpdatedAt:created.updatedAt,rows:[{employeeId:person.id,hours50:'48:00',hours100:'30:00'}]})).report;
  const other=(await rpc('create',{...input,notes:'Oficina',dateFrom:'2026-11-01',dateTo:'2026-11-30'})).report;
  assert.equal((await rpc('list',{...scope,search:'colheita'})).reports[0].id,saved.id);
  assert.equal((await rpc('list',{...scope,search:'MARIA'})).reports[0].id,saved.id);
  assert.equal((await rpc('list',{...scope,search:'001'})).reports[0].id,saved.id);
  assert.equal((await rpc('list',{...scope,search:'%'})).reports.length,1,'Search treats percent literally');
  assert.equal((await rpc('list',{...scope,search:'_%'})).reports.length,0);
  assert.equal((await rpc('list',{...scope,dateFrom:'2026-10-01',dateTo:'2026-10-31'})).reports.length,1);
  await denied('finish',{...scope,id:saved.id,expectedUpdatedAt:created.updatedAt},'23514');
  const finished=(await rpc('finish',{...scope,id:saved.id,expectedUpdatedAt:saved.updatedAt})).report;
  assert.equal(finished.status,'finished');assert.ok(finished.finishedAt);assert.equal(finished.total50,'48:00:00');
  assert.equal(finished.canFinish,false);
  const open=await rpc('list',scope);assert.deepEqual(open.counts,{open:1,finished:1});assert.deepEqual(open.reports.map(r=>r.id),[other.id]);
  const final=await rpc('list',{...scope,status:'finished'});assert.deepEqual(final.reports.map(r=>r.id),[saved.id]);
  await denied('finish',{...scope,id:saved.id,expectedUpdatedAt:finished.updatedAt},'23514');
  await denied('save',{...scope,id:saved.id,expectedUpdatedAt:finished.updatedAt,dateFrom:saved.dateFrom,dateTo:saved.dateTo,referenceMonth:saved.referenceMonth,sector:saved.sector,rows:[{employeeId:person.id,hours50:'01:00',hours100:''}]},'23514');
  const reopened=(await rpc('reopen',{...scope,id:saved.id,expectedUpdatedAt:finished.updatedAt})).report;
  assert.equal(reopened.status,'open');assert.equal(reopened.finishedAt,null);assert.equal(reopened.canFinish,true);
  await denied('reopen',{...scope,id:saved.id,expectedUpdatedAt:reopened.updatedAt},'23514');
  const draft=(await rpc('save',{...scope,id:saved.id,expectedUpdatedAt:reopened.updatedAt,dateFrom:saved.dateFrom,dateTo:saved.dateTo,referenceMonth:saved.referenceMonth,sector:saved.sector,rows:[{employeeId:person.id,hours50:'',hours100:''}]})).report;
  assert.equal(draft.employeeCount,1);assert.equal(draft.total50,'00:00:00');assert.equal(draft.canFinish,false);
  await denied('finish',{...scope,id:saved.id,expectedUpdatedAt:draft.updatedAt},'23514');
  const restored=(await rpc('save',{...scope,id:saved.id,expectedUpdatedAt:draft.updatedAt,dateFrom:saved.dateFrom,dateTo:saved.dateTo,referenceMonth:saved.referenceMonth,sector:saved.sector,rows:[{employeeId:person.id,hours50:'48:00',hours100:'30:00'}]})).report;
  const finalAgain=(await rpc('finish',{...scope,id:saved.id,expectedUpdatedAt:restored.updatedAt})).report;
  for(const patch of [{dateTo:'2026-02-30'},{dateTo:'2026-09-25'},{notes:'x'.repeat(2001)},{notes:4},{rows:[]},{ownerId:ids.otherOwner}])await denied('create',{...input,...patch},'22023');
  await denied('list',{...scope,search:'x'.repeat(161)},'22023');await denied('list',{...scope,status:'invented'},'22023');
  await denied('finish',{companyId:ids.siblingCompany,id:saved.id,expectedUpdatedAt:finished.updatedAt},'P0002');
  await setActor(ids.reader);await db.exec('RESET ROLE');await db.query("UPDATE public.billing_access_profiles SET permissions=ARRAY['requests.read'] WHERE id=$1",[ids.readerProfile]);await setActor(ids.reader);
  assert.equal((await rpc('list',{...scope,status:'finished'})).reports.length,1);
  await denied('create',input,'42501');await denied('finish',{...scope,id:other.id,expectedUpdatedAt:other.updatedAt},'42501');
  await denied('reopen',{...scope,id:saved.id,expectedUpdatedAt:finalAgain.updatedAt},'42501');
  await setActor(ids.owner);await rpc('delete',{...scope,id:saved.id,expectedUpdatedAt:finalAgain.updatedAt});
 }finally{await db.close();}
});
