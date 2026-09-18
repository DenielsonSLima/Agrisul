import type {jsPDF} from 'jspdf';
import type {DocumentPreviewData} from '@/modules/cadastro/modelos-documentos/types';
import {dateLabel, moneyLabel} from '@/shared/utils/presentation';
import type {ServiceRequest} from '../types';
import {documentTimestamp} from './requestDocumentData';
import {drawPdfQr} from './renderDocumentPdf';

const ink = '#183e2f', muted = '#61786b', border = '#dbe6df';

/** The audit remains separate from the signed, immutable request content. */
export function drawRequestPdfAudit(doc: jsPDF, request: ServiceRequest, data: DocumentPreviewData, drawBackground: () => number) {
  let y = 300;
  const page = () => {
    doc.addPage(); y = drawBackground() + 3;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(ink);
    doc.text(`Registro da solicitação nº ${request.number}`, 14, y + 3);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(muted);
    doc.text('Identificação, assinaturas e histórico de movimentações', 14, y + 9);
    y += 17;
  };
  const ensure = (space: number) => {if (y + space > 279) page();};
  const paragraph = (value: string, size = 8.5, bold = false, subtle = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size);
    const lines = doc.splitTextToSize(value, 182) as string[];
    const step = size <= 7.5 ? 3.6 : 4.4;
    for (const line of lines) {
      ensure(step);
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(subtle ? muted : ink);
      doc.text(line, 14, y); y += step;
    }
    y += 1.5;
  };
  const section = (label: string) => {
    ensure(24); y += 2;
    doc.setFillColor('#eaf2ed'); doc.roundedRect(14, y, 182, 7, 1, 1, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(ink); doc.text(label, 17, y + 4.7); y += 12;
  };
  const field = (label: string, value: string) => {
    ensure(12); paragraph(label.toLocaleUpperCase('pt-BR'), 6.5, true, true); paragraph(value);
  };

  page();
  if (request.workflowStatus) field('Situação do serviço', {open: 'Aberto', in_progress: 'Em andamento', finished: 'Finalizado', rejected: 'Recusado'}[request.workflowStatus]);
  field('Decisão do diretor', {pending: 'Aguardando análise', approved: 'Aprovada', rejected: 'Recusada'}[request.status]);
  field('Documento', request.id);
  field('Modelo', `${request.template?.name || 'Solicitação de serviço'} · versão ${request.template?.version ?? 0}`);
  paragraph(`Hash do documento: ${request.documentHash || 'Registro anterior ao controle de hash'}`, 7.5, false, true);
  section('RESPONSÁVEIS');
  field('Registrado no sistema por', `${request.createdBy.name} · ${documentTimestamp(request.createdAt)} (Brasília)`);
  paragraph(`Usuário responsável pelo lançamento: ${request.createdBy.userId}`, 7, false, true);
  for (const entry of [{label: 'Solicitante', actor: request.requester}, {label: 'Diretor geral', actor: request.decision}]) {
    field(entry.label, entry.actor?.name || 'Aguardando decisão');
    if (!entry.actor) continue;
    paragraph(entry.actor.signaturePath ? 'Assinatura PNG registrada com o documento.' : 'Assinatura manual.', 7.5, false, true);
    if (entry.label === 'Diretor geral' && entry.actor.userId) paragraph(`Usuário: ${entry.actor.userId}`, 7, false, true);
    if (entry.actor.signatureHash) paragraph(`Hash do registro: ${entry.actor.signatureHash}`, 7, false, true);
  }
  if (request.decisionComplementHash) paragraph(`Hash da complementação vinculada à decisão: ${request.decisionComplementHash}`, 7, false, true);
  section('HISTÓRICO');
  for (const event of request.history) {
    ensure(16);
    const action = {approved: 'Aprovada', rejected: 'Recusada', complemented: 'Complementada', completed: 'Serviço finalizado'}[event.action] || 'Registrada';
    paragraph(`${action} por ${event.actorName}`, 8.5, true);
    paragraph(`${documentTimestamp(event.at)} · Brasília`, 7.5, false, true);
    if (event.reason) paragraph(event.reason, 8);
    paragraph(`Usuário: ${event.actorId}`, 7, false, true);
  }
  if (request.attachments.length) {
    section('ORÇAMENTOS ANEXADOS');
    for (const file of request.attachments) paragraph(file.fileName, 8);
  }
  if (request.complements?.length) {
    section('COMPLEMENTAÇÕES DA SOLICITAÇÃO');
    paragraph('Valores, prazos e orçamentos adicionados após a criação. O documento original e suas assinaturas permanecem preservados.', 8, false, true);
    for (const entry of request.complements) {
      ensure(28);
      paragraph(`Registro ${entry.version} · ${entry.actorName}`, 9, true);
      paragraph(entry.recordedStatus === 'pending' ? 'Registrado antes da decisão.' : 'Registrado após a aprovação.', 7.5, false, true);
      paragraph(`${documentTimestamp(entry.at)} · Brasília`, 7.5, false, true);
      paragraph(`Valor do serviço: ${entry.serviceValue == null ? 'A apurar' : moneyLabel(entry.serviceValue)} · Previsão de retorno: ${entry.returnDate ? dateLabel(entry.returnDate) : 'Não informada'}`, 8.5);
      for (const file of request.attachments.filter(file => entry.attachmentIds.includes(file.id))) paragraph(`Orçamento adicionado: ${file.fileName}`, 8);
      paragraph(`Usuário: ${entry.actorId}`, 7, false, true);
      paragraph(`Hash do complemento: ${entry.hash}`, 7, false, true);
      y += 2;
    }
  }
  if (data.verification?.url) {
    ensure(36); y += 3;
    doc.setDrawColor(border); doc.setLineWidth(.2); doc.line(14, y - 3, 196, y - 3);
    drawPdfQr(doc, data.verification.url, 14, y, 26);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(ink); doc.text('Verificação do documento', 45, y + 8);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(muted);
    doc.text('Confira o registro no sistema.', 45, y + 14);
    doc.text('A consulta requer acesso ao espaço.', 45, y + 19);
  }
}

export function drawRequestPdfFooters(doc: jsPDF, number: number) {
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setDrawColor(border); doc.setLineWidth(.2); doc.line(14, 287, 196, 287);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(muted);
    doc.text(`Solicitação de serviço nº ${number} · Controle interno`, 14, 291);
    doc.text(`Página ${page} de ${pages}`, 196, 291, {align: 'right'});
  }
}
