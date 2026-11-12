import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync('modules/solicitacoes/horas-extras/utils/draftRecovery.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {reportDraft,recoverReportDraft,recoverDailyDraft,blockingOvertimeRead}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const day=(date='2026-11-01',reason='Base')=>({date,startTime:'18:00',endTime:'20:00',breakStart:'',breakEnd:'',breakDuration:'00:00:00',rate:'50',reason,approval:''});
const daily=()=>({activity:'Operação',sector:'Agrícola',entries:[day()],adjustment:null});
const report=()=>({id:'report',companyId:'company',dateFrom:'2026-10-26',dateTo:'2026-11-25',referenceMonth:'2026-11',sector:'Agrícola',notes:'',updatedAt:'r1',status:'open',rows:[{employeeId:'one',employeeName:'Pessoa',hours50:'02:00:00',hours100:'00:00:00',daily:daily()}]});

test('monthly recovery retains local edits, remote additions and server totals without an optimistic overwrite',()=>{
 const base=report(),local={...reportDraft(base),notes:'Minha nota'},remote=report();remote.updatedAt='r2';remote.sector='Indústria';remote.rows[0].hours50='03:00:00';remote.rows.push({employeeId:'two',hours50:'00:00:00',hours100:'01:00:00'});
 const recovered=recoverReportDraft(base,local,remote);
 assert.deepEqual(recovered.conflicts,[]);assert.equal(recovered.input.notes,'Minha nota');assert.equal(recovered.input.sector,'Indústria');assert.equal(recovered.input.rows[0].hours50,'03:00:00');assert.equal(recovered.input.rows.length,2);
 remote.notes='Outra nota';assert.deepEqual(recoverReportDraft(base,local,remote).conflicts,['Observação']);assert.equal(local.notes,'Minha nota');
});
test('local employee removal conflicts with a remote daily edit instead of deleting the newly saved work',()=>{
 const base=report(),local={...reportDraft(base),rows:[]},remote=report();remote.rows[0].daily.entries[0].reason='Editado em outra sessão';
 assert.deepEqual(recoverReportDraft(base,local,remote).conflicts,['Lançamentos de Pessoa']);
 assert.deepEqual(recoverReportDraft(base,local,base).conflicts,[]);
});
test('recovery recognizes a committed write and keeps keystrokes made after that write',()=>{
 const base=report(),remote=report();remote.notes='Primeira nota';
 assert.equal(recoverReportDraft(base,{...reportDraft(base),notes:'Primeira nota'},remote).alreadySaved,true);
 const submitted={...reportDraft(base),notes:'Primeira nota'},next=recoverReportDraft(base,{...submitted,notes:'Segunda nota'},remote,submitted);
 assert.equal(next.alreadySaved,false);assert.equal(next.input.notes,'Segunda nota');assert.deepEqual(next.conflicts,[]);
 assert.throws(()=>recoverReportDraft(base,reportDraft(base),{...remote,id:'other'}));
});
test('daily recovery merges independent dates and formatting while protecting edits to the same day',()=>{
 const base=daily(),local=daily(),remote=daily();local.entries[0].reason='Local';remote.entries[0].startTime='18:00:00';remote.entries[0].endTime='20:00:00';remote.entries[0].hours50='02:00:00';remote.entries.push(day('2026-11-02','Remoto'));
 let recovered=recoverDailyDraft(base,local,remote,report());assert.deepEqual(recovered.conflicts,[]);assert.equal(recovered.input.entries.length,2);assert.equal(recovered.input.entries[0].reason,'Local');
 remote.entries[0].reason='Concorrente';assert.deepEqual(recoverDailyDraft(base,local,remote,report()).conflicts,['Dia 2026-11-01']);
 recovered=recoverDailyDraft(base,base,remote,{...report(),dateFrom:'2026-11-02'});assert.ok(recovered.conflicts.includes('Período do relatório'));
});
test('daily committed writes and interval clock normalization do not manufacture a conflict or a duplicate save',()=>{
 const base=daily();base.entries[0].breakStart='18:30';base.entries[0].breakEnd='19:00';
 const remote=structuredClone(base);remote.entries[0].breakStart='18:30:00';remote.entries[0].breakEnd='19:00:00';remote.entries[0].breakDuration='00:30:00';
 assert.equal(recoverDailyDraft(base,base,remote,report()).alreadySaved,true);
 const local=structuredClone(base);local.adjustment={hours50:'3:00',hours100:'00:00',reason:'  Conferido  '};remote.adjustment={hours50:'03:00:00',hours100:'00:00:00',reason:'Conferido'};
 assert.equal(recoverDailyDraft(base,local,remote,report()).alreadySaved,true);
 const submitted=structuredClone(local),later=structuredClone(local);later.adjustment.reason='Conferência posterior';
 const recovered=recoverDailyDraft(base,later,remote,report(),submitted);
 assert.deepEqual(recovered.conflicts,[]);assert.equal(recovered.input.adjustment.reason,'Conferência posterior');assert.equal(recovered.alreadySaved,false);
});
test('cached drafts survive transient refetch errors, but access failures remain blocking',()=>{
 for(const status of [500,503,504])assert.equal(blockingOvertimeRead({error:'Rede',status,data:report()}),false);
 for(const status of [401,403,404])assert.equal(blockingOvertimeRead({error:'Acesso',status,data:report()}),true);
 assert.equal(blockingOvertimeRead({error:'Rede',status:503,data:undefined}),true);
});
