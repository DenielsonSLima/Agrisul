import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {type JWTVerifyGetKey} from 'jose';
import {createUpstreamAccountLinkUrl, getUpstreamUserAccessToken} from './upstream-grant.ts';
import {verifyMcpAccessToken, verifyUpstreamAccessToken} from './token-verification.ts';

// ChatGPT's token is accepted only by this resource. Supabase RPC/Storage use
// a different, user-scoped OAuth grant obtained directly by Agrisul.
const PROJECT_ORIGIN = 'https://rbuscpwntzpyqsuycqmv.supabase.co';
const RESOURCE_PATH = '/api/mcp';
const WELL_KNOWN_PATH = '/.well-known/oauth-protected-resource';
const ACCOUNT_LINK_PATH = '/api/mcp/account-link/start';

export type McpAuthContext = {client: SupabaseClient; userId: string};
export type McpAuthResult = McpAuthContext |
  {status: 'needs_account_link'; accountLinkUrl: string} |
  {status: 'upstream_unavailable'} | null;
export type McpConfig = {
  resource: string;
  resourceOrigin: string;
  authorizationServer: string;
  supabaseUrl: string;
  publishableKey: string;
  clientId: string;
  upstreamClientId: string;
};

export type McpAuthDependencies = {
  // Server-owned injection points for offline tests; never supplied by a request.
  config?: McpConfig | null;
  keySet?: JWTVerifyGetKey;
  getUpstreamToken?: (userId: string) => Promise<
    {status: 'ready'; accessToken: string} | {status: 'link_required'} | {status: 'unavailable'}>;
  createAccountLinkUrl?: (userId: string) => Promise<string | null>;
};

function serverEnv(name: string): string | undefined {
  const viteEnv = (import.meta as ImportMeta & {env?: Record<string, string>}).env;
  return process.env[name] || viteEnv?.[name];
}

export function getMcpConfig(): McpConfig | null {
  if (serverEnv('AGRISUL_MCP_ENABLED') !== 'true') return null;
  const resource = serverEnv('AGRISUL_MCP_RESOURCE');
  const clientId = serverEnv('AGRISUL_MCP_OAUTH_CLIENT_ID');
  const upstreamClientId = serverEnv('AGRISUL_MCP_UPSTREAM_CLIENT_ID');
  const upstreamClientSecret = serverEnv('AGRISUL_MCP_UPSTREAM_CLIENT_SECRET');
  const vaultDatabaseUrl = serverEnv('AGRISUL_MCP_VAULT_DATABASE_URL');
  const vaultKey = serverEnv('AGRISUL_MCP_VAULT_KEY_V1');
  const supabaseUrl = serverEnv('VITE_SUPABASE_URL');
  const publishableKey = serverEnv('VITE_SUPABASE_PUBLISHABLE_KEY');
  if (!resource || !clientId || !upstreamClientId || upstreamClientId === clientId ||
      !upstreamClientSecret || !vaultDatabaseUrl || !vaultKey || !supabaseUrl || !publishableKey) return null;
  try {
    const endpoint = new URL(resource);
    const supabase = new URL(supabaseUrl);
    const vault = new URL(vaultDatabaseUrl);
    if ((endpoint.protocol !== 'https:' && !isLocalHttp(endpoint)) ||
        endpoint.pathname !== RESOURCE_PATH || endpoint.search || endpoint.hash ||
        supabase.origin !== PROJECT_ORIGIN || supabase.pathname !== '/' ||
        supabase.search || supabase.hash ||
        !['postgres:', 'postgresql:'].includes(vault.protocol) || !vault.hostname ||
        !vault.username || !vault.password ||
        !/^[A-Za-z0-9_-]{43}$/.test(vaultKey) || Buffer.from(vaultKey, 'base64url').length !== 32) return null;
    return {
      resource: endpoint.href,
      resourceOrigin: endpoint.origin,
      authorizationServer: `${supabase.origin}/auth/v1`,
      supabaseUrl: supabase.origin,
      publishableKey,
      clientId,
      upstreamClientId,
    };
  } catch {
    return null;
  }
}

function isLocalHttp(url: URL): boolean {
  return url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
}

export function getMcpResourceMetadata(config: McpConfig) {
  return {
    resource: config.resource,
    authorization_servers: [config.authorizationServer],
    bearer_methods_supported: ['header'],
  };
}

export function getMcpResourceMetadataUrl(config: McpConfig): string {
  return `${config.resourceOrigin}${WELL_KNOWN_PATH}`;
}

export function getMcpAuthChallenge(config: McpConfig): string {
  return `Bearer resource_metadata="${getMcpResourceMetadataUrl(config)}"`;
}

export {validateMcpTokenClaims} from './token-verification.ts';

function safeAccountLinkUrl(value: string | null, config: McpConfig): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.origin !== config.resourceOrigin || url.pathname !== ACCOUNT_LINK_PATH ||
        url.username || url.password || url.hash ||
        [...url.searchParams.keys()].length !== 1 ||
        !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('ticket') ?? '')) return null;
    return url.href;
  } catch {
    return null;
  }
}

export async function authenticateMcpPrincipal(request: Request,
    dependencies: Pick<McpAuthDependencies, 'config' | 'keySet'> = {}): Promise<string | null> {
  const config = dependencies.config === undefined ? getMcpConfig() : dependencies.config;
  if (!config) return null;
  const authorization = request.headers.get('authorization');
  const match = authorization?.match(/^Bearer ([A-Za-z0-9._~-]+)$/i);
  const incomingToken = match?.[1];
  if (!incomingToken || incomingToken.length > 8192) return null;

  return verifyMcpAccessToken(incomingToken, config, dependencies.keySet);
}

export async function authorizeMcpRequest(request: Request,
    dependencies: McpAuthDependencies = {}): Promise<McpAuthResult> {
  const config = dependencies.config === undefined ? getMcpConfig() : dependencies.config;
  if (!config) return null;
  const incomingToken = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9._~-]+)$/i)?.[1];
  if (!incomingToken) return null;

  const subject = await authenticateMcpPrincipal(request, {config, keySet: dependencies.keySet});
  if (!subject) return null;

  try {
    const upstream = await (dependencies.getUpstreamToken ?? getUpstreamUserAccessToken)(subject);
    if (upstream.status === 'unavailable') return {status: 'upstream_unavailable'};
    if (upstream.status === 'link_required') {
      const link = safeAccountLinkUrl(
        await (dependencies.createAccountLinkUrl ?? createUpstreamAccountLinkUrl)(subject), config);
      return link ? {status: 'needs_account_link', accountLinkUrl: link} : {status: 'upstream_unavailable'};
    }
    const upstreamToken = upstream.accessToken;
    if (upstreamToken === incomingToken ||
        !await verifyUpstreamAccessToken(upstreamToken, subject, config, dependencies.keySet)) {
      return {status: 'upstream_unavailable'};
    }

    const client = createClient(config.supabaseUrl, config.publishableKey, {
      auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
      global: {headers: {Authorization: `Bearer ${upstreamToken}`}},
    });
    return {client, userId: subject};
  } catch {
    return {status: 'upstream_unavailable'};
  }
}
