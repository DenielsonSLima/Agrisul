import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {getMcpCredentials, PROJECT_REF} from '../scripts/supabase-mcp.mjs';

if (process.env.BILLING_RUN_LIVE_TESTS !== '1') {
  throw new Error('Set BILLING_RUN_LIVE_TESTS=1 for isolated remote tests.');
}
if (PROJECT_REF !== 'rbuscpwntzpyqsuycqmv') throw new Error('Unexpected Supabase project.');

const {authorization} = getMcpCredentials();
const keyResponse = await fetch(
  `https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`,
  {headers: {Authorization: authorization}},
);
assert.equal(keyResponse.status, 200);
const keys = await keyResponse.json();
const publicKey = keys.find(key => key.type === 'publishable')?.api_key;
const adminKey = keys.find(key => key.type === 'secret')?.api_key
  ?? keys.find(key => key.name === 'service_role')?.api_key;
assert.ok(publicKey && adminKey);

const url = `https://${PROJECT_REF}.supabase.co`;
const options = {auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false}};
const admin = createClient(url, adminKey, options);
const users = [];
const clients = [];
const record = join(tmpdir(), `quotation-unaward-live-users-${randomUUID()}.json`);

async function account() {
  const email = `quotation-unaward-${randomUUID()}@example.com`;
  const password = `${randomUUID()}aA9!`;
  const created = await admin.auth.admin.createUser({email, password, email_confirm: true});
  assert.ifError(created.error);
  users.push(created.data.user.id);
  writeFileSync(record, JSON.stringify({projectRef: PROJECT_REF, userIds: users}));
  const client = createClient(url, publicKey, options);
  clients.push(client);
  const signed = await client.auth.signInWithPassword({email, password});
  assert.ifError(signed.error);
  return {id: created.data.user.id, client};
}

async function rpc(client, resource, action, payload = {}) {
  const {data, error} = await client.rpc('billing_rpc', {
    p_resource: resource,
    p_action: action,
    p_payload: payload,
  });
  if (error) throw Object.assign(new Error(error.message), {code: error.code});
  return data;
}

try {
  const owner = await account();
  const outsider = await account();
  const anonymous = createClient(url, publicKey, options);
  clients.push(anonymous);
  await rpc(owner.client, 'settings', 'get');
  await rpc(outsider.client, 'settings', 'get');

  const signature = (await rpc(owner.client, 'signatures', 'save', {
    name: 'Solicitante temporário',
    role: 'requester',
  })).signature;
  const material = (await rpc(owner.client, 'materials', 'save', {
    name: 'Material temporário para desaprovação',
    internalCode: `UNAWARD-${randomUUID().slice(0, 8)}`,
    unit: 'UN',
    application: 'Teste isolado',
  })).material;
  const provider = (await rpc(owner.client, 'service-providers', 'save', {
    documentType: 'CNPJ',
    document: '04773159000523',
    legalName: 'Fornecedor temporário para desaprovação',
    tradeName: 'Fornecedor temporário',
    street: 'Rua temporária',
    number: '1',
    complement: '',
    district: 'Centro',
    city: 'Itabaiana',
    state: 'SE',
    zipCode: '49500000',
    phone: '79999999999',
    email: 'unaward@example.invalid',
  })).provider;
  const quotationItemId = randomUUID();
  const quotationProviderId = randomUUID();
  const saved = await rpc(owner.client, 'quotations', 'save', {
    title: 'Cotação temporária para desaprovação',
    number: '',
    requestDate: '2026-09-28',
    requester: 'IGNORADO',
    requesterSignatureId: signature.id,
    notes: 'Teste remoto isolado',
    items: [{
      id: quotationItemId,
      materialId: material.id,
      materialName: 'IGNORADO',
      quantity: '2',
      unit: 'IGNORADO',
      notes: '',
    }],
    providers: [{
      id: quotationProviderId,
      providerId: provider.id,
      providerName: 'IGNORADO',
      providerEmail: '',
      providerPhone: '',
      notes: '',
      sentAt: null,
      values: {[quotationItemId]: ''},
    }],
  });
  const quotationId = saved.quote.id;
  await rpc(owner.client, 'quotations', 'record-negotiation', {
    id: quotationId,
    quotationProviderId,
    quotationItemId,
    unitPrice: '10.00',
    discountType: 'percentage',
    discountValue: '7',
    notes: 'Condição temporária',
    requestId: randomUUID(),
  });
  const awarded = await rpc(owner.client, 'quotations', 'award-item', {
    id: quotationId,
    quotationItemId,
    quotationProviderId,
  });
  assert.equal(awarded.quote.awardedItemCount, 1);
  assert.equal(awarded.quote.awardedGrossTotal, '20');
  assert.equal(awarded.quote.awardedTotal, '18.6');

  const cleared = await rpc(owner.client, 'quotations', 'unaward-item', {
    id: quotationId,
    quotationItemId,
  });
  assert.equal(cleared.quote.awardedItemCount, 0);
  assert.equal(cleared.quote.pendingAwardCount, 1);
  assert.equal(cleared.quote.awardedGrossTotal, '0');
  assert.equal(cleared.quote.awardedTotal, '0');
  assert.equal(cleared.quote.itemAwards.length, 0);
  assert.equal(cleared.quote.negotiations.length, 1);
  assert.equal(cleared.quote.providers[0].offers[quotationItemId].lineTotal, '18.6');

  const retried = await rpc(owner.client, 'quotations', 'unaward-item', {
    id: quotationId,
    quotationItemId,
  });
  assert.equal(retried.quote.awardedItemCount, 0);
  assert.equal(retried.quote.negotiations.length, 1);
  await assert.rejects(
    rpc(outsider.client, 'quotations', 'unaward-item', {id: quotationId, quotationItemId}),
    error => error.code === 'P0002',
  );
  await assert.rejects(
    rpc(anonymous, 'quotations', 'unaward-item', {id: quotationId, quotationItemId}),
    error => error.code === '42501' || error.code === '28000',
  );
  const directDelete = await owner.client
    .from('billing_quotation_item_awards')
    .delete()
    .eq('quotation_id', quotationId);
  assert.equal(directDelete.error?.code, '42501');

  const restored = await rpc(owner.client, 'quotations', 'award-item', {
    id: quotationId,
    quotationItemId,
    quotationProviderId,
  });
  assert.equal(restored.quote.awardedItemCount, 1);
  assert.equal(restored.quote.awardedTotal, '18.6');
  console.log('PASS: remote unaward clears only the decision, preserves prices/history, recalculates totals and enforces isolation.');
} finally {
  for (const client of clients) await client.removeAllChannels();
  const failures = [];
  for (const id of [...users].reverse()) {
    const {error} = await admin.auth.admin.deleteUser(id);
    if (error) failures.push(id);
  }
  if (failures.length) {
    throw new Error(`Temporary account cleanup failed; see ${record}: ${failures.join(', ')}`);
  }
  if (users.length) unlinkSync(record);
  console.log(`Cleanup: ${users.length} temporary accounts removed.`);
}
