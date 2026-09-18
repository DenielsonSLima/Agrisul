import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

export async function verifyDocumentTemplatesBrowser({managerSession, operatorSession, otherSession, projectRef, cdpUrl = 'http://localhost:9235', baseUrl = 'http://localhost:5173'}) {
  assert.equal(projectRef, 'rbuscpwntzpyqsuycqmv');
  const output = resolve('.sites-runtime/requests-validation'); mkdirSync(output, {recursive: true});
  const tab = await (await fetch(`${cdpUrl}/json/new?about:blank`, {method: 'PUT'})).json();
  const socket = new WebSocket(tab.webSocketDebuggerUrl), jobs = new Map(), errors = []; let sequence = 0, initScript;
  await new Promise((resolve, reject) => {socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true});});
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    const job = jobs.get(message.id);
    if (job) {jobs.delete(message.id); clearTimeout(job.timer); if (message.error) job.reject(Error(message.error.message)); else job.resolve(message.result);}
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {const id = ++sequence, timer = setTimeout(() => {jobs.delete(id); reject(Error('CDP timeout: ' + method));}, 20000); jobs.set(id, {resolve, reject, timer}); socket.send(JSON.stringify({id, method, params}));});
  const evaluate = async expression => {const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true}); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value;};
  const wait = async (expression, label) => {const until = Date.now() + 45000; while (Date.now() < until) {if (await evaluate(`!!document.body && !!(${expression})`)) return; await new Promise(resolve => setTimeout(resolve, 200));} throw Error(`${label}: ${await evaluate('document.body.innerText.slice(-2200)')}\n${errors.join('\n')}`);};
  const click = text => evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled);if(!button)throw Error('Button missing: '+${JSON.stringify(text)});button.click();})()`);
  const input = (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Input missing');const p=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
  const seed = async session => {if (initScript) await send('Page.removeScriptToEvaluateOnNewDocument', {identifier: initScript}); initScript = (await send('Page.addScriptToEvaluateOnNewDocument', {source: `localStorage.setItem('sb-${projectRef}-auth-token',${JSON.stringify(JSON.stringify(session))});`})).identifier;};
  const go = async path => {await send('Page.navigate', {url: baseUrl + path}); await wait("document.querySelector('.app-main')", 'application shell');};
  const capture = async name => {const shot = await send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false}); writeFileSync(resolve(output, name + '.png'), Buffer.from(shot.data, 'base64'));};
  const geometry = selector => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Block missing');const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,left:e.style.left,top:e.style.top};})()`);
  const drag = async (selector, dx, dy) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})`);
    await new Promise(resolve=>setTimeout(resolve,300));
    const box = await geometry(selector), x = box.x + box.width / 2, y = box.y + box.height / 2;
    assert.equal(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),hit=document.elementFromPoint(${x},${y});return e===hit||e.contains(hit)})()`),true,'Pointer must hit the selected editor block');
    await send('Input.dispatchMouseEvent', {type: 'mouseMoved', x, y});
    await send('Input.dispatchMouseEvent', {type: 'mousePressed', x, y, button: 'left', clickCount: 1});
    await send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: x + dx, y: y + dy, button: 'left', buttons: 1});
    await send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', clickCount: 1});
  };
  const catalog = '/cadastro?secao=modelos-documentos', editor = catalog + '&modelo=service-request';
  const name = 'Modelo de oficina', title = 'SOLICITAÇÃO DE OFICINA', addedText = 'Texto livre de teste';
  try {
    await send('Page.enable'); await send('Runtime.enable'); await send('Page.bringToFront'); await send('Emulation.setFocusEmulationEnabled', {enabled: true}); await send('Emulation.setDeviceMetricsOverride', {width: 1700, height: 1100, deviceScaleFactor: 1, mobile: false});
    await seed(managerSession); await go(catalog);
    await wait("document.querySelector('.document-template-card')", 'template module cards'); await capture('modelos-catalogo');
    await evaluate("document.querySelector('.document-template-card').click()"); await wait("document.querySelector('[data-template-block=instruction]')", 'A4 editor');
    await input('.template-properties>label input', name);
    await evaluate("[...document.querySelectorAll('.template-layer-list button')].find(button=>button.textContent.startsWith('Solicitamos a execução')).click()");
    await wait("document.querySelector('.template-properties textarea')", 'text properties'); await input('.template-properties textarea', title);
    await wait(`document.querySelector('[data-document-block=instruction]').textContent===${JSON.stringify(title)}`, 'live text preview');
    const before = await geometry('[data-template-block=instruction]');
    await drag('[data-template-block=instruction]', 12, 8);
    const moved = await geometry('[data-template-block=instruction]'); assert.notEqual(moved.left, before.left); assert.notEqual(moved.top, before.top);
    await evaluate("document.querySelector('button[aria-label=Desfazer]').click()"); assert.equal((await geometry('[data-template-block=instruction]')).left, before.left);
    await evaluate("document.querySelector('button[aria-label=Refazer]').click()"); assert.equal((await geometry('[data-template-block=instruction]')).left, moved.left);
    await drag('[data-template-block=instruction] [data-resize]', 10, 5);
    assert.ok((await geometry('[data-template-block=instruction]')).width > moved.width, 'Resize changes physical page geometry');
    await evaluate("document.querySelector('button[title=\"Adicionar texto\"]').click()");
    await input('.template-properties textarea', addedText);
    await input('.template-geometry label:nth-child(1) input', '16'); await input('.template-geometry label:nth-child(2) input', '83');
    await input('.template-geometry label:nth-child(4) input', '6');
    const blockCount = await evaluate("document.querySelectorAll('[data-template-block]').length");
    await click('Duplicar'); assert.equal(await evaluate("document.querySelectorAll('[data-template-block]').length"), blockCount + 1);
    await click('Excluir'); await wait("document.querySelector('[role=alertdialog]')", 'block delete confirmation'); await click('Excluir bloco');
    assert.equal(await evaluate("document.querySelectorAll('[data-template-block]').length"), blockCount);
    await input('select[aria-label="Zoom da página"]', '50'); await evaluate('window.scrollTo(0,0)'); await capture('modelo-editor');
    await click('Salvar modelo'); await wait("document.querySelector('.template-editor-heading p').textContent.includes('Versão') && !document.querySelector('.template-editor-heading p').textContent.includes('não salvas')", 'template persisted');
    const version = Number((await evaluate("document.querySelector('.template-editor-heading p').textContent")).match(/Versão (\d+)/)[1]);
    await go(editor); await wait(`document.querySelector('[data-document-block=instruction]')?.textContent===${JSON.stringify(title)}`, 'saved layout after reload');
    assert.ok((await evaluate("document.querySelector('.document-layout-page').textContent")).includes(addedText));
    await seed(operatorSession); await go(editor); await wait("document.querySelector('.template-notice')", 'read-only model permissions');
    assert.equal(await evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Salvar modelo')"), false);
    assert.equal(await evaluate("document.querySelector('.template-properties input').disabled"), true);
    await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
    await go(catalog); await wait("document.querySelector('.document-template-card')", 'mobile template catalog'); await capture('modelos-mobile');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'), true);
    await seed(otherSession); await go(editor); await wait("document.querySelector('[data-document-block=instruction]')", 'separate workspace model');
    assert.ok((await evaluate("document.querySelector('[data-document-block=instruction]').textContent")).startsWith('Solicitamos a execução'));
    assert.deepEqual(errors, []);
    console.log('PASS: document template cards, live editing, real pointer drag/resize, undo/redo, add/delete confirmation, persistent versions, permissions, mobile and isolation.');
    return {name, version, title, addedText};
  } catch (error) {console.error('Document editor browser verification:', error.message); await capture('modelo-erro').catch(() => {}); throw error;}
  finally {
    try {if (initScript) await send('Page.removeScriptToEvaluateOnNewDocument', {identifier: initScript}); await evaluate(`localStorage.removeItem('sb-${projectRef}-auth-token')`);} finally {socket.close(); await fetch(`${cdpUrl}/json/close/${tab.id}`);}
  }
}
