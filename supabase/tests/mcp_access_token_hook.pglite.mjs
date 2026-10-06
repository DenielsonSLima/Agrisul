import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const A = 'chatgpt-mcp-client';
const B = 'agrisul-upstream-client';
const RESOURCE = 'https://agrisul.example.com/api/mcp';
const ISSUER = 'https://rbuscpwntzpyqsuycqmv.supabase.co/auth/v1';
const USER = '12345678-1234-4123-8123-123456789abc';
const db = new PGlite();

async function asAuthAdmin(task) {
  await db.exec('SET ROLE supabase_auth_admin');
  try { return await task(); }
  finally { await db.exec('RESET ROLE'); }
}

async function invoke(event) {
  const {rows} = await db.query(
    'SELECT agrisul_mcp_hook_private.access_token($1::jsonb) AS output',
    [JSON.stringify(event)],
  );
  return rows[0].output;
}

function event(clientId, method = 'oauth_provider/authorization_code') {
  return {
    user_id: USER,
    claims: {
      iss: ISSUER, aud: 'authenticated', exp: 2_000_000_000,
      iat: 1_900_000_000, sub: USER, role: 'authenticated',
      aal: 'aal1', session_id: 'session-1', email: 'sample@example.com',
      phone: '', is_anonymous: false, custom_claim: {retained: true},
      ...(clientId === null ? {} : {client_id: clientId}),
    },
    authentication_method: method,
  };
}

try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE supabase_auth_admin;');
  await db.exec(readFileSync(new URL('../../docs/mcp-sql-pending/20261006010720_agrisul_mcp_access_token_hook.sql', import.meta.url), 'utf8'));

  const privileges = await db.query(`SELECT
    has_schema_privilege('supabase_auth_admin', 'agrisul_mcp_hook_private', 'USAGE') AS auth_schema,
    has_table_privilege('supabase_auth_admin', 'agrisul_mcp_hook_private.config', 'SELECT') AS auth_read,
    has_table_privilege('supabase_auth_admin', 'agrisul_mcp_hook_private.config', 'INSERT') AS auth_insert,
    has_function_privilege('supabase_auth_admin', 'agrisul_mcp_hook_private.access_token(jsonb)', 'EXECUTE') AS auth_execute,
    has_function_privilege('anon', 'agrisul_mcp_hook_private.access_token(jsonb)', 'EXECUTE') AS anon_execute,
    has_function_privilege('authenticated', 'agrisul_mcp_hook_private.access_token(jsonb)', 'EXECUTE') AS user_execute`);
  assert.deepEqual(privileges.rows[0], {
    auth_schema: true, auth_read: true, auth_insert: false, auth_execute: true,
    anon_execute: false, user_execute: false,
  });
  const rls = await db.query(`SELECT rowsecurity FROM pg_tables WHERE
    schemaname = 'agrisul_mcp_hook_private' AND tablename = 'config'`);
  assert.equal(rls.rows[0].rowsecurity, true);

  // An accidentally enabled, unconfigured hook must not issue an OAuth
  // bearer with the ordinary authenticated role.
  await asAuthAdmin(async () => {
    await assert.rejects(invoke(event(A)), /OAuth access token hook is not configured/);
    await assert.rejects(invoke(event(B)), /OAuth access token hook is not configured/);
    const web = event(null, 'password');
    assert.deepEqual(await invoke(web), {claims: web.claims});
  });

  await db.query(`INSERT INTO agrisul_mcp_hook_private.config
    (singleton, enabled, oauth_client_id, resource) VALUES (true, false, $1, $2)`, [A, RESOURCE]);
  await asAuthAdmin(async () => {
    await assert.rejects(invoke(event(A)), /OAuth access token hook is not configured/);
    const web = event(null, 'password');
    assert.deepEqual(await invoke(web), {claims: web.claims});
  });

  await db.exec('UPDATE agrisul_mcp_hook_private.config SET enabled = true');
  await asAuthAdmin(async () => {
    for (const method of ['oauth_provider/authorization_code', 'token_refresh']) {
      const input = event(A, method);
      assert.deepEqual(await invoke(input), {
        claims: {...input.claims, aud: RESOURCE, role: 'agrisul_mcp'},
      });
      assert.deepEqual(await invoke(event(B, method)), {claims: event(B, method).claims});
    }
    for (const method of ['password', 'token_refresh']) {
      const web = event(null, method);
      assert.deepEqual(await invoke(web), {claims: web.claims});
    }
    const other = event('unrelated-client');
    assert.deepEqual(await invoke(other), {claims: other.claims});

    // Supabase's generic hook reference shows claims.client_id; the OAuth
    // guide shows top-level client_id. The model handles either shape for A.
    const topLevel = event(null);
    topLevel.client_id = A;
    assert.deepEqual(await invoke(topLevel), {
      claims: {...topLevel.claims, client_id: A, aud: RESOURCE, role: 'agrisul_mcp'},
    });
    const conflict = event(A);
    conflict.client_id = B;
    await assert.rejects(invoke(conflict), /Conflicting OAuth client IDs/);
    const missingClaim = event(A);
    delete missingClaim.claims.session_id;
    await assert.rejects(invoke(missingClaim), /Missing required claim/);
    const wrongRole = event(A);
    wrongRole.claims.role = 'service_role';
    await assert.rejects(invoke(wrongRole), /Unexpected original MCP token claims/);
    const malformed = {claims: null};
    await assert.rejects(invoke(malformed), /Invalid access token hook event/);

    // A refresh event lacking client_id is indistinguishable from a normal
    // web refresh. This is deliberately exposed as a live activation blocker.
    const missingRefreshClient = event(null, 'token_refresh');
    assert.deepEqual(await invoke(missingRefreshClient), {claims: missingRefreshClient.claims});
  });

  await db.exec('SET ROLE authenticated');
  try {
    await assert.rejects(invoke(event(A)), /permission denied/);
  } finally {
    await db.exec('RESET ROLE');
  }
  console.log('MCP access token hook A/B/web, refresh model, RLS and grants passed locally');
} finally {
  await db.close();
}
