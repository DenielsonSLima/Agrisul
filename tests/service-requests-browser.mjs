import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync, readdirSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import {inflateSync} from 'node:zlib';
import {readRequestPreviewPdf} from './request-pdf-browser.mjs';

function pdfText(path) {
  const bytes = readFileSync(path), source = bytes.toString('latin1'), text = [];
  for (const match of source.matchAll(/\bstream\r?\n/g)) {
    const start = match.index + match[0].length, end = source.indexOf('\nendstream', start);
    if (end < 0) continue;
    const header = source.slice(source.lastIndexOf('<<', match.index), match.index);
    let stream = bytes.subarray(start, end);
    try {if (header.includes('/FlateDecode')) stream = inflateSync(stream);} catch {continue;}
    for (const entry of stream.toString('latin1').matchAll(/\(((?:\\[\s\S]|[^\\)])*)\)\s*Tj/g)) {
      text.push(entry[1].replace(/\\([()\\])/g, '$1').replace(/\\[nr]/g, ' '));
    }
  }
  return text.join('\n');
}

export async function verifyRequestsBrowser({operatorSession, managerSession, otherSession, operatorName = 'Operador de teste', projectRef, png, requesterName = 'Edmilson Navegador', baseUrl = 'http://localhost:5173', cdpUrl = 'http://localhost:9235'}) {
  assert.equal(projectRef, 'rbuscpwntzpyqsuycqmv');
  assert.ok(png?.length, 'A valid PNG fixture is required');
  assert.notEqual(operatorSession.user.id, managerSession.user.id, 'Operator and manager must use independent logins');
  const output = resolve('.sites-runtime/requests-validation'); mkdirSync(output, {recursive: true});
  const tab = await (await fetch(`${cdpUrl}/json/new?about:blank`, {method: 'PUT'})).json();
  const socket = new WebSocket(tab.webSocketDebuggerUrl), pending = new Map(), errors = []; let seq = 0;
  await new Promise((resolve, reject) => {socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true});});
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.id && pending.has(message.id)) {
      const job = pending.get(message.id); pending.delete(message.id); clearTimeout(job.timer);
      if (message.error) job.reject(Error(message.error.message)); else job.resolve(message.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq, timer = setTimeout(() => {pending.delete(id); reject(Error('CDP timeout: ' + method));}, 20000);
    pending.set(id, {resolve, reject, timer}); socket.send(JSON.stringify({id, method, params}));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, label) => {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {if (await evaluate(`!!document.body && !!(${expression})`)) return; await new Promise(resolve => setTimeout(resolve, 200));}
    throw Error('Browser did not reach ' + label + ': ' + await evaluate('document.body.innerText.slice(-2200)') + '\n' + errors.join('\n'));
  };
  const click = (text, selector = 'button') => evaluate(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled);if(!b)throw Error('Button missing: '+${JSON.stringify(text)});b.click();})()`);
  const input = (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Input missing: '+${JSON.stringify(selector)});const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});if(e.tagName==='INPUT'&&e.type==='text')e.setSelectionRange(e.value.length,e.value.length);e.dispatchEvent(e.getAttribute('role')==='combobox'?new InputEvent('input',{bubbles:true,inputType:'insertText',data:${JSON.stringify(value)}}):new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
  const uploadPng = (selector, fileName) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('File input missing');const bytes=Uint8Array.from(atob(${JSON.stringify(png.toString('base64'))}),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([bytes],${JSON.stringify(fileName)},{type:'image/png'}));e.files=transfer.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const capture = async name => {const image = await send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false}); writeFileSync(resolve(output, name + '.png'), Buffer.from(image.data, 'base64'));};
  const go = async path => {await send('Page.navigate', {url: baseUrl + path}); await waitFor("document.querySelector('.app-main')", 'application shell');};
  let initScript;
  const seedSession = async value => {
    if (initScript) await send('Page.removeScriptToEvaluateOnNewDocument', {identifier: initScript});
    const result = await send('Page.addScriptToEvaluateOnNewDocument', {source: `localStorage.setItem('sb-${projectRef}-auth-token',${JSON.stringify(JSON.stringify(value))});`});
    initScript = result.identifier;
  };
  const pressKey = async (key, code = key, virtualKey = key === 'Escape' ? 27 : 9) => {
    await send('Input.dispatchKeyEvent', {type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey});
    await send('Input.dispatchKeyEvent', {type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey});
  };
  const openRequest = async () => {
    await go('/solicitacoes?secao=servico'); await waitFor("document.querySelector('.request-filters')", 'service listing');
    await click('Nova solicitação'); await waitFor("document.querySelector('.request-modal .request-person-select')", 'request modal');
    assert.equal(await evaluate("!!document.querySelector('.request-filters')"), true, 'The listing stays mounted behind the dialog');
    await waitFor("document.querySelector('.request-modal').contains(document.activeElement)", 'focus inside request modal');
  };
  const chooseRequester = async name => {
    const id = await evaluate(`(()=>{const option=[...document.querySelector('.request-person-select').options].find(option=>option.textContent===${JSON.stringify(name)});if(!option)throw Error('Person missing from requester options');return option.value;})()`);
    assert.match(id, /^[0-9a-f-]{36}$/i); await input('.request-person-select', id); return id;
  };
  const fillRequest = async company => {
    await waitFor("document.querySelector('.request-provider-combobox input')", 'provider search');
    await input('.request-provider-combobox input', company);
    await waitFor(`[...document.querySelectorAll('[data-provider-id]')].some(option=>option.querySelector('strong')?.textContent===${JSON.stringify(company)})`, 'registered service provider');
    await evaluate(`[...document.querySelectorAll('[data-provider-id]')].find(option=>option.querySelector('strong')?.textContent===${JSON.stringify(company)}).click()`);
    await input('.request-edit-item textarea[maxlength="2000"]', 'Confeccionar duas mangueiras hidráulicas');
    await input('.request-edit-item textarea[maxlength="1000"]', 'Carregadeira Valtra BM100 nº 220/221');
    await input('.request-form input[inputmode="decimal"]', '1433,00');
    await input('.request-form input[type=date]', '2026-09-30');
    await input('.request-form textarea[maxlength="4000"]', 'Registro de verificação do formulário pelo operador.');
  };
  const submitRequest = async () => {
    assert.equal(await evaluate('document.querySelector(".request-form").checkValidity()'), true);
    await click('Enviar solicitação', '.request-form button');
    await waitFor("document.querySelector('.request-detail') && !document.querySelector('.request-modal')", 'request recorded');
    const id = await evaluate("new URLSearchParams(location.search).get('solicitacao')"); assert.match(id, /^[0-9a-f-]{36}$/i); return id;
  };
  const downloadPdf = async () => {
    const before = new Map(readdirSync(output).filter(name => name.endsWith('.pdf')).map(name => [name, statSync(resolve(output, name)).mtimeMs]));
    await click('Exportar PDF');
    const download = () => readdirSync(output).find(name => name.endsWith('.pdf') && statSync(resolve(output, name)).mtimeMs > (before.get(name) ?? 0));
    const deadline = Date.now() + 25000;
    while (!download() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 250));
    const name = download(); assert.ok(name, 'Service request PDF must download');
    return {text: pdfText(resolve(output, name)), bytes: readFileSync(resolve(output, name))};
  };
  try {
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Page.bringToFront'); await send('Emulation.setFocusEmulationEnabled', {enabled: true});
    await send('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: output});
    await send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false});
    await seedSession(operatorSession);
    await go('/cadastro?secao=assinaturas');
    await waitFor("document.querySelectorAll('.signatures-table tbody tr').length>=3", 'signature registry for operator');
    await waitFor("document.querySelectorAll('.signature-preview img').length>=3 && [...document.querySelectorAll('.signature-preview img')].every(image=>image.complete&&image.naturalWidth>0)", 'registry previews');
    await capture('assinaturas-desktop');

    // A requester can be registered with just a name, without a PNG or account.
    await click('Cadastrar assinatura'); await waitFor("document.querySelector('.signature-modal')", 'signature form');
    assert.equal(await evaluate("document.querySelectorAll('.signature-modal select').length"), 1);
    assert.equal(await evaluate("document.querySelector('.signature-modal select').value"), 'requester');
    assert.equal(await evaluate("document.querySelector('.signature-modal').textContent.includes('Usuário do diretor geral')"), false);
    await input('.signature-modal input:not([type=file])', requesterName);
    await pressKey('Escape'); await waitFor("document.querySelector('[role=alertdialog]')", 'registry discard confirmation');
    await click('Cancelar', '[role=alertdialog] button');
    assert.equal(await evaluate("document.querySelector('.signature-modal input:not([type=file])').value"), requesterName);
    assert.equal(await evaluate("document.querySelector('.signature-modal input[type=file]').files.length"), 0);
    await capture('assinatura-cadastro');
    await click('Cadastrar assinatura', '.signature-modal button');
    await waitFor(`!document.querySelector('.signature-modal') && [...document.querySelectorAll('.signatures-table tbody tr')].some(row=>row.textContent.includes(${JSON.stringify(requesterName)})&&row.textContent.includes('Pessoa cadastrada'))`, 'requester saved without an account');

    // Escape requests confirmation, cancellation preserves the draft, and an
    // explicit discard returns focus to the list's creation button.
    await openRequest();
    const requesterSignatureId = await chooseRequester(requesterName);
    await input('.request-form textarea[maxlength="4000"]', 'Rascunho preservado');
    await pressKey('Escape'); await waitFor("document.querySelector('[role=alertdialog]')", 'request discard confirmation');
    await click('Cancelar', '[role=alertdialog] button');
    assert.equal(await evaluate("document.querySelector('.request-form textarea[maxlength=\"4000\"]').value"), 'Rascunho preservado');
    await pressKey('Tab'); assert.equal(await evaluate("document.querySelector('.request-modal').contains(document.activeElement)"), true, 'Focus remains in the modal');
    await click('Cancelar', '.request-form button'); await waitFor("document.querySelector('[role=alertdialog]')", 'explicit discard');
    await click('Descartar formulário', '[role=alertdialog] button');
    await waitFor("!document.querySelector('.request-modal') && document.activeElement?.textContent.includes('Nova solicitação')", 'focus restored to listing');
    await openRequest(); await chooseRequester(requesterName);
    assert.equal(await evaluate("document.querySelector('.request-form textarea[maxlength=\"4000\"]').value"), '');
    assert.equal(await evaluate("document.querySelector('[name=requester-signing-mode][value=registered]').disabled"), true);
    assert.equal(await evaluate("document.querySelector('[name=requester-signing-mode][value=manual]').checked"), true);
    await fillRequest('Tornearia Navegador');
    assert.equal(await evaluate("document.querySelector('.request-form input[type=file]').files.length"), 0);
    await capture('solicitacao-modal-manual-desktop');
    await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
    assert.equal(await evaluate("document.querySelector('.request-modal').scrollWidth<=document.querySelector('.request-modal').clientWidth+1"), true, 'Modal fits mobile width');
    await capture('solicitacao-modal-manual-mobile');
    await send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false});
    await send('Network.emulateNetworkConditions', {offline: false, latency: 1200, downloadThroughput: -1, uploadThroughput: -1});
    await click('Enviar solicitação', '.request-form button');
    await waitFor("document.querySelector('.request-form')?.getAttribute('aria-busy')==='true'", 'busy form');
    await pressKey('Escape');
    assert.equal(await evaluate("!!document.querySelector('.request-modal')&&!document.querySelector('[role=alertdialog]')"), true, 'Busy submission cannot be dismissed');
    await waitFor("document.querySelector('.request-detail') && !document.querySelector('.request-modal')", 'manual request without budget');
    await send('Network.emulateNetworkConditions', {offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1});
    const requestId = await evaluate("new URLSearchParams(location.search).get('solicitacao')"); assert.match(requestId, /^[0-9a-f-]{36}$/i);
    assert.equal(await evaluate("document.querySelector('.request-person-card strong').textContent"), requesterName);
    const operatorFooter = await evaluate("document.querySelector('.request-registration-note').textContent+document.querySelector('.request-record-details').textContent");
    assert.ok(operatorFooter.includes(operatorName)); assert.ok(operatorFooter.includes(operatorSession.user.id));
    assert.ok(operatorFooter.includes('Registrado'), 'The detail identifies the operator separately');
    assert.equal(await evaluate("document.querySelector('.request-person-card').textContent.includes('Usuário:')"), false, 'Requester must not be displayed as an authenticated user');
    assert.equal(await evaluate("[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Aprovar solicitação')"), false, 'Operator cannot approve');
    assert.equal(await evaluate("document.querySelectorAll('.request-person-image img').length"), 0);
    assert.equal(await evaluate("document.querySelectorAll('.request-signature-hash').length"), 0, 'Manual signature has no registered signature hash');
    const documentHash = await evaluate("document.querySelector('.request-verification-card code').textContent"); assert.match(documentHash, /^[a-f0-9]{64}$/i);
    const manualPdf = await downloadPdf();
    assert.ok(manualPdf.text.includes(requesterName) && manualPdf.text.includes('DIRETOR GERAL'));
    assert.equal(/\/Subtype\s*\/Image\b/.test(manualPdf.bytes.toString('latin1')), false, 'Manual pending form has no raster signatures');
    await capture('solicitacao-registrada-operador');

    // A saved PNG can be bypassed for one document, or used on another.
    await openRequest(); const registeredRequesterSignatureId = await chooseRequester('Edmilson de teste');
    assert.equal(await evaluate("document.querySelector('[name=requester-signing-mode][value=registered]').checked"), true);
    await evaluate("document.querySelector('[name=requester-signing-mode][value=manual]').click()");
    await fillRequest('Tornearia PNG dispensado');
    const manualWithPngRequestId = await submitRequest();
    assert.equal(await evaluate("document.querySelectorAll('.request-person-image img').length"), 0);
    assert.equal(await evaluate("document.querySelectorAll('.request-signature-hash').length"), 0);
    await openRequest(); await chooseRequester('Edmilson de teste'); await fillRequest('Tornearia assinatura cadastrada');
    await uploadPng('.request-form input[type=file]', 'orcamento-navegador.png');
    const registeredRequestId = await submitRequest();
    await waitFor("document.querySelector('.request-person-image img')?.naturalWidth>0", 'registered requester image');
    assert.match(await evaluate("document.querySelector('.request-signature-hash code').textContent"), /^[a-f0-9]{64}$/i);

    // A separate manager login reviews and approves the operator's submission.
    await seedSession(managerSession); await go('/solicitacoes?secao=servico&solicitacao=' + requestId);
    await waitFor("[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Aprovar solicitação'&&!button.disabled)", 'manager approval controls');
    await click('Recusar'); await waitFor("document.querySelector('[role=alert]')?.textContent.includes('motivo')", 'refusal requires reason');
    await evaluate("document.querySelector('[name=manager-signing-mode][value=manual]').click()");
    await click('Aprovar solicitação'); await waitFor("document.querySelector('[role=alertdialog]')", 'decision confirmation');
    await click('Aprovar solicitação', '[role=alertdialog] button');
    await waitFor("document.querySelector('.request-decision-card')?.textContent.includes('Decisão registrada')", 'approval recorded');
    assert.equal(await evaluate("document.querySelectorAll('.request-history li').length"), 2);
    assert.match(await evaluate("document.querySelector('.request-history time').textContent"), /\d{2}:\d{2}:\d{2}/);
    assert.ok((await evaluate("document.querySelector('.request-history li').textContent")).includes(operatorName));
    assert.ok((await evaluate("document.querySelectorAll('.request-person-card')[1].textContent")).includes(managerSession.user.id));
    assert.equal(await evaluate("document.querySelectorAll('.request-person-image img').length"), 0);
    assert.equal(await evaluate("document.querySelectorAll('.request-signature-hash').length"), 0);
    assert.equal(await evaluate("document.querySelector('.request-verification-card code').textContent"), documentHash, 'The document snapshot hash survives its decision');
    await capture('solicitacao-aprovada-manual');
    await go('/solicitacoes?secao=servico&solicitacao=' + registeredRequestId);
    await waitFor("document.querySelector('[name=manager-signing-mode][value=registered]')", 'registered director mode');
    await evaluate("document.querySelector('[name=manager-signing-mode][value=registered]').click()");
    await click('Aprovar solicitação'); await waitFor("document.querySelector('[role=alertdialog]')", 'registered decision confirmation');
    await click('Aprovar solicitação', '[role=alertdialog] button');
    await waitFor("document.querySelector('.request-decision-card')?.textContent.includes('Decisão registrada')", 'registered decision recorded');
    await waitFor("document.querySelectorAll('.request-person-image img').length===2 && [...document.querySelectorAll('.request-person-image img')].every(image=>image.complete&&image.naturalWidth>0)", 'both registered signatures');
    assert.equal(await evaluate("document.querySelectorAll('.request-signature-hash code').length"), 2);
    const registeredPdf = await downloadPdf();
    assert.ok(registeredPdf.text.includes('SOLICITANTE') && registeredPdf.text.includes('Edmilson de teste'));
    assert.ok(registeredPdf.text.includes(operatorName) && registeredPdf.text.includes(operatorSession.user.id));
    assert.ok(registeredPdf.text.includes('DIRETOR GERAL') && registeredPdf.text.includes(managerSession.user.id));
    assert.ok(registeredPdf.text.includes('Hash do registro'));
    assert.ok(registeredPdf.text.includes('SOLICITAÇÃO DE OFICINA') && registeredPdf.text.includes('Texto livre de teste'), 'The issued PDF uses the edited template snapshot');
    assert.equal(/\/Subtype\s*\/Image\b/.test(registeredPdf.bytes.toString('latin1')), true);
    await capture('solicitacao-aprovada-desktop');

    await click('Prévia do documento');
    const preview=await readRequestPreviewPdf(evaluate,waitFor);assert.ok(preview.text.includes('SOLICITA\u00c7\u00c3O DE OFICINA'));
    assert.ok(preview.text.includes('Hash do registro'));assert.ok(/\/Subtype\s*\/Image\b/.test(preview.source));
    await capture('solicitacao-previa-modelo');
    await evaluate("document.querySelector('.request-preview-modal [data-slot=dialog-close]').click()");
    const verificationUrl = await evaluate("document.querySelector('.request-verification-content a').href");
    await go(verificationUrl.replace(baseUrl, '')); await waitFor("document.querySelector('.request-verification-valid')", 'QR verifies original saved hash');
    await go(verificationUrl.replace(baseUrl, '').replace(/verificar=[^&]+/, 'verificar='+'0'.repeat(64)));
    await waitFor("document.querySelector('.request-verification-card [role=alert]')?.textContent.includes('não corresponde')", 'changed QR hash is rejected');
    await go(verificationUrl.replace(baseUrl, '')); await waitFor("document.querySelector('.request-verification-valid')", 'valid QR restored');

    await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
    await capture('solicitacao-aprovada-mobile');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'), true, 'Detail fits mobile viewport');
    await go('/solicitacoes?secao=servico'); await waitFor("document.querySelector('.request-filters')", 'mobile listing'); await capture('solicitacoes-mobile');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'), true, 'List fits mobile viewport');
    await go('/cadastro?secao=assinaturas'); await waitFor("document.querySelector('.signatures-table')", 'mobile signatures'); await capture('assinaturas-mobile');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'), true, 'Registry fits mobile viewport');
    await seedSession(otherSession); await go('/solicitacoes?secao=servico'); await waitFor("document.querySelector('.request-filters')", 'new account');
    await waitFor("!document.querySelector('.request-table tbody tr, .request-service-card')", 'new account is empty');
    assert.equal(await evaluate(`document.body.innerText.includes('Tornearia Navegador')||document.body.innerText.includes(${JSON.stringify(requesterName)})||document.body.innerText.includes(${JSON.stringify(operatorName)})`), false);
    assert.deepEqual(errors, []);
    console.log('PASS: modal focus/discard/busy/mobile, name-only registry, optional budget, manual and registered signatures, director decisions, PDF/hash snapshots and account isolation.');
    return {requestId, requesterSignatureId, requesterName, registeredRequestId, registeredRequesterSignatureId, manualWithPngRequestId};
  } catch (error) {
    console.error('Request browser verification:', error.message);
    await capture('solicitacao-erro').catch(() => {});
    throw error;
  } finally {
    try {
      if (initScript) await send('Page.removeScriptToEvaluateOnNewDocument', {identifier: initScript}).catch(() => {});
      await evaluate(`localStorage.removeItem('sb-${projectRef}-auth-token')`).catch(() => {});
    } finally {socket.close(); await fetch(`${cdpUrl}/json/close/${tab.id}`);}
  }
}
