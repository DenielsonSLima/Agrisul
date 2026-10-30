import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,unlinkSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';

if(process.env.BILLING_RUN_LIVE_TESTS!=='1')throw Error('Set BILLING_RUN_LIVE_TESTS=1 for isolated live verification.');
const ref='ykounjabfsrtkzostbbz';assert.equal(readFileSync('supabase/.temp/project-ref','utf8').trim(),ref);
const raw=JSON.parse(execFileSync('.sites-runtime/tools/supabase.exe',['projects','api-keys','--project-ref',ref,'--reveal','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const keys=Array.isArray(raw)?raw:raw.api_keys??raw.apiKeys??raw.keys;
const pub=keys.find(k=>k.type==='publishable')?.api_key,secret=keys.find(k=>k.type==='secret')?.api_key??keys.find(k=>k.name==='service_role')?.api_key;
assert.ok(pub&&secret);
const url=`https://${ref}.supabase.co`,options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(url,secret,options),users=[],clients=[];
const directory='.sites-runtime/employees-validation';mkdirSync(directory,{recursive:true});
const journal=directory+'/identities-'+randomUUID()+'.json';let observer;
async function rpc(client,action,payload={},resource='employees'){
 const {data,error}=await client.rpc('billing_rpc',{p_resource:resource,p_action:action,p_payload:payload}).abortSignal(AbortSignal.timeout(30000));
 if(error)throw Object.assign(Error(error.message),{code:error.code});return data;
}
async function account(){
 const email=`employees-${randomUUID()}@example.com`,password=randomUUID()+'Aa9!';
 const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);
 users.push(created.data.user.id);writeFileSync(journal,JSON.stringify({projectRef:ref,userIds:users}));
 const client=createClient(url,pub,options);clients.push(client);
 const signed=await client.auth.signInWithPassword({email,password});assert.ifError(signed.error);
 await rpc(client,'get',{},'settings');return {client,id:created.data.user.id,session:signed.data.session};
}
async function browser(owner,other,independent){
 const endpoint=process.env.BILLING_EMPLOYEES_CDP??'http://127.0.0.1:9362';
 const tab=await(await fetch(endpoint+'/json/new?about:blank',{method:'PUT'})).json();
 const socket=new WebSocket(tab.webSocketDebuggerUrl),pending=new Map(),errors=[];let sequence=0,script;
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.text);if(pending.has(msg.id)){const job=pending.get(msg.id);pending.delete(msg.id);clearTimeout(job.timer);if(msg.error)job.reject(Error(msg.error.message));else job.resolve(msg.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'));},30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;};
 const wait=async(expression,label)=>{const end=Date.now()+45000;while(Date.now()<end){if(await evaluate(`Boolean(${expression})`))return;await new Promise(resolve=>setTimeout(resolve,200));}throw Error(label+': '+await evaluate('document.body.innerText.slice(-1800)'));};
 const click=(text,scope='document')=>evaluate(`(()=>{const node=[...${scope}.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled);if(!node)throw Error('Missing button');node.click();})()`);
 const input=(selector,value)=>evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 const visit=async session=>{if(script)await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:script});script=(await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('sb-${ref}-auth-token',${JSON.stringify(JSON.stringify(session))});`})).identifier;await send('Page.navigate',{url:'http://127.0.0.1:5173/cadastro?secao=funcionarios'});await wait("document.querySelector('.employees-workspace .company-empty')",'empty registry');};
 const open=async()=>{await click('Cadastrar funcionário');await wait("document.querySelector('.employee-form')",'employee form');};
 const fill=async(name,number)=>{await input('.employee-form input[autocomplete=name]',name);await input('.employee-form input[autocomplete=off]',number);};
 try{
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
  await visit(owner.session);await open();await fill('Maria Aparecida Santos','00123');
  await click('Cadastrar funcionário',"document.querySelector('.employee-modal')");
  await wait("!document.querySelector('.employee-modal')&&document.querySelector('.employees-table')?.textContent.includes('00123')",'created employee');
  assert.equal((await rpc(owner.client,'list')).employees[0].registrationNumber,'00123');
  await open();await fill('Duplicado Teste','00123');await click('Cadastrar funcionário',"document.querySelector('.employee-modal')");
  await wait("document.querySelector('.form-error')?.textContent.includes('matrícula')",'inline duplicate error');await click('Cancelar',"document.querySelector('.employee-modal')");
  await click('Editar');await wait("document.querySelector('.employee-modal')",'edit form');await fill('Maria Aparecida Souza','00007');
  await click('Salvar alterações');await wait("!document.querySelector('.employee-modal')&&document.querySelector('.employees-table')?.textContent.includes('00007')",'updated employee');
  await input('.employees-toolbar input','inexistente');await wait("document.querySelector('.company-empty')?.textContent.includes('Nenhum funcionário encontrado')",'search empty');
  await click('Limpar busca');await wait("document.querySelector('.employees-table')",'search reset');
  await rpc(independent,'save',{fullName:'José Carlos Realtime',registrationNumber:'00999'});
  await wait("document.querySelector('.employees-table')?.textContent.includes('José Carlos Realtime')",'independent Realtime refresh');
  writeFileSync(directory+'/desktop.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Mobile viewport contains the table');
  writeFileSync(directory+'/mobile.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate("document.querySelector('[aria-label=\"Excluir Maria Aparecida Souza\"]').click()");
  await wait("document.querySelector('[role=alertdialog]')",'delete confirmation');await click('Cancelar',"document.querySelector('[role=alertdialog]')");
  assert.equal((await rpc(owner.client,'list')).employees.length,2);
  await evaluate("document.querySelector('[aria-label=\"Excluir Maria Aparecida Souza\"]').click()");
  await wait("document.querySelector('[role=alertdialog]')",'second delete confirmation');await click('Excluir funcionário',"document.querySelector('[role=alertdialog]')");
  await wait("!document.querySelector('.employees-table')?.textContent.includes('Maria Aparecida Souza')",'deleted employee');
  await open();await fill('Rascunho da conta anterior','00888');
  await evaluate(`(()=>{const key='sb-${ref}-auth-token',session=${JSON.stringify(other.session)};localStorage.setItem(key,JSON.stringify(session));const channel=new BroadcastChannel(key);channel.postMessage({event:'SIGNED_IN',session});setTimeout(()=>channel.close(),100);})()`);
  await wait("document.querySelector('.employees-workspace .company-empty')?.textContent.includes('Nenhum funcionário cadastrado')&&!document.querySelector('.employee-form')",'account change clears draft and old records');
  assert.equal(await evaluate("document.querySelector('.employees-workspace').textContent.includes('José Carlos Realtime')"),false);
  assert.deepEqual(errors,[],'No browser runtime errors');
  console.log('PASS browser: create/edit/search/duplicate feedback, delete confirmation/cancellation, independent Realtime refresh, mobile layout and account isolation.');
 }finally{socket.close();await fetch(endpoint+'/json/close/'+tab.id);}
}
try{
 const a=await account(),b=await account();
 const independent=createClient(url,pub,{...options,global:{headers:{Authorization:`Bearer ${a.session.access_token}`}}});clients.push(independent);
 const anonymous=createClient(url,pub,options);clients.push(anonymous);
 await assert.rejects(rpc(anonymous,'list'),error=>['42501','28000'].includes(error.code));
 let resolveSeen;const seen=new Promise(resolve=>{resolveSeen=resolve;});
 observer=a.client.channel('employees-live-'+randomUUID()).on('postgres_changes',{event:'INSERT',schema:'public',table:'billing_employees'},event=>{if(event.new.owner_id===a.id)resolveSeen();});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Realtime subscription timed out')),25000);observer.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}if(['CHANNEL_ERROR','TIMED_OUT'].includes(status)){clearTimeout(timer);reject(Error(status));}});});
 const input={fullName:'Ana Maria Teste',registrationNumber:'00001'};
 const results=await Promise.allSettled([rpc(a.client,'save',input),rpc(independent,'save',input)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'23505');
 let timer;try{await Promise.race([seen,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Realtime insert missing')),15000);})]);}finally{clearTimeout(timer);}
 const employee=results.find(r=>r.status==='fulfilled').value.employee;
 assert.equal(employee.registrationNumber,'00001');assert.deepEqual((await rpc(b.client,'list')).employees,[]);
 await assert.rejects(rpc(b.client,'delete',{id:employee.id}),error=>error.code==='P0002');
 await assert.rejects(rpc(a.client,'save',{...input,ownerId:b.id}),error=>error.code==='22023');
 assert.equal((await b.client.from('billing_employees').select('id')).data.length,0);
 for(const operation of [
  ()=>a.client.from('billing_employees').insert({owner_id:a.id,full_name:'Direto',registration_number:'2'}),
  ()=>a.client.from('billing_employees').update({full_name:'Indevido'}).eq('id',employee.id),
  ()=>a.client.from('billing_employees').delete().eq('id',employee.id),
 ])assert.equal((await operation()).error?.code,'42501');
 await rpc(a.client,'delete',{id:employee.id});
 console.log('PASS live RPC: concurrent unique registrations, leading zeroes, RLS/account/no-session isolation, direct DML denied and independent Realtime.');
 await browser(a,b,independent);
}finally{
 if(observer)await clients[0]?.removeChannel(observer);
 for(const client of clients){await client.removeAllChannels();await client.auth.signOut({scope:'local'});}
 const failures=[];
 for(const id of users){const {error}=await admin.auth.admin.deleteUser(id);if(error)failures.push(error.message);}
 if(!failures.length){try{unlinkSync(journal);}catch{}}
 assert.deepEqual(failures,[],'Remove only the ephemeral test accounts');
 console.log('Removed ephemeral employee test accounts and their data.');
}
