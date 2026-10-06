import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {createPostgresGrantStore} from '../modules/mcp/upstream-grant-store.ts';

const require = createRequire(import.meta.url);
const {build} = require(require.resolve('esbuild', {paths: [require.resolve('vite')]}));
const USER = '12345678-1234-4123-8123-123456789abc';
const OTHER = '87654321-4321-4321-8321-cba987654321';
const KEY = Buffer.alloc(32, 7);
let core;

test.before(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agrisul-mcp-grant-'));
  test.after(async () => rm(directory, {recursive: true, force: true}));
  const outfile = join(directory, 'grant-core.mjs');
  await build({entryPoints: ['modules/mcp/upstream-grant-core.ts'], outfile,
    bundle: true, platform: 'node', format: 'esm', logLevel: 'silent'});
  core = await import(pathToFileURL(outfile).href);
});

function fixture(options = {}) {
  const requests = new Map();
  const grants = new Map();
  const exchanges = [];
  const revocations = [];
  let clock = new Date('2026-10-06T00:00:00.000Z');
  let randomCounter = 0;
  let queue = Promise.resolve();
  let failNextExchange = false;
  let revokeNext = false;
  let verifyOutage = false;
  let failRevocation = false;
  const store = {
    async putRequest(request) { requests.set(request.tokenHash.toString('hex'), request); },
    async consumeRequest(hash, purpose, now) {
      const key = hash.toString('hex');
      const request = requests.get(key);
      if (!request || request.purpose !== purpose || request.expiresAt <= now) return null;
      requests.delete(key);
      return request;
    },
    async saveGrant(userId, refreshCiphertext, grantedAt, expiresAt) {
      grants.set(userId, {refreshCiphertext, grantedAt, lastUsedAt: grantedAt, expiresAt});
    },
    async withLockedGrant(userId, task) {
      const predecessor = queue;
      let release;
      queue = new Promise(resolve => { release = resolve; });
      await predecessor;
      try {
        return await task({record: grants.get(userId) ?? null,
          update: async (ciphertext, usedAt) => {
            const grant = grants.get(userId);
            assert.ok(grant);
            grants.set(userId, {...grant, refreshCiphertext: ciphertext, lastUsedAt: usedAt});
          },
          delete: async () => { grants.delete(userId); }});
      } finally { release(); }
    },
    async deleteGrant(userId) { return grants.delete(userId); },
  };
  const exchange = async params => {
    exchanges.push(Object.fromEntries(params));
    if (failNextExchange) { failNextExchange = false; throw Error('network unavailable'); }
    if (revokeNext) { revokeNext = false; throw new core.UpstreamGrantRevokedError('invalid_grant'); }
    if (params.get('grant_type') === 'authorization_code') {
      return {token_type: 'bearer', access_token: options.wrongIdentity ? `B:${OTHER}` : `B:${USER}`,
        refresh_token: 'refresh-0'};
    }
    const previous = params.get('refresh_token');
    return {token_type: 'bearer', access_token: `B:${USER}`, refresh_token: `refresh-${Number(previous?.split('-')[1]) + 1}`};
  };
  const service = core.createUpstreamGrantService({store,
    config: {resourceOrigin: 'https://agrisul.example',
      authorizationServer: 'https://rbuscpwntzpyqsuycqmv.supabase.co/auth/v1',
      clientId: 'upstream-test', clientSecret: 'unused-by-core', vaultKey: KEY},
    exchange, verifyAccessToken: async (token, userId) => {
      if (verifyOutage) return false;
      return token === `B:${userId}`;
    },
    revokeAccess: async token => {
      revocations.push(token);
      if (failRevocation) { failRevocation = false; return false; }
      return true;
    },
    now: () => clock, random: size => Buffer.alloc(size, ++randomCounter)});
  async function link() {
    const url = await service.createAccountLinkUrl(USER);
    assert.ok(url);
    const ticket = new URL(url).searchParams.get('ticket');
    const authorize = await service.beginAccountLink(ticket);
    assert.ok(authorize);
    const state = new URL(authorize).searchParams.get('state');
    return {ticket, authorize, state};
  }
  return {service, requests, grants, exchanges, revocations, link,
    advance: ms => { clock = new Date(clock.getTime() + ms); },
    failNext: () => { failNextExchange = true; },
    revokeNext: () => { revokeNext = true; },
    failRevocation: () => { failRevocation = true; },
    setVerifyOutage: value => { verifyOutage = value; }};
}

test('vault envelope is authenticated and bound to user, purpose and OAuth client', () => {
  const encrypted = core.encryptVaultValue('sensitive-refresh', USER, 'refresh', 'client-1', KEY);
  assert.ok(!encrypted.includes('sensitive-refresh'));
  assert.equal(core.decryptVaultValue(encrypted, USER, 'refresh', 'client-1', KEY), 'sensitive-refresh');
  for (const [user, purpose, client] of [[OTHER, 'refresh', 'client-1'],
    [USER, 'pkce', 'client-1'], [USER, 'refresh', 'client-2']]) {
    assert.throws(() => core.decryptVaultValue(encrypted, user, purpose, client, KEY));
  }
  const parts = encrypted.split('.');
  parts[3] = (parts[3].startsWith('A') ? 'B' : 'A') + parts[3].slice(1);
  assert.throws(() => core.decryptVaultValue(parts.join('.'), USER, 'refresh', 'client-1', KEY));
});

test('vault credentials cannot be sent to arbitrary hosts or with TLS overrides', async () => {
  for (const databaseUrl of [
    'postgresql://agrisul_mcp_vault_login:fixture@evil.example/postgres',
    'postgresql://agrisul_mcp_vault_login:fixture@db.rbuscpwntzpyqsuycqmv.supabase.co/postgres?sslmode=disable',
    'postgresql://postgres:fixture@db.rbuscpwntzpyqsuycqmv.supabase.co/postgres',
    'postgresql://agrisul_mcp_vault_login.other-project:fixture@aws-0-us-east-1.pooler.supabase.com/postgres',
    'postgresql://agrisul_mcp_vault_login:fixture@localhost/postgres',
  ]) {
    await assert.rejects(createPostgresGrantStore(databaseUrl).deleteGrant(USER),
      /Invalid vault database URL|expected Supabase project/);
  }
});

test('ticket and PKCE state are single-use and callback binds B to the same user', async () => {
  const f = fixture({wrongIdentity: true});
  const {ticket, authorize, state} = await f.link();
  const url = new URL(authorize);
  assert.equal(url.origin, 'https://rbuscpwntzpyqsuycqmv.supabase.co');
  assert.equal(url.searchParams.get('client_id'), 'upstream-test');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://agrisul.example/api/mcp/account-link/callback');
  assert.equal(await f.service.beginAccountLink(ticket), null);
  assert.equal(await f.service.completeAccountLink(state, 'code-1', null), false);
  assert.equal(await f.service.completeAccountLink(state, 'code-1', null), false);
  assert.equal(f.grants.size, 0);
  assert.equal(f.exchanges.length, 1);
});

test('successful consent stores only ciphertext; locked refresh rotates token once per call', async () => {
  const f = fixture();
  const {state} = await f.link();
  assert.equal(await f.service.completeAccountLink(state, 'code-1', null), true);
  assert.ok(!f.grants.get(USER).refreshCiphertext.includes('refresh-0'));
  assert.equal(await f.service.completeAccountLink(state, 'code-1', null), false);
  const [first, second] = await Promise.all([f.service.getAccessToken(USER), f.service.getAccessToken(USER)]);
  assert.equal(first, `B:${USER}`);
  assert.equal(second, `B:${USER}`);
  assert.deepEqual(f.exchanges.slice(1).map(item => item.refresh_token), ['refresh-0', 'refresh-1']);
  assert.equal(core.decryptVaultValue(f.grants.get(USER).refreshCiphertext, USER, 'refresh', 'upstream-test', KEY),
    'refresh-2');
});

test('transient exchange errors retain grant; expiration and unlink remove it', async () => {
  const f = fixture();
  const {state} = await f.link();
  assert.equal(await f.service.completeAccountLink(state, 'code-1', null), true);
  f.failNext();
  await assert.rejects(f.service.getAccessToken(USER), /network unavailable/);
  assert.ok(f.grants.has(USER));
  assert.equal(await f.service.getAccessToken(USER), `B:${USER}`);
  f.advance(30 * 24 * 60 * 60_000);
  assert.equal(await f.service.getAccessToken(USER), null);
  assert.equal(f.grants.has(USER), false);
  assert.equal(await f.service.deleteGrant(USER), 'local_only');
  const again = await f.link();
  assert.equal(await f.service.completeAccountLink(again.state, 'code-2', null), true);
  assert.equal(await f.service.deleteGrant(USER), 'unlinked');
  assert.deepEqual(f.revocations, [`B:${USER}`]);
  assert.equal(await f.service.getAccessToken(USER), null);
});

test('unlink keeps rotated refresh when provider revocation fails and retries with B', async () => {
  const f = fixture();
  const {state} = await f.link();
  assert.equal(await f.service.completeAccountLink(state, 'code-1', null), true);
  f.failRevocation();
  assert.equal(await f.service.deleteGrant(USER), 'unavailable');
  assert.ok(f.grants.has(USER));
  assert.equal(core.decryptVaultValue(f.grants.get(USER).refreshCiphertext, USER, 'refresh', 'upstream-test', KEY),
    'refresh-1');
  assert.equal(await f.service.deleteGrant(USER), 'unlinked');
  assert.equal(f.grants.has(USER), false);
  assert.deepEqual(f.exchanges.slice(1).map(item => item.refresh_token), ['refresh-0', 'refresh-1']);
  assert.deepEqual(f.revocations, [`B:${USER}`, `B:${USER}`]);
});

test('temporary token verification failure retains refresh; invalid_grant removes it', async () => {
  const f = fixture();
  const {state} = await f.link();
  assert.equal(await f.service.completeAccountLink(state, 'code-1', null), true);
  f.setVerifyOutage(true);
  await assert.rejects(f.service.getAccessToken(USER), /Unverifiable upstream token/);
  assert.ok(f.grants.has(USER));
  f.setVerifyOutage(false);
  assert.equal(await f.service.getAccessToken(USER), `B:${USER}`);
  f.revokeNext();
  assert.equal(await f.service.getAccessToken(USER), null);
  assert.equal(f.grants.has(USER), false);
});

test('expired tickets and denied consent cannot create grants', async () => {
  const f = fixture();
  const link = await f.service.createAccountLinkUrl(USER);
  f.advance(5 * 60_000);
  assert.equal(await f.service.beginAccountLink(new URL(link).searchParams.get('ticket')), null);
  const {state} = await f.link();
  assert.equal(await f.service.completeAccountLink(state, null, 'access_denied'), false);
  assert.equal(f.grants.size, 0);
});
