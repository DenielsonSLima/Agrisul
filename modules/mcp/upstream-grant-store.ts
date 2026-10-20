import pg, {type PoolClient} from 'pg';
import type {AuthRequest, GrantStore, LockedGrant, RequestPurpose, StoredGrant} from './upstream-grant-core.ts';

const {Pool} = pg;
const SCHEMA = 'agrisul_mcp_private';
let pool: InstanceType<typeof Pool> | null = null;
let poolUrl: string | null = null;

function getPool(databaseUrl: string, allowLocalhost: boolean): InstanceType<typeof Pool> {
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username || !url.password ||
      !url.pathname || url.pathname === '/' || url.search || url.hash ||
      (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535))) {
    throw new Error('Invalid vault database URL');
  }
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const database = decodeURIComponent(url.pathname.slice(1));
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const direct = url.hostname === 'db.rbuscpwntzpyqsuycqmv.supabase.co';
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/i.test(url.hostname) &&
    user === 'agrisul_mcp_vault_login.rbuscpwntzpyqsuycqmv';
  if (database !== 'postgres' ||
      (direct && user !== 'agrisul_mcp_vault_login') ||
      (local && user !== 'agrisul_mcp_vault_login') ||
      (!direct && !pooler && !(local && allowLocalhost))) {
    throw new Error('Vault database is not the expected Supabase project');
  }
  if (pool && poolUrl === databaseUrl) return pool;
  if (pool) throw new Error('Vault database changed while server is running');
  // Do not pass connectionString: node-postgres can let sslmode/sslcert query
  // parameters override the validated TLS options.
  pool = new Pool({host: url.hostname, port: Number(url.port || 5432),
    user, password, database, max: 4, connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000, ssl: local ? false : {rejectUnauthorized: true}});
  poolUrl = databaseUrl;
  return pool;
}

async function withVaultTransaction<T>(databaseUrl: string, allowLocalhost: boolean,
  task: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool(databaseUrl, allowLocalhost).connect();
  let transaction = false;
  try {
    await client.query('BEGIN');
    transaction = true;
    const {rows} = await client.query<{
      session_user: string; rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean;
      rolcreatedb: boolean; rolreplication: boolean; rolinherit: boolean;
    }>(`SELECT session_user, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb,
      rolreplication, rolinherit FROM pg_roles WHERE rolname = session_user`);
    const login = rows[0];
    if (!login || login.rolsuper || login.rolbypassrls || login.rolcreaterole ||
        login.rolcreatedb || login.rolreplication || login.rolinherit ||
        ['postgres', 'service_role', 'supabase_admin', 'authenticator'].includes(login.session_user)) {
      throw new Error('Privileged vault login is forbidden');
    }
    const memberships = await client.query<{rolname: string}>(`SELECT parent.rolname FROM pg_auth_members membership
      JOIN pg_roles parent ON parent.oid = membership.roleid
      JOIN pg_roles member ON member.oid = membership.member
      WHERE member.rolname = session_user`);
    if (memberships.rows.length !== 1 || memberships.rows[0].rolname !== 'agrisul_mcp_vault') {
      throw new Error('Vault login has unexpected role memberships');
    }
    // This requires a separately provisioned LOGIN with SET membership in the
    // NOLOGIN role. All following queries run with only the vault role's rights.
    await client.query('SET LOCAL ROLE agrisul_mcp_vault');
    const role = await client.query<{current_user: string}>('SELECT current_user');
    if (role.rows[0]?.current_user !== 'agrisul_mcp_vault') throw new Error('Vault role unavailable');
    const binding = await client.query<{project_ref: string}>(`SELECT project_ref
      FROM ${SCHEMA}.project_binding WHERE singleton = true`);
    if (binding.rows.length !== 1 || binding.rows[0].project_ref !== 'rbuscpwntzpyqsuycqmv') {
      throw new Error('Vault is bound to a different Supabase project');
    }
    const result = await task(client);
    await client.query('COMMIT');
    transaction = false;
    return result;
  } catch (error) {
    if (transaction) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function createPostgresGrantStore(databaseUrl: string, allowLocalhost = false): GrantStore {
  return {
    async putRequest(request: AuthRequest) {
      await withVaultTransaction(databaseUrl, allowLocalhost, async client => {
        await client.query(`DELETE FROM ${SCHEMA}.auth_requests WHERE expires_at <= now()`);
        await client.query(`DELETE FROM ${SCHEMA}.upstream_grants
          WHERE expires_at <= now() OR last_used_at <= now() - interval '30 days'`);
        await client.query(`INSERT INTO ${SCHEMA}.auth_requests
          (token_hash, purpose, user_id, verifier_ciphertext, expires_at)
          VALUES ($1, $2, $3, $4, $5)`,
        [request.tokenHash, request.purpose, request.userId, request.verifierCiphertext, request.expiresAt]);
      });
    },
    async consumeRequest(hash: Buffer, purpose: RequestPurpose, now: Date): Promise<AuthRequest | null> {
      return withVaultTransaction(databaseUrl, allowLocalhost, async client => {
        const {rows} = await client.query<{
          token_hash: Buffer; purpose: RequestPurpose; user_id: string; verifier_ciphertext: string | null; expires_at: Date;
        }>(`DELETE FROM ${SCHEMA}.auth_requests
          WHERE token_hash = $1 AND purpose = $2 AND expires_at > $3
          RETURNING token_hash, purpose, user_id, verifier_ciphertext, expires_at`, [hash, purpose, now]);
        const row = rows[0];
        return row ? {tokenHash: row.token_hash, purpose: row.purpose, userId: row.user_id,
          verifierCiphertext: row.verifier_ciphertext, expiresAt: asDate(row.expires_at)} : null;
      });
    },
    async saveGrant(userId: string, refreshCiphertext: string, now: Date, expiresAt: Date) {
      await withVaultTransaction(databaseUrl, allowLocalhost, async client => {
        await client.query(`INSERT INTO ${SCHEMA}.upstream_grants
          (user_id, refresh_ciphertext, granted_at, last_used_at, expires_at)
          VALUES ($1, $2, $3, $3, $4)
          ON CONFLICT (user_id) DO UPDATE SET refresh_ciphertext = EXCLUDED.refresh_ciphertext,
            granted_at = EXCLUDED.granted_at, last_used_at = EXCLUDED.last_used_at,
            expires_at = EXCLUDED.expires_at`, [userId, refreshCiphertext, now, expiresAt]);
      });
    },
    async withLockedGrant<T>(userId: string, task: (grant: LockedGrant) => Promise<T>): Promise<T> {
      return withVaultTransaction(databaseUrl, allowLocalhost, async client => {
        const {rows} = await client.query<{
          refresh_ciphertext: string; granted_at: Date; last_used_at: Date; expires_at: Date;
        }>(`SELECT refresh_ciphertext, granted_at, last_used_at, expires_at
          FROM ${SCHEMA}.upstream_grants WHERE user_id = $1 FOR UPDATE`, [userId]);
        const row = rows[0];
        const record: StoredGrant | null = row ? {refreshCiphertext: row.refresh_ciphertext,
          grantedAt: asDate(row.granted_at), lastUsedAt: asDate(row.last_used_at),
          expiresAt: asDate(row.expires_at)} : null;
        return task({record,
          update: async (refreshCiphertext, lastUsedAt) => {
            if (!row) throw new Error('No grant is locked');
            await client.query(`UPDATE ${SCHEMA}.upstream_grants
              SET refresh_ciphertext = $2, last_used_at = $3 WHERE user_id = $1`,
            [userId, refreshCiphertext, lastUsedAt]);
          },
          delete: async () => {
            await client.query(`DELETE FROM ${SCHEMA}.upstream_grants WHERE user_id = $1`, [userId]);
          },
        });
      });
    },
    async deleteGrant(userId: string): Promise<boolean> {
      return withVaultTransaction(databaseUrl, allowLocalhost, async client => {
        const result = await client.query(`DELETE FROM ${SCHEMA}.upstream_grants WHERE user_id = $1`, [userId]);
        return (result.rowCount ?? 0) > 0;
      });
    },
  };
}
