import type {DocumentLayout, DocumentPreviewData} from './types';

// Geometria de apresentação compartilhada com o PDF. O banco entrega o modelo
// vigente e valida versões, limites e os snapshots de cada solicitação.
export const legacyServiceRequestLayout: DocumentLayout = {
  page: {width: 210, height: 297},
  blocks: [
    {id: 'brand', type: 'text', x: 16, y: 14, width: 130, height: 6, text: 'CONTROLE DE FATURAMENTO', fontSize: 8, fontWeight: 'bold'},
    {id: 'title', type: 'text', x: 16, y: 24, width: 142, height: 12, text: 'SOLICITAÇÃO DE SERVIÇO', fontSize: 16, fontWeight: 'bold'},
    {id: 'number', type: 'field', x: 161, y: 24, width: 33, height: 12, field: 'requestNumber', fontSize: 12, fontWeight: 'bold', align: 'right'},
    {id: 'top-rule', type: 'line', x: 16, y: 39, width: 178, height: 0.4},
    {id: 'company-label', type: 'text', x: 16, y: 45, width: 29, height: 7, text: 'EMPRESA', fontSize: 9, fontWeight: 'bold'},
    {id: 'company', type: 'field', x: 48, y: 45, width: 146, height: 7, field: 'companyName', fontSize: 10},
    {id: 'address-label', type: 'text', x: 16, y: 55, width: 29, height: 7, text: 'ENDEREÇO', fontSize: 9, fontWeight: 'bold'},
    {id: 'address', type: 'field', x: 48, y: 55, width: 146, height: 7, field: 'companyAddress', fontSize: 9},
    {id: 'instruction', type: 'text', x: 16, y: 68, width: 178, height: 17, text: 'Solicitamos a execução do serviço no equipamento / material abaixo, mediante apresentação prévia de orçamento. Cite o número desta solicitação no orçamento.', fontSize: 9},
    {id: 'items', type: 'items', x: 16, y: 90, width: 178, height: 71, fontSize: 9},
    {id: 'value-label', type: 'text', x: 16, y: 169, width: 80, height: 6, text: 'VALOR DO SERVIÇO', fontSize: 8, fontWeight: 'bold'},
    {id: 'value', type: 'field', x: 16, y: 177, width: 80, height: 8, field: 'serviceValue', fontSize: 12, fontWeight: 'bold'},
    {id: 'return-label', type: 'text', x: 112, y: 169, width: 82, height: 6, text: 'PREVISÃO DE RETORNO', fontSize: 8, fontWeight: 'bold'},
    {id: 'return', type: 'field', x: 112, y: 177, width: 82, height: 8, field: 'returnDate', fontSize: 10},
    {id: 'notes-label', type: 'text', x: 16, y: 190, width: 178, height: 5, text: 'OBSERVAÇÕES', fontSize: 8, fontWeight: 'bold'},
    {id: 'notes', type: 'field', x: 16, y: 197, width: 178, height: 10, field: 'notes', fontSize: 8},
    {id: 'requester-signature', type: 'signature', x: 16, y: 215, width: 82, height: 41, field: 'requester', fontSize: 8, align: 'center'},
    {id: 'director-signature', type: 'signature', x: 112, y: 215, width: 82, height: 41, field: 'director', fontSize: 8, align: 'center'},
    {id: 'verification', type: 'verification', x: 16, y: 260, width: 178, height: 24, fontSize: 8},
    {id: 'operator', type: 'field', x: 16, y: 288, width: 178, height: 5, field: 'createdByName', fontSize: 8},
  ],
};

export const defaultServiceRequestLayout: DocumentLayout = {
  page: {width: 210, height: 297},
  blocks: [
    {id: 'number-label', type: 'text', x: 17, y: 49, width: 48, height: 4, text: 'SOLICITAÇÃO', fontSize: 8, fontWeight: 'bold'},
    {id: 'number', type: 'field', x: 17, y: 54, width: 48, height: 7, field: 'requestNumber', fontSize: 13, fontWeight: 'bold'},
    {id: 'created-label', type: 'text', x: 77, y: 49, width: 68, height: 4, text: 'DATA DO REGISTRO', fontSize: 8, fontWeight: 'bold'},
    {id: 'created', type: 'field', x: 77, y: 55, width: 68, height: 6, field: 'createdAt', fontSize: 9},
    {id: 'status-label', type: 'text', x: 155, y: 49, width: 38, height: 4, text: 'SITUAÇÃO', fontSize: 8, fontWeight: 'bold'},
    {id: 'status', type: 'field', x: 155, y: 55, width: 38, height: 6, field: 'status', fontSize: 9, fontWeight: 'bold'},
    {id: 'company-label', type: 'text', x: 14, y: 67, width: 182, height: 4, text: 'PRESTADOR DO SERVIÇO', fontSize: 8, fontWeight: 'bold'},
    {id: 'company', type: 'field', x: 14, y: 73, width: 182, height: 6, field: 'companyName', fontSize: 11, fontWeight: 'bold'},
    {id: 'address-label', type: 'text', x: 14, y: 82, width: 24, height: 5, text: 'ENDEREÇO', fontSize: 8, fontWeight: 'bold'},
    {id: 'address', type: 'field', x: 40, y: 82, width: 156, height: 9, field: 'companyAddress', fontSize: 8.5},
    {id: 'instruction', type: 'text', x: 14, y: 95, width: 182, height: 10, text: 'Solicitamos a execução do serviço no equipamento / material abaixo, mediante apresentação prévia de orçamento. Cite o número desta solicitação no orçamento.', fontSize: 8.5},
    {id: 'items', type: 'items', x: 14, y: 108, width: 182, height: 50, fontSize: 9},
    {id: 'value-label', type: 'text', x: 17, y: 164, width: 80, height: 5, text: 'VALOR DO SERVIÇO', fontSize: 8, fontWeight: 'bold'},
    {id: 'value', type: 'field', x: 17, y: 171, width: 80, height: 7, field: 'serviceValue', fontSize: 11, fontWeight: 'bold'},
    {id: 'return-label', type: 'text', x: 111, y: 164, width: 82, height: 5, text: 'PREVISÃO DE RETORNO', fontSize: 8, fontWeight: 'bold'},
    {id: 'return', type: 'field', x: 111, y: 171, width: 82, height: 7, field: 'returnDate', fontSize: 10},
    {id: 'notes-label', type: 'text', x: 14, y: 185, width: 182, height: 5, text: 'OBSERVAÇÕES', fontSize: 8, fontWeight: 'bold'},
    {id: 'notes', type: 'field', x: 14, y: 192, width: 182, height: 8, field: 'notes', fontSize: 8.5},
    {id: 'requester-signature', type: 'signature', x: 14, y: 206, width: 86, height: 44, field: 'requester', fontSize: 8, align: 'center'},
    {id: 'director-signature', type: 'signature', x: 110, y: 206, width: 86, height: 44, field: 'director', fontSize: 8, align: 'center'},
    {id: 'verification', type: 'verification', x: 14, y: 255, width: 182, height: 24, fontSize: 8},
    {id: 'operator', type: 'field', x: 14, y: 281, width: 182, height: 4, field: 'createdByName', fontSize: 8},
  ],
};

export const documentExampleData: DocumentPreviewData = {
  fields: {
    requestNumber: 'Nº 489', companyName: 'Tornearia Propriá', companyAddress: 'Rua Jessé Ferreira Trindade, 1.907 — Propriá, SE',
    serviceValue: 'R$ 1.433,00', returnDate: '30/09/2026', notes: 'Orçamento anexado à solicitação.', requesterName: 'Edmilson Silva',
    directorName: 'Diretor geral responsável', createdAt: '18/09/2026 10:30:05', decidedAt: '18/09/2026 11:12:34',
    createdByName: 'Registrado por: Operador responsável', status: 'Aprovada', verificationCode: 'EXEMPLO-489',
  },
  items: [
    {description: 'Confeccionar 2 mangueiras hidráulicas de pressão do comando.', application: 'Carregadeira Valtra BM100 nº 220/221'},
    {description: 'Confeccionar 2 mangueiras hidráulicas de retorno do comando.', application: 'Carregadeira Valtra BM100 nº 220/221'},
    {description: 'Confeccionar 6 mangueiras hidráulicas da garra.', application: 'Carregadeira Valtra BM100 nº 220/221'},
  ],
  signatures: {requester: {name: 'Edmilson Silva'}, director: {name: 'Diretor geral responsável'}},
  verification: {code: 'EXEMPLO-489'},
};
