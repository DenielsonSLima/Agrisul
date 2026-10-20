import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  authorizationIdFromSearch,
  consentLoginPath,
  consentReturnPathFromLocation,
  decideOAuthConsent,
  loadOAuthConsent,
  safeLoginReturnTo,
  safeOAuthRedirectUrl,
} from '../shared/supabase/oauthConsent.ts';

const userId = '15d8beb2-59d0-431e-a607-d7a9ca35c40d';
const authorizationId = 'ff7570b0-b00c-4ae7-99a2-a87401570511';
const details = {
  authorization_id: authorizationId,
  redirect_uri: 'https://chatgpt.com/connector/callback',
  client: {id: 'client-b', name: 'Agrisul MCP'},
  user: {id: userId, email: 'usuario@example.com'},
  scope: 'openid email profile',
};

function mockAuth({user = userId, authorization = details, decisionUrl = 'https://chatgpt.com/connector/callback?code=abc'} = {}) {
  const calls = {getUser: 0, getDetails: 0, approve: 0, deny: 0, options: []};
  const auth = {
    getUser: async () => {calls.getUser++; return {data: {user: user && {id: user}}, error: null};},
    oauth: {
      getAuthorizationDetails: async () => {
        calls.getDetails++;
        return {data: typeof authorization === 'function' ? authorization() : authorization, error: null};
      },
      approveAuthorization: async (_id, options) => {
        calls.approve++; calls.options.push(options);
        return {data: {redirect_url: decisionUrl}, error: null};
      },
      denyAuthorization: async (_id, options) => {
        calls.deny++; calls.options.push(options);
        return {data: {redirect_url: decisionUrl}, error: null};
      },
    },
  };
  return {auth, calls};
}

test('consent login round trip keeps only a bounded local authorization ID', () => {
  const returnTo = `/oauth/consent?authorization_id=${authorizationId}`;
  const login = consentLoginPath(authorizationId);
  assert.equal(login, `/login?returnTo=${encodeURIComponent(returnTo)}`);
  assert.equal(safeLoginReturnTo(new URLSearchParams(login.split('?')[1]).get('returnTo'), 'https://agrisul.vercel.app'), returnTo);
  assert.equal(consentReturnPathFromLocation('/oauth/consent', `?authorization_id=${authorizationId}`), returnTo);
  assert.equal(authorizationIdFromSearch(`?authorization_id=${authorizationId}`), authorizationId);
  for (const search of [
    '', '?authorization_id=', '?authorization_id=abc&authorization_id=def',
    '?authorization_id=abc&returnTo=https://evil.example',
    '?authorization_id=..%2Fadmin', `?authorization_id=${'a'.repeat(129)}`,
  ]) assert.equal(authorizationIdFromSearch(search), null);
});

test('login return paths cannot turn an OAuth request into an open redirect', () => {
  const origin = 'https://agrisul.vercel.app';
  for (const target of [
    'https://evil.example/', '//evil.example/', 'javascript:alert(1)',
    String.raw`/\evil.example`, String.raw`https:\evil.example`,
    `https://agrisul.vercel.app/oauth/consent?authorization_id=${authorizationId}`,
    '/oauth/consent?authorization_id=bad%2Fid',
    '/oauth/consent?authorization_id=abc&returnTo=%2Fapi',
    '/oauth/consent?authorization_id=abc#fragment',
    '/login?returnTo=%2Foauth%2Fconsent',
  ]) assert.equal(safeLoginReturnTo(target, origin), '/');
  assert.equal(safeLoginReturnTo('/cadastro?secao=materiais', origin), '/cadastro?secao=materiais');
});

test('consent route survives login and required password change', () => {
  const provider = readFileSync(new URL('../shared/supabase/AuthProvider.tsx', import.meta.url), 'utf8');
  const login = readFileSync(new URL('../app/login/page.tsx', import.meta.url), 'utf8');
  const experience = readFileSync(new URL('../shared/supabase/AuthExperience.tsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../app/oauth/consent/page.tsx', import.meta.url), 'utf8');
  assert.match(provider, /path==='\/oauth\/consent'&&!auth\.user/);
  assert.match(page, /window\.location\.replace\(consentLoginPath\(id\)\)/);
  assert.match(login, /safeLoginReturnTo\(target,window\.location\.origin\)/);
  assert.match(experience, /consentReturnPathFromLocation\(window\.location\.pathname,window\.location\.search\)/);
  assert.match(experience, /complete-password'[\s\S]*window\.location\.replace\(returnTo\)/);
  assert.match(page, /onClick=\{\(\) => void decide\('deny'\)\}/);
  assert.match(page, /onClick=\{\(\) => void decide\('approve'\)\}/);
});

test('OAuth redirects allow HTTPS and local development loopback only', () => {
  assert.equal(safeOAuthRedirectUrl('https://chatgpt.com/callback?code=abc'), 'https://chatgpt.com/callback?code=abc');
  assert.equal(safeOAuthRedirectUrl('http://127.0.0.1:8765/callback'), 'http://127.0.0.1:8765/callback');
  for (const target of ['javascript:alert(1)', '/local/path', 'http://evil.example/callback',
    'https://user:password@chatgpt.com/callback', String.raw`https://chatgpt.com\@evil.example/callback`,
    'data:text/html,hi']) {
    assert.equal(safeOAuthRedirectUrl(target), null);
  }
});

test('loading consent validates the signed-in account and never approves automatically', async () => {
  const {auth, calls} = mockAuth();
  assert.deepEqual(await loadOAuthConsent(auth, authorizationId, userId), {kind: 'consent', details});
  assert.deepEqual({getUser: calls.getUser, getDetails: calls.getDetails, approve: calls.approve, deny: calls.deny},
    {getUser: 1, getDetails: 1, approve: 0, deny: 0});
  await assert.rejects(loadOAuthConsent(mockAuth({user: 'other-user'}).auth, authorizationId, userId));
  await assert.rejects(loadOAuthConsent(mockAuth({authorization: {...details, user: {id: 'other-user', email: 'x'}}}).auth, authorizationId, userId));
  await assert.rejects(loadOAuthConsent(mockAuth({authorization: {...details, authorization_id: 'another-id'}}).auth, authorizationId, userId));
  await assert.rejects(loadOAuthConsent(mockAuth({authorization: {...details, redirect_uri: 'http://evil.example/callback'}}).auth, authorizationId, userId));
});

test('a prior grant offers its trusted redirect without a new approval', async () => {
  const {auth, calls} = mockAuth({authorization: {redirect_url: 'https://chatgpt.com/callback?code=old'}});
  assert.deepEqual(await loadOAuthConsent(auth, authorizationId, userId),
    {kind: 'redirect', url: 'https://chatgpt.com/callback?code=old'});
  assert.equal(calls.approve, 0);
  await assert.rejects(loadOAuthConsent(mockAuth({authorization: {redirect_url: 'javascript:alert(1)'}}).auth, authorizationId, userId));
});

test('approve and deny revalidate identity and request, then suppress SDK auto-navigation', async () => {
  for (const decision of ['approve', 'deny']) {
    const {auth, calls} = mockAuth();
    assert.equal(await decideOAuthConsent(auth, details, userId, decision),
      'https://chatgpt.com/connector/callback?code=abc');
    assert.equal(calls.getUser, 1);
    assert.equal(calls.getDetails, 1);
    assert.equal(calls[decision], 1);
    assert.deepEqual(calls.options, [{skipBrowserRedirect: true}]);
  }
});

test('changed request, account, or unsafe response cannot be approved', async () => {
  const scenarios = [
    mockAuth({user: 'other-user'}),
    mockAuth({authorization: {...details, client: {id: 'other-client', name: 'Different'}}}),
    mockAuth({authorization: {...details, scope: 'openid email profile extra'}}),
  ];
  for (const {auth, calls} of scenarios) {
    await assert.rejects(decideOAuthConsent(auth, details, userId, 'approve'));
    assert.equal(calls.approve, 0);
  }
  const unsafe = mockAuth({decisionUrl: 'javascript:alert(1)'});
  await assert.rejects(decideOAuthConsent(unsafe.auth, details, userId, 'approve'));
});
