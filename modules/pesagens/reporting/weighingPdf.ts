import type {jsPDF as JsPdf} from 'jspdf';
import {drawReportPdfHeader} from '@/shared/reporting/pdfHeader';
import {drawReportPdfWatermark} from '@/shared/reporting/pdfWatermark';
import {REPORT_MARGIN_MM} from '@/shared/reporting/reportLayout';
import {loadReportImage} from '@/shared/reporting/loadReportImage';
import type {ReportPdfBrand} from '@/shared/reporting/types';
import {dateLabel} from '@/shared/utils/presentation';
import {percentLabel, weightLabel} from '../utils/presentation';
import type {WeighingDetail, WeighingSummary} from '../types';

const clipped = (doc: JsPdf, value: string, width: number) => String(doc.splitTextToSize(value, Math.max(width, 1))[0] ?? '');
export async function createWeighingPdf(detail: WeighingDetail, brand: ReportPdfBrand, options?: {signal?: AbortSignal}) {
  const {jsPDF} = await import('@/shared/reporting/jsPdfRuntime');
  options?.signal?.throwIfAborted();
  const doc = new jsPDF({orientation: 'landscape', unit: 'mm', format: 'a4', compress: true});
  const margin = REPORT_MARGIN_MM, width = doc.internal.pageSize.getWidth(), height = doc.internal.pageSize.getHeight(), contentWidth = width - margin * 2, bottom = height - margin - 9;
  const [logo, watermark] = await Promise.all([loadReportImage(brand.company?.logoUrl ?? null), loadReportImage(brand.watermark.imageUrl)]);
  options?.signal?.throwIfAborted();
  let y = 0;
  const widths = [11, 15, 24, 20, 30, 30, 34, 35, contentWidth - 199];
  const headings = ['Hora', 'Frota', 'Placa', 'Tipo', 'Tara AGRISUL', 'Bruto AGRISUL', 'Líquido AGRISUL', 'Líquido parceiro', 'Diferença'];
  function pageHeader(day: string) {
    drawReportPdfWatermark(doc, width, height, brand.watermark, watermark);
    const top = drawReportPdfHeader({doc, pageWidth: width, margin, orientation: 'landscape', settings: brand.header, company: brand.company, logo, title: 'Pesagem de cana'});
    doc.setTextColor('#315640'); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(clipped(doc, `AGRISUL x ${detail.control.partnerName}`, contentWidth - 60), margin, top + 6);
    doc.setFontSize(8); doc.text(day, width - margin, top + 6, {align: 'right'});
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor('#647c6d');
    doc.text(`Safra ${detail.control.season} | Início: ${dateLabel(detail.control.startDate)} | Pesos em quilogramas (kg)`, margin, top + 11);
    return top + 16;
  }
  function tableHeader() {
    doc.setFillColor('#eaf4ed'); doc.rect(margin, y, contentWidth, 7, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8); doc.setTextColor('#3c674b');
    let x = margin;
    headings.forEach((text, index) => {doc.text(text, index >= 4 ? x + widths[index] - 2 : x + 2, y + 4.5, {align: index >= 4 ? 'right' : 'left'}); x += widths[index];});
    y += 7;
  }
  function newPage(day: string) {doc.addPage(); y = pageHeader(day); tableHeader();}
  function row(values: string[], bold = false, tint = false) {
    if (tint) {doc.setFillColor('#f1f7f2'); doc.rect(margin, y, contentWidth, 6.5, 'F');}
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(7); doc.setTextColor('#405f4b');
    let x = margin;
    values.forEach((value, index) => {doc.text(clipped(doc, value, widths[index] - 4), index >= 4 ? x + widths[index] - 2 : x + 2, y + 4.3, {align: index >= 4 ? 'right' : 'left'}); x += widths[index];});
    y += 6.5; doc.setDrawColor('#e6eee8'); doc.line(margin, y, width - margin, y);
  }
  function subtotal(label: string, summary: Pick<WeighingSummary, 'tareKg' | 'grossKg' | 'agrisulNetKg' | 'partnerNetKg' | 'differenceKg'>) {
    row([label, '', '', '', weightLabel(summary.tareKg), weightLabel(summary.grossKg), weightLabel(summary.agrisulNetKg), weightLabel(summary.partnerNetKg), weightLabel(summary.differenceKg)], true, true);
  }
  function paragraph(text: string, day: string) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); doc.setTextColor('#657e6d');
    for (const line of doc.splitTextToSize(text, contentWidth - 4) as string[]) {
      if (y + 4 > bottom) newPage(day);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); doc.setTextColor('#657e6d');
      doc.text(line, margin + 2, y + 3); y += 4;
    }
  }
  y = pageHeader('Comparativo geral');
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor('#526e5c');
  doc.text(`Viagens: ${detail.summary.entryCount} | Pendentes: ${detail.summary.pendingCount} | Diferença: ${percentLabel(detail.summary.differencePercent)}`, margin, y + 3); y += 8;
  tableHeader();
  if (!detail.entries.length) row(['', '', 'Sem viagens', '', '', '', '', '', '']);
  for (const day of detail.daily) {
    if (y + 14 + 26 > bottom) newPage(dateLabel(day.date));
    doc.setFont('helvetica', 'bold'); doc.setTextColor('#315640'); doc.setFontSize(8); doc.text(`Data: ${dateLabel(day.date)} | ${day.entryCount} viagens`, margin + 2, y + 5); y += 9;
    for (const entry of detail.entries.filter(item => item.weighedAt === day.date)) {
      const rowCount = entry.components.length + 1;
      if (y + rowCount * 6.5 > bottom) newPage(dateLabel(day.date));
      for (const component of entry.components) row([entry.weighedTime || '—', component.fleetNumber || '—', component.plate || 'Pendente', component.kind === 'truck' ? 'Caminhão' : 'Reboque', weightLabel(component.tareKg), weightLabel(component.grossKg), weightLabel(component.netKg), weightLabel(component.partnerNetKg), weightLabel(component.differenceKg)]);
      subtotal('Viagem', entry); y += 2;
      if (entry.notes) {
        const lines = doc.splitTextToSize(entry.notes, contentWidth - 4) as string[];
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor('#657e6d');
        for (const line of lines) {if (y + 4 > bottom) newPage(dateLabel(day.date)); doc.text(line, margin + 2, y + 3); y += 4;}
      }
    }
    if (y + 7 > bottom) newPage(dateLabel(day.date)); subtotal('Dia', day); y += 2;
    const dayEntries = detail.entries.filter(entry => entry.weighedAt === day.date);
    const pending = [dayEntries.some(entry => entry.agrisulNetKg == null) ? 'AGRISUL parcial' : '', dayEntries.some(entry => !entry.partnerComplete) ? `${detail.control.partnerName} parcial` : ''].filter(Boolean).join(' | ');
    if (pending) paragraph(`${pending}. Há pesos pendentes no total apresentado.`, dateLabel(day.date));
    y += 3;
  }
  if (y + 25 > bottom) newPage('Totais');
  subtotal('Total', detail.summary); y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); doc.setTextColor('#657e6d');
  doc.text('Diferença = líquido parceiro - líquido AGRISUL. Pendente indica peso não informado; valores ausentes não são zero.', margin, y + 3);
  doc.text('Bruto conjunto dos reboques dividido igualmente, conforme o controle. Números e placas preservados para cada veículo.', margin, y + 7);
  y += 12;
  if (detail.control.notes) paragraph(`Observações do controle: ${detail.control.notes}`, 'Observações');
  const pages = doc.getNumberOfPages(), emitted = new Intl.DateTimeFormat('pt-BR', {dateStyle: 'short', timeStyle: 'short'}).format(brand.issuedAt);
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setDrawColor('#dfe8e2'); doc.line(margin, height - margin - 4, width - margin, height - margin - 4);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor('#718679');
    doc.text(clipped(doc, `Emitido por ${brand.issuer.name || brand.issuer.email} | ${emitted}`, contentWidth - 25), margin, height - margin);
    doc.text(`${page} / ${pages}`, width - margin, height - margin, {align: 'right'});
  }
  return {doc, fileName: `pesagem-cana-${detail.control.startDate}.pdf`};
}
