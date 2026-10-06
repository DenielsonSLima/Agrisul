import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {build} = require(require.resolve('esbuild', {paths: [require.resolve('vite')]}));
const ORIGIN = 'https://agrisul.example';
const TICKET = Buffer.alloc(32, 9).toString('base64url');
let start;
let callback;
let result;

test.before(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agrisul-link-routes-'));
  test.after(async () => rm(directory, {recursive: true, force: true}));
  const mock = {name: 'mock-account-link-dependencies', setup(buildApi) {
    buildApi.onResolve({filter: /^@\/modules\/mcp\/(?:auth|upstream-grant)\.ts$/}, args =>
      ({path: args.path, namespace: 'mock-account-link'}));
    buildApi.onLoad({filter: /.*/, namespace: 'mock-account-link'}, args => ({contents:
      args.path.endsWith('/auth.ts')
        ? 'export const getMcpConfig = () => globalThis.__accountLinkFixture.config;'
        : `export const beginUpstreamAccountLink = async ticket => globalThis.__accountLinkFixture.begin(ticket);
           export const completeUpstreamAccountLink = async (state, code, error) =>
             globalThis.__accountLinkFixture.complete(state, code, error);`, loader: 'js'}));
  }};
  async function route(name, source) {
    const outfile = join(directory, `${name}.mjs`);
    await build({entryPoints: [source], outfile, bundle: true, platform: 'node', format: 'esm',
      plugins: [mock], logLevel: 'silent'});
    return import(pathToFileURL(outfile).href);
  }
  [start, callback, result] = await Promise.all([
    route('start', 'app/api/mcp/account-link/start/route.ts'),
    route('callback', 'app/api/mcp/account-link/callback/route.ts'),
    route('result', 'app/api/mcp/account-link/result/[status]/route.ts'),
  ]);
});

test.beforeEach(() => {
  const calls = [];
  globalThis.__accountLinkFixture = {
    config: {resourceOrigin: ORIGIN}, calls,
    begin: async ticket => {
      calls.push({type: 'begin', ticket});
      return 'https://rbuscpwntzpyqsuycqmv.supabase.co/auth/v1/oauth/authorize?state=fixture';
    },
    complete: async (state, code, error) => {
      calls.push({type: 'complete', state, code, error});
      return true;
    },
  };
});

test('GET confirmation is read-only; same-origin POST consumes ticket once', async () => {
  const url = `${ORIGIN}/api/mcp/account-link/start?ticket=${TICKET}`;
  const preview = await start.GET(new Request(url));
  assert.equal(preview.status, 200);
  assert.match(await preview.text(), /Continuar para a Agrisul/);
  assert.deepEqual(globalThis.__accountLinkFixture.calls, []);
  const posted = await start.POST(new Request(`${ORIGIN}/api/mcp/account-link/start`, {
    method: 'POST', headers: {origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({ticket: TICKET}),
  }));
  assert.equal(posted.status, 303);
  assert.equal(posted.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(!posted.headers.get('location').includes(TICKET));
  assert.deepEqual(globalThis.__accountLinkFixture.calls, [{type: 'begin', ticket: TICKET}]);
});

test('cross-origin POST and malformed tickets do not start consent', async () => {
  const rejected = await start.POST(new Request(`${ORIGIN}/api/mcp/account-link/start`, {
    method: 'POST', headers: {origin: 'https://elsewhere.example',
      'content-type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({ticket: TICKET}),
  }));
  assert.equal(rejected.status, 400);
  const malformed = await start.GET(new Request(`${ORIGIN}/api/mcp/account-link/start?ticket=x`));
  assert.equal(malformed.status, 400);
  assert.deepEqual(globalThis.__accountLinkFixture.calls, []);
});

test('callback consumes code and state then redirects to a clean result URL', async () => {
  const response = await callback.GET(new Request(`${ORIGIN}/api/mcp/account-link/callback?code=secret-code&state=secret-state`));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), `${ORIGIN}/api/mcp/account-link/result/success`);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.deepEqual(globalThis.__accountLinkFixture.calls,
    [{type: 'complete', state: 'secret-state', code: 'secret-code', error: null}]);
  const finalPage = await result.GET(new Request(`${ORIGIN}/api/mcp/account-link/result/success`),
    {params: Promise.resolve({status: 'success'})});
  assert.equal(finalPage.status, 200);
  assert.ok(!(await finalPage.text()).includes('secret-code'));
});
