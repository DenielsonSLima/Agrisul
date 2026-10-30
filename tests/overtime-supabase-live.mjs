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
const directory='.sites-runtime/overtime-validation';mkdirSync(directory,{recursive:true});
const journal=directory+'/identities-'+randomUUID()+'.json';let observer;
async function rpc(client,action,payload={},resource='overtime'){
 const {data,error}=await client.rpc('billing_rpc',{p_resource:resource,p_action:action,p_payload:payload}).retry(false).abortSignal(AbortSignal.timeout(30000));
 if(error)throw Object.assign(Error(error.message),{code:error.code});return data;
}
async function account(){
 const email=`overtime-${randomUUID()}@example.com`,password=randomUUID()+'Aa9!';
 const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);
 users.push(created.data.user.id);writeFileSync(journal,JSON.stringify({projectRef:ref,userIds:users}));
 const client=createClient(url,pub,options);clients.push(client);
 const signed=await client.auth.signInWithPassword({email,password});assert.ifError(signed.error);
 await rpc(client,'get',{},'settings');return {client,id:created.data.user.id,session:signed.data.session};
}
async function browser(owner,other,independent,fixture){
 const endpoint=process.env.BILLING_OVERTIME_CDP??'http://127.0.0.1:9363';
 const tab=await(await fetch(endpoint+'/json/new?about:blank',{method:'PUT'})).json();
 const socket=new WebSocket(tab.webSocketDebuggerUrl),pending=new Map(),errors=[];let sequence=0;
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.text);if(pending.has(msg.id)){const job=pending.get(msg.id);pending.delete(msg.id);clearTimeout(job.timer);if(msg.error)job.reject(Error(msg.error.message));else job.resolve(msg.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'));},30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;};
 const wait=async(expression,label)=>{const end=Date.now()+45000;while(Date.now()<end){if(await evaluate('Boolean('+expression+')'))return;await new Promise(resolve=>setTimeout(resolve,200));}throw Error(label+': '+await evaluate('document.body.innerText.slice(-2200)'));};
 const click=(text,scope='document')=>evaluate('(()=>{const node=[...'+scope+'.querySelectorAll("button")].find(e=>e.textContent.trim()==='+JSON.stringify(text)+'&&!e.disabled);if(!node)throw Error("Missing button "+'+JSON.stringify(text)+');node.click();})()');
 const input=(selector,value)=>evaluate('(()=>{const node=document.querySelector('+JSON.stringify(selector)+');if(!node)throw Error("Missing input "+'+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(node.tagName==="SELECT"?HTMLSelectElement.prototype:node.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value").set.call(node,'+JSON.stringify(value)+');node.dispatchEvent(new Event(node.tagName==="SELECT"?"change":"input",{bubbles:true}));})()');
 const screenshot=async name=>writeFileSync(directory+'/'+name+'.png',Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
 const clickTab=async value=>{
  const point=await evaluate('(()=>{const tab=[...document.querySelectorAll(".overtime-tabs [role=tab]")].find(node=>node.textContent.includes('+JSON.stringify(value)+'));if(!tab)throw Error("Missing tab");tab.scrollIntoView({block:"center"});const rect=tab.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()');
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
 };
 try{
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('sb-"+ref+"-auth-token',"+JSON.stringify(JSON.stringify(owner.session))+");"});
  await send('Page.navigate',{url:'http://127.0.0.1:5173/solicitacoes?secao=horas-extras'});
  await wait('document.querySelectorAll(".overtime-report-card").length===4','four report cards');
  const grid=await evaluate('(()=>{const nodes=[...document.querySelectorAll(".overtime-report-card")],top=nodes[0].getBoundingClientRect().top;return {columns:getComputedStyle(document.querySelector(".overtime-report-grid")).gridTemplateColumns.split(" ").length,sameRow:nodes.every(node=>Math.abs(node.getBoundingClientRect().top-top)<2),labels:[...document.querySelectorAll(".overtime-filters .field>span")].map(node=>node.textContent)};})()');
  assert.equal(grid.columns,4);assert.equal(grid.sameRow,true);assert.deepEqual(grid.labels,['Busca','Data inicial','Data final']);
  await screenshot('cards-desktop');
  await input('.overtime-filters input[type=search]','Setor de teste');await click('Filtrar');
  await wait('document.querySelectorAll(".overtime-report-card").length===1','search filter');
  await click('Limpar filtros');await wait('document.querySelectorAll(".overtime-report-card").length===4','cleared search');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".overtime-report-grid")).gridTemplateColumns.split(" ").length'),1);
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Mobile list stays within the viewport');
  await screenshot('cards-mobile');
  await click('Novo relatório');await wait('document.querySelector(".overtime-create-modal")','creation modal');
  assert.equal(await evaluate('document.querySelectorAll(".overtime-create-modal input").length'),2,'Only initial and final dates');
  assert.equal(await evaluate('document.querySelectorAll(".overtime-create-modal textarea").length'),1,'Only one observation');
  assert.equal(await evaluate('document.querySelector(".overtime-create-modal").contains(document.activeElement)'),true,'Modal traps focus');
  await input('.overtime-create-fields input[type=date]','2026-09-26');
  await input('.overtime-create-fields .field:nth-child(2) input','2026-10-25');
  await input('.overtime-create-fields textarea','AGRICOLA MODELO');
  await click('Criar relatório','document.querySelector(".overtime-create-modal")');
  await wait('document.querySelector(".overtime-editor")&&!document.querySelector(".overtime-create-modal")','period created and employee editor opened');
  assert.ok(await evaluate('document.querySelector(".overtime-breadcrumb").textContent.includes("26/09/2026")'));
  const clickSelector=async selector=>{
   const point=await evaluate('(()=>{const node=document.querySelector('+JSON.stringify(selector)+');if(!node)throw Error("Missing node");node.scrollIntoView({block:"center"});const r=node.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
   await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
  };
  const duration=async(selector,digits)=>{
   await evaluate('(()=>{const node=document.querySelector('+JSON.stringify(selector)+');node.focus();node.select();})()');
   for(const digit of digits){await send('Input.dispatchKeyEvent',{type:'keyDown',key:digit,text:digit,windowsVirtualKeyCode:digit.charCodeAt(0)});await send('Input.dispatchKeyEvent',{type:'keyUp',key:digit,windowsVirtualKeyCode:digit.charCodeAt(0)});}
  };
  const row50=index=>'.overtime-edit-table tbody tr:nth-child('+index+') td:nth-child(4) input';
  const row100=index=>'.overtime-edit-table tbody tr:nth-child('+index+') td:nth-child(5) input';
  await clickSelector('.overtime-edit-table tbody tr:nth-child(1) [role=combobox]');
  await input('.overtime-edit-table tbody tr:nth-child(1) [role=combobox]','Maria');
  await wait('document.querySelector("[data-employee-id=\\"'+fixture.maria.id+'\\"]")','employee typeahead result');
  await clickSelector('[data-employee-id="'+fixture.maria.id+'"]');
  await wait('document.querySelector(".overtime-edit-table tbody")?.textContent.includes("Motorista")','automatic role after search selection');
  assert.equal(await evaluate('[...document.querySelectorAll(".overtime-editor button")].some(node=>node.textContent.includes("Salvar relatório"))'),false,'No manual save button');
  await duration(row50(1),'50');
  assert.equal(await evaluate('document.querySelector('+JSON.stringify(row50(1))+').value'),'50:00:00');
  await duration(row50(1),'5022');
  await wait('document.activeElement===document.querySelector('+JSON.stringify(row100(1))+')','four digit completion moves focus to 100');
  assert.equal(await evaluate('document.querySelector('+JSON.stringify(row50(1))+').value'),'50:22:00');
  await duration(row50(1),'502235');
  await wait('document.activeElement===document.querySelector('+JSON.stringify(row100(1))+')','seconds completion moves focus to 100');
  assert.equal(await evaluate('document.querySelector('+JSON.stringify(row50(1))+').value'),'50:22:35');
  await duration(row100(1),'08');
  await click('Adicionar funcionário');
  await click('Cadastrar funcionário','document.querySelector(".overtime-editor-note")');
  await wait('document.querySelector(".employee-modal")','quick employee modal');
  await input('.employee-form input[autocomplete=name]','FUNCIONARIO CADASTRO RAPIDO');
  await input('.employee-form input[autocomplete=off]','00125');
  await input('.employee-form input[placeholder^="Ex.: Motorista"]','Fiscal');
  await click('Cadastrar funcionário','document.querySelector(".employee-modal")');
  await wait('!document.querySelector(".employee-modal")&&document.querySelectorAll(".overtime-edit-table tbody tr")[1]?.textContent.includes("Fiscal")','quick employee registered and selected');
  assert.equal(await evaluate('document.querySelector('+JSON.stringify(row50(1))+').value'),'50:22:35','Quick registration preserves typed hours');
  await duration(row50(2),'48');
  await evaluate('document.querySelector('+JSON.stringify(row100(2))+').focus()');
  await send('Input.insertText',{text:'30'});
  await wait('document.querySelector(".overtime-draft-summary output[aria-label=\\"Total de horas 50%\\"]")?.textContent==="98:22:35"','live 50 total from RPC');
  await wait('document.querySelector(".overtime-draft-summary output[aria-label=\\"Total de horas 100%\\"]")?.textContent==="38:00:00"','live 100 total from RPC');
  await wait('document.querySelector(".overtime-auto-save-status")?.textContent.includes("salvas")','automatic save settles');
  const reportId=await evaluate('new URL(location.href).searchParams.get("relatorio")');
  const snapshot=(await rpc(independent,'get',{companyId:fixture.company.id,id:reportId})).report;
  assert.equal(snapshot.total50,'98:22:35');assert.equal(snapshot.total100,'38:00:00');assert.equal(snapshot.employeeCount,2);
  assert.ok(await evaluate('[...document.querySelectorAll(".overtime-heading-actions button")].some(node=>node.textContent.includes("Exportar PDF"))'),'Export is beside the title while editing');
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Mobile employee editor stays within viewport');
  await screenshot('editor-mobile');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  const {resolve}=await import('node:path'),{readdir}=await import('node:fs/promises');
  const download=resolve(directory,'downloads');mkdirSync(download,{recursive:true});
  await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:download});
  await click('Exportar PDF');
  const deadline=Date.now()+30000;let files=[];
  while(Date.now()<deadline){files=(await readdir(download)).filter(file=>file.endsWith('.pdf'));if(files.length)break;await new Promise(resolve=>setTimeout(resolve,200));}
  assert.ok(files.length,'The PDF was downloaded');assert.equal(readFileSync(resolve(download,files.at(-1))).subarray(0,4).toString(),'%PDF');
  await screenshot('editor-desktop');
  await click('Finalizar');await wait('document.querySelector("[role=alertdialog]")','finalization confirmation');await click('Finalizar relatório','document.querySelector("[role=alertdialog]")');
  await wait('new URL(location.href).searchParams.get("aba")==="finalizados"&&document.querySelector(".overtime-report-card")?.textContent.includes("AGRICOLA MODELO")','finished tab and moved card');
  await evaluate('document.querySelector(".overtime-report-card").click()');
  await wait('document.querySelector(".overtime-sheet")','finished record opens from card');
  assert.equal(await evaluate('[...document.querySelectorAll(".overtime-heading-actions button")].some(node=>node.textContent.includes("Editar funcionários"))'),false,'Finished reports have no edit action');
  await click('Abrir novamente');await wait('document.querySelector("[role=alertdialog]")','reopen confirmation');await click('Abrir novamente','document.querySelector("[role=alertdialog]")');
  await wait('document.querySelector(".overtime-editor")','reopened report permits editing');
  await wait('document.querySelector(".overtime-auto-save-status")?.textContent.includes("salvas")','reopened sheet is saved');
  await click('Excluir');await wait('document.querySelector("[role=alertdialog]")','delete confirmation');await click('Cancelar','document.querySelector("[role=alertdialog]")');
  assert.ok((await rpc(owner.client,'get',{companyId:fixture.company.id,id:reportId})).report);
  await click('Excluir');await wait('document.querySelector("[role=alertdialog]")','confirmed delete');await click('Excluir relatório','document.querySelector("[role=alertdialog]")');
  await wait('!new URL(location.href).searchParams.has("relatorio")','returned to finished list');
  await clickTab('Em aberto');await wait('document.querySelector(".overtime-report-card")','open tab');
  await click('Novo relatório');await wait('document.querySelector(".overtime-create-modal")','new draft before account change');
  await input('.overtime-create-fields textarea','Rascunho anterior');
  await evaluate('(()=>{const key="sb-'+ref+'-auth-token",session='+JSON.stringify(other.session)+';localStorage.setItem(key,JSON.stringify(session));const channel=new BroadcastChannel(key);channel.postMessage({event:"SIGNED_IN",session});setTimeout(()=>channel.close(),100);})()');
  await wait('document.querySelector(".overtime-workspace")?.textContent.includes("Outra Empresa Hora Extra Teste")&&![...document.querySelectorAll(".overtime-create-modal textarea")].some(node=>node.value==="Rascunho anterior")','account change removes old draft');
  assert.deepEqual(errors,[],'No browser runtime errors');
  console.log('PASS browser: cards/tabs/modal, searchable employees, quick registration without losing input, hours/minutes/seconds mask, automatic 50-to-100 focus, server totals, autosave, PDF while editing, finish/reopen, deletion and account cleanup.');
 }finally{socket.close();await fetch(endpoint+'/json/close/'+tab.id);}
}
try{
 const a=await account(),b=await account();
 const details={tradeName:'',cnpj:'',street:'',number:'',complement:'',district:'',city:'',state:'',zipCode:'',phone:'',email:''};
 const company=(await rpc(a.client,'save',{...details,legalName:'Empresa Hora Extra Teste',isPrimary:true},'companies')).company;
 const otherCompany=(await rpc(b.client,'save',{...details,legalName:'Outra Empresa Hora Extra Teste',isPrimary:true},'companies')).company;
 const maria=(await rpc(a.client,'save',{fullName:'Maria Aparecida Teste',registrationNumber:'00123',jobTitle:'Motorista'},'employees')).employee;
 const jose=(await rpc(a.client,'save',{fullName:'José Carlos Teste',registrationNumber:'00124',jobTitle:'Operador'},'employees')).employee;
 const independent=createClient(url,pub,{...options,global:{headers:{Authorization:'Bearer '+a.session.access_token}}});clients.push(independent);
 const anonymous=createClient(url,pub,options);clients.push(anonymous);
 await assert.rejects(rpc(anonymous,'list',{companyId:company.id}),error=>['42501','28000'].includes(error.code));
 let resolveSeen;const seen=new Promise(resolve=>{resolveSeen=resolve;});
 await a.client.realtime.setAuth(a.session.access_token);
 observer=a.client.channel('overtime-live-'+randomUUID()).on('postgres_changes',{event:'INSERT',schema:'public',table:'billing_overtime_reports'},event=>{if(event.new.owner_id===a.id)resolveSeen();});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Realtime subscription timed out')),25000);observer.on('system',{},event=>{if(event.status==='ok'&&event.extension==='postgres_changes'){clearTimeout(timer);resolve();}});observer.subscribe(status=>{if(['CHANNEL_ERROR','TIMED_OUT'].includes(status)){clearTimeout(timer);reject(Error(status));}});});
 const base={companyId:company.id,dateFrom:'2026-09-26',dateTo:'2026-10-25',referenceMonth:'2026-09',sector:'Setor de teste',rows:[{employeeId:maria.id,hours50:'48:00',hours100:'30:00'}]};
 const first=(await rpc(independent,'save',base)).report;
 let timer;try{await Promise.race([seen,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Realtime insert missing')),30000);})]);}finally{clearTimeout(timer);}
 assert.equal(first.total50,'48:00:00');assert.equal(first.rows[0].jobTitle,'Motorista');
 await rpc(a.client,'save',{...base,id:first.id,expectedUpdatedAt:first.updatedAt});
 await assert.rejects(rpc(independent,'save',{...base,id:first.id,expectedUpdatedAt:first.updatedAt}),error=>error.code==='23514');
 await assert.rejects(rpc(b.client,'get',{companyId:otherCompany.id,id:first.id}),error=>error.code==='P0002');
 await assert.rejects(rpc(b.client,'save',{...base,companyId:otherCompany.id}),error=>error.code==='P0002');
 await assert.rejects(rpc(a.client,'save',{...base,ownerId:b.id}),error=>error.code==='22023');
 for(const table of ['billing_overtime_reports','billing_overtime_rows']){
  assert.equal((await b.client.from(table).select('id')).data.length,0);
  assert.equal((await a.client.from(table).delete().eq('owner_id',a.id)).error?.code,'42501');
  assert.equal((await a.client.from(table).update({owner_id:a.id}).eq('owner_id',a.id)).error?.code,'42501');
 }
 assert.equal((await a.client.from('billing_overtime_reports').insert({owner_id:a.id,company_id:company.id,date_from:'2026-10-01',date_to:'2026-10-31',reference_month:'2026-10-01'})).error?.code,'42501');
 for(let i=0;i<3;i++)await rpc(a.client,'create',{companyId:company.id,dateFrom:'2026-10-01',dateTo:'2026-10-31',notes:'Card de teste '+i});
 console.log('PASS live RPC: role snapshot, exact 50/100 totals, stale edits, no-session/owner/RLS isolation, DML denial and independent Realtime.');
 await browser(a,b,independent,{company,maria,jose});
}finally{
 if(observer)await clients[0]?.removeChannel(observer);
 for(const client of clients){await client.removeAllChannels();await client.auth.signOut({scope:'local'});}
 const failures=[];
 for(const id of users){const {error}=await admin.auth.admin.deleteUser(id);if(error)failures.push(error.message);}
 if(!failures.length){try{unlinkSync(journal);}catch{}}
 assert.deepEqual(failures,[],'Remove only the ephemeral test accounts');
 console.log('Removed ephemeral overtime test accounts and their data.');
}
