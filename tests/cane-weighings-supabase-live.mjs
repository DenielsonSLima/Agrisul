// Opt-in live verification. Uses the already authenticated Supabase CLI and
// ephemeral identities only. Administrative keys remain in process memory.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';

if(process.env.BILLING_RUN_LIVE_TESTS!=='1')throw Error('Set BILLING_RUN_LIVE_TESTS=1 for ephemeral live verification.');
const ref='ykounjabfsrtkzostbbz';
assert.equal(readFileSync('supabase/.temp/project-ref','utf8').trim(),ref);
const cli=process.env.BILLING_SUPABASE_CLI||'.sites-runtime/tools/supabase.exe';
const {keys}=JSON.parse(execFileSync(cli,['projects','api-keys','--project-ref',ref,'--reveal','--output-format','json'],{encoding:'utf8'}));
const publicKey=keys.find(key=>key.type==='publishable')?.api_key;
const adminKey=keys.find(key=>key.type==='secret')?.api_key;
assert.ok(publicKey&&adminKey);
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(`https://${ref}.supabase.co`,adminKey,options);
const accounts=[];
const output='.sites-runtime/pesagens-validation';mkdirSync(output,{recursive:true});
const cleanupRecord=`${output}/identities-${randomUUID()}.json`;
let ws,tab,send;
async function account(){
 const email=`cane-${randomUUID()}@example.com`,password=`Aa9!${randomUUID()}`;
 const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(error);
 const result={id:data.user.id,client:createClient(`https://${ref}.supabase.co`,publicKey,options)};
 accounts.push(result);writeFileSync(cleanupRecord,JSON.stringify({projectRef:ref,userIds:accounts.map(a=>a.id)}));
 const signed=await result.client.auth.signInWithPassword({email,password});assert.ifError(signed.error);result.session=signed.data.session;
 return result;
}
async function rpc(client,resource,action,payload={}){
 const {data,error}=await client.rpc('billing_rpc',{p_resource:resource,p_action:action,p_payload:payload});
 if(error)throw Object.assign(Error(error.message),{code:error.code});return data;
}
try{
 const owner=await account(),other=await account();
 const details={tradeName:'',cnpj:'',street:'',number:'',complement:'',district:'',city:'',state:'',zipCode:'',phone:'',email:''};
 const company=(await rpc(owner.client,'companies','save',{...details,legalName:'AGRISUL · teste pesagens',isPrimary:true})).company;
 const partner=(await rpc(owner.client,'clients','save',{...details,legalName:'TAQUARI · teste pesagens',cnpj:'33444555000161',status:'Ativo'})).client;
 const otherCompany=(await rpc(other.client,'companies','save',{...details,legalName:'Outra conta · teste pesagens',isPrimary:true})).company;
 const control=(await rpc(owner.client,'cane-weighings','save',{companyId:company.id,partnerId:partner.id,startDate:'2026-10-16'})).control;
 const input={companyId:company.id,controlId:control.id,weighedAt:'2026-10-16',weighedTime:'18:07',ticket:'LIVE-133',notes:'',trailerGrossMode:'combined',combinedTrailerGrossKg:'55.220',components:[
  {fleetNumber:'133',plate:'QMP6D31',kind:'truck',tareKg:'16.400',grossKg:'38.860',partnerNetKg:'22.710'},
  {fleetNumber:'277',plate:'OEK4136',kind:'trailer',tareKg:'10.320',grossKg:null,partnerNetKg:'20.600'},
  {fleetNumber:'267',plate:'OEK4276',kind:'trailer',tareKg:'10.320',grossKg:null,partnerNetKg:'13.150'},
 ]};
 const entry=(await rpc(owner.client,'cane-weighings','save-entry',input)).entry;
 assert.equal(entry.agrisulNetKg,'57040');assert.equal(entry.partnerNetKg,'56460');assert.equal(entry.differenceKg,'-580');
 assert.equal(entry.components[1].grossKg,'27610');
 assert.deepEqual((await rpc(other.client,'cane-weighings','list',{companyId:otherCompany.id})).controls,[]);
 await assert.rejects(rpc(other.client,'cane-weighings','get',{companyId:otherCompany.id,id:control.id}),error=>error.code==='P0002');
 assert.ok((await owner.client.from('billing_cane_weighing_entries').update({notes:'denied'}).eq('id',entry.id)).error);
 assert.deepEqual((await other.client.from('billing_cane_weighing_entries').select('id')).data,[]);
 const anonymous=createClient(`https://${ref}.supabase.co`,publicKey,options);
 assert.ok((await anonymous.rpc('billing_rpc',{p_resource:'cane-weighings',p_action:'list',p_payload:{companyId:company.id}})).error);
 console.log('Live RPC: source workbook arithmetic, shared trailer allocation, two-account isolation, RLS and RPC-only writes passed.');

 const cdp=process.env.BILLING_CDP_URL;
 if(cdp){
  const base=process.env.BILLING_BASE_URL||'http://127.0.0.1:5173';
  tab=await(await fetch(`${cdp}/json/new?about:blank`,{method:'PUT'})).json();
  ws=new WebSocket(tab.webSocketDebuggerUrl);const pending=new Map(),errors=[];let sequence=0;
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout ${method}`));},45000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);const job=pending.get(message.id);if(job){pending.delete(message.id);clearTimeout(job.timer);message.error?job.reject(Error(message.error.message)):job.resolve(message.result);}});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const wait=async(expression,label)=>{const end=Date.now()+45000;while(Date.now()<end){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,150));}throw Error(`Missing ${label}: ${await evaluate('document.body.innerText.slice(-1800)')} ${errors.join('\n')}`);};
  const click=async selector=>{const point=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);assert.ok(point,selector);await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});};
  const clickText=async text=>{assert.ok(await evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)return false;e.click();return true;})()`),text);};
  const set=async(selector,value)=>{assert.ok(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`),selector);};
  const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(`${output}/${name}.png`,Buffer.from(r.data,'base64'));};
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(base)}){localStorage.clear();localStorage.setItem('sb-${ref}-auth-token',${JSON.stringify(JSON.stringify(owner.session))});localStorage.setItem('billing:${owner.id}:active-company',${JSON.stringify(company.id)});}`});
  await send('Page.navigate',{url:`${base}/pesagens`});
  await wait("!!document.querySelector('.weighing-control-card')",'weighing list');await shot('01-list');
  await clickText('Novo controle');await wait("!!document.querySelector('.weighing-control-dialog')",'create dialog');
  await set('.weighing-control-dialog input[type=date]','2026-10-19');
  await wait("document.querySelector('.weighing-control-dialog [role=combobox]')?.disabled===false",'loaded partners');
  await click('.weighing-control-dialog [role=combobox]');await wait("!!document.querySelector('[role=option]')",'partner option');await click('[role=option]');
  await shot('02-create-control');await clickText('Criar controle');
  await wait("location.search.includes('controle=') && !!document.querySelector('.weighing-metrics')",'new control detail');
  assert.ok(await evaluate("document.body.innerText.includes('19/10/2026')"));
  await clickText('Adicionar viagem');await wait("!!document.querySelector('.weighing-entry-dialog')",'trip dialog');
  await set('.weighing-entry-meta input[type=time]','18:07');await set('.weighing-entry-meta .field:last-child input','BROWSER-133');
  await set('.weighing-combined input','55.220');
  const values=[['133','QMP6D31','16.400','38.860','22.710'],['277','OEK4136','10.320','20.600'],['267','OEK4276','10.320','13.150']];
  // Labels wrap each input, so select the section's input collection by index.
  await evaluate(`(()=>{const values=${JSON.stringify(values)};document.querySelectorAll('.weighing-component').forEach((section,i)=>section.querySelectorAll('input').forEach((input,j)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,values[i][j]);input.dispatchEvent(new Event('input',{bubbles:true}));}));})()`);
  await shot('03-trip-form');await clickText('Salvar viagem');
  await wait("!document.querySelector('.weighing-entry-dialog') && document.querySelectorAll('.weighing-trip').length===1",'saved trip');
  assert.ok(await evaluate("document.querySelector('.weighing-metrics').textContent.includes('57.040')"));
  assert.ok(await evaluate("document.querySelector('.weighing-metrics').textContent.includes('-580')"));
  await shot('04-comparison');
  for(const width of [390,768,1024]){
   await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});
   await new Promise(resolve=>setTimeout(resolve,250));
   assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),`no page horizontal overflow ${width}`);
   if(width===390)await shot('05-mobile');
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  const browserId=await evaluate("new URLSearchParams(location.search).get('controle')");
  const browserEntry=(await rpc(owner.client,'cane-weighings','get',{companyId:company.id,id:browserId})).entries[0];
  // An independent API write must reach the already-open browser through Realtime.
  await rpc(owner.client,'cane-weighings','save-entry',{...input,id:browserEntry.id,controlId:browserId,weighedAt:'2026-10-19',ticket:'BROWSER-133',components:input.components.map((c,i)=>({...c,partnerNetKg:i===0?'22.711':c.partnerNetKg}))});
  await wait("document.querySelector('.weighing-metrics').textContent.includes('-579')",'independent Realtime update');
  await click('.weighing-row-actions button[aria-label^="Editar"]');await wait("!!document.querySelector('.weighing-entry-dialog')",'edit trip');
  assert.equal(await evaluate("document.querySelector('.weighing-combined input').value"),'55220');
  await shot('06-edit-trip');await clickText('Cancelar');
  await click('.weighing-row-actions button[aria-label^="Excluir"]');await wait("document.body.innerText.includes('Excluir esta viagem?')",'delete confirmation');await clickText('Excluir viagem');
  await wait("!document.querySelector('.weighing-trip')",'trip removed');
  assert.deepEqual(errors,[]);
  console.log('Live browser: date/partner creation, paper-trip entry, real server calculations, edit, confirmed delete, responsive layouts and independent Realtime refresh passed.');
 }
}finally{
 if(send){try{await send('Page.navigate',{url:'about:blank'});}catch{}}
 if(ws)ws.close();
 if(tab&&process.env.BILLING_CDP_URL)await fetch(`${process.env.BILLING_CDP_URL}/json/close/${tab.id}`).catch(()=>{});
 const failed=[];
 for(const account of accounts){await account.client.auth.signOut({scope:'global'});const {error}=await admin.auth.admin.deleteUser(account.id);if(error)failed.push(account.id);}
 writeFileSync(cleanupRecord,JSON.stringify({projectRef:ref,userIds:failed,cleanupComplete:!failed.length}));
 assert.deepEqual(failed,[],'All temporary identities must be removed.');
 console.log('Removed only the temporary accounts and their test data.');
}
