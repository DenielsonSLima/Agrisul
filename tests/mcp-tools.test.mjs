import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {build} = require(require.resolve('esbuild', {paths: [require.resolve('vite')]}));
const OWNER = '22222222-2222-4222-8222-222222222222';
const MATERIAL = '33333333-3333-4333-8333-333333333333';
const QUOTE = '44444444-4444-4444-8444-444444444444';
const REQUEST = '55555555-5555-4555-8555-555555555555';
const REQUESTER = '66666666-6666-4666-8666-666666666666';

async function withTools(run) {
  const directory = await mkdtemp(join(tmpdir(), 'agrisul-mcp-tools-'));
  try {
    const outfile = join(directory, 'tools.mjs');
    await build({entryPoints: ['modules/mcp/tools.ts'], outfile, bundle: true,
      platform: 'node', format: 'esm', external: ['sharp'], logLevel: 'silent'});
    await run(await import(pathToFileURL(outfile).href));
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

function fixture() {
  const calls = [];
  const files = [];
  const stored = new Map();
  const signedPaths = [];
  let writable = true;
  let persistUploads = true;
  let forcedMissingChecks = 0;
  let savedImportPayload = null;
  const quote = {
    id: QUOTE, number: 'COT-TESTE', title: 'Cotação da foto',
    requestDate: '2026-10-05', requester: 'Solicitante Teste', notes: '',
    items: [{materialName: 'Filtro exato', materialCode: 'INT-1', quantity: '2', unit: 'UN',
      materialImageKey: null, materialReferences: [{brand: 'Marca', code: 'ABC-1'}]}],
    providers: [],
  };
  const client = {
    rpc: async (_functionName, args) => {
      calls.push(args);
      if (args.p_resource === 'materials' && args.p_action === 'list') return {data: {materials: [
        {id: MATERIAL, name: 'Filtro exato', internalCode: 'INT-1', unit: 'UN', imageKey: null,
          references: [{id: '77777777-7777-4777-8777-777777777777', brand: 'Marca', code: 'ABC-1'}]},
      ]}, error: null};
      if (args.p_resource === 'settings' && args.p_action === 'get') return {data: {settings: {workspaceId: OWNER}}, error: null};
      if (args.p_resource === 'quotations' && args.p_action === 'import-status') return {data: savedImportPayload
        ? {exists: true, requestPayload: savedImportPayload}
        : {exists: false}, error: null};
      if (args.p_resource === 'quotations' && args.p_action === 'import-draft') {
        savedImportPayload ??= args.p_payload;
        return {data: {quote, requestId: REQUEST}, error: null};
      }
      if (args.p_resource === 'quotations' && args.p_action === 'get') return {data: {quote}, error: null};
      throw Error(`Unexpected RPC: ${args.p_resource}/${args.p_action}`);
    },
    storage: {from: bucket => {
      assert.equal(bucket, 'billing-quotation-files');
      return {
        exists: async path => {
          if (forcedMissingChecks > 0) {
            forcedMissingChecks -= 1;
            return {data: false, error: {statusCode: '404'}};
          }
          const present = stored.has(path);
          return {data: present, error: present ? null : {statusCode: '404'}};
        },
        download: async path => stored.has(path)
          ? {data: new Blob([stored.get(path)]), error: null}
          : {data: null, error: {statusCode: '404'}},
        upload: async (path, bytes) => {
          if (!writable) return {error: {statusCode: '403'}};
          if (stored.has(path)) return {error: {statusCode: '409'}};
          if (!persistUploads) return {error: null};
          const copy = Buffer.from(bytes);
          stored.set(path, copy);
          files.push({path, bytes: copy});
          return {error: null};
        },
        createSignedUrl: async path => {
          signedPaths.push(path);
          return {data: {signedUrl: `https://files.example.invalid/${path}?token=fixture`}, error: null};
        },
      };
    }},
  };
  return {client, calls, files, quote, signedPaths,
    setWritable: value => {writable = value;},
    setPersistUploads: value => {persistUploads = value;},
    setStored: (path, bytes) => stored.set(path, Buffer.from(bytes)),
    forceMissingOnce: () => {forcedMissingChecks += 1;}};
}

test('MCP tools import an existing exact material, leave providers empty, and return a real PDF link', async () => {
  await withTools(async ({callMcpTool}) => {
    const {client, calls, files} = fixture();
    const context = {client, userId: OWNER};
    const item = {name: 'Filtro exato', internalCode: 'INT-1', brand: 'Marca', code: 'ABC-1',
      unit: 'UN', quantity: '2', sourceText: 'FILTRO MARCA ABC-1 2 UN'};
    const prepared = await callMcpTool('prepare_quote_import', {items: [item]}, context);
    assert.equal(prepared.structuredContent.ready, true);
    assert.equal(prepared.structuredContent.matches[0].materialId, MATERIAL);
    assert.equal(calls.some(call => call.p_action === 'import-draft'), false);

    const committed = await callMcpTool('commit_quote_import', {
      requestId: REQUEST, source: {kind: 'chat-image', label: 'foto do usuário'},
      requesterSignatureId: REQUESTER, title: 'Cotação da foto', requestDate: '2026-10-05',
      items: [item], providers: [],
    }, context);
    assert.equal(committed.isError, undefined);
    assert.equal(committed.structuredContent.committed, true);
    assert.equal(committed.structuredContent.pdf.fileName, 'cotacao-COT-TESTE.pdf');
    assert.equal(committed.content[1].type, 'resource_link');
    const importCall = calls.find(call => call.p_action === 'import-draft');
    assert.equal(importCall.p_payload.items[0].materialId, undefined, 'SQL resolves strong identifiers again');
    assert.deepEqual(importCall.p_payload.providers, []);
    assert.equal(files.length, 1);
    assert.match(Buffer.from(files[0].bytes).toString('latin1', 0, 8), /^%PDF-1\./);

    const repeated = await callMcpTool('commit_quote_import', {
      requestId: REQUEST, source: {kind: 'chat-image', label: 'foto do usuário'},
      requesterSignatureId: REQUESTER, title: 'Cotação da foto', requestDate: '2026-10-05',
      items: [item], providers: [],
    }, context);
    assert.equal(repeated.structuredContent.committed, true);
    assert.equal(files.length, 1, 'an identical PDF is reused on replay');
    assert.equal(calls.filter(call => call.p_action === 'import-draft').length, 2);
    assert.equal(calls.filter(call => call.p_resource === 'materials').length, 2, 'replay does not rescan the catalog');
    const changed = await callMcpTool('commit_quote_import', {
      requestId: REQUEST, source: {kind: 'chat-image', label: 'foto do usuário'},
      requesterSignatureId: REQUESTER, title: 'Cotação da foto', requestDate: '2026-10-05',
      items: [{...item, quantity: '3'}], providers: [],
    }, context);
    assert.equal(changed.isError, true);
    assert.equal(calls.filter(call => call.p_action === 'import-draft').length, 2);
  });
});

test('read-only user reuses the exact stored PDF, but cannot sign a missing or mismatched PDF', async () => {
  await withTools(async ({callMcpTool}) => {
    const {client, files, quote, signedPaths, setWritable, setPersistUploads, setStored, forceMissingOnce} = fixture();
    const context = {client, userId: OWNER};
    const input = {quoteId: QUOTE};

    const first = await callMcpTool('get_quote_pdf', input, context);
    assert.equal(first.isError, undefined);
    assert.equal(files.length, 1);
    assert.equal(signedPaths.length, 1);
    assert.equal(signedPaths[0], files[0].path);

    setWritable(false);
    const reused = await callMcpTool('get_quote_pdf', input, context);
    assert.equal(reused.isError, undefined);
    assert.equal(reused.content[1].type, 'resource_link');
    assert.equal(files.length, 1, 'read-only retrieval must not upload');
    assert.deepEqual(signedPaths, [files[0].path, files[0].path]);

    quote.notes = 'Nova versão da cotação';
    const missing = await callMcpTool('get_quote_pdf', input, context);
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /permissão de escrita/);
    assert.equal(missing.content.some(part => part.type === 'resource_link'), false);
    assert.equal(signedPaths.length, 2, 'a missing file must never receive a signed link');

    quote.notes = '';
    setStored(files[0].path, Buffer.from('PDF de outro conteúdo'));
    const mismatched = await callMcpTool('get_quote_pdf', input, context);
    assert.equal(mismatched.isError, true);
    assert.match(mismatched.content[0].text, /não corresponde/);
    assert.equal(signedPaths.length, 2, 'a mismatched file must never receive a signed link');

    setWritable(true);
    forceMissingOnce();
    const collision = await callMcpTool('get_quote_pdf', input, context);
    assert.equal(collision.isError, true, 'upload conflict must verify the existing bytes');
    assert.match(collision.content[0].text, /não corresponde/);
    assert.equal(signedPaths.length, 2);

    quote.notes = 'Terceira versão da cotação';
    setPersistUploads(false);
    const unpersisted = await callMcpTool('get_quote_pdf', input, context);
    assert.equal(unpersisted.isError, true, 'a successful upload response alone does not prove the file exists');
    assert.equal(signedPaths.length, 2);
  });
});

test('MCP tools block ambiguous identity before any write and never expose arbitrary RPC', async () => {
  await withTools(async ({callMcpTool, listMcpTools}) => {
    const {client, calls} = fixture();
    const context = {client, userId: OWNER};
    const toolNames = listMcpTools().map(tool => tool.name);
    assert.equal(toolNames.includes('execute_sql'), false);
    assert.equal(toolNames.includes('billing_rpc'), false);
    const ambiguous = await callMcpTool('commit_quote_import', {
      requestId: REQUEST, source: {kind: 'chat-image', label: 'foto'},
      requesterSignatureId: REQUESTER, title: 'Cotação da foto', requestDate: '2026-10-05',
      items: [{name: 'Filtro exato', unit: 'UN', quantity: '2', sourceText: 'FILTRO 2 UN'}],
    }, context);
    assert.equal(ambiguous.structuredContent.committed, false);
    assert.equal(ambiguous.structuredContent.matches[0].status, 'ambiguous');
    assert.equal(calls.some(call => call.p_action === 'import-draft'), false);
    const unknown = await callMcpTool('billing_rpc', {resource: 'users', action: 'delete'}, context);
    assert.equal(unknown.isError, true);
  });
});

test('requester listing filters across source pages before paginating requesters', async () => {
  await withTools(async ({callMcpTool}) => {
    const pages = [];
    const client = {rpc: async (_name, args) => {
      assert.equal(args.p_resource, 'signatures');
      assert.equal(args.p_action, 'list');
      pages.push(args.p_payload.page);
      const page = args.p_payload.page;
      return {data: {total: 101, items: page === 1
        ? Array.from({length: 100}, (_, index) => ({id: `manager-${index}`, name: `Manager ${index}`, role: 'manager', active: true}))
        : [{id: REQUESTER, name: 'Solicitante', role: 'requester', active: true}]}, error: null};
    }};
    const response = await callMcpTool('list_requesters', {}, {client, userId: OWNER});
    assert.deepEqual(pages, [1, 2]);
    assert.deepEqual(response.structuredContent, {
      requesters: [{id: REQUESTER, name: 'Solicitante'}], page: 1, total: 1,
    });
  });
});
