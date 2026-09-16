import assert from 'node:assert/strict';
import {writeFileSync,readdirSync,statSync} from 'node:fs';
import {resolve} from 'node:path';

export async function verifyContractsSummaryBrowser({cdpUrl,baseUrl,session,projectRef,onRemotePayment}){
 const tab=await (await fetch(`${cdpUrl}/json/new?about:blank`,{method:'PUT'})).json();
 const socket=new WebSocket(tab.webSocketDebuggerUrl),pending=new Map(),errors=[];let seq=0;
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);if(message.id&&pending.has(message.id)){const job=pending.get(message.id);pending.delete(message.id);clearTimeout(job.timer);if(message.error)job.reject(Error(message.error.message));else job.resolve(message.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
 const waitFor=async(expression,label)=>{const end=Date.now()+40000;while(Date.now()<end){if(await evaluate(`document.body && (${expression})`))return;await new Promise(resolve=>setTimeout(resolve,200));}throw Error('Browser did not reach '+label+': '+await evaluate('document.body.innerText.slice(-1800)'));};
 const fill=(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 const click=label=>evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled);if(!b)throw Error('Button missing');b.click();})()`);
 const capture=async name=>{const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync('.sites-runtime/contract-kpis/'+name+'.png',Buffer.from(r.data,'base64'));};
 try{
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1888,height:1080,deviceScaleFactor:1,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(new URL(baseUrl).origin)})localStorage.setItem(${JSON.stringify(`sb-${projectRef}-auth-token`)},${JSON.stringify(JSON.stringify(session))});`});
  await send('Page.navigate',{url:baseUrl+'/contratos'});
  await waitFor("document.querySelector('.contracts-overview-volume dd')?.textContent.includes('40,00')",'filtered summary');
  const metrics=await evaluate("[...document.querySelectorAll('.contracts-overview-item')].map(e=>({top:e.getBoundingClientRect().top,label:e.querySelector('dt').textContent,value:e.querySelector('dd').textContent}))");
  assert.equal(metrics.length,7);assert.equal(new Set(metrics.map(item=>item.top)).size,1,'All seven indicators must occupy one row');
  assert.equal(await evaluate("(()=>{const e=document.querySelector('.contracts-overview-scroll');return e.scrollWidth<=e.clientWidth+1;})()"),true,'Seven desktop KPIs must be visible together');
  assert.ok(metrics.find(item=>item.label==='Pendentes').value.includes('780,00'));
  await capture('desktop');
  await fill('.contract-toolbar .local-search input','CTR-002');
  await waitFor("document.querySelector('.contracts-overview-volume dd')?.textContent.includes('30,00')",'search-specific totals');
  await click('Exportar PDF');await waitFor("document.querySelectorAll('.contract-report-summary>div').length===7",'PDF preview KPIs');
  assert.equal(await evaluate("!!document.querySelector('.report-document.report-landscape')&&!document.querySelector('.report-document.report-portrait')"),true,'Contract list preview always uses landscape');
  assert.equal(await evaluate("(()=>{const stage=document.querySelector('.farm-report-preview-stage');return stage.scrollWidth<=stage.clientWidth+1;})()"),true,'The landscape page must fit the desktop preview width');
  assert.equal(await evaluate("document.querySelector('.contracts-list-report-table thead th').textContent"),'Cliente');
  assert.equal(await evaluate("document.querySelector('.contracts-report-group').rows.length"),2);
  const reportCells=await evaluate("Object.fromEntries([...document.querySelectorAll('.contracts-report-group:first-of-type [data-metric]')].map(cell=>[cell.dataset.metric,cell.textContent]))");
  assert.equal(reportCells.atr,'200,00');assert.ok(reportCells.quote.includes('1,0000'));assert.ok(reportCells.quote.includes('Acumulado'));
  assert.ok(reportCells.discount.includes('60,00'));assert.ok(reportCells.net.includes('5.940,00'));
  assert.equal(await evaluate("document.querySelector('.contract-report-summary dd').textContent.includes('30,00')"),true);
  assert.equal(await evaluate("document.querySelector('.contract-list-report tbody').textContent.includes('CTR-001')"),false);
  await capture('pdf-preview');
  await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:resolve('.sites-runtime/contract-kpis')});
  const beforeDownload=new Map(readdirSync('.sites-runtime/contract-kpis').filter(name=>name.endsWith('.pdf')).map(name=>[name,statSync('.sites-runtime/contract-kpis/'+name).mtimeMs]));
  await click('Baixar PDF');await waitFor("document.body.innerText.includes('foi baixado em PDF')",'PDF download');
  const downloaded=()=>readdirSync('.sites-runtime/contract-kpis').some(name=>name.endsWith('.pdf')&&statSync('.sites-runtime/contract-kpis/'+name).mtimeMs>(beforeDownload.get(name)??0));
  const downloadDeadline=Date.now()+15000;while(!downloaded()&&Date.now()<downloadDeadline)await new Promise(resolve=>setTimeout(resolve,200));
  assert.ok(downloaded(),'PDF must finish downloading');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await waitFor("!document.querySelector('[role=dialog]')",'closed report');
  await fill('.contract-toolbar .local-search input','');
  await waitFor("document.querySelector('.contracts-overview-volume dd')?.textContent.includes('40,00')",'cleared search');
  await fill('input[aria-label="Data final do contrato"]','2026-07-01');
  await waitFor("document.querySelector('.contracts-overview-volume dd')?.textContent.includes('10,00')",'date-specific totals');
  await fill('input[aria-label="Data final do contrato"]','');
  await evaluate("(()=>{const b=[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.includes('Finalizado'));b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));b.click();})()");
  await waitFor("document.querySelector('.contracts-overview-volume dd')?.textContent==='0,00 t'&&document.querySelector('.contract-card-grid')?.textContent.includes('CTR-003')",'finished tab totals');
  await evaluate("(()=>{const b=[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.includes('Em aberto'));b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));b.click();})()");
  await waitFor("document.querySelector('.contracts-overview-volume dd')?.textContent.includes('40,00')",'active tab restored');
  if(onRemotePayment){await onRemotePayment();await waitFor("document.querySelector('.contracts-overview-received dd')?.textContent.includes('7.225,00')&&document.querySelector('.contracts-overview-pending dd')?.textContent.includes('755,00')",'Realtime summary from an independent client');}
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await capture('laptop');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'),true,'Mobile must not overflow the page');
  await capture('mobile');
  assert.equal(await evaluate("(()=>{const e=document.querySelector('.contracts-overview-scroll');e.scrollLeft=e.scrollWidth;return e.scrollLeft>0;})()"),true,'Mobile summary scrolls horizontally');
  await fill('.contract-toolbar .local-search input','NOT-FOUND');await waitFor("document.querySelector('.company-empty')?.textContent.includes('Nenhum contrato encontrado')",'empty filter');
  assert.equal(await evaluate("document.querySelector('.contracts-overview-volume dd').textContent"),'0,00 t');
  assert.deepEqual(errors,[]);
  console.log('PASS: browser desktop/mobile, seven KPIs in one row, tabs/search/dates, empty results, matching report preview, PDF download and independent Realtime refresh.');
 }finally{socket.close();await fetch(`${cdpUrl}/json/close/${tab.id}`);}
}
