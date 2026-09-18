import type {DocumentPreviewData} from '@/modules/cadastro/modelos-documentos/types';
import {dateLabel, moneyLabel} from '@/shared/utils/presentation';
import {qrSvgDataUrl} from '@/shared/reporting/qrCode';
import type {ServiceRequest} from '../types';
import {requestVerificationUrl} from './requestVerification';

export const documentTimestamp = (value: string) => new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Sao_Paulo',
}).format(new Date(value));

export function requestDocumentData(request: ServiceRequest, origin: string, images: {requester?: string | null; director?: string | null} = {}): DocumentPreviewData {
  const url = requestVerificationUrl(request, origin);
  return {
    fields: {
      requestNumber: `Nº ${request.number}`,
      companyName: request.companyName,
      companyAddress: request.companyAddress || '—',
      serviceValue: request.serviceValue == null ? '________________' : moneyLabel(request.serviceValue),
      returnDate: request.returnDate ? dateLabel(request.returnDate) : '____/____/________',
      notes: request.notes,
      requesterName: request.requester.name,
      directorName: request.decision?.name || '',
      createdAt: documentTimestamp(request.createdAt),
      decidedAt: request.decision ? documentTimestamp(request.decision.at) : '',
      createdByName: `Registrado por: ${request.createdBy.name}`,
      status: ({pending: 'Pendente', approved: 'Aprovada', rejected: 'Recusada'} as const)[request.status],
      verificationCode: request.documentHash || request.id,
    },
    items: request.items,
    signatures: {
      requester: {name: request.requester.name, imageUrl: images.requester, hash: request.requester.signatureHash, timestamp: request.requester.signaturePath ? documentTimestamp(request.createdAt) : null},
      director: {name: request.decision?.name || '', imageUrl: images.director, hash: request.decision?.signatureHash, timestamp: request.decision?.signaturePath ? documentTimestamp(request.decision.at) : null},
    },
    verification: {code: request.documentHash || request.id, url, qrImageUrl: qrSvgDataUrl(url)},
  };
}
