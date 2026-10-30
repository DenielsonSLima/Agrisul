import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';

if(process.env.BILLING_RUN_LIVE_TESTS!=='1')throw Error('Set BILLING_RUN_LIVE_TESTS=1 for ephemeral weekly verification.');
const ref='ykounjabfsrtkzostbbz';assert.equal(readFileSync('supabase/.temp/project-ref','utf8').trim(),ref);
const projects=JSON.parse(execFileSync('.sites-runtime/tools/supabase.exe',['projects','list'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.ok(projects.projects.some(p=>p.id===ref&&p.name==='agrisul'&&p.linked));
const raw=JSON.parse(execFileSync('.sites-runtime/tools/supabase.exe',['projects','api-keys','--project-ref',ref,'--reveal','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const keys=Array.isArray(raw)?raw:raw.api_keys??raw.apiKeys??raw.keys;
const pub=keys.find(k=>k.type==='publishable')?.api_key,secret=keys.find(k=>k.type==='secret')?.api_key??keys.find(k=>k.name==='service_role')?.api_key;assert.ok(pub&&secret);
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}},url=`https://${ref}.supabase.co`,admin=createClient(url,secret,options),users=[],clients=[];
const journal='.sites-runtime/weekly-live-identities.json';let browser;
async function rpc(client,resource,action,payload={}){const {data,error}=await client.rpc('billing_rpc',{p_resource:resource,p_action:action,p_payload:payload}).abortSignal(AbortSignal.timeout(45000));if(error)throw Object.assign(Error(error.message),{code:error.code});return data;}
async function account(){const password=`${randomUUID()}Aa9!`,email=`weekly-${randomUUID()}@example.com`,created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);users.push(created.data.user.id);writeFileSync(journal,JSON.stringify({projectRef:ref,userIds:users}));const client=createClient(url,pub,options);clients.push(client);const session=await client.auth.signInWithPassword({email,password});assert.ifError(session.error);await rpc(client,'settings','get');return {client,session:session.data.session};}
async function browserConnection(session){
 const cdp='http://127.0.0.1:9358',tab=await(await fetch(`${cdp}/json/new?about:blank`,{method:'PUT'})).json(),socket=new WebSocket(tab.webSocketDebuggerUrl),pending=new Map(),errors=[];let sequence=0;
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);if(message.id&&pending.has(message.id)){const task=pending.get(message.id);pending.delete(message.id);clearTimeout(task.timer);message.error?task.reject(Error(message.error.message)):task.resolve(message.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout ${method}`));},30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;};
 const wait=async(expression,label)=>{const deadline=Date.now()+60000;while(Date.now()<deadline){if(await evaluate(`Boolean(${expression})`))return;await new Promise(resolve=>setTimeout(resolve,200));}throw Error(`${label}: ${await evaluate('document.body.innerText.slice(-1600)')}`);};
 const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const capture=async name=>{mkdirSync('.sites-runtime/weekly-validation',{recursive:true});const result=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`.sites-runtime/weekly-validation/${name}.png`,Buffer.from(result.data,'base64'));};
 await send('Page.enable');await send('Runtime.enable');
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin==='http://127.0.0.1:5173')localStorage.setItem('sb-${ref}-auth-token',${JSON.stringify(JSON.stringify(session))});`});
 return {send,evaluate,wait,click,capture,errors,close:async()=>{socket.close();await fetch(`${cdp}/json/close/${tab.id}`).catch(()=>{});}};
}
try{
 const a=await account(),b=await account(),call=(resource,action,payload)=>rpc(a.client,resource,action,payload);
 const details={tradeName:'',cnpj:'',street:'',number:'',complement:'',district:'',city:'',state:'',zipCode:'',phone:'',email:''};
 const company=(await call('companies','save',{...details,legalName:'Empresa Semanal · teste',isPrimary:true})).company;
 const supplier=async(name,cnpj)=>(await call('clients','save',{...details,legalName:name,cnpj})).client;
 const ca=await supplier('Fornecedor A Semanal','00000000000000'),cb=await supplier('Fornecedor B Semanal','11111111111111');
 await call('contract-types','save',{name:'Manual',stages:[]});await call('contract-types','save',{name:'Mecanizado',stages:[]});const kinds=(await call('contract-types','list')).types;
 const farm=(await call('farms','save',{name:'Fazenda Semanal',areaHa:'100',city:'Capela',state:'SE'})).farm;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const shift=(days)=>{const date=new Date(`${today}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);};
 const contract=async(client,kind,title)=>(await call('contracts','save',{title,contractNumber:title,companyId:company.id,clientId:client.id,typeId:kinds.find(k=>k.name===kind).id,status:'Ativo',startDate:shift(-30),endDate:'',contractedVolume:'1000',value:'',notes:'',atrPriceType:'gross',atrPeriodType:'monthly'})).contract;
 const manual=await contract(ca,'Manual','MANUAL-A'),mechanized=await contract(ca,'Mecanizado','MECANIZADO-A'),other=await contract(cb,'Manual','MANUAL-B');
 for(const reference of new Set([today.slice(0,7),shift(-7).slice(0,7)])){const [year,month]=reference.split('-').map(Number);await call('atr','save',{year,month,monthlyGrossValue:'1',monthlyNetValue:'1',accumulatedGrossValue:'1',accumulatedNetValue:'1'});}
 const load=async(contract,date,volume,atr)=>(await call('contracts','save-load',{companyId:company.id,contractId:contract.id,loadedAt:date,farmId:farm.id,plotId:'',volume,atr,document:'Semanal fixture',notes:''})).load;
 await load(manual,today,'10','100');await load(manual,shift(-6),'30','140');await load(mechanized,shift(-1),'20','150');await load(other,shift(-2),'5','110');await load(manual,shift(-7),'10','120');
 const scope={companyId:company.id,from:shift(-6),to:today};
 const all=await call('summary','weekly',scope);assert.equal(all.totals.loadedVolume,'65');assert.equal(all.days.length,4);assert.equal(all.contractMethods.find(row=>row.code==='2').loadedVolume,'20');assert.equal(all.contractMethods.find(row=>row.code==='1').loadedVolume,'45');
 assert.equal((await call('summary','weekly',{...scope,partnerIds:[ca.id],contractIds:[manual.id]})).totals.loadedVolume,'40');
 await assert.rejects(()=>rpc(b.client,'summary','weekly',scope));
 browser=await browserConnection(a.session);const {send,evaluate,wait,click,capture}=browser;
 await send('Emulation.setDeviceMetricsOverride',{width:1593,height:797,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:'http://127.0.0.1:5173/dashboard'});
 await wait("document.querySelector('#tab-dashboard-weekly')&&document.querySelector('[data-dashboard-metric=loaded-volume]')",'Dashboard');
 const originalPeriod=await evaluate("[...document.querySelectorAll('.dashboard-period-filter input')].map(n=>n.value)");
 await click('#tab-dashboard-weekly');await wait("document.querySelector('[data-dashboard-metric=weekly-volume]')&&document.querySelectorAll('[data-weekly-days=\"4\"]').length===2",'Weekly productive-day charts');
 assert.equal(await evaluate("document.querySelectorAll('.dashboard-weekly-metrics [data-dashboard-metric]').length"),6);
 assert.match(await evaluate("document.querySelector('[data-dashboard-metric=weekly-mechanized]').textContent"),/20,00.*150,00/s);
 assert.equal(await evaluate("document.querySelectorAll('.executive-tabs [role=tab]').length"),8);
 assert.equal(await evaluate("document.querySelectorAll('.dashboard-quick-filters').length"),1);
 assert.equal(await evaluate("document.querySelectorAll('.dashboard-weekly-controls button,.dashboard-weekly-controls select').length"),0);
 assert.match(await evaluate("document.querySelector('[data-dashboard-metric=weekly-volume] dd').textContent"),/65,00/);
 await click('[aria-label^="Filtrar por cliente:"]');await click(`[aria-label="Selecionar cliente ${ca.legalName}"]`);
 await evaluate("[...document.querySelectorAll('#dashboard-partner-filter button')].find(n=>n.textContent==='Aplicar').click()");
 await wait("document.querySelector('[data-dashboard-metric=weekly-volume] dd')?.textContent.includes('60,00')",'Existing client filter');
 await click('[aria-label^="Filtrar por contrato:"]');await click('[aria-label="Selecionar contrato MANUAL-A · MANUAL-A"]');
 await evaluate("[...document.querySelectorAll('#dashboard-contract-filter button')].find(n=>n.textContent==='Aplicar').click()");
 await wait("document.querySelector('[data-dashboard-metric=weekly-volume] dd')?.textContent.includes('40,00')",'Existing manual contract filter');
 await click('[aria-label="Ocultar valores financeiros"]');assert.ok(!/R\$/.test(await evaluate("document.querySelector('[data-dashboard-metric=weekly-gross]').textContent")));
 await click('.dashboard-weekly-panel .dashboard-data-trigger');await wait("document.querySelector('dialog[open] tbody tr')",'Weekly data dialog');assert.equal(await evaluate("document.querySelectorAll('dialog[open] tbody tr').length"),2);await click('dialog[open] [aria-label="Fechar dados"]');
 for(const view of [{width:1593,height:797,mobile:false},{width:1366,height:768,mobile:false},{width:390,height:844,mobile:true}]){
  await send('Emulation.setDeviceMetricsOverride',{...view,deviceScaleFactor:1});await new Promise(resolve=>setTimeout(resolve,350));
  const layout=await evaluate("(()=>{const root=document.querySelector('.dashboard-page'),panel=document.querySelector('#dashboard-weekly'),r=panel.getBoundingClientRect();return {pageWidth:document.documentElement.scrollWidth,width:innerWidth,height:innerHeight,bottom:r.bottom,rootScroll:root.scrollHeight,rootHeight:root.clientHeight,charts:[...document.querySelectorAll('.dashboard-weekly-plot')].map(n=>({height:n.clientHeight,width:n.clientWidth}))};})()");
  assert.ok(layout.pageWidth<=layout.width+1,JSON.stringify(layout));assert.ok(layout.bottom<=layout.height+1,JSON.stringify(layout));assert.ok(layout.rootScroll<=layout.rootHeight+1,JSON.stringify(layout));assert.ok(layout.charts.every(c=>c.height>=60),JSON.stringify(layout));await capture(`${view.width}x${view.height}`);
 }
 await send('Emulation.setDeviceMetricsOverride',{width:1593,height:797,deviceScaleFactor:1,mobile:false});await click('#tab-dashboard-general');await wait("document.querySelector('[data-dashboard-metric=loaded-volume]')",'Return to General');assert.deepEqual(await evaluate("[...document.querySelectorAll('.dashboard-period-filter input')].map(n=>n.value)"),originalPeriod);
 await click('[aria-label="Configurações do Dashboard"]');await wait("document.querySelector('[data-dashboard-settings]')",'Presentation settings');
 assert.equal(await evaluate("document.querySelectorAll('[aria-label^=\"Tempo da aba\"]').length"),8);
 await evaluate("(()=>{const select=document.querySelector('[aria-label=\"Intervalo de troca dos painéis\"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,String(10/60));select.dispatchEvent(new Event('change',{bubbles:true}));})()");
 await click('[aria-label="Configurações do Dashboard"]');await evaluate("[...document.querySelectorAll('.executive-actions button')].find(n=>n.textContent.trim()==='Apresentar').click()");
 await wait("document.fullscreenElement&&document.querySelector('[data-dashboard-metric=weekly-volume]')",'Automatic rotation into Weekly');
 await evaluate("[...document.querySelectorAll('.executive-actions button')].find(n=>n.textContent.trim()==='Pausar').click()");await capture('fullscreen');
 const independent=createClient(url,pub,{...options,global:{headers:{Authorization:`Bearer ${a.session.access_token}`}}});clients.push(independent);
 await rpc(independent,'contracts','save-load',{companyId:company.id,contractId:manual.id,loadedAt:today,farmId:farm.id,plotId:'',volume:'1',atr:'100',document:'Weekly Realtime',notes:''});
 await wait("document.querySelector('[data-dashboard-metric=weekly-volume] dd')?.textContent.includes('41,00')",'Weekly Realtime refresh');
 await evaluate('document.exitFullscreen()');assert.deepEqual(browser.errors,[]);console.log('PASS weekly live: authenticated RPC, account isolation, eight tabs, productive dates, six compact metrics with modality tonnes/ATR, existing filters, mask, productive-day table, desktop/mobile layout, restored General period, fullscreen rotation and Realtime.');
}catch(error){if(browser)await browser.capture('failure').catch(()=>{});throw error;}
finally{
 if(browser)await browser.close();
 for(const client of clients){await client.removeAllChannels();client.realtime.disconnect();await client.auth.signOut().catch(()=>{});}
 for(const id of users){const result=await admin.auth.admin.deleteUser(id);assert.ifError(result.error);}
 if(users.length)unlinkSync(journal);console.log('Temporary weekly identities removed:',users.length);
}
