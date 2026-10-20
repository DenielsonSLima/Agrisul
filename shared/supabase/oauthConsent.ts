import type {SupabaseClient} from '@supabase/supabase-js';

// Supabase sends an opaque authorization_id to the configured authorization
// path. Keep it out of URL path interpolation unless it has a bounded,
// path-safe shape. UUIDs and base64url identifiers are both accepted.
const AUTHORIZATION_ID = /^[A-Za-z0-9_-]{1,128}$/;

export type ConsentAuthApi = Pick<SupabaseClient['auth'], 'getUser' | 'oauth'>;
export type ConsentDetails = {
  authorization_id: string;
  redirect_uri: string;
  client: {id: string; name: string};
  user: {id: string; email: string};
  scope: string;
};
export type ConsentLoad =
  | {kind: 'consent'; details: ConsentDetails}
  | {kind: 'redirect'; url: string};

export function authorizationIdFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  if ([...params.keys()].length !== 1 || !params.has('authorization_id')) return null;
  const id = params.get('authorization_id');
  return id && AUTHORIZATION_ID.test(id) ? id : null;
}

export function consentReturnPath(id: string): string {
  if (!AUTHORIZATION_ID.test(id)) throw new Error('Invalid authorization ID');
  return `/oauth/consent?authorization_id=${encodeURIComponent(id)}`;
}

export function consentLoginPath(id: string): string {
  return `/login?returnTo=${encodeURIComponent(consentReturnPath(id))}`;
}

export function consentReturnPathFromLocation(pathname: string, search: string): string | null {
  if (pathname !== '/oauth/consent') return null;
  const id = authorizationIdFromSearch(search);
  return id ? consentReturnPath(id) : null;
}

export function safeLoginReturnTo(target: string | null, origin: string): string {
  if (!target || !target.startsWith('/') || target.startsWith('//') ||
      /[\u0000-\u001f\u007f\\]/.test(target)) return '/';
  try {
    const parsed = new URL(target, origin);
    if (parsed.origin !== origin || parsed.pathname.startsWith('/login')) return '/';
    if (parsed.pathname === '/oauth/consent') {
      if (!target.startsWith('/oauth/consent?') || parsed.hash) return '/';
      return consentReturnPathFromLocation(parsed.pathname, parsed.search) ?? '/';
    }
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return '/';
  }
}

// The registered client redirect is supplied by Supabase Auth, never by this
// page's query string. Restrict browser navigation to network URLs only.
export function safeOAuthRedirectUrl(value: string): string | null {
  if (!/^https?:\/\//i.test(value) || /[\u0000-\u001f\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || !url.hostname) return null;
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function trustedRedirect(value: string): string {
  const url = safeOAuthRedirectUrl(value);
  if (!url) throw new Error('Invalid OAuth redirect');
  return url;
}

async function verifyCurrentUser(auth: ConsentAuthApi, expectedUserId: string): Promise<void> {
  const {data, error} = await auth.getUser();
  if (error || !data.user || data.user.id !== expectedUserId) {
    throw new Error('OAuth session changed');
  }
}

export async function loadOAuthConsent(
  auth: ConsentAuthApi,
  authorizationId: string,
  expectedUserId: string,
): Promise<ConsentLoad> {
  if (!AUTHORIZATION_ID.test(authorizationId) || !expectedUserId) {
    throw new Error('Invalid OAuth authorization request');
  }
  await verifyCurrentUser(auth, expectedUserId);
  const {data, error} = await auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) throw new Error('OAuth authorization unavailable');
  if ('redirect_url' in data) return {kind: 'redirect', url: trustedRedirect(data.redirect_url)};
  if (data.authorization_id !== authorizationId || data.user?.id !== expectedUserId ||
      !data.client?.id || !data.client.name || !data.redirect_uri ||
      !safeOAuthRedirectUrl(data.redirect_uri) ||
      typeof data.scope !== 'string' || typeof data.user.email !== 'string') {
    throw new Error('OAuth authorization mismatch');
  }
  return {kind: 'consent', details: data};
}

export async function decideOAuthConsent(
  auth: ConsentAuthApi,
  details: ConsentDetails,
  expectedUserId: string,
  decision: 'approve' | 'deny',
): Promise<string> {
  if (decision !== 'approve' && decision !== 'deny') throw new Error('Invalid OAuth decision');
  const current = await loadOAuthConsent(auth, details.authorization_id, expectedUserId);
  if (current.kind === 'redirect') return current.url; // Already authorized; no new approval.
  const latest = current.details;
  if (latest.client.id !== details.client.id || latest.redirect_uri !== details.redirect_uri ||
      latest.scope !== details.scope || latest.user.id !== details.user.id) {
    throw new Error('OAuth authorization changed');
  }
  const response = decision === 'approve'
    ? await auth.oauth.approveAuthorization(details.authorization_id, {skipBrowserRedirect: true})
    : await auth.oauth.denyAuthorization(details.authorization_id, {skipBrowserRedirect: true});
  if (response.error || !response.data?.redirect_url) throw new Error('OAuth decision failed');
  return trustedRedirect(response.data.redirect_url);
}
