import { getSupabaseBrowserClient } from './client';

export class RpcError extends Error {
  constructor(message: string, public status = 400, public code?: string) { super(message); this.name = 'RpcError'; }
}
function errorStatus(code?: string, status?: number) {
  if (code === '28000' || code === 'PGRST301' || code === 'PGRST303') return 401;
  if (code === '42501') return 403;
  if (code === 'P0002') return 404;
  if (code === '23505' || code === '23503' || code === '23514' || code === '40001') return 409;
  if (code?.startsWith('22') || code === '23514' || code === 'P0001') return 400;
  return status && status >= 400 ? status : 503;
}
export async function rpcRequest<T>(resource: string, action: string, payload: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const client = getSupabaseBrowserClient();
  let request = client.rpc('billing_rpc', {p_resource: resource, p_action: action, p_payload: payload});
  if (signal) request = request.abortSignal(signal);
  const {data, error, status} = await request;
  if (signal?.aborted) throw new DOMException('Consulta cancelada', 'AbortError');
  if (error) {
    const code = error.code;
    const mapped = errorStatus(code, status);
    const message = mapped === 401 ? 'Sua sessão expirou. Entre novamente.' :
      mapped === 403 ? 'Você não tem permissão para acessar este registro.' :
      mapped === 503 ? 'Não foi possível conectar ao servidor. Tente novamente.' : error.message;
    throw new RpcError(message, mapped, code);
  }
  return data as T;
}
export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const client = getSupabaseBrowserClient();
  const {data: {session}, error} = await client.auth.getSession();
  if (error || !session) throw new RpcError('Entre para continuar.', 401);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session.access_token}`);
  return fetch(input, {...init, headers});
}
