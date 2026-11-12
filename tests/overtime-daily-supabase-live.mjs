import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,unlinkSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';

if(process.env.BILLING_RUN_LIVE_TESTS!=='1')throw Error('Set BILLING_RUN_LIVE_TESTS=1 for isolated live verification.');
const ref='ykounjabfsrtkzostbbz';
assert.equal(readFileSync('supabase/.temp/project-ref','utf8').trim(),ref);
const raw=JSON.parse(execFileSync('.sites-runtime/tools/supabase.exe',['projects','api-keys','--project-ref',ref,'--reveal','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const keys=Array.isArray(raw)?raw:raw.api_keys??raw.apiKeys??raw.keys;
const publicKey=keys.find(k=>k.type==='publishable')?.api_key;
const secret=keys.find(k=>k.type==='secret')?.api_key??keys.find(k=>k.name==='service_role')?.api_key;
assert.ok(publicKey&&secret);
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const url=`https://${ref}.supabase.co`,admin=createClient(url,secret,options),users=[],clients=[];
const directory='.sites-runtime/overtime-daily-validation';mkdirSync(directory,{recursive:true});
const journal=directory+'/identities-'+randomUUID()+'.json';let channel;
async function rpc(client,action,payload={},resource='overtime'){
 const {data,error}=await client.rpc('billing_rpc',{p_resource:resource,p_action:action,p_payload:payload}).retry(false).abortSignal(AbortSignal.timeout(30000));
 if(error)throw Object.assign(Error(error.message),{code:error.code});return data;
}
async function account(){
 const email=`daily-overtime-${randomUUID()}@example.com`,password=randomUUID()+'Aa9!';
 const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);
 users.push(created.data.user.id);writeFileSync(journal,JSON.stringify({projectRef:ref,userIds:users}));
 const client=createClient(url,publicKey,options);clients.push(client);
 const signed=await client.auth.signInWithPassword({email,password});assert.ifError(signed.error);
 await rpc(client,'get',{},'settings');return {client,id:created.data.user.id,session:signed.data.session};
}
try{
 const a=await account(),b=await account();
 const details={tradeName:'',cnpj:'',street:'',number:'',complement:'',district:'',city:'',state:'',zipCode:'',phone:'',email:''};
 const company=(await rpc(a.client,'save',{...details,legalName:'Empresa Teste Diário',isPrimary:true},'companies')).company;
 const otherCompany=(await rpc(b.client,'save',{...details,legalName:'Outra Empresa Teste Diário',isPrimary:true},'companies')).company;
 const employee=(await rpc(a.client,'save',{fullName:'Funcionário Teste Diário',registrationNumber:'DIA-001',jobTitle:'Operador'},'employees')).employee;
 const base={companyId:company.id,dateFrom:'2026-10-26',dateTo:'2026-11-25',referenceMonth:'2026-11',sector:'Agrícola',notes:'Validação efêmera',rows:[{employeeId:employee.id,hours50:'00:00:00',hours100:'00:00:00'}]};
 let report=(await rpc(a.client,'save',base)).report;
 const scope={companyId:company.id,id:report.id,employeeId:employee.id};
 const independent=createClient(url,publicKey,{...options,global:{headers:{Authorization:'Bearer '+a.session.access_token}}});clients.push(independent);
 const entries=[
  {date:'2026-10-27',startTime:'06:00',breakStart:'12:00',breakEnd:'13:30',breakDuration:'',endTime:'18:00',rate:'50',reason:'Serviço de teste',approval:'Conferido'},
  {date:'2026-11-01',startTime:'22:00',breakStart:'',breakEnd:'',breakDuration:'00:30:00',endTime:'06:00',rate:'100',reason:'Plantão noturno de teste',approval:''},
 ];
 const input={...scope,activity:'Operação de teste',sector:'Agrícola',entries,adjustment:null};
 let resolveSeen;const seen=new Promise(resolve=>{resolveSeen=resolve;});
 await a.client.realtime.setAuth(a.session.access_token);
 channel=a.client.channel('daily-overtime-live-'+randomUUID()).on('postgres_changes',{event:'INSERT',schema:'public',table:'billing_overtime_daily_entries'},event=>{if(event.new.report_id===report.id)resolveSeen();});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Daily Realtime subscription timed out')),25000);channel.on('system',{},event=>{if(event.status==='ok'&&event.extension==='postgres_changes'){clearTimeout(timer);resolve();}});channel.subscribe(status=>{if(['CHANNEL_ERROR','TIMED_OUT'].includes(status)){clearTimeout(timer);reject(Error(status));}});});
 let result=await rpc(independent,'daily-save',{...input,expectedUpdatedAt:report.updatedAt});
 let eventTimer;try{await Promise.race([seen,new Promise((_,reject)=>{eventTimer=setTimeout(()=>reject(Error('Daily Realtime event missing')),25000);})]);}finally{clearTimeout(eventTimer);}
 assert.equal(result.daily.calculated50,'10:30:00');assert.equal(result.daily.calculated100,'07:30:00');
 assert.equal(result.daily.totalHours,'18:00:00');assert.equal(result.daily.entryCount,2);
 assert.equal(result.report.total50,'10:30:00');assert.equal(result.report.total100,'07:30:00');report=result.report;
 assert.equal((await rpc(independent,'daily-get',scope)).daily.entries.length,2);
 await assert.rejects(rpc(independent,'daily-save',{...input,expectedUpdatedAt:base.updatedAt??'2000-01-01T00:00:00Z'}),e=>e.code==='23514');
 await assert.rejects(rpc(b.client,'daily-get',{...scope,companyId:otherCompany.id}),e=>e.code==='P0002');
 await assert.rejects(rpc(a.client,'daily-save',{...input,expectedUpdatedAt:report.updatedAt,ownerId:b.id}),e=>e.code==='22023');
 const anonymous=createClient(url,publicKey,options);clients.push(anonymous);
 await assert.rejects(rpc(anonymous,'daily-get',scope),e=>['42501','28000'].includes(e.code));
 for(const table of ['billing_overtime_daily_sheets','billing_overtime_daily_entries']){
  const invisible=await b.client.from(table).select('*');assert.ifError(invisible.error);assert.deepEqual(invisible.data,[]);
  assert.equal((await a.client.from(table).delete().eq('owner_id',a.id)).error?.code,'42501');
  assert.equal((await a.client.from(table).update({owner_id:a.id}).eq('owner_id',a.id)).error?.code,'42501');
  assert.equal((await a.client.from(table).insert({owner_id:a.id,report_id:report.id,employee_id:employee.id})).error?.code,'42501');
 }
 const preserved=await rpc(a.client,'save',{...base,id:report.id,expectedUpdatedAt:report.updatedAt,notes:'Metadados atualizados'});
 assert.equal(preserved.report.total50,'10:30:00');assert.equal((await rpc(a.client,'daily-get',scope)).daily.entries.length,2);report=preserved.report;
 result=await rpc(a.client,'daily-save',{...input,expectedUpdatedAt:report.updatedAt,adjustment:{hours50:'11:00:00',hours100:'08:00:00',reason:'Ajuste de conferência'}});
 assert.equal(result.daily.calculated50,'10:30:00');assert.equal(result.report.total50,'11:00:00');report=result.report;
 assert.equal(result.daily.totalHours,'19:00:00');assert.equal(result.daily.entryCount,2);
 await assert.rejects(rpc(a.client,'daily-save',{...input,expectedUpdatedAt:report.updatedAt,adjustment:{hours50:'11:00:00',hours100:'08:00:00',reason:''}}),e=>e.code==='22023');
 if(process.env.BILLING_DAILY_BROWSER==='1'){
  const {verifyDailyOvertimeBrowser}=await import('./overtime-daily-browser.mjs');
  await verifyDailyOvertimeBrowser({directory,ref,session:a.session,report,employee,rpc:(action,payload)=>rpc(a.client,action,payload)});
 }
 console.log('PASS live daily RPC: exact intervals and overnight durations, totals, adjustment with reason, preservation after monthly autosave, stale edits, account isolation, DML denial and independent Realtime.');
}finally{
 if(channel)await clients[0]?.removeChannel(channel);
 for(const client of clients){await client.removeAllChannels();await client.auth.signOut({scope:'local'});}
 const failures=[];for(const id of users){const {error}=await admin.auth.admin.deleteUser(id);if(error)failures.push(error.message);}
 if(!failures.length){try{unlinkSync(journal);}catch{}}
 assert.deepEqual(failures,[],'Remove only the ephemeral test accounts');
 console.log('Removed ephemeral daily overtime test accounts and their data.');
}
