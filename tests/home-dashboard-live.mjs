import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync, writeFileSync, unlinkSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {getMcpCredentials, PROJECT_REF} from '../scripts/supabase-mcp.mjs';

if (process.env.BILLING_RUN_LIVE_TESTS !== '1') throw Error('Set BILLING_RUN_LIVE_TESTS=1 for isolated live verification.');
assert.equal(PROJECT_REF, 'rbuscpwntzpyqsuycqmv');
const {authorization} = getMcpCredentials();
const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`, {headers: {Authorization: authorization}});
assert.equal(response.status, 200);
const keys = await response.json();
const publicKey = keys.find(key => key.type === 'publishable')?.api_key;
const adminKey = keys.find(key => key.type === 'secret')?.api_key ?? keys.find(key => key.name === 'service_role')?.api_key;
assert.ok(publicKey && adminKey);
const options = {auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false}};
const admin = createClient(`https://${PROJECT_REF}.supabase.co`, adminKey, options);
const users = [], clients = [], output = '.sites-runtime/home-validation';
mkdirSync(output, {recursive: true});
const record = `${output}/identities-${randomUUID()}.json`;
let ws, tab;
async function account(name) {
  const email = `home-${randomUUID()}@example.com`, password = randomUUID() + 'aA9!';
  const {data, error} = await admin.auth.admin.createUser({email, password, email_confirm: true, user_metadata: {display_name: name}});
  assert.ifError(error); users.push(data.user.id); writeFileSync(record, JSON.stringify({projectRef: PROJECT_REF, userIds: users}));
  const client = createClient(`https://${PROJECT_REF}.supabase.co`, publicKey, options); clients.push(client);
  const signed = await client.auth.signInWithPassword({email, password}); assert.ifError(signed.error);
  return {client, id: data.user.id, session: signed.data.session};
}
async function rpc(client, resource, action, payload = {}) {
  const {data, error} = await client.rpc('billing_rpc', {p_resource: resource, p_action: action, p_payload: payload});
  if (error) throw Object.assign(Error(error.message), {code: error.code}); return data;
}
try {
  const owner = await account('Marina Teste'), other = await account('Outra Conta'), reader = await account('Leitor Serviços');
  const start = await rpc(owner.client, 'home', 'get');
  assert.equal(start.finance, null); assert.equal(start.requests.pendingCount, 0);
  const today = start.today, month = start.month;
  const shift = n => {const date = new Date(`${today}T12:00:00Z`);date.setUTCDate(date.getUTCDate() + n);return date.toISOString().slice(0, 10);};
  const details = {tradeName: '', cnpj: '', street: '', number: '', complement: '', district: '', city: '', state: '', zipCode: '', phone: '', email: ''};
  const company = (await rpc(owner.client, 'companies', 'save', {...details, legalName: 'Agro Horizonte · Teste Início', isPrimary: true})).company;
  const second = (await rpc(owner.client, 'companies', 'save', {...details, legalName: 'Unidade sem movimento', isPrimary: false})).company;
  const client = (await rpc(owner.client, 'clients', 'save', {...details, legalName: 'Usina Boa Esperança', cnpj: '33444555000161', status: 'Ativo'})).client;
  await rpc(owner.client, 'contract-types', 'save', {name: 'Fornecimento de cana', stages: []});
  const kind = (await rpc(owner.client, 'contract-types', 'list')).types[0];
  const farm = (await rpc(owner.client, 'farms', 'save', {name: 'Fazenda Santa Clara', areaHa: '200', city: 'Ribeirão Preto', state: 'SP'})).farm;
  const plot = (await rpc(owner.client, 'plots', 'save', {farmId: farm.id, name: 'Talhão 01', areaHa: '100'})).data.plots[0];
  const contract = (await rpc(owner.client, 'contracts', 'save', {title: 'Fornecimento safra atual', contractNumber: '2026/001', companyId: company.id,
    clientId: client.id, typeId: kind.id, status: 'Ativo', startDate: shift(-45), endDate: shift(-1), contractedVolume: '1000', value: '', notes: '', atrPriceType: 'gross', atrPeriodType: 'monthly'})).contract;
  await rpc(owner.client, 'contracts', 'save-load', {companyId: company.id, contractId: contract.id, farmId: farm.id, plotId: plot.id, loadedAt: today, volume: '120.5', atr: '140', document: '0001', notes: ''});
  await rpc(owner.client, 'contracts', 'save-payment', {companyId: company.id, contractId: contract.id, requestId: randomUUID(), kind: 'receipt', receivedAt: today, referenceMonth: month, amount: '18500.75', document: '', notes: ''});
  const culture = await rpc(owner.client, 'cultures', 'save', {kind: 'culture', name: 'Cana teste'});
  const subtype = await rpc(owner.client, 'cultures', 'save', {kind: 'subtype', cultureId: culture.id, name: 'Cana planta'});
  const period = (await rpc(owner.client, 'planning', 'save-period', {name: 'Safra de cana 2026/27', startDate: shift(-60), endDate: shift(180), targetAreaHa: '100', cultureId: culture.id, cultureSubtypeId: subtype.id, notes: '', status: 'active'})).period;
  await rpc(owner.client, 'planning', 'save-allocation', {periodId: period.id, plotId: plot.id, areaHa: '80', notes: ''});
  await rpc(owner.client, 'planning', 'save-field-log', {periodId: period.id, plotId: plot.id, kind: 'planting', practiceId: '', occurredOn: today, areaHa: '35', notes: '', requestId: randomUUID(), details: {materials: []}});
  await rpc(owner.client, 'planning', 'save-harvest-goal', {periodId: period.id, targetTons: '1000', targets: [{plotId: plot.id, targetTons: '1000'}], expectedRevision: 1, reason: 'Meta teste'});
  const person = (await rpc(owner.client, 'signatures', 'save', {name: 'Carlos de Oliveira', role: 'requester'})).signature;
  const provider = (await rpc(owner.client, 'service-providers', 'save', {documentType: 'CNPJ', document: '16567478000138', legalName: 'Oficina Agrícola Santa Clara', tradeName: '', street: '', number: '', complement: '', district: '', city: '', state: '', zipCode: '', phone: '', email: ''})).provider;
  await rpc(owner.client, 'service-requests', 'create', {requestId: randomUUID(), requesterSignatureId: person.id, requesterSigningMode: 'manual', providerId: provider.id, items: [{description: 'Revisão de colhedora', application: 'Colhedora 01'}], serviceValue: null, returnDate: shift(5), notes: '', attachmentIds: []});
  const profile = (await rpc(owner.client, 'access-profiles', 'save', {name: 'Leitura de serviços teste', description: 'Validação do Início', permissions: ['requests.read']})).profile;
  assert.ifError((await admin.from('billing_memberships').insert({owner_id: owner.id, user_id: reader.id, access_profile_id: profile.id, is_owner: false, status: 'active'})).error);
  await rpc(reader.client, 'onboarding', 'complete', {name: 'Leitor Serviços'});

  const full = await rpc(owner.client, 'home', 'get', {companyId: company.id, month});
  assert.equal(full.finance.netAmount, ''); assert.equal(full.finance.pendingLoadCount, 1); assert.equal(full.finance.loadedVolume, '120.5');
  assert.equal(full.finance.receivedAmount, '18500.75'); assert.equal(full.contracts.overdueCount, 1);
  assert.equal(full.planning.plantingPercent, '35'); assert.equal(full.planning.harvestedTons, '120.5');
  assert.equal(full.requests.pendingCount, 1);
  const isolated = await rpc(other.client, 'home', 'get'); assert.equal(isolated.requests.pendingCount, 0);assert.equal(isolated.registrations.farmCount, 0);
  await assert.rejects(rpc(other.client, 'home', 'get', {companyId: company.id}), error => error.code === '22023');
  const restricted = await rpc(reader.client, 'home', 'get');assert.equal(restricted.requests.pendingCount, 1);assert.equal(restricted.finance, null);assert.equal(restricted.planning, null);assert.equal(restricted.registrations, null);
  assert.ok((await owner.client.from('billing_contracts').update({title: 'Denied'}).eq('id', contract.id)).error);
  console.log('Live RPC: exact decimals, empty states, current planning, company/workspace isolation and restricted permissions passed.');

  const cdp = process.env.BILLING_CDP_URL || 'http://localhost:9241', base = 'http://localhost:5173';
  tab = await (await fetch(`${cdp}/json/new?about:blank`, {method: 'PUT'})).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  const pending = new Map(), browserErrors = []; let sequence = 0, script;
  await new Promise((resolve, reject) => {ws.addEventListener('open', resolve, {once: true});ws.addEventListener('error', reject, {once: true});});
  const send = (method, params = {}) => new Promise((resolve, reject) => {const id = ++sequence, timer = setTimeout(() => {pending.delete(id);reject(Error('CDP timeout: ' + method));}, 45000);pending.set(id, {resolve, reject, timer});ws.send(JSON.stringify({id, method, params}));});
  ws.addEventListener('message', event => {const message = JSON.parse(event.data);if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);const job = pending.get(message.id);if (job) {pending.delete(message.id);clearTimeout(job.timer);if (message.error) job.reject(Error(message.error.message));else job.resolve(message.result);}});
  const evaluate = async expression => {const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);return result.result.value;};
  const wait = async (expression, label) => {const deadline = Date.now() + 45000;while (Date.now() < deadline) {if (await evaluate(`!!document.body && !!(${expression})`)) return;await new Promise(resolve => setTimeout(resolve, 250));}throw Error('Missing ' + label + ': ' + await evaluate('document.body.innerText.slice(-1600)') + browserErrors.join('\n'));};
  const shot = async name => {const result = await send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true});writeFileSync(`${output}/${name}.png`, Buffer.from(result.data, 'base64'));};
  const login = async account => {
    await send('Page.navigate', {url: 'about:blank'});
    if (script) await send('Page.removeScriptToEvaluateOnNewDocument', {identifier: script});
    script = (await send('Page.addScriptToEvaluateOnNewDocument', {source: `if(location.origin===${JSON.stringify(base)}){localStorage.clear();localStorage.setItem('sb-${PROJECT_REF}-auth-token',${JSON.stringify(JSON.stringify(account.session))});localStorage.setItem('billing:${account.id}:active-company',${JSON.stringify(company.id)});}`})).identifier;
    await send('Page.navigate', {url: base});await wait("document.querySelector('.inicio-content')", 'home content');
  };
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false});
  await login(owner);await wait("document.querySelector('.inicio-finance-main')?.textContent.includes('A apurar')", 'pending finance');
  assert.ok(await evaluate("document.querySelector('.inicio-attention').textContent.includes('Solicitações abertas')"));
  assert.ok(await evaluate("document.querySelector('.inicio-planning').textContent.includes('35,00%')"));
  await shot('inicio-desktop');
  for (const width of [390, 768, 1024]) {
    await send('Emulation.setDeviceMetricsOverride', {width, height: 1000, deviceScaleFactor: 1, mobile: width < 600});
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), 'No horizontal scroll at ' + width);
    assert.ok(await evaluate("[...document.querySelectorAll('.inicio-panel,.inicio-finance,.inicio-registry')].every(e=>e.scrollWidth<=e.clientWidth+1)"), 'No clipped panels at ' + width);
    if (width === 390) await shot('inicio-mobile');
  }
  await send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false});
  // React inputs require the native setter to notify the controlled field.
  await evaluate("(()=>{const input=document.querySelector('.inicio-month input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2020-02');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await wait("document.querySelector('.inicio-finance-main')?.textContent.includes('fevereiro de 2020')", 'month filter');
  assert.ok(await evaluate("document.querySelector('.inicio-finance-main').textContent.includes('R$ 0,00')"));
  assert.ok(await evaluate("document.querySelector('.inicio-planning').textContent.includes('35,00%')"));
  await evaluate(`document.querySelector('.inicio-record[href*="${contract.id}"]').click()`);
  await wait("location.search.includes('contrato=') && document.querySelector('.contract-detail-heading')", 'contract deep link');
  await evaluate("document.querySelector('.brand').click()");await wait("document.querySelector('.inicio-finance')", 'return home');

  // Independent client writes should invalidate the visible dashboard through Realtime.
  const quote = new Date(`${month}-01T12:00:00Z`);quote.setUTCMonth(quote.getUTCMonth() - 1);
  await rpc(owner.client, 'atr', 'save', {year: quote.getUTCFullYear(), month: quote.getUTCMonth() + 1, monthlyGrossValue: '1.2', monthlyNetValue: '1.1', accumulatedGrossValue: '1.2', accumulatedNetValue: '1.1'});
  await wait("document.querySelector('.inicio-finance-main')?.textContent.includes('20.244,00')", 'Realtime recalculation after ATR');
  await shot('inicio-desktop-apurado');
  const chooseCompany = async label => {
    await evaluate("document.querySelector('.top-company-switch [role=combobox]').click()");
    await wait("document.querySelector('[role=option]')", 'company options');
    await evaluate(`[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.includes(${JSON.stringify(label)})).click()`);
    await wait(`document.querySelector('.inicio-company')?.textContent.includes(${JSON.stringify(label)}) && !!document.querySelector('.inicio-finance')`, 'company selection');
  };
  await chooseCompany(second.legalName || second.name || 'Unidade sem movimento');
  assert.ok(await evaluate("document.querySelector('.inicio-finance-main').textContent.includes('R$ 0,00')"));
  assert.ok(await evaluate("document.querySelector('.inicio-content').textContent.includes('Oficina Agrícola Santa Clara')"));
  await chooseCompany(company.legalName || company.name || 'Agro Horizonte');
  await wait("document.querySelector('.inicio-finance-main')?.textContent.includes('20.244,00')", 'restored company');
  await login(reader);assert.equal(await evaluate("!!document.querySelector('.inicio-finance')"), false);assert.equal(await evaluate("!!document.querySelector('.inicio-registry')"), false);
  assert.ok(await evaluate("document.querySelector('.inicio-content').textContent.includes('Oficina Agrícola Santa Clara')"));
  await shot('inicio-perfil-restrito');
  await login(other);assert.ok(await evaluate("document.querySelector('.inicio-setup').textContent.includes('Comece pela sua empresa')"));
  assert.equal(await evaluate("document.querySelector('.inicio-content').textContent.includes('Oficina Agrícola Santa Clara')"), false);
  await shot('inicio-vazio');
  assert.deepEqual(browserErrors, []);
  console.log('Browser: desktop/mobile/tablet, month filter, contract navigation, Realtime, restricted member and account isolation passed.');
  console.log('Screenshots:', output);
  await send('Page.removeScriptToEvaluateOnNewDocument', {identifier: script});
  await evaluate(`localStorage.removeItem('sb-${PROJECT_REF}-auth-token')`);
  await send('Page.navigate', {url: 'about:blank'});
} finally {
  if (ws) ws.close();
  if (tab?.id) await fetch(`${process.env.BILLING_CDP_URL || 'http://localhost:9241'}/json/close/${tab.id}`).catch(() => {});
  for (const client of clients) await client.removeAllChannels();
  const failures = [];
  if (users.length) {
    const result = await admin.from('billing_document_templates').delete().in('owner_id', users);if (result.error) failures.push(result.error.message);
    for (const id of [...users].reverse()) {const result = await admin.auth.admin.deleteUser(id);if (result.error) failures.push(id + ': ' + result.error.message);}
  }
  if (failures.length) throw Error('Temporary identity cleanup failed; see ' + record + ': ' + failures.join('; '));
  if (users.length) unlinkSync(record);
  console.log(`Cleanup: ${users.length} temporary accounts and their workspace records removed.`);
}
