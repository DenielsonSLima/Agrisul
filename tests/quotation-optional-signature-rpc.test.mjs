import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('quotations accept a requester name without signatures and preserve ownership and linked signatures', async () => {
  const {db, ids, setActor} = await createCaneWeighingDb();
  const rpc = async (resource, action, payload = {}) =>
    (await db.query('select public.billing_rpc($1,$2,$3::jsonb) result', [resource, action, JSON.stringify(payload)])).rows[0].result;
  try {
    const material = (await rpc('materials', 'save', {name: 'Peça de teste', internalCode: '', unit: 'PC', application: ''})).material;
    const input = {
      title: 'Cotação sem assinatura', number: '', requestDate: '2026-11-16', requester: 'Solicitante avulso', notes: '',
      items: [{id: randomUUID(), materialId: material.id, quantity: '2', notes: ''}], providers: [],
    };
    const first = (await rpc('quotations', 'save', input)).quote;
    assert.equal(first.requester, 'Solicitante avulso');
    assert.equal(first.requesterSignatureId, null);
    const second = (await rpc('quotations', 'save', {...input, requesterSignatureId: '', items: [{...input.items[0], id: randomUUID()}]})).quote;
    assert.equal(second.requesterSignatureId, null, 'an explicitly empty signature must not turn the RPC response into SQL null');
    const details = {id: first.id, title: 'Nome digitado', requestDate: first.requestDate, requester: 'Outro solicitante', requesterSignatureId: null, notes: 'Observação'};
    const edited = (await rpc('quotations', 'update-details', details)).quote;
    assert.equal(edited.requester, 'Outro solicitante');
    assert.equal(edited.requesterSignatureId, null);
    assert.deepEqual(edited.items, first.items, 'header edits must preserve item quantities and snapshots');
    await assert.rejects(() => rpc('quotations', 'save', {...input, requester: ' '}), error => error.code === '22023');
    await assert.rejects(() => rpc('quotations', 'update-details', {...details, requester: ''}), error => error.code === '22023');
    const signature = (await rpc('signatures', 'save', {name: 'Nome da assinatura', userId: null, role: 'requester'})).signature;
    const linked = (await rpc('quotations', 'update-details', {...details, requester: 'Nome ignorado', requesterSignatureId: signature.id})).quote;
    assert.equal(linked.requester, signature.name);
    assert.equal(linked.requesterSignatureId, signature.id);
    const unlinked = (await rpc('quotations', 'save', {...input, id: first.id, requester: 'Nome sem vínculo', requesterSignatureId: ''})).quote;
    assert.equal(unlinked.requester, 'Nome sem vínculo');
    assert.equal(unlinked.requesterSignatureId, null);
    await setActor(ids.otherOwner);
    await assert.rejects(() => rpc('quotations', 'update-details', details), error => error.code === 'P0002');
    const otherMaterial = (await rpc('materials', 'save', {name: 'Outra peça', internalCode: '', unit: 'PC', application: ''})).material;
    await assert.rejects(() => rpc('quotations', 'save', {...input, requesterSignatureId: signature.id, items: [{id: randomUUID(), materialId: otherMaterial.id, quantity: '1', notes: ''}]}), error => error.code === '23514');
    await setActor(ids.reader);
    await assert.rejects(() => rpc('quotations', 'update-details', details), error => error.code === '42501');
    await setActor();
    await assert.rejects(() => db.query("update public.billing_quotations set requester='Direto' where id=$1", [first.id]), error => error.code === '42501');
    await setActor(null);
    await assert.rejects(() => rpc('quotations', 'list', {status: 'open'}), error => error.code === '28000');
  } finally {
    await db.close();
  }
});
