import {getMcpConfig} from '@/modules/mcp/auth.ts';

export const runtime = 'nodejs';

const HEADERS = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Content-Type': 'text/html; charset=utf-8'};

export async function GET(_request: Request, context: {params: Promise<{status: string}>}): Promise<Response> {
  if (!getMcpConfig()) return new Response(null, {status: 404, headers: HEADERS});
  const {status} = await context.params;
  if (status !== 'success' && status !== 'failed') return new Response(null, {status: 404, headers: HEADERS});
  const message = status === 'success'
    ? 'Conta Agrisul vinculada. Volte ao chat e repita a operação.'
    : 'Vínculo não concluído. Volte ao chat e tente novamente.';
  return new Response(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Agrisul</title><p>${message}</p></html>`,
    {status: status === 'success' ? 200 : 400, headers: HEADERS});
}
