import {
  createRemoteJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';
import type {McpConfig} from './auth.ts';

// Only public signing keys from this Agrisul project may verify either grant.
// A short cache bounds the delay when Supabase rotates or revokes a signing key.
const PROJECT_JWKS = createRemoteJWKSet(
  new URL('https://rbuscpwntzpyqsuycqmv.supabase.co/auth/v1/.well-known/jwks.json'),
  {cacheMaxAge: 60_000, cooldownDuration: 5_000, timeoutDuration: 5_000},
);
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Claims = Record<string, unknown>;

function claimsFor(token: string): Claims | null {
  try {
    const claims = decodeJwt(token);
    return claims && typeof claims === 'object' ? claims as Claims : null;
  } catch {
    return null;
  }
}

function subjectFor(claims: Claims | null, config: McpConfig, audience: string, clientId: string,
    role: string, nowSeconds: number): string | null {
  if (!claims || claims.iss !== config.authorizationServer || claims.aud !== audience ||
      claims.client_id !== clientId || claims.role !== role || claims.is_anonymous === true ||
      typeof claims.sub !== 'string' || !USER_ID_PATTERN.test(claims.sub) ||
      typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= nowSeconds ||
      (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf) ||
        claims.nbf > nowSeconds)) ||
      (claims.iat !== undefined && (typeof claims.iat !== 'number' || !Number.isFinite(claims.iat) ||
        claims.iat > nowSeconds + 30))) return null;
  return claims.sub;
}

// This is only a fast reject for malformed claims; never use it as authentication.
export function validateMcpTokenClaims(token: string, config: McpConfig,
    nowSeconds = Date.now() / 1000): string | null {
  return subjectFor(claimsFor(token), config, config.resource, config.clientId,
    'agrisul_mcp', nowSeconds);
}

async function verifiedSubject(token: string, config: McpConfig, audience: string,
    clientId: string, role: string, keySet: JWTVerifyGetKey): Promise<string | null> {
  if (token.length > 8192) return null;
  try {
    const header = decodeProtectedHeader(token);
    if (typeof header.alg !== 'string' || !['RS256', 'ES256'].includes(header.alg) ||
        typeof header.kid !== 'string' || !header.kid) return null;
    const {payload} = await jwtVerify(token, keySet, {
      issuer: config.authorizationServer,
      audience,
      algorithms: ['RS256', 'ES256'],
      typ: 'JWT',
    });
    return subjectFor(payload as Claims, config, audience, clientId, role, Date.now() / 1000);
  } catch {
    // Invalid signature, claim, JWKS, or a JWKS outage all fail closed.
    return null;
  }
}

export async function verifyMcpAccessToken(token: string, config: McpConfig,
    keySet: JWTVerifyGetKey = PROJECT_JWKS): Promise<string | null> {
  if (!validateMcpTokenClaims(token, config)) return null;
  return verifiedSubject(token, config, config.resource, config.clientId, 'agrisul_mcp', keySet);
}

export async function verifyUpstreamAccessToken(token: string, expectedUserId: string,
    config: McpConfig, keySet: JWTVerifyGetKey = PROJECT_JWKS): Promise<boolean> {
  if (!USER_ID_PATTERN.test(expectedUserId) || !config.upstreamClientId ||
      config.upstreamClientId === config.clientId) return false;
  const subject = await verifiedSubject(token, config, 'authenticated',
    config.upstreamClientId, 'authenticated', keySet);
  return subject === expectedUserId;
}
