import type {ServiceRequest} from '../types';

export function requestVerificationUrl(request: Pick<ServiceRequest, 'id' | 'documentHash'>, origin: string): string {
  const url = new URL('/solicitacoes', origin);
  url.searchParams.set('secao', 'servico');
  url.searchParams.set('solicitacao', request.id);
  if (request.documentHash) url.searchParams.set('verificar', request.documentHash);
  return url.toString();
}

export function checkDocumentHash(expected: string | null, actual: string | null | undefined): 'none' | 'valid' | 'invalid' {
  if (!expected) return 'none';
  return /^[a-f0-9]{64}$/i.test(expected) && expected.toLowerCase() === actual?.toLowerCase() ? 'valid' : 'invalid';
}
