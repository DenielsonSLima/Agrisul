import {documentBlockLabels, documentFieldLabels, type DocumentBlock, type DocumentPreviewData, type DocumentSignatureRole} from './types';

export function documentBlockText(block: DocumentBlock, data: DocumentPreviewData) {
  if (block.type === 'text') return block.text ?? '';
  if (block.type === 'field' && block.field && block.field !== 'requester' && block.field !== 'director') return data.fields[block.field] ?? '—';
  if (block.type === 'verification') return `Confira o registro deste documento.\nHash do documento: ${data.verification?.code ?? data.fields.verificationCode ?? '—'}`;
  return '';
}

export function documentSignatureLabel(role: DocumentSignatureRole) {
  return role === 'requester' ? 'SOLICITANTE' : 'DIRETOR GERAL';
}

export function documentBlockLabel(block: DocumentBlock) {
  if (block.type === 'text') return block.text?.split('\n')[0]?.slice(0, 44) || 'Texto sem conteúdo';
  if (block.type === 'field' && block.field && block.field !== 'requester' && block.field !== 'director') return documentFieldLabels[block.field];
  if (block.type === 'signature') return block.field === 'director' ? 'Assinatura do diretor geral' : 'Assinatura do solicitante';
  return documentBlockLabels[block.type];
}

export const pointsToMillimeters = (points: number) => points * 25.4 / 72;
