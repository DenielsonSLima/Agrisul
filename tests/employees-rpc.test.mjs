import assert from 'node:assert/strict';
import test from 'node:test';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

test('employee API cancels stale account writes and forwards abort signals',async()=>{
 const require=createRequire(import.meta.url),{build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
 const directory=await mkdtemp(join(tmpdir(),'employees-api-'));
 try{
  const output=join(directory,'api.mjs');
  await build({stdin:{contents:"export * from './modules/cadastro/funcionarios/services/employeeApi';",resolveDir:process.cwd()},outfile:output,bundle:true,platform:'node',format:'esm',plugins:[{name:'fixture',setup(builder){
   builder.onResolve({filter:/^@\/shared\/supabase\/(rpc|client)$/},args=>({path:args.path,namespace:'fixture'}));
   builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path.endsWith('/rpc')?'export class RpcError extends Error {constructor(message,status,code){super(message);this.code=code;}};export const rpcRequest=(...args)=>globalThis.employeeApiFixture.rpc(...args);':'export const getSupabaseBrowserClient=()=>globalThis.employeeApiFixture.client;'}));
  }}]});
  const api=await import(pathToFileURL(output));
  let actor='employee-owner';const calls=[];
  globalThis.employeeApiFixture={client:{auth:{getSession:async()=>({data:{session:{user:{id:actor}}},error:null})}},rpc:async(...args)=>{calls.push(args);return {employee:{id:'employee-a'},deleted:true};}};
  const controller=new AbortController(),execution={actorId:actor,signal:controller.signal},input={fullName:'Maria Silva',registrationNumber:'0001'};
  await api.fetchEmployees(controller.signal);assert.deepEqual(calls.at(-1),['employees','list',{},controller.signal]);
  assert.deepEqual(await api.persistEmployee(input,execution),{id:'employee-a'});assert.deepEqual(calls.at(-1),['employees','save',input,controller.signal]);
  await api.deleteEmployee('employee-a',execution);assert.deepEqual(calls.at(-1),['employees','delete',{id:'employee-a'},controller.signal]);
  const count=calls.length;actor='another-owner';
  await assert.rejects(api.persistEmployee(input,execution),error=>error.code==='BILLING_SESSION_ACTOR_CHANGED');
  await assert.rejects(api.deleteEmployee('employee-a',execution),error=>error.code==='BILLING_SESSION_ACTOR_CHANGED');assert.equal(calls.length,count);
  actor=execution.actorId;controller.abort();
  await assert.rejects(api.persistEmployee(input,execution),error=>error.name==='AbortError');assert.equal(calls.length,count);
  const live=new AbortController();
  globalThis.employeeApiFixture.rpc=async()=>{actor='another-owner';return {employee:{id:'employee-a'}};};
  await assert.rejects(api.persistEmployee(input,{actorId:execution.actorId,signal:live.signal}),error=>error.code==='BILLING_SESSION_ACTOR_CHANGED');
 }finally{delete globalThis.employeeApiFixture;await rm(directory,{recursive:true,force:true});}
});

test('employee registry validates names and textual unique registrations, CRUD, workspace isolation and permissions',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(action,payload={})=>(await db.query(`SELECT public.billing_rpc('employees',$1,$2::jsonb) result`,[action,JSON.stringify(payload)])).rows[0].result;
 const denied=(action,payload,code)=>assert.rejects(rpc(action,payload),error=>error.code===code);
 try{
  assert.deepEqual(await rpc('list'),{employees:[],canManage:true});
  const input={fullName:'  Maria   Aparecida Santos  ',registrationNumber:' 00123 '};
  const {employee}=await rpc('save',input);
  assert.equal(employee.fullName,'Maria Aparecida Santos');assert.equal(employee.registrationNumber,'00123');
  assert.ok(employee.createdAt&&employee.updatedAt);assert.equal('ownerId' in employee,false);
  await denied('save',input,'23505');
  const alpha=(await rpc('save',{fullName:'José dos Santos',registrationNumber:'AB-01'})).employee;
  await denied('save',{fullName:'Outro nome',registrationNumber:'ab-01'},'23505');
  const sameName=(await rpc('save',{...input,registrationNumber:'00124'})).employee;
  assert.notEqual(sameName.id,employee.id,'Names need not be unique');
  for(const payload of [
   {},{fullName:' ',registrationNumber:'1'},{fullName:'Ana Silva',registrationNumber:'\t '},
   {fullName:3,registrationNumber:'1'},{fullName:'Ana Silva',registrationNumber:123},
   {fullName:'x'.repeat(161),registrationNumber:'1'},{fullName:'Ana Silva',registrationNumber:'x'.repeat(61)},
   {...input,ownerId:ids.otherOwner},{...input,owner_id:ids.otherOwner},{...input,id:5},{...input,id:'invalid'},
  ])await denied('save',payload,'22023');
  await denied('list',{ownerId:ids.owner},'22023');
  await denied('delete',{},'22023');await denied('unknown',{},'22023');
  await denied('save',null,'22023');
  const edited=(await rpc('save',{id:employee.id,fullName:'Maria Aparecida Souza',registrationNumber:'00007'})).employee;
  assert.equal(edited.id,employee.id);assert.equal(edited.registrationNumber,'00007');
  await denied('save',{id:employee.id,fullName:edited.fullName,registrationNumber:alpha.registrationNumber},'23505');
  assert.equal((await rpc('list')).employees.find(e=>e.id===employee.id).registrationNumber,'00007','Conflicting edit is atomic');
  for(const statement of [
   `INSERT INTO public.billing_employees(owner_id,full_name,registration_number) VALUES('${ids.owner}','Direto','2')`,
   `UPDATE public.billing_employees SET full_name='Indevido' WHERE id='${employee.id}'`,
   `DELETE FROM public.billing_employees WHERE id='${employee.id}'`,
  ])await assert.rejects(db.exec(statement),error=>error.code==='42501');
  await setActor(ids.otherOwner);
  assert.deepEqual((await rpc('list')).employees,[]);
  assert.equal((await db.query('SELECT * FROM public.billing_employees')).rows.length,0);
  await denied('delete',{id:employee.id},'P0002');
  await denied('save',{id:employee.id,...input},'P0002');
  await rpc('save',input); // A separate workspace can reuse a registration.
  await setActor(ids.reader);await denied('list',{},'42501');
  assert.equal((await db.query('SELECT * FROM public.billing_employees')).rows.length,0);
  await db.exec('RESET ROLE');
  await db.query(`UPDATE public.billing_access_profiles SET permissions=ARRAY['registrations.read'] WHERE id=$1`,[ids.readerProfile]);
  await setActor(ids.reader);
  assert.equal((await rpc('list')).employees.length,3);assert.equal((await rpc('list')).canManage,false);
  assert.equal((await db.query('SELECT * FROM public.billing_employees')).rows.length,3);
  await denied('save',input,'42501');await denied('delete',{id:employee.id},'42501');
  await setActor(null);await denied('list',{},'28000');
  await setActor(ids.owner);
  assert.deepEqual(await rpc('delete',{id:employee.id}),{id:employee.id,deleted:true});
  await denied('delete',{id:employee.id},'P0002');
  assert.equal((await rpc('list')).employees.length,2);
  assert.ok((await db.query(`SELECT public.billing_rpc('clients','list','{}') result`)).rows[0].result.clients,'Existing routes survive');
  const functions=await db.query(`SELECT proname,prosecdef,proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='public' AND proname='billing_rpc') OR (n.nspname='billing_private' AND proname IN ('dispatch','employees_dispatch'))`);
  for(const row of functions.rows){assert.equal(row.prosecdef,row.proname!=='billing_rpc');assert.ok(row.proconfig.includes('search_path=""'));}
 }finally{await db.close();}
});
