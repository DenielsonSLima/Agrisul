import {getMcpConfig} from '@/modules/mcp/auth.ts';
import {completeUpstreamAccountLink} from '@/modules/mcp/upstream-grant.ts';

export const runtime = 'nodejs';

const HEADERS = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff'};

function resultPage(origin: string, success: boolean): Response {
  return new Response(null, {status: 303, headers: {...HEADERS,
    Location: `${origin}/api/mcp/account-link/result/${success ? 'success' : 'failed'}`}});
}

export async function GET(request: Request): Promise<Response> {
  const config = getMcpConfig();
  if (!config) return new Response(null, {status: 404, headers: HEADERS});
  const params = new URL(request.url).searchParams;
  const states = params.getAll('state');
  const codes = params.getAll('code');
  const errors = params.getAll('error');
  if (states.length !== 1 || codes.length > 1 || errors.length > 1 ||
      (codes.length === 1) === (errors.length === 1) ||
      [...params.keys()].some(key => !['state', 'code', 'error', 'error_description'].includes(key))) {
    return resultPage(config.resourceOrigin, false);
  }
  const success = await completeUpstreamAccountLink(states[0], codes[0] ?? null, errors[0] ?? null);
  return resultPage(config.resourceOrigin, success);
}
