import {getMcpConfig} from '@/modules/mcp/auth.ts';
import {beginUpstreamAccountLink} from '@/modules/mcp/upstream-grant.ts';

export const runtime = 'nodejs';

const HEADERS = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff'};

async function readLimitedForm(request: Request): Promise<string | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!getMcpConfig()) return new Response(null, {status: 404, headers: HEADERS});
  const url = new URL(request.url);
  const tickets = url.searchParams.getAll('ticket');
  if (tickets.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(tickets[0]) ||
      [...url.searchParams.keys()].some(key => key !== 'ticket')) {
    return new Response('Vínculo inválido ou expirado.', {status: 400, headers: HEADERS});
  }
  // GET is deliberately read-only. Link previews and browser prefetch must not
  // consume a one-use ticket before the person chooses to continue.
  const body = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Vincular Agrisul</title>` +
    `<p>Permitir que o plugin Agrisul acesse sua conta para consultar materiais e criar cotações?</p>` +
    `<form method="post" action="/api/mcp/account-link/start">` +
    `<input type="hidden" name="ticket" value="${tickets[0]}">` +
    `<button type="submit">Continuar para a Agrisul</button></form></html>`;
  return new Response(body, {status: 200, headers: {...HEADERS,
    'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
}

export async function POST(request: Request): Promise<Response> {
  const config = getMcpConfig();
  if (!config) return new Response(null, {status: 404, headers: HEADERS});
  if (request.headers.get('origin') !== config.resourceOrigin ||
      !/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '') ||
      Number(request.headers.get('content-length') || 0) > 1024) {
    return new Response('Vínculo inválido.', {status: 400, headers: HEADERS});
  }
  const body = await readLimitedForm(request);
  if (body === null) return new Response('Vínculo inválido.', {status: 400, headers: HEADERS});
  const params = new URLSearchParams(body);
  const tickets = params.getAll('ticket');
  if (tickets.length !== 1 || [...params.keys()].some(key => key !== 'ticket')) {
    return new Response('Vínculo inválido.', {status: 400, headers: HEADERS});
  }
  const authorizationUrl = await beginUpstreamAccountLink(tickets[0]);
  if (!authorizationUrl) return new Response('Vínculo inválido ou expirado.', {status: 400, headers: HEADERS});
  return new Response(null, {status: 303, headers: {...HEADERS, Location: authorizationUrl}});
}
