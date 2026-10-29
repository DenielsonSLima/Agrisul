import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';

// The live runner owns identities, fixtures and remote writes. This harness
// only operates its isolated tab and the supplied mutation callbacks.
export async function verifyDashboardBrowser({session,projectRef,baseUrl='http://127.0.0.1:5173',cdpUrl='http://127.0.0.1:9358',onRemoteLoad,queueFixture,ui={}}){
 const contract={root:'.dashboard-page',market:'.market-ticker',metric:'[data-dashboard-metric="loaded-volume"]',settings:'[aria-label="Configurações do Dashboard"]',popover:'[data-dashboard-settings]',interval:'[aria-label="Intervalo de troca dos painéis"]',tabs:['Geral','Produção e ATR','Faturamento','Fornecedor','Contrato','Tipo','Notícias'],...ui};
 const tab=await(await fetch(`${cdpUrl}/json/new?about:blank`,{method:'PUT'})).json();
 const socket=new WebSocket(tab.webSocketDebuggerUrl),pending=new Map(),errors=[];let sequence=0;
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{
  const message=JSON.parse(event.data);
  if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);
  if(message.id&&pending.has(message.id)){const job=pending.get(message.id);pending.delete(message.id);clearTimeout(job.timer);if(message.error)job.reject(Error(message.error.message));else job.resolve(message.result);}
 });
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout ${method}`));},30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;};
 const wait=async(expression,label)=>{const deadline=Date.now()+45000;while(Date.now()<deadline){if(await evaluate(`Boolean(${expression})`))return;await new Promise(resolve=>setTimeout(resolve,250));}throw Error(`Missing ${label}: ${await evaluate('document.body.innerText.slice(-1800)')}`);};
 const query=selector=>`document.querySelector(${JSON.stringify(selector)})`;
 const selectedLabel=()=>evaluate("document.querySelector('[role=tab][aria-selected=true]')?.textContent.trim()");
 const click=text=>evaluate(`(()=>{const node=[...document.querySelectorAll('button')].find(node=>(node.textContent.trim()===${JSON.stringify(text)}||node.getAttribute('aria-label')===${JSON.stringify(text)})&&!node.disabled);if(!node)throw Error('Button missing: '+${JSON.stringify(text)});node.click();})()`);
 const clickSelector=selector=>evaluate(`(()=>{const node=${query(selector)};if(!node||node.disabled)throw Error('Control missing: '+${JSON.stringify(selector)});node.click();})()`);
 const capture=async name=>{mkdirSync('.sites-runtime/dashboard-validation',{recursive:true});const result=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`.sites-runtime/dashboard-validation/${name}.png`,Buffer.from(result.data,'base64'));};
 const settled=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,300))))');
 const openSettings=async()=>{if(!await evaluate(`Boolean(${query(contract.popover)})`))await clickSelector(contract.settings);await wait(query(contract.popover),'Dashboard settings');const visible=await evaluate(`(()=>{const panel=${query(contract.popover)},fields=[...panel.querySelectorAll('select')];return {count:fields.length,allVisible:fields.every(field=>{const box=field.getBoundingClientRect(),hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);return !!hit&&field.contains(hit)}),barScroll:document.querySelector('.market-ticker-bar')?.scrollTop??0};})()`);assert.equal(visible.count,9,'Shared duration, seven per-tab controls and financial grouping');assert.equal(visible.allVisible,true,'Settings controls must be painted and clickable, not clipped by the market strip');assert.equal(visible.barScroll,0,'Opening settings must not scroll the ticker strip');};
 const closeSettings=async()=>{if(await evaluate(`Boolean(${query(contract.popover)})`)){await clickSelector(contract.settings);await wait(`!${query(contract.popover)}`,'closed settings');}};
 const selectTab=async label=>{
  await evaluate(`(()=>{const tab=[...document.querySelectorAll('[role=tab]')].find(node=>node.textContent.trim()===${JSON.stringify(label)});if(!tab)throw Error('Tab missing: '+${JSON.stringify(label)});tab.click();})()`);
  await wait(`document.querySelector('[role=tab][aria-selected=true]')?.textContent.trim()===${JSON.stringify(label)}`,`selected ${label}`);await settled();
 };
 async function assertTabContract(label){
  const result=await evaluate(`(()=>{const tabs=[...document.querySelectorAll('[role=tab]')],selected=tabs.filter(node=>node.getAttribute('aria-selected')==='true'),panels=[...document.querySelectorAll('[role=tabpanel]')],panel=panels[0];return {tablists:document.querySelectorAll('[role=tablist]').length,labels:tabs.map(node=>node.textContent.trim()),selected:selected.map(node=>node.textContent.trim()),panels:panels.length,linked:selected.length===1&&panels.length===1&&selected[0].getAttribute('aria-controls')===panel.id&&panel.getAttribute('aria-labelledby')===selected[0].id,marketStable:window.__dashboardMarketNode===${query(contract.market)}};})()`);
  assert.equal(result.tablists,1,'One Dashboard tablist');assert.deepEqual(result.labels,contract.tabs);assert.deepEqual(result.selected,[label]);assert.equal(result.panels,1,'Only the selected panel is mounted');assert.equal(result.linked,true,'Accessible tab/panel IDs match');assert.equal(result.marketStable,true,'Market ticker DOM identity survives page changes');
 }
 async function assertViewport(label){
  await settled();
  const result=await evaluate(`(()=>{
   const root=${query(contract.root)},panel=document.querySelector('[role=tabpanel]'),visible=node=>node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden';
   const rect=node=>{const box=node.getBoundingClientRect();return {top:box.top,right:box.right,bottom:box.bottom,left:box.left,width:box.width,height:box.height};};
   const boxes=panel?[panel,...panel.querySelectorAll('[data-dashboard-card],[data-dashboard-chart],.summary-panel,.summary-kpis,.recharts-responsive-container,h2,h3,h4,dl,table')].filter(node=>visible(node)&&!node.closest('.sr-only')):[];
   const panelBounds=panel?rect(panel):null;
   const outside=boxes.map(node=>({node:node.tagName+'.'+String(node.className),rect:rect(node)})).filter(({rect:box})=>box.width>2&&box.height>2&&(box.left< -1||box.top< -1||box.right>innerWidth+1||box.bottom>innerHeight+1||box.left<panelBounds.left-1||box.right>panelBounds.right+1||box.top<panelBounds.top-1||box.bottom>panelBounds.bottom+1));
   const scrolling=panel?[panel,...panel.querySelectorAll('*')].filter(node=>{if(!visible(node))return false;const style=getComputedStyle(node);return (['auto','scroll'].includes(style.overflowY)&&node.scrollHeight>node.clientHeight+1)||(['auto','scroll'].includes(style.overflowX)&&node.scrollWidth>node.clientWidth+1);}).map(node=>({node:node.tagName+'.'+String(node.className),width:node.clientWidth,scrollWidth:node.scrollWidth,height:node.clientHeight,scrollHeight:node.scrollHeight})):[];
   return {viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},root:root?{...rect(root),scrollHeight:root.scrollHeight,clientHeight:root.clientHeight}:null,marketHeight:${query(contract.market)}?.getBoundingClientRect().height,outside,scrolling};
  })()`);
  assert.ok(result.root,`${label}: root mounted`);assert.ok(result.document.width<=result.viewport.width+1,`${label}: document width: ${JSON.stringify(result)}`);assert.ok(result.document.height<=result.viewport.height+1,`${label}: document height: ${JSON.stringify(result)}`);assert.ok(result.root.top>=-1&&result.root.bottom<=result.viewport.height+1,`${label}: root visible: ${JSON.stringify(result)}`);assert.ok(result.root.scrollHeight<=result.root.clientHeight+1,`${label}: internal vertical overflow: ${JSON.stringify(result)}`);assert.ok(result.marketHeight<=44,`${label}: compact 40px market strip, got ${result.marketHeight}`);assert.deepEqual(result.outside,[],`${label}: charts, headings and cards fit viewport and panel`);assert.deepEqual(result.scrolling,[],`${label}: active panel requires no scrolling`);
 }
 try{
  await send('Page.enable');await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(new URL(baseUrl).origin)}){
   localStorage.setItem('sb-${projectRef}-auth-token',${JSON.stringify(JSON.stringify(session))});
   const originalSetInterval=window.setInterval,originalClearInterval=window.clearInterval;window.__dashboardTimers=[];
   window.setInterval=function(fn,ms,...args){const id=originalSetInterval(fn,ms,...args);if([15000,60000,120000,300000,600000].includes(ms))window.__dashboardTimers.push({id,fn:()=>fn(...args),ms,active:true});return id;};
   window.clearInterval=function(id){for(const timer of window.__dashboardTimers)if(timer.id===id)timer.active=false;return originalClearInterval(id);};
   // The presentation schedules one timeout per tab; identify its development stack so query GC timers are excluded.
   const originalSetTimeout=window.setTimeout,originalClearTimeout=window.clearTimeout;
   window.setTimeout=function(fn,ms,...args){const id=originalSetTimeout(fn,ms,...args);if([60000,120000,300000,600000].includes(ms)&&/useDashboardPresentation/.test(new Error().stack??''))window.__dashboardTimers.push({id,fn:()=>{for(const timer of window.__dashboardTimers)if(timer.id===id)timer.active=false;originalClearTimeout(id);fn(...args)},ms,active:true});return id;};
   window.clearTimeout=function(id){for(const timer of window.__dashboardTimers)if(timer.id===id)timer.active=false;return originalClearTimeout(id);};
  }`});
  await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:baseUrl+'/dashboard'});
  await wait(`${query(contract.root)}&&${query(contract.metric)}&&document.querySelector('[role=tabpanel]')`,'Dashboard data');
  assert.equal(await evaluate("[...document.querySelectorAll('.main-nav a')].some(node=>node.textContent.trim()==='Resumo')"),false);assert.ok(await evaluate("[...document.querySelectorAll('.main-nav a')].some(node=>node.textContent.trim()==='Dashboard')"));
  await evaluate(`void(window.__dashboardMarketNode=${query(contract.market)})`);assert.ok(await evaluate('Boolean(window.__dashboardMarketNode)'));assert.equal(await evaluate(`Boolean(${query(contract.popover)})`),false,'Settings start closed');await openSettings();await closeSettings();
  const initialVolume=await evaluate(`${query(contract.metric)}.textContent`);if(onRemoteLoad){await onRemoteLoad();await wait(`${query(contract.metric)}?.textContent!==${JSON.stringify(initialVolume)}`,'independent Realtime update');}
  for(const viewport of [{width:1920,height:1080,mobile:false},{width:1440,height:900,mobile:false},{width:1366,height:768,mobile:false},{width:390,height:844,mobile:true}]){
   await send('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:1});
   for(const label of contract.tabs){await selectTab(label);await assertTabContract(label);await assertViewport(`${viewport.width}x${viewport.height} ${label}`);await capture(`${viewport.width}x${viewport.height}-${contract.tabs.indexOf(label)+1}`);}
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await selectTab(contract.tabs[0]);
  await evaluate("document.querySelector('[role=tab][aria-selected=true]').focus()");
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  await wait(`document.activeElement?.getAttribute('role')==='tab'&&document.activeElement?.textContent.trim()===${JSON.stringify(contract.tabs[1])}`,'keyboard next tab');
  if(await selectedLabel()!==contract.tabs[1]){await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});}
  await wait(`document.querySelector('[role=tab][aria-selected=true]')?.textContent.trim()===${JSON.stringify(contract.tabs[1])}`,'keyboard activation');
  for(const [key,keyCode,label] of [['End',35,contract.tabs.at(-1)],['Home',36,contract.tabs[0]]]){
   await send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:keyCode});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:keyCode});await wait(`document.activeElement?.getAttribute('role')==='tab'&&document.activeElement?.textContent.trim()===${JSON.stringify(label)}`,`keyboard ${key}`);
  }
  await selectTab(contract.tabs[0]);
  await openSettings();await click('Tela cheia');await closeSettings();await wait(`document.fullscreenElement===${query(contract.root)}`,'real fullscreen');await wait("document.body.innerText.includes('Sessão mantida durante exibição')",'live display registration');
  await evaluate(`localStorage.setItem('billing:last-activity:${session.user.id}',String(Date.now()-31*60000));window.__dashboardTimers.filter(timer=>timer.ms===15000&&timer.active).at(-1).fn()`);assert.ok(await evaluate(`Boolean(${query(contract.root)})`),'Visible fullscreen survives inactivity check');
  await openSettings();await click('Apresentar');await closeSettings();await wait('window.__dashboardTimers.some(timer=>timer.ms===120000&&timer.active)','two minute rotation');
  for(const label of contract.tabs){await selectTab(label);await assertTabContract(label);await assertViewport(`Fullscreen ${label}`);}
  await selectTab(contract.tabs[0]);await openSettings();await click('Pausar');await closeSettings();assert.equal(await evaluate('window.__dashboardTimers.some(timer=>timer.ms===120000&&timer.active)'),false,'Pausing clears rotation timer');
  await openSettings();await click('Continuar');await evaluate(`(()=>{const select=${query(contract.interval)};if(!select)throw Error('Rotation interval missing');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'5');select.dispatchEvent(new Event('change',{bubbles:true}));})()`);await closeSettings();await wait('window.__dashboardTimers.some(timer=>timer.ms===300000&&timer.active)','five minute rotation');
  const beforeRotation=await selectedLabel();await evaluate('window.__dashboardTimers.filter(timer=>timer.ms===300000&&timer.active).at(-1).fn()');const nextLabel=contract.tabs[(contract.tabs.indexOf(beforeRotation)+1)%contract.tabs.length];await wait(`document.querySelector('[role=tab][aria-selected=true]')?.textContent.trim()===${JSON.stringify(nextLabel)}`,'automatic tab transition');await assertTabContract(nextLabel);await assertViewport('Automatic rotation');
  await evaluate('document.exitFullscreen()');await wait('!document.fullscreenElement','fullscreen exit');await wait('!window.__dashboardTimers.some(timer=>timer.ms===300000&&timer.active)','fullscreen exit stops rotation');assert.equal(await evaluate(`Date.now()-Number(localStorage.getItem('billing:last-activity:${session.user.id}'))<60000`),true,'Leaving fullscreen restores ordinary inactivity period');
  if(queueFixture){
   await send('Emulation.setDeviceMetricsOverride',{width:1540,height:1080,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:baseUrl+'/contratos?contrato='+queueFixture.contractId+'&aba=loads'});
   await wait("document.querySelector('.imported-loads-queue')&&!document.querySelector('.imported-loads-queue .animate-spin')",'contract import queue');assert.equal(await evaluate(`document.querySelector('.imported-loads-queue').textContent.includes(${JSON.stringify(queueFixture.sourceName)})`),false,'Open PDF not queued');await queueFixture.finalize();await wait(`document.querySelector('.imported-loads-queue').textContent.includes(${JSON.stringify(queueFixture.sourceName)})`,'finalized PDF appears through Realtime');await capture('contract-pdf-queue');
   await evaluate("document.querySelector('.imported-loads-queue tbody button').click()");await wait("document.querySelector('[aria-label=\"Selecione a fazenda cadastrada\"]:not(:disabled)')",'link form');await evaluate("document.querySelector('[aria-label=\"Selecione a fazenda cadastrada\"]').click()");await wait("document.querySelector('[role=option]')",'farm selection');await evaluate(`(()=>{const option=[...document.querySelectorAll('[role=option]')].find(node=>node.textContent.includes(${JSON.stringify(queueFixture.farmName)}));if(!option)throw Error('Missing farm');option.click();})()`);await click('Vincular ao contrato');await wait("!document.querySelector('[role=dialog]')&&!document.querySelector('.imported-loads-queue tbody')",'linked PDF removed from queue');await queueFixture.verify();await capture('contract-pdf-linked');console.log('PASS browser PDF queue: open excluded, finalization Realtime, farm selection, link mutation and pending ATR.');
  }
  assert.deepEqual(errors,[],'Browser runtime errors');console.log('PASS Dashboard browser: six exclusive accessible pages, stable market ticker, gear settings, four viewports without scroll/cuts, keyboard, Realtime, fullscreen, inactivity and configurable rotation.');
 }catch(error){await capture('failure').catch(()=>{});throw error;}
 finally{for(const job of pending.values()){clearTimeout(job.timer);job.reject(Error('Browser test ended'));}socket.close();await fetch(`${cdpUrl}/json/close/${tab.id}`).catch(()=>{});}
}
