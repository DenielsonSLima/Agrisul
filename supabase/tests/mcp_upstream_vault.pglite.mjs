import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const db = new PGlite();
const USER = '12345678-1234-4123-8123-123456789abc';
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
  CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);`);
await db.exec(readFileSync(new URL('../../docs/mcp-sql-pending/20261006002123_agrisul_mcp_upstream_vault.sql', import.meta.url), 'utf8'));

const roles = await db.query(`SELECT rolname, rolcanlogin, rolsuper, rolbypassrls FROM pg_roles
  WHERE rolname IN ('agrisul_mcp', 'agrisul_mcp_vault') ORDER BY rolname`);
assert.deepEqual(roles.rows.map(({rolname, rolcanlogin, rolsuper, rolbypassrls}) =>
  ({rolname, rolcanlogin, rolsuper, rolbypassrls})), [
  {rolname: 'agrisul_mcp', rolcanlogin: false, rolsuper: false, rolbypassrls: false},
  {rolname: 'agrisul_mcp_vault', rolcanlogin: false, rolsuper: false, rolbypassrls: false},
]);

for (const role of ['anon', 'authenticated', 'agrisul_mcp']) {
  const privileges = await db.query(`SELECT
    has_schema_privilege($1, 'agrisul_mcp_private', 'USAGE') AS schema_usage,
    has_table_privilege($1, 'agrisul_mcp_private.upstream_grants', 'SELECT') AS grant_select,
    has_table_privilege($1, 'agrisul_mcp_private.auth_requests', 'INSERT') AS state_insert`, [role]);
  assert.deepEqual(privileges.rows[0], {schema_usage: false, grant_select: false, state_insert: false});
}
const vaultPrivileges = await db.query(`SELECT
  has_schema_privilege('agrisul_mcp_vault', 'agrisul_mcp_private', 'USAGE') AS schema_usage,
  has_table_privilege('agrisul_mcp_vault', 'agrisul_mcp_private.project_binding', 'SELECT') AS binding_read,
  has_table_privilege('agrisul_mcp_vault', 'agrisul_mcp_private.project_binding', 'UPDATE') AS binding_write`);
assert.deepEqual(vaultPrivileges.rows[0], {schema_usage: true, binding_read: true, binding_write: false});

const policies = await db.query(`SELECT tablename, rowsecurity FROM pg_tables
  WHERE schemaname = 'agrisul_mcp_private' ORDER BY tablename`);
assert.deepEqual(policies.rows, [
  {tablename: 'auth_requests', rowsecurity: true},
  {tablename: 'project_binding', rowsecurity: true},
  {tablename: 'upstream_grants', rowsecurity: true},
]);

await db.query('INSERT INTO auth.users (id) VALUES ($1)', [USER]);
await db.exec(`CREATE ROLE agrisul_mcp_vault_login LOGIN NOINHERIT NOBYPASSRLS;
  GRANT agrisul_mcp_vault TO agrisul_mcp_vault_login;`);
await db.exec('SET SESSION AUTHORIZATION agrisul_mcp_vault_login;');
const loginAudit = await db.query(`SELECT session_user, rolsuper, rolbypassrls, rolcreaterole,
  rolcreatedb, rolreplication, rolinherit FROM pg_roles WHERE rolname = session_user`);
assert.deepEqual(loginAudit.rows[0], {session_user: 'agrisul_mcp_vault_login', rolsuper: false,
  rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolinherit: false});
const memberships = await db.query(`SELECT parent.rolname FROM pg_auth_members membership
  JOIN pg_roles parent ON parent.oid = membership.roleid
  JOIN pg_roles member ON member.oid = membership.member
  WHERE member.rolname = session_user`);
assert.deepEqual(memberships.rows, [{rolname: 'agrisul_mcp_vault'}]);
await db.exec('BEGIN; SET LOCAL ROLE agrisul_mcp_vault;');
try {
  const binding = await db.query(`SELECT project_ref FROM agrisul_mcp_private.project_binding WHERE singleton = true`);
  assert.equal(binding.rows[0].project_ref, 'rbuscpwntzpyqsuycqmv');
  await db.query(`INSERT INTO agrisul_mcp_private.auth_requests
    (token_hash, purpose, user_id, expires_at) VALUES ($1, 'ticket', $2, now() + interval '5 minutes')`,
  [Buffer.alloc(32, 1), USER]);
  const inserted = await db.query(`SELECT count(*)::int AS count FROM agrisul_mcp_private.auth_requests`);
  assert.equal(inserted.rows[0].count, 1);
  await assert.rejects(db.exec(`UPDATE agrisul_mcp_private.project_binding
    SET project_ref = 'another-project'`), /permission denied/);
} finally {
  await db.exec('ROLLBACK');
  await db.exec('RESET SESSION AUTHORIZATION');
}

console.log('MCP vault migration, restricted roles, RLS and grants passed locally');
await db.close();
