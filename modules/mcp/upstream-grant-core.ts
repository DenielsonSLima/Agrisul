import {createCipheriv, createDecipheriv, createHash, randomBytes} from 'node:crypto';

const TICKET_LIFETIME_MS = 5 * 60_000;
const STATE_LIFETIME_MS = 10 * 60_000;
const GRANT_LIFETIME_MS = 30 * 24 * 60 * 60_000;
const PROJECT_REF = 'rbuscpwntzpyqsuycqmv';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RANDOM_VALUE = /^[A-Za-z0-9_-]{43}$/;

export type RequestPurpose = 'ticket' | 'state';
export type AuthRequest = {
  tokenHash: Buffer;
  purpose: RequestPurpose;
  userId: string;
  verifierCiphertext: string | null;
  expiresAt: Date;
};
export type StoredGrant = {
  refreshCiphertext: string;
  grantedAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
};
export type LockedGrant = {
  record: StoredGrant | null;
  update: (refreshCiphertext: string, lastUsedAt: Date) => Promise<void>;
  delete: () => Promise<void>;
};
export type GrantStore = {
  putRequest: (request: AuthRequest) => Promise<void>;
  consumeRequest: (hash: Buffer, purpose: RequestPurpose, now: Date) => Promise<AuthRequest | null>;
  saveGrant: (userId: string, refreshCiphertext: string, now: Date, expiresAt: Date) => Promise<void>;
  withLockedGrant: <T>(userId: string, task: (grant: LockedGrant) => Promise<T>) => Promise<T>;
  deleteGrant: (userId: string) => Promise<boolean>;
};
export type OAuthTokenResponse = {access_token: string; refresh_token?: string; token_type: string};
export class UpstreamGrantRevokedError extends Error {}
export type UpstreamGrantConfig = {
  resourceOrigin: string;
  authorizationServer: string;
  clientId: string;
  clientSecret: string;
  vaultKey: Buffer;
};
export type GrantServiceDependencies = {
  store: GrantStore;
  config: UpstreamGrantConfig;
  exchange: (params: URLSearchParams) => Promise<OAuthTokenResponse>;
  verifyAccessToken: (token: string, userId: string) => Promise<boolean>;
  revokeAccess: (token: string) => Promise<boolean>;
  now?: () => Date;
  random?: (size: number) => Buffer;
};

function opaqueHash(value: string): Buffer {
  return createHash('sha256').update(value, 'ascii').digest();
}

function envelopeAAD(userId: string, purpose: string, clientId: string): Buffer {
  return Buffer.from(`agrisul-mcp-v1\0${PROJECT_REF}\0${clientId}\0${userId}\0${purpose}`, 'utf8');
}

export function encryptVaultValue(value: string, userId: string, purpose: string, clientId: string, key: Buffer): string {
  if (key.length !== 32) throw new Error('Invalid vault key');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(envelopeAAD(userId, purpose, clientId));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1.${nonce.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptVaultValue(envelope: string, userId: string, purpose: string, clientId: string, key: Buffer): string {
  if (key.length !== 32) throw new Error('Invalid vault key');
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1' || parts.slice(1).some(part => !/^[A-Za-z0-9_-]+$/.test(part))) {
    throw new Error('Invalid vault envelope');
  }
  const nonce = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const encrypted = Buffer.from(parts[3], 'base64url');
  if (nonce.length !== 12 || tag.length !== 16 || encrypted.length === 0) throw new Error('Invalid vault envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(envelopeAAD(userId, purpose, clientId));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function validResponse(value: OAuthTokenResponse): boolean {
  return value.token_type?.toLowerCase() === 'bearer' &&
    typeof value.access_token === 'string' && value.access_token.length > 0 && value.access_token.length <= 8192 &&
    (value.refresh_token === undefined ||
      (typeof value.refresh_token === 'string' && value.refresh_token.length > 0 && value.refresh_token.length <= 8192));
}

export function createUpstreamGrantService({store, config, exchange, verifyAccessToken, revokeAccess,
  now = () => new Date(), random = randomBytes}: GrantServiceDependencies) {
  if (config.vaultKey.length !== 32) throw new Error('Invalid vault key');
  const callbackUrl = `${config.resourceOrigin}/api/mcp/account-link/callback`;

  async function createAccountLinkUrl(userId: string): Promise<string | null> {
    if (!UUID.test(userId)) return null;
    const ticket = random(32).toString('base64url');
    const created = now();
    await store.putRequest({tokenHash: opaqueHash(ticket), purpose: 'ticket', userId,
      verifierCiphertext: null, expiresAt: new Date(created.getTime() + TICKET_LIFETIME_MS)});
    return `${config.resourceOrigin}/api/mcp/account-link/start?ticket=${ticket}`;
  }

  async function beginAccountLink(ticket: string): Promise<string | null> {
    if (!RANDOM_VALUE.test(ticket)) return null;
    const request = await store.consumeRequest(opaqueHash(ticket), 'ticket', now());
    if (!request) return null;
    const state = random(32).toString('base64url');
    const verifier = random(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
    const created = now();
    await store.putRequest({tokenHash: opaqueHash(state), purpose: 'state', userId: request.userId,
      verifierCiphertext: encryptVaultValue(verifier, request.userId, 'pkce', config.clientId, config.vaultKey),
      expiresAt: new Date(created.getTime() + STATE_LIFETIME_MS)});
    const authorize = new URL(`${config.authorizationServer}/oauth/authorize`);
    authorize.search = new URLSearchParams({response_type: 'code', client_id: config.clientId,
      redirect_uri: callbackUrl, state, code_challenge: challenge, code_challenge_method: 'S256'}).toString();
    return authorize.href;
  }

  async function completeAccountLink(state: string, code: string | null, error: string | null): Promise<boolean> {
    if (!RANDOM_VALUE.test(state)) return false;
    const request = await store.consumeRequest(opaqueHash(state), 'state', now());
    if (!request || !request.verifierCiphertext || error || !code || code.length > 2048) return false;
    const verifier = decryptVaultValue(request.verifierCiphertext, request.userId, 'pkce', config.clientId, config.vaultKey);
    const response = await exchange(new URLSearchParams({grant_type: 'authorization_code', code,
      redirect_uri: callbackUrl, code_verifier: verifier}));
    if (!validResponse(response) || !response.refresh_token ||
        !await verifyAccessToken(response.access_token, request.userId)) return false;
    const granted = now();
    await store.saveGrant(request.userId,
      encryptVaultValue(response.refresh_token, request.userId, 'refresh', config.clientId, config.vaultKey),
      granted, new Date(granted.getTime() + GRANT_LIFETIME_MS));
    return true;
  }

  async function getAccessToken(userId: string): Promise<string | null> {
    if (!UUID.test(userId)) return null;
    return store.withLockedGrant(userId, async grant => {
      if (!grant.record) return null;
      const current = now();
      if (grant.record.expiresAt <= current ||
          current.getTime() - grant.record.lastUsedAt.getTime() >= GRANT_LIFETIME_MS) {
        await grant.delete();
        return null;
      }
      const refresh = decryptVaultValue(grant.record.refreshCiphertext, userId, 'refresh', config.clientId, config.vaultKey);
      let response: OAuthTokenResponse;
      try {
        response = await exchange(new URLSearchParams({grant_type: 'refresh_token', refresh_token: refresh}));
      } catch (error) {
        if (!(error instanceof UpstreamGrantRevokedError)) throw error;
        await grant.delete();
        return null;
      }
      // Signature/JWKS or malformed provider responses may be transient. Keep
      // the old refresh token and let the transaction roll back; only a clear
      // invalid_grant response or the local deadline removes consent.
      if (!validResponse(response) || !await verifyAccessToken(response.access_token, userId)) {
        throw new Error('Unverifiable upstream token');
      }
      const nextRefresh = response.refresh_token ?? refresh;
      await grant.update(encryptVaultValue(nextRefresh, userId, 'refresh', config.clientId, config.vaultKey), current);
      return response.access_token;
    });
  }

  async function deleteGrant(userId: string): Promise<'unlinked' | 'local_only' | 'unavailable'> {
    if (!UUID.test(userId)) return 'unavailable';
    return store.withLockedGrant(userId, async grant => {
      if (!grant.record) return 'local_only';
      const refresh = decryptVaultValue(grant.record.refreshCiphertext, userId, 'refresh', config.clientId, config.vaultKey);
      let response: OAuthTokenResponse;
      try {
        response = await exchange(new URLSearchParams({grant_type: 'refresh_token', refresh_token: refresh}));
      } catch (error) {
        if (!(error instanceof UpstreamGrantRevokedError)) throw error;
        await grant.delete();
        return 'local_only';
      }
      if (!validResponse(response) || !await verifyAccessToken(response.access_token, userId)) {
        throw new Error('Unverifiable upstream token');
      }
      // Refresh-token rotation must survive a transient revocation failure.
      // The callback returns unavailable instead of throwing so this update
      // commits and the same user can retry the unlink operation.
      const current = now();
      await grant.update(encryptVaultValue(response.refresh_token ?? refresh, userId,
        'refresh', config.clientId, config.vaultKey), current);
      let revoked = false;
      try { revoked = await revokeAccess(response.access_token); }
      catch { return 'unavailable'; }
      if (!revoked) return 'unavailable';
      await grant.delete();
      return 'unlinked';
    });
  }

  return {createAccountLinkUrl, beginAccountLink, completeAccountLink, getAccessToken, deleteGrant};
}
