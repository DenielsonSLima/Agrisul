import {createUpstreamGrantService, UpstreamGrantRevokedError, type OAuthTokenResponse} from './upstream-grant-core.ts';
import {createPostgresGrantStore} from './upstream-grant-store.ts';
import {verifyUpstreamAccessToken} from './token-verification.ts';

const PROJECT_ORIGIN = 'https://rbuscpwntzpyqsuycqmv.supabase.co';
const MAX_TOKEN_RESPONSE_BYTES = 32_768;

function serverEnv(name: string): string | undefined {
  const viteEnv = (import.meta as ImportMeta & {env?: Record<string, string>}).env;
  return process.env[name] || viteEnv?.[name];
}

async function configuredService() {
  // Dynamic import avoids evaluating auth.ts -> upstream-grant.ts cyclic
  // dependencies until an authenticated MCP request actually needs a grant.
  const {getMcpConfig} = await import('./auth.ts');
  const mcp = getMcpConfig();
  const databaseUrl = serverEnv('AGRISUL_MCP_VAULT_DATABASE_URL');
  const keyText = serverEnv('AGRISUL_MCP_VAULT_KEY_V1');
  const clientSecret = serverEnv('AGRISUL_MCP_UPSTREAM_CLIENT_SECRET');
  if (!mcp || !databaseUrl || !keyText || !clientSecret ||
      !/^[A-Za-z0-9_-]{43}$/.test(keyText)) return null;
  const vaultKey = Buffer.from(keyText, 'base64url');
  if (vaultKey.length !== 32) return null;
  const authorizationServer = `${PROJECT_ORIGIN}/auth/v1`;
  const exchange = async (params: URLSearchParams): Promise<OAuthTokenResponse> => {
    const response = await fetch(`${authorizationServer}/oauth/token`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: {'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${mcp.upstreamClientId}:${clientSecret}`).toString('base64')}`},
      body: params,
    });
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json') ||
        Number(response.headers.get('content-length') || 0) > MAX_TOKEN_RESPONSE_BYTES) {
      throw new Error('Upstream OAuth exchange failed');
    }
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > MAX_TOKEN_RESPONSE_BYTES) throw new Error('Upstream OAuth response too large');
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid upstream OAuth response');
    if (!response.ok) {
      if (response.status === 400 && (parsed as {error?: unknown}).error === 'invalid_grant') {
        throw new UpstreamGrantRevokedError('Upstream grant is no longer valid');
      }
      throw new Error('Upstream OAuth exchange failed');
    }
    return parsed as OAuthTokenResponse;
  };
  const revokeAccess = async (accessToken: string): Promise<boolean> => {
    const url = new URL(`${authorizationServer}/user/oauth/grants`);
    url.searchParams.set('client_id', mcp.upstreamClientId);
    const response = await fetch(url, {method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: {Authorization: `Bearer ${accessToken}`, apikey: mcp.publishableKey}});
    return response.ok;
  };
  return createUpstreamGrantService({
    store: createPostgresGrantStore(databaseUrl,
      new URL(mcp.resourceOrigin).protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(new URL(mcp.resourceOrigin).hostname)),
    config: {resourceOrigin: mcp.resourceOrigin, authorizationServer,
      clientId: mcp.upstreamClientId, clientSecret, vaultKey},
    exchange,
    verifyAccessToken: (token, userId) => verifyUpstreamAccessToken(token, userId, mcp),
    revokeAccess,
  });
}

// These entrypoints never receive or forward the inbound MCP bearer. A missing
// client, vault credential/key, migration, or per-user consent fails closed.
export type UpstreamAccessResult =
  | {status: 'ready'; accessToken: string}
  | {status: 'link_required'}
  | {status: 'unavailable'};

export async function getUpstreamUserAccessToken(userId: string): Promise<UpstreamAccessResult> {
  try {
    const service = await configuredService();
    if (!service) return {status: 'unavailable'};
    const accessToken = await service.getAccessToken(userId);
    return accessToken ? {status: 'ready', accessToken} : {status: 'link_required'};
  } catch {
    return {status: 'unavailable'};
  }
}

export async function createUpstreamAccountLinkUrl(userId: string): Promise<string | null> {
  try { return await (await configuredService())?.createAccountLinkUrl(userId) ?? null; }
  catch { return null; }
}

export async function beginUpstreamAccountLink(ticket: string): Promise<string | null> {
  try { return await (await configuredService())?.beginAccountLink(ticket) ?? null; }
  catch { return null; }
}

export async function completeUpstreamAccountLink(state: string, code: string | null, error: string | null): Promise<boolean> {
  try { return await (await configuredService())?.completeAccountLink(state, code, error) ?? false; }
  catch { return false; }
}

export async function deleteUpstreamGrant(userId: string): Promise<{status: 'unlinked' | 'local_only' | 'unavailable'}> {
  try {
    const service = await configuredService();
    if (!service) return {status: 'unavailable'};
    return {status: await service.deleteGrant(userId)};
  } catch {
    return {status: 'unavailable'};
  }
}
