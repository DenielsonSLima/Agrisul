import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {createLocalJWKSet, exportJWK, generateKeyPair, SignJWT} from 'jose';
import {authenticateMcpPrincipal, authorizeMcpRequest, getMcpConfig, getMcpResourceMetadata,
  validateMcpTokenClaims} from '../modules/mcp/auth.ts';
import {verifyMcpAccessToken, verifyUpstreamAccessToken} from '../modules/mcp/token-verification.ts';

const require = createRequire(import.meta.url);
const {build} = require(require.resolve('esbuild', {paths: [require.resolve('vite')]}));
const config = {
  resource: 'https://agrisul.example/api/mcp',
  resourceOrigin: 'https://agrisul.example',
  authorizationServer: 'https://rbuscpwntzpyqsuycqmv.supabase.co/auth/v1',
  supabaseUrl: 'https://rbuscpwntzpyqsuycqmv.supabase.co',
  publishableKey: 'sb_publishable_test',
  clientId: 'oauth-client-test',
  upstreamClientId: 'upstream-client-test',
};
const userId = '12345678-1234-4123-8123-123456789abc';
const context = {client: {}, userId};
let handleMcpRequest;
let signingKey;
let localKeys;
let publicJwk;

test.before(async () => {
  const pair = await generateKeyPair('ES256');
  signingKey = pair.privateKey;
  publicJwk = {...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'ES256', use: 'sig'};
  localKeys = createLocalJWKSet({keys: [publicJwk]});
  const directory = await mkdtemp(join(tmpdir(), 'agrisul-mcp-transport-'));
  test.after(async () => rm(directory, {recursive: true, force: true}));
  const outfile = join(directory, 'transport.cjs');
  await build({entryPoints: ['modules/mcp/transport.ts'], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent'});
  ({handleMcpRequest} = await import(pathToFileURL(outfile).href));
});

function jwt(claims) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({alg: 'RS256', typ: 'JWT'})}.${encode(claims)}.signature`;
}

async function signedJwt(claims, key = signingKey) {
  return new SignJWT(claims).setProtectedHeader({alg: 'ES256', kid: 'test-key', typ: 'JWT'}).sign(key);
}

function aClaims(changes = {}) {
  return {iss: config.authorizationServer, aud: config.resource, client_id: config.clientId,
    sub: userId, role: 'agrisul_mcp', exp: Math.floor(Date.now() / 1000) + 3600, ...changes};
}

function bClaims(changes = {}) {
  return {iss: config.authorizationServer, aud: 'authenticated', client_id: config.upstreamClientId,
    sub: userId, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, ...changes};
}

function modern(method, params = {}, options = {}) {
  const version = '2026-07-28';
  const body = {
    jsonrpc: '2.0', id: options.id ?? 1, method,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': version,
        'io.modelcontextprotocol/clientInfo': {name: 'test-client', version: '1.0.0'},
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  };
  return new Request(config.resource, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': version,
      'mcp-method': method,
      ...(method === 'tools/call' ? {'mcp-name': params.name} : {}),
      ...options.headers,
    },
    body: JSON.stringify(options.body ?? body),
  });
}

function legacy(method, params = {}, id = 1, includeVersion = true) {
  return new Request(config.resource, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(includeVersion ? {'mcp-protocol-version': '2025-11-25'} : {}),
    },
    body: JSON.stringify({jsonrpc: '2.0', ...(id !== null ? {id} : {}), method, params}),
  });
}

const deps = {config, authorize: async () => context};

test('resource metadata binds this MCP endpoint to the Supabase authorization server', () => {
  assert.deepEqual(getMcpResourceMetadata(config), {
    resource: config.resource,
    authorization_servers: [config.authorizationServer],
    bearer_methods_supported: ['header'],
  });
});

test('claim preflight rejects ordinary app tokens, wrong OAuth clients and expired tokens', () => {
  const claims = {
    iss: config.authorizationServer, aud: config.resource, client_id: config.clientId,
    sub: userId, role: 'agrisul_mcp', exp: 2_000_000_000,
  };
  assert.equal(validateMcpTokenClaims(jwt(claims), config, 1_900_000_000), userId);
  for (const changes of [
    {aud: 'authenticated'}, {client_id: 'other-client'}, {iss: 'https://other.example/auth/v1'},
    {exp: 1_900_000_000}, {role: 'authenticated'}, {role: 'service_role'},
    {sub: 'not-a-user-id'}, {is_anonymous: true},
  ]) {
    assert.equal(validateMcpTokenClaims(jwt({...claims, ...changes}), config, 1_900_000_000), null);
  }
  assert.equal(validateMcpTokenClaims('not-a-jwt', config), null);
});

test('server auth stays disabled until fully configured for the Agrisul Supabase project', async () => {
  const names = ['AGRISUL_MCP_ENABLED', 'AGRISUL_MCP_RESOURCE', 'AGRISUL_MCP_OAUTH_CLIENT_ID',
    'AGRISUL_MCP_UPSTREAM_CLIENT_ID', 'AGRISUL_MCP_UPSTREAM_CLIENT_SECRET',
    'AGRISUL_MCP_VAULT_DATABASE_URL', 'AGRISUL_MCP_VAULT_KEY_V1',
    'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    assert.equal(getMcpConfig(), null);
    process.env.AGRISUL_MCP_ENABLED = 'true';
    process.env.AGRISUL_MCP_RESOURCE = config.resource;
    process.env.AGRISUL_MCP_OAUTH_CLIENT_ID = config.clientId;
    process.env.AGRISUL_MCP_UPSTREAM_CLIENT_ID = config.upstreamClientId;
    process.env.AGRISUL_MCP_UPSTREAM_CLIENT_SECRET = 'test-only-secret';
    process.env.AGRISUL_MCP_VAULT_DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.AGRISUL_MCP_VAULT_KEY_V1 = Buffer.alloc(32, 7).toString('base64url');
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY = config.publishableKey;
    process.env.VITE_SUPABASE_URL = 'https://different-project.supabase.co';
    assert.equal(getMcpConfig(), null);
    process.env.VITE_SUPABASE_URL = config.supabaseUrl;
    assert.equal(getMcpConfig().authorizationServer, config.authorizationServer);
    delete process.env.AGRISUL_MCP_UPSTREAM_CLIENT_SECRET;
    assert.equal(getMcpConfig(), null);
    process.env.AGRISUL_MCP_UPSTREAM_CLIENT_SECRET = 'test-only-secret';
    process.env.AGRISUL_MCP_UPSTREAM_CLIENT_ID = config.clientId;
    assert.equal(getMcpConfig(), null);
    process.env.AGRISUL_MCP_UPSTREAM_CLIENT_ID = config.upstreamClientId;
    assert.equal(await authorizeMcpRequest(new Request(config.resource, {
      headers: {authorization: 'Bearer wrong-token'},
    }), {config: getMcpConfig(), keySet: localKeys}), null);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('local JWKS verification rejects forged signatures and keeps A and B in separate roles', async () => {
  const a = await signedJwt(aClaims());
  const b = await signedJwt(bClaims());
  const forgery = await generateKeyPair('ES256');
  const forgedA = await signedJwt(aClaims(), forgery.privateKey);
  assert.equal(await verifyMcpAccessToken(a, config, localKeys), userId);
  assert.equal(await verifyMcpAccessToken(forgedA, config, localKeys), null);
  assert.equal(await verifyMcpAccessToken(b, config, localKeys), null);
  assert.equal(await verifyUpstreamAccessToken(b, userId, config, localKeys), true);
  assert.equal(await verifyUpstreamAccessToken(a, userId, config, localKeys), false);
  assert.equal(await verifyUpstreamAccessToken(await signedJwt(bClaims({client_id: config.clientId})),
    userId, config, localKeys), false);
  assert.equal(await verifyUpstreamAccessToken(await signedJwt(bClaims({role: 'agrisul_mcp'})),
    userId, config, localKeys), false);
  for (const changed of [{aud: 'authenticated'}, {client_id: 'other'}, {role: 'authenticated'},
    {sub: 'not-a-uuid'}, {exp: 1}]) {
    assert.equal(await verifyMcpAccessToken(await signedJwt(aClaims(changed)), config, localKeys), null);
  }
});

test('remote JWKS fetch is pinned to this project and carries no incoming bearer', async () => {
  const previousFetch = globalThis.fetch;
  const a = await signedJwt(aClaims());
  const seen = [];
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      seen.push({url, authorization: headers.get('authorization')});
      return Response.json({keys: [publicJwk]});
    };
    assert.equal(await verifyMcpAccessToken(a, config), userId);
    assert.deepEqual(seen, [{url: `${config.authorizationServer}/.well-known/jwks.json`, authorization: null}]);
    assert.ok(!JSON.stringify(seen).includes(a));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('server auth sends only independently issued B to Data and Storage, never incoming A', async () => {
  const previousFetch = globalThis.fetch;
  const a = await signedJwt(aClaims());
  const b = await signedJwt(bClaims());
  const seen = [];
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      seen.push({url, authorization: headers.get('authorization')});
      if (url.endsWith('/rest/v1/rpc/billing_rpc')) return Response.json({ok: true});
      if (url.includes('/storage/v1/object/list/')) return Response.json([]);
      throw new Error(`Unexpected test fetch: ${url}`);
    };
    const actor = await authorizeMcpRequest(new Request(config.resource, {
      headers: {authorization: `Bearer ${a}`},
    }), {config, keySet: localKeys, getUpstreamToken: async id => {
      assert.equal(id, userId);
      return {status: 'ready', accessToken: b};
    }, createAccountLinkUrl: async () => {throw new Error('unused');}});
    assert.equal(actor?.userId, userId);
    const {data, error} = await actor.client.rpc('billing_rpc', {
      p_resource: 'materials', p_action: 'list', p_payload: {},
    });
    assert.equal(error, null);
    assert.deepEqual(data, {ok: true});
    const files = await actor.client.storage.from('billing-material-images').list(userId);
    assert.equal(files.error, null);
    assert.equal(seen.length, 2);
    assert.ok(seen.every(call => call.authorization === `Bearer ${b}`));
    assert.ok(seen.every(call => !JSON.stringify(call).includes(a)));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('valid A without B returns a single-use account link or a fail-closed unavailable state', async () => {
  const a = await signedJwt(aClaims());
  const request = new Request(config.resource, {headers: {authorization: `Bearer ${a}`}});
  const link = `${config.resourceOrigin}/api/mcp/account-link/start?ticket=${'A'.repeat(43)}`;
  assert.deepEqual(await authorizeMcpRequest(request, {config, keySet: localKeys,
    getUpstreamToken: async () => ({status: 'link_required'}), createAccountLinkUrl: async () => link}),
  {status: 'needs_account_link', accountLinkUrl: link});
  assert.deepEqual(await authorizeMcpRequest(request, {config, keySet: localKeys,
    getUpstreamToken: async () => ({status: 'link_required'}), createAccountLinkUrl: async () => null}),
  {status: 'upstream_unavailable'});
  assert.deepEqual(await authorizeMcpRequest(request, {config, keySet: localKeys,
    getUpstreamToken: async () => ({status: 'ready',
      accessToken: await signedJwt(bClaims({sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}))})}),
  {status: 'upstream_unavailable'});
  let linked = false;
  assert.deepEqual(await authorizeMcpRequest(request, {config, keySet: localKeys,
    getUpstreamToken: async () => ({status: 'unavailable'}),
    createAccountLinkUrl: async () => {linked = true; return link;}}),
  {status: 'upstream_unavailable'});
  assert.equal(linked, false);
});

test('disabled MCP returns 404 before authentication or tool dispatch', async () => {
  let called = false;
  const response = await handleMcpRequest(modern('tools/list'), {
    config: null, authorize: async () => {called = true; return context;},
  });
  assert.equal(response.status, 404);
  assert.equal(called, false);
});

test('foreign Origin is denied before authentication', async () => {
  let called = false;
  const response = await handleMcpRequest(modern('tools/list', {}, {headers: {origin: 'https://other.example'}}), {
    ...deps, authorize: async () => {called = true; return context;},
  });
  assert.equal(response.status, 403);
  assert.equal(called, false);
});

test('discovery and tool schemas are public, while tool calls require OAuth', async () => {
  const tools = [{name: 'search_materials', securitySchemes: [{type: 'oauth2', scopes: []}]}];
  const publicDeps = {
    ...deps, listTools: () => tools,
    authorize: async () => {throw new Error('public methods must not invoke auth');},
  };
  assert.equal((await handleMcpRequest(modern('server/discover'), publicDeps)).status, 200);
  const listed = await handleMcpRequest(modern('tools/list'), publicDeps);
  assert.deepEqual((await listed.json()).result.tools, tools);

  const response = await handleMcpRequest(modern('tools/call', {name: 'search_materials'}), {
    ...deps, listTools: () => tools, authorize: async () => null,
  });
  assert.equal(response.status, 401);
  const challenge = response.headers.get('www-authenticate');
  assert.match(challenge, /^Bearer resource_metadata="https:\/\/agrisul\.example\/\.well-known\/oauth-protected-resource"/);
  assert.match(challenge, /error="invalid_token"/);
  assert.deepEqual((await response.json()).result._meta['mcp/www_authenticate'], [challenge]);
});

test('a valid MCP identity without an upstream grant gets an account-link tool result', async () => {
  const tools = [{name: 'search_materials'}];
  const url = `${config.resourceOrigin}/api/mcp/account-link/start?ticket=${'A'.repeat(43)}`;
  let dispatched = false;
  const response = await handleMcpRequest(modern('tools/call', {name: 'search_materials'}), {
    config, listTools: () => tools,
    authorize: async () => ({status: 'needs_account_link', accountLinkUrl: url}),
    callTool: async () => {dispatched = true; return {content: []};},
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('www-authenticate'), null);
  assert.equal(dispatched, false);
  const result = (await response.json()).result;
  assert.deepEqual(result.structuredContent, {status: 'needs_account_link', accountLinkUrl: url});
  assert.deepEqual(result.content[1], {type: 'resource_link', name: 'Vincular conta Agrisul', uri: url});

  const unavailable = await handleMcpRequest(modern('tools/call', {name: 'search_materials'}), {
    config, listTools: () => tools, authorize: async () => ({status: 'upstream_unavailable'}),
  });
  assert.deepEqual((await unavailable.json()).result.structuredContent, {status: 'upstream_unavailable'});
});

test('unlink_account requires signed A and distinguishes provider revocation from local-only removal', async () => {
  const tools = [{name: 'unlink_account'}];
  const a = await signedJwt(aClaims());
  let deletedUser = null;
  const allowed = await handleMcpRequest(modern('tools/call', {name: 'unlink_account', arguments: {}},
    {headers: {authorization: `Bearer ${a}`}}), {
    config, listTools: () => tools,
    authenticatePrincipal: request => authenticateMcpPrincipal(request, {config, keySet: localKeys}),
    authorize: async () => {throw new Error('B must not be required');},
    deleteGrant: async id => {deletedUser = id; return {status: 'unlinked'};},
  });
  assert.equal(allowed.status, 200);
  assert.equal(deletedUser, userId);
  assert.deepEqual((await allowed.json()).result.structuredContent, {status: 'unlinked'});

  const localOnly = await handleMcpRequest(modern('tools/call', {name: 'unlink_account', arguments: {}},
    {headers: {authorization: `Bearer ${a}`}}), {
    config, listTools: () => tools,
    authenticatePrincipal: request => authenticateMcpPrincipal(request, {config, keySet: localKeys}),
    deleteGrant: async () => ({status: 'local_only'}),
  });
  const localOnlyResult = (await localOnly.json()).result;
  assert.deepEqual(localOnlyResult.structuredContent, {status: 'local_only'});
  assert.match(localOnlyResult.content[0].text, /revogue o consentimento/);

  const denied = await handleMcpRequest(modern('tools/call', {name: 'unlink_account', arguments: {}},
    {headers: {authorization: 'Bearer invalid'}}), {
    config, listTools: () => tools,
    authenticatePrincipal: request => authenticateMcpPrincipal(request, {config, keySet: localKeys}),
    deleteGrant: async () => {throw new Error('unauthorized deletion');},
  });
  assert.equal(denied.status, 401);

  const argsDenied = await handleMcpRequest(modern('tools/call', {name: 'unlink_account', arguments: {all: true}},
    {headers: {authorization: `Bearer ${a}`}}), {config, listTools: () => tools});
  assert.equal((await argsDenied.json()).error.code, -32602);
});

test('modern discovery, list and call use the authenticated user context', async () => {
  const discover = await handleMcpRequest(modern('server/discover'), deps);
  assert.equal(discover.status, 200);
  const description = (await discover.json()).result;
  assert.deepEqual(description.supportedVersions, ['2026-07-28', '2025-11-25']);
  assert.equal(description.resultType, 'complete');

  const tools = [{name: 'search_materials', inputSchema: {type: 'object'}}];
  const listed = await handleMcpRequest(modern('tools/list'), {...deps, listTools: () => tools});
  assert.deepEqual((await listed.json()).result, {resultType: 'complete', tools});

  let received;
  const called = await handleMcpRequest(modern('tools/call', {name: 'search_materials', arguments: {query: 'filtro'}}), {
    ...deps, listTools: () => tools,
    callTool: async (name, args, actor) => {
      received = {name, args, actor};
      return {content: [{type: 'text', text: 'ok'}], structuredContent: {matches: []}};
    },
  });
  assert.equal(called.status, 200);
  assert.deepEqual(received, {name: 'search_materials', args: {query: 'filtro'}, actor: context});
  assert.equal((await called.json()).result.resultType, 'complete');
});

test('modern header/body mismatch and unknown methods are rejected', async () => {
  for (const request of [
    modern('tools/list', {}, {headers: {'mcp-method': 'tools/call'}}),
    modern('tools/call', {name: 'search_materials'}, {headers: {'mcp-name': 'other'}}),
    modern('tools/list', {}, {headers: {'mcp-protocol-version': '2025-11-25'}}),
  ]) {
    const response = await handleMcpRequest(request, deps);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, -32020);
  }
  const unknown = await handleMcpRequest(modern('arbitrary/rpc'), deps);
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error.code, -32601);
});

test('modern clientInfo is optional but required capabilities cannot be omitted', async () => {
  const withoutClientInfo = modern('tools/list');
  const goodBody = await withoutClientInfo.json();
  delete goodBody.params._meta['io.modelcontextprotocol/clientInfo'];
  const accepted = await handleMcpRequest(modern('tools/list', {}, {body: goodBody}), {
    ...deps, listTools: () => [],
  });
  assert.equal(accepted.status, 200);

  delete goodBody.params._meta['io.modelcontextprotocol/clientCapabilities'];
  const rejected = await handleMcpRequest(modern('tools/list', {}, {body: goodBody}), deps);
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error.code, -32602);
});

test('unknown tool is blocked before dispatcher', async () => {
  let called = false;
  const response = await handleMcpRequest(modern('tools/call', {name: 'execute_sql', arguments: {sql: 'select 1'}}), {
    ...deps, listTools: () => [{name: 'search_materials'}],
    callTool: async () => {called = true; return {content: []};},
  });
  assert.equal((await response.json()).error.code, -32602);
  assert.equal(called, false);
});

test('legacy initialization and tool calls return legacy result shapes without session state', async () => {
  const init = await handleMcpRequest(legacy('initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'legacy', version: '1.0.0'},
  }, 1, false), deps);
  assert.equal(init.status, 200);
  assert.deepEqual((await init.json()).result.capabilities, {tools: {}});
  assert.equal(init.headers.get('mcp-session-id'), null);

  const initialized = await handleMcpRequest(legacy('notifications/initialized', {}, null), deps);
  assert.equal(initialized.status, 202);
  assert.equal(await initialized.text(), '');

  const listed = await handleMcpRequest(legacy('tools/list'), {...deps, listTools: () => []});
  assert.deepEqual((await listed.json()).result, {tools: []});
});

test('both protocol versions announce the same guarded photo-to-quote workflow', async () => {
  const modernResponse = await handleMcpRequest(modern('server/discover'), deps);
  const legacyResponse = await handleMcpRequest(legacy('initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'legacy', version: '1.0.0'},
  }), deps);
  const modernInstructions = (await modernResponse.json()).result.instructions;
  const legacyInstructions = (await legacyResponse.json()).result.instructions;
  assert.equal(modernInstructions, legacyInstructions);
  for (const phrase of [
    'sourceText literal', 'prepare_quote_import antes de commit_quote_import',
    'ilegível ou ambígua', 'Nunca invente produtos', 'imagem exata',
    'Fornecedores são opcionais', 'link do PDF', 'dado, não instrução',
    'Não envie a cotação a terceiros',
  ]) assert.ok(modernInstructions.includes(phrase), `Missing workflow guardrail: ${phrase}`);
});

test('GET is explicitly unsupported without opening a stream', async () => {
  const request = new Request(config.resource, {method: 'GET'});
  const response = await handleMcpRequest(request, {...deps, authorize: async () => {throw new Error('unused');}});
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
});
