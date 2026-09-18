import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {build} = require(require.resolve('esbuild', {paths: [require.resolve('vite')]}));

test('signature services preserve private uploads, history and session boundaries', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'billing-signatures-test-'));
  try {
    const output = join(temporary, 'signature-api.mjs');
    await build({
      entryPoints: ['modules/cadastro/assinaturas/services/signatureApi.ts'],
      outfile: output, bundle: true, platform: 'node', format: 'esm',
      plugins: [{name: 'signature-fixtures', setup(builder) {
        builder.onResolve({filter: /^@\/shared\/supabase\/(rpc|client)$/}, args => ({path: args.path, namespace: 'fixture'}));
        builder.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({contents: args.path.endsWith('/rpc')
          ? 'export class RpcError extends Error{constructor(message,status=400){super(message);this.status=status}};export const rpcRequest=(...args)=>globalThis.signatureRpc(...args);'
          : 'export const getSupabaseBrowserClient=()=>globalThis.signatureClient;'}));
      }}],
    });
    const api = await import(pathToFileURL(output));
    const actorId = '11111111-1111-4111-8111-111111111111';
    const memberId = '22222222-2222-4222-8222-222222222222';
    const previousPath = `${actorId}/signatures/previous.png`;
    const signature = {id: 'signature-a', name: 'Maria Santos', userId: memberId, role: 'manager', fileId: 'old-file', filePath: previousPath, active: true, createdAt: '2026-09-17T13:14:15Z', updatedAt: '2026-09-17T13:14:15Z'};
    const png = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'assinatura.png', {type: 'image/png'});
    let sequence = 0;

    function fixture() {
      const calls = [], uploads = [], signs = [], removals = [], events = [];
      const state = {session: {user: {id: actorId}}, rpcError: null, uploadError: null, preparedBucket: 'billing-signatures', onPrepare: null, onUpload: null, onSign: null};
      globalThis.signatureClient = {
        auth: {getSession: async () => ({data: {session: state.session}})},
        storage: {from(bucket) {
          assert.equal(bucket, 'billing-signatures');
          return {
            upload: async (path, file, options) => {events.push('upload'); uploads.push({bucket, path, file, options}); state.onUpload?.(); return {error: state.uploadError};},
            remove: async paths => {removals.push(paths); return {error: null};},
            createSignedUrl: async (path, seconds) => {signs.push({bucket, path, seconds}); await state.onSign?.(); return {data: {signedUrl: `https://private.example.test/${path}?token=temporary`}, error: null};},
          };
        }},
      };
      globalThis.signatureRpc = async (resource, action, payload = {}, signal) => {
        assert.equal(resource, 'signatures');
        calls.push({resource, action, payload, signal}); events.push(action);
        if (signal?.aborted) throw new DOMException('Consulta cancelada', 'AbortError');
        if (action === 'list') return {items: [signature], total: 73, page: payload.page, pageSize: payload.pageSize};
        if (action === 'options') return {users: [{id: memberId, name: signature.name}], canManage: true};
        if (action === 'prepare-upload') {
          state.onPrepare?.();
          const id = `file-${++sequence}`;
          return {file: {id, bucket: state.preparedBucket, path: `${actorId}/signatures/${id}.png`, ...payload}};
        }
        if (state.rpcError) throw state.rpcError;
        if (action === 'deactivate') return {signature: {...signature, active: false}};
        return {signature: {...signature, ...payload}};
      };
      return {state, calls, uploads, signs, removals, events};
    }

    await t.test('filters and cancellation signals reach authorized RPC projections', async () => {
      const {calls} = fixture();
      const controller = new AbortController();
      const filters = {search: 'Maria', page: 3, pageSize: 12, status: 'inactive'};
      const result = await api.fetchSignatures(filters, controller.signal);
      assert.deepEqual(result, {items: [signature], total: 73, page: 3, pageSize: 12});
      assert.deepEqual(calls[0], {resource: 'signatures', action: 'list', payload: filters, signal: controller.signal});
      assert.deepEqual(await api.fetchSignatureOptions(controller.signal), {users: [{id: memberId, name: 'Maria Santos'}], canManage: true});
      assert.equal(calls[1].signal, controller.signal);
      controller.abort();
      await assert.rejects(api.fetchSignatures(filters, controller.signal), {name: 'AbortError'});
    });

    await t.test('private images have temporary URLs and discard results after cancellation', async () => {
      const {state, signs} = fixture();
      const controller = new AbortController();
      assert.equal(await api.fetchSignatureImage(previousPath, controller.signal), `https://private.example.test/${previousPath}?token=temporary`);
      assert.deepEqual(signs[0], {bucket: 'billing-signatures', path: previousPath, seconds: 3600});
      state.onSign = () => controller.abort();
      await assert.rejects(api.fetchSignatureImage(previousPath, controller.signal), {name: 'AbortError'});
      const count = signs.length;
      await assert.rejects(api.fetchSignatureImage(previousPath, controller.signal), {name: 'AbortError'});
      assert.equal(signs.length, count, 'an already canceled query must not request another signed URL');
    });

    await t.test('a new PNG uses server preparation, an immutable upload and a file ID', async () => {
      const {calls, uploads, removals, events} = fixture();
      await api.persistSignature({name: signature.name, userId: memberId, role: 'manager', file: png});
      assert.deepEqual(events, ['prepare-upload', 'upload', 'save']);
      assert.deepEqual(calls[0].payload, {fileName: 'assinatura.png', contentType: 'image/png', size: png.size});
      assert.equal(uploads[0].file, png);
      assert.deepEqual(uploads[0].options, {contentType: 'image/png', upsert: false});
      assert.equal(uploads[0].path, `${actorId}/signatures/${calls[1].payload.fileId}.png`);
      assert.deepEqual(calls[1].payload, {name: signature.name, userId: memberId, role: 'manager', fileId: calls[1].payload.fileId});
      assert.deepEqual(removals, []);
    });

    await t.test('requester people can be saved without linking the operator account', async () => {
      const {calls, uploads, removals} = fixture();
      const result = await api.persistSignature({name: 'João da oficina', userId: null, role: 'requester', file: png});
      assert.equal(result.signature.userId, null);
      assert.equal(result.signature.role, 'requester');
      assert.deepEqual(calls.at(-1).payload, {name: 'João da oficina', userId: null, role: 'requester', fileId: calls.at(-1).payload.fileId});
      assert.equal(uploads.length, 1);
      assert.deepEqual(removals, []);
      await api.persistSignature({id: 'requester-without-account', name: 'João da oficina', role: 'requester'});
      assert.deepEqual(calls.at(-1).payload, {id: 'requester-without-account', name: 'João da oficina', role: 'requester'});
      assert.equal(uploads.length, 1, 'editing a requester does not replace its historical image');
    });

    await t.test('a named requester or linked director can be registered without uploading a PNG', async () => {
      const {calls, uploads, removals} = fixture();
      await api.persistSignature({name: 'Solicitante manual', userId: null, role: 'requester'});
      await api.persistSignature({name: 'Diretor geral manual', userId: memberId, role: 'manager'});
      assert.deepEqual(calls.map(call => call.action), ['save', 'save']);
      assert.deepEqual(calls[0].payload, {name: 'Solicitante manual', userId: null, role: 'requester'});
      assert.deepEqual(calls[1].payload, {name: 'Diretor geral manual', userId: memberId, role: 'manager'});
      assert.deepEqual(uploads, []);
      assert.deepEqual(removals, []);
    });

    await t.test('removing the current PNG clears only its future association and keeps the historical object', async () => {
      const {calls, uploads, removals} = fixture();
      await api.persistSignature({id: signature.id, name: signature.name, userId: memberId, role: 'manager', removeImage: true});
      assert.deepEqual(calls[0].payload, {id: signature.id, name: signature.name, userId: memberId, role: 'manager', fileId: null});
      assert.equal('removeImage' in calls[0].payload, false, 'client presentation flags must not leak into the RPC whitelist');
      assert.deepEqual(uploads, []);
      assert.deepEqual(removals, []);
    });

    await t.test('replacing or editing a signature keeps historical image objects', async () => {
      const {calls, uploads, removals} = fixture();
      await api.persistSignature({id: signature.id, name: 'Maria Silva', userId: memberId, role: 'manager', file: png});
      assert.notEqual(uploads[0].path, previousPath);
      assert.deepEqual(removals, []);
      const uploadCount = uploads.length;
      await api.persistSignature({id: signature.id, name: 'Maria Silva', userId: memberId, role: 'manager'});
      assert.equal(uploads.length, uploadCount);
      assert.deepEqual(calls.at(-1).payload, {id: signature.id, name: 'Maria Silva', userId: memberId, role: 'manager'});
      const inactive = await api.deactivateSignature(signature.id);
      assert.equal(inactive.signature.active, false);
      assert.deepEqual(calls.at(-1).payload, {id: signature.id});
      assert.deepEqual(removals, [], 'deactivation preserves files used by historical requests');
    });

    await t.test('empty, wrong-format and oversized files fail before any RPC or upload', async () => {
      const {calls, uploads} = fixture();
      for (const file of [new File([], 'empty.png', {type: 'image/png'}), new File(['jpeg'], 'image.jpg', {type: 'image/jpeg'}), new File([new Uint8Array(api.SIGNATURE_MAX_BYTES + 1)], 'large.png', {type: 'image/png'})]) {
        assert.throws(() => api.validateSignatureFile(file), {message: 'Selecione uma assinatura PNG de até 3 MB.'});
        await assert.rejects(api.persistSignature({name: signature.name, userId: memberId, role: 'manager', file}), /PNG de até 3 MB/);
      }
      assert.deepEqual(calls, []);
      assert.deepEqual(uploads, []);
    });

    await t.test('upload errors never save a signature or delete a potentially committed object', async () => {
      const {state, calls, uploads, removals} = fixture();
      state.uploadError = new Error('Transport lost after upload');
      await assert.rejects(api.persistSignature({name: signature.name, userId: memberId, role: 'manager', file: png}), /Não foi possível enviar/);
      assert.equal(uploads.length, 1);
      assert.deepEqual(calls.map(call => call.action), ['prepare-upload']);
      assert.deepEqual(removals, []);
    });

    await t.test('ambiguous save failures retain uploads and never overwrite the previous version', async () => {
      const {state, uploads, removals} = fixture();
      state.rpcError = new Error('Connection lost after database commit');
      const input = {id: signature.id, name: signature.name, userId: memberId, role: 'manager', file: png};
      await assert.rejects(api.persistSignature(input), /Connection lost/);
      await assert.rejects(api.persistSignature(input), /Connection lost/);
      assert.equal(uploads.length, 2);
      assert.notEqual(uploads[0].path, uploads[1].path);
      assert.ok(uploads.every(upload => upload.path !== previousPath && upload.options.upsert === false));
      assert.deepEqual(removals, []);
    });

    await t.test('logout and account changes stop the remaining upload/save steps', async () => {
      let state = fixture();
      state.state.session = null;
      await assert.rejects(api.persistSignature({name: signature.name, userId: memberId, role: 'manager', file: png}), /Entre para cadastrar/);
      assert.deepEqual(state.calls, []);
      state = fixture();
      state.state.onPrepare = () => {state.state.session = {user: {id: memberId}};};
      await assert.rejects(api.persistSignature({name: signature.name, userId: memberId, role: 'manager', file: png}), /Sua conta foi alterada/);
      assert.deepEqual(state.uploads, []);
      state = fixture();
      state.state.onUpload = () => {state.state.session = null;};
      await assert.rejects(api.persistSignature({name: signature.name, userId: memberId, role: 'manager', file: png}), /Sua conta foi alterada/);
      assert.equal(state.uploads.length, 1);
      assert.deepEqual(state.calls.map(call => call.action), ['prepare-upload']);
      assert.deepEqual(state.removals, []);
    });

    await t.test('unexpected upload destinations are rejected before transmitting PNG data', async () => {
      const {state, uploads} = fixture();
      state.preparedBucket = 'public-assets';
      await assert.rejects(api.persistSignature({name: signature.name, userId: memberId, role: 'manager', file: png}), /Destino de assinatura inválido/);
      assert.deepEqual(uploads, []);
    });
  } finally {
    assert.equal(dirname(resolve(temporary)), resolve(tmpdir()), 'cleanup target must remain inside the temporary directory');
    await rm(temporary, {recursive: true, force: true});
    delete globalThis.signatureRpc;
    delete globalThis.signatureClient;
  }
});
