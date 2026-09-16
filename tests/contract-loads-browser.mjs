import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';

export async function verifyLoadsBrowser({cdpUrl,baseUrl,session,projectRef,contractId}){
 const response=await fetch(`${cdpUrl}/json/new?about:blank`,{method:'PUT'});assert.equal(response.status,200);const tab=await response.json();
 const socket=new WebSocket(tab.webSocketDebuggerUrl),pending=new Map();let seq=0;
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const result=JSON.parse(event.data);if(result.id&&pending.has(result.id)){const job=pending.get(result.id);pending.delete(result.id);clearTimeout(job.timeout);if(result.error)job.reject(new Error(result.error.message));else job.resolve(result.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timeout=setTimeout(()=>{pending.delete(id);reject(new Error('Browser command timed out: '+method));},15000);pending.set(id,{resolve,reject,timeout});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
 const waitFor=async(expression,label)=>{const end=Date.now()+30000;while(Date.now()<end){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,200));}throw new Error('Browser did not reach '+label+': '+await evaluate("Array.from(document.querySelectorAll('[role=alert]')).map(x=>x.textContent).join(' | ')"));};
 const press=async expression=>{const p=await evaluate(`(()=>{const e=${expression};if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);assert.ok(p,'Clickable element: '+expression);await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});};
 const click=(label,scope='document')=>press(`Array.from(${scope}.querySelectorAll('button')).find(x=>x.textContent.trim()===${JSON.stringify(label)}&&!x.disabled)`);
 const fill=async(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing input '+${JSON.stringify(selector)});const p=e instanceof HTMLSelectElement?HTMLSelectElement.prototype:e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`);
 const choose=async(label,text)=>{await waitFor("!document.querySelector('[role=listbox]')",'previous selector closed');await press(`document.querySelector('button[aria-label=${JSON.stringify(label)}]')`);await waitFor(`Array.from(document.querySelectorAll('[role=option]')).some(x=>x.textContent.includes(${JSON.stringify(text)}))`,'options for '+text);await evaluate(`Array.from(document.querySelectorAll('[role=option]')).find(x=>x.textContent.includes(${JSON.stringify(text)})).focus()`);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await waitFor("!document.querySelector('[role=listbox]')",'selector closed');await waitFor(`document.querySelector('button[aria-label=${JSON.stringify(label)}]')?.textContent.includes(${JSON.stringify(text)})`,'selected '+text);};
 const capture=async name=>{const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync('.sites-runtime/loads/'+name+'.png',Buffer.from(shot.data,'base64'));};
 const volume=value=>`document.querySelector('.loads-kpi-featured strong')?.textContent===${JSON.stringify(value)}`;
 try{
  await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(new URL(baseUrl).origin)})localStorage.setItem(${JSON.stringify(`sb-${projectRef}-auth-token`)},${JSON.stringify(JSON.stringify(session))});`});
  await send('Page.navigate',{url:baseUrl+'/contratos?contrato='+contractId});
  await waitFor("!!document.querySelector('[role=tab][data-state]')",'contract tabs');
  await click('Carregamentos');await waitFor(volume('100,00 t'),'server KPIs');
  assert.equal(await evaluate("document.querySelectorAll('.loads-group').length"),3);
  assert.equal(await evaluate("document.querySelectorAll('.loads-kpis article').length"),7);
  const financialKpis=()=>evaluate("Array.from(document.querySelectorAll('.loads-kpis article')).slice(-3).map(e=>e.querySelector('strong').textContent.replace(/\\u00a0/g,' '))");
  assert.deepEqual(await financialKpis(),['R$ 1.919.000,00','R$ 572,14','R$ 1.918.427,86']);
  assert.deepEqual(await evaluate("Array.from(document.querySelector('.loads-table thead tr').children).slice(5,8).map(e=>e.textContent)"),['Faturamento','Desconto','Valor líquido']);
  assert.deepEqual(await evaluate("Array.from(Array.from(document.querySelectorAll('.loads-table tbody tr')).find(r=>r.textContent.includes('ROM-02')).querySelectorAll('td')).slice(5,8).map(e=>e.textContent.replace(/\\u00a0/g,' '))"),['R$ 320.000,00','R$ 200,00','R$ 319.800,00']);
  await capture('carregamentos-desktop');
  await fill('select[aria-label="Agrupar carregamentos por"]','farm');await waitFor("document.querySelectorAll('.loads-group').length===2",'farm groups');
  await fill('input[name=loadFrom]','2026-02-01');await fill('input[name=loadTo]','2026-02-28');await waitFor(volume('50,00 t'),'period KPIs');
  await fill('input[name=loadSearch]','Aurora');await waitFor(volume('20,00 t'),'combined filters');
  assert.deepEqual(await financialKpis(),['R$ 320.000,00','R$ 200,00','R$ 319.800,00'],'Financial KPIs follow the combined date and search filters');
  assert.equal(await evaluate("document.querySelectorAll('.loads-table tbody tr').length"),1);
  await click('Exportar');await waitFor("!!document.querySelector('.contract-tab-pdf-preview')",'load PDF preview');
  assert.equal(await evaluate("document.querySelector('[role=dialog]').textContent.includes('Carregamentos do contrato')"),true);
  assert.equal(await evaluate("document.querySelector('[role=dialog]').textContent.includes('01/02/2026 a 28/02/2026')"),true);
  const pdf=await evaluate("(async()=>{const r=await fetch(document.querySelector('.contract-tab-pdf-preview').dataset.pdfUrl);return new TextDecoder().decode(new Uint8Array(await r.arrayBuffer()).slice(0,4));})()");assert.equal(pdf,'%PDF');
  await capture('carregamentos-exportacao');await evaluate("document.querySelector('[data-slot=dialog-close]').click()");await waitFor("!document.querySelector('[role=dialog]')",'closed report');
  assert.equal(await evaluate(volume('20,00 t')),true,'Export preserves filters and active tab');
  await click('Limpar');await waitFor(volume('100,00 t'),'cleared filters');
  await click('Novo carregamento');await waitFor("!!document.querySelector('.contract-load-form')",'entry form');
  await fill('input[name=loadedAt]','2026-02-10');await fill('input[name=volume]','2,500');assert.equal(await evaluate("document.querySelector('input[name=atr]')?.required"),true);await fill('input[name=atr]','121,500000');await fill('input[name=document]','NAVEGADOR-01');
  await waitFor("!!document.querySelector('button[aria-label=\"Selecione a fazenda\"]:not(:disabled)')",'farm selector');
  await choose('Selecione a fazenda','Fazenda Aurora');await waitFor("!!document.querySelector('button[aria-label=\"Selecione o talhão\"]:not(:disabled)')",'plot selector');await choose('Selecione o talhão','Talhão Norte');
  await choose('Selecione a fazenda','Fazenda Bela Vista');await waitFor("!!document.querySelector('button[aria-label=\"Selecione o talhão\"]:not(:disabled)')",'changed farm plots');
  assert.equal(await evaluate("document.querySelector('button[aria-label=\"Selecione o talhão\"]').textContent.includes('Talhão Norte')"),false);
  await choose('Selecione o talhão','Talhão Sul');await capture('carregamentos-formulario');await click('Lançar carregamento');
  await waitFor("!document.querySelector('.contract-load-form')",'saved load');await waitFor(volume('102,50 t'),'created load KPIs');
  const row="Array.from(document.querySelectorAll('.loads-table tbody tr')).find(r=>r.textContent.includes('NAVEGADOR-01'))";
  await evaluate(`${row}.querySelector('button[title="Editar carregamento"]').click()`);await waitFor("!!document.querySelector('.contract-load-form')",'edit load');await fill('input[name=volume]','1000');await click('Salvar alterações');await waitFor("document.querySelector('.contract-load-form [role=alert]')?.textContent.includes('saldo')",'server capacity error');
  await fill('input[name=volume]','3,500');await click('Salvar alterações');await waitFor("!document.querySelector('.contract-load-form')",'edited load');await waitFor(volume('103,50 t'),'edited KPIs');
  await evaluate(`${row}.querySelector('button[title="Excluir carregamento"]').click()`);await waitFor("!!document.querySelector('[role=alertdialog]')",'delete confirmation');await click('Cancelar',"document.querySelector('[role=alertdialog]')");assert.equal(await evaluate(volume('103,50 t')),true);
  await evaluate(`${row}.querySelector('button[title="Excluir carregamento"]').click()`);await waitFor("!!document.querySelector('[role=alertdialog]')",'delete confirmation again');await click('Excluir carregamento',"document.querySelector('[role=alertdialog]')");await waitFor(volume('100,00 t'),'deleted load KPIs');
  await fill('input[name=loadSearch]','sem resultados');await waitFor(volume('0,00 t'),'empty filtered KPIs');assert.equal(await evaluate("document.body.innerText.includes('Nenhum carregamento neste filtro')"),true);await click('Limpar');await waitFor(volume('100,00 t'),'restored KPIs');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await capture('carregamentos-mobile');writeFileSync('.sites-runtime/loads/mobile-layout.json',JSON.stringify(await evaluate("({width:document.documentElement.scrollWidth,viewport:window.visualViewport.width,overflow:Array.from(document.querySelectorAll('body *')).filter(e=>e.getBoundingClientRect().right>392&&getComputedStyle(e).overflowX==='visible').slice(0,30).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width}))})"),null,2));assert.equal(await evaluate('document.documentElement.scrollWidth<=392&&window.visualViewport.width<=392'),true,'Mobile viewport fits');
  await evaluate("document.querySelector('.loads-group').scrollIntoView({block:'start'})");
  await capture('carregamentos-valores-mobile');
  assert.deepEqual(await evaluate("Array.from(document.querySelector('.loads-table tbody tr').querySelectorAll('td')).slice(5,8).map(e=>getComputedStyle(e,'::before').content.replaceAll('\"',''))"),['Faturamento','Desconto','Valor líquido']);
  await click('Novo carregamento');await waitFor("!!document.querySelector('.contract-load-form')",'mobile form');await capture('carregamentos-formulario-mobile');assert.equal(await evaluate("document.querySelector('[role=dialog]').getBoundingClientRect().width<=390"),true);
  console.log('PASS: browser filters and KPIs, grouping, contextual PDF, dependent origins, create/edit/delete, capacity feedback, empty state and responsive layout.');
 }catch(error){await capture('browser-failure').catch(()=>{});throw error;}
 finally{await evaluate(`localStorage.removeItem(${JSON.stringify(`sb-${projectRef}-auth-token`)})`).catch(()=>{});socket.close();for(const job of pending.values()){clearTimeout(job.timeout);job.reject(new Error('Browser closed'));}await fetch(`${cdpUrl}/json/close/${tab.id}`).catch(()=>{});}
}
