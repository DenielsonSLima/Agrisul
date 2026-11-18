import type {jsPDF as JsPdf} from 'jspdf';
import {drawReportPdfHeader, type ReportPdfImage} from '@/shared/reporting/pdfHeader';
import {drawReportPdfWatermark} from '@/shared/reporting/pdfWatermark';
import {REPORT_MARGIN_MM} from '@/shared/reporting/reportLayout';
import type {ReportPdfBrand} from '@/shared/reporting/types';
import {dateLabel, moneyLabel} from '@/shared/utils/presentation';
import type {QuotationNegotiationSnapshot} from './quotationNegotiationPdf';

/** Adds a closing page using only the quotation's server-projected totals. */
export function drawQuotationClosingSummary(
  doc: JsPdf,
  snapshot: QuotationNegotiationSnapshot,
  brand: ReportPdfBrand,
  logo: ReportPdfImage | null,
  watermark: ReportPdfImage | null,
) {
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = REPORT_MARGIN_MM;
  const contentWidth = width - margin * 2;
  const bottom = height - margin - 9;
  const columns = [
    {label: 'FORNECEDOR', fraction: .25},
    {label: 'ITENS COTADOS', fraction: .075},
    {label: 'ITENS APROVADOS', fraction: .085},
    {label: 'APROVADO BRUTO', fraction: .13},
    {label: 'APROVADO LÍQUIDO', fraction: .14},
    {label: 'PAGAMENTO / VALIDADE', fraction: .17},
    {label: 'PRAZO DE ENTREGA', fraction: .15},
  ];
  const columnWidths = columns.map(column => contentWidth * column.fraction);
  let y = 0;

  const textLines = (text: string, column: number) => doc.splitTextToSize(
    text,
    columnWidths[column] - 6,
  ) as string[];

  const tableHeader = () => {
    let x = margin;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.8);
    doc.setTextColor(43, 76, 53);
    doc.setDrawColor(194, 211, 200);
    columns.forEach((column, index) => {
      doc.setFillColor(229, 239, 232);
      doc.rect(x, y, columnWidths[index], 12, 'FD');
      doc.text(textLines(column.label, index), x + 3, y + 4.5, {lineHeightFactor: 1.15});
      x += columnWidths[index];
    });
    y += 12;
  };

  const beginPage = (continuation: boolean, withTable: boolean) => {
    doc.addPage();
    drawReportPdfWatermark(doc, width, height, brand.watermark, watermark);
    y = drawReportPdfHeader({
      doc, pageWidth: width, margin, orientation: 'landscape',
      settings: brand.header, company: brand.company, logo,
      title: continuation ? 'Resumo da cotação · continuação' : 'Resumo da cotação',
    }) + 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(43, 76, 53);
    const title = doc.splitTextToSize(snapshot.title, contentWidth) as string[];
    doc.text(title, margin, y, {lineHeightFactor: 1.15});
    y += title.length * 3.8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    const metadata = doc.splitTextToSize(
      `${snapshot.number || 'Sem número'} · ${dateLabel(snapshot.requestDate)} · Solicitante: ${snapshot.requester}`,
      contentWidth,
    ) as string[];
    doc.text(metadata, margin, y, {lineHeightFactor: 1.15});
    y += metadata.length * 3.4 + 5;
    if (!continuation) {
      const metrics = [
        ['MATERIAIS NA COTAÇÃO', String(snapshot.items.length)],
        ['MATERIAIS APROVADOS', String(snapshot.awardedItemCount)],
        ['FORNECEDORES', String(snapshot.providers.length)],
        ['TOTAL APROVADO LÍQUIDO', moneyLabel(snapshot.awardedTotal)],
      ];
      const cardWidth = (contentWidth - 9) / 4;
      metrics.forEach(([label, value], index) => {
        const x = margin + index * (cardWidth + 3);
        doc.setFillColor(237, 246, 240);
        doc.setDrawColor(194, 211, 200);
        doc.roundedRect(x, y, cardWidth, 19, 1.5, 1.5, 'FD');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6);
        doc.setTextColor(86, 112, 95);
        doc.text(label, x + 3, y + 5);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(26, 112, 63);
        doc.text(value, x + 3, y + 13.5);
      });
      y += 24;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(100, 118, 106);
      doc.text('Resumo das aprovações registradas até esta emissão. Os materiais são contados por item da cotação.', margin, y);
      y += 5;
    }
    if (withTable) tableHeader();
  };

  beginPage(false, true);
  snapshot.providers.forEach((provider, index) => {
    const terms = snapshot.providerTerms?.[provider.id];
    const blank = '____________________';
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    const cells = [
      textLines(provider.providerName, 0),
      textLines(String(provider.quotedItemCount ?? 0), 1),
      textLines(String(provider.awardedItemCount ?? 0), 2),
      textLines(moneyLabel(provider.awardedGrossTotal ?? provider.awardedTotal ?? '0'), 3),
      textLines(moneyLabel(provider.awardedTotal ?? '0'), 4),
      [
        ...textLines(terms?.paymentTerms.trim() || blank, 5),
        ...textLines(`Validade: ${terms?.proposalValidity.trim() || blank}`, 5),
      ],
      textLines(terms?.deliveryTime.trim() || blank, 6),
    ];
    const rowHeight = Math.max(18, Math.max(...cells.map(lines => lines.length)) * 3.4 + 6);
    if (y + rowHeight > bottom) beginPage(true, true);
    let x = margin;
    cells.forEach((lines, column) => {
      doc.setFillColor(...(index % 2 === 0 ? [249, 251, 249] : [255, 255, 255]) as [number, number, number]);
      doc.setDrawColor(205, 217, 209);
      doc.rect(x, y, columnWidths[column], rowHeight, 'FD');
      doc.setFont('helvetica', column === 0 || column === 4 ? 'bold' : 'normal');
      doc.setFontSize(7);
      doc.setTextColor(43, 76, 53);
      doc.text(lines, x + 3, y + 5, {lineHeightFactor: 1.35});
      x += columnWidths[column];
    });
    y += rowHeight;
  });

  const notes = snapshot.closingNotes?.trim() ?? '';
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const noteLines = notes ? doc.splitTextToSize(notes, contentWidth - 6) as string[] : [];
  const drawNotesHeading = () => {
    if (y + 20 > bottom) beginPage(true, false);
    y += 7;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(43, 76, 53);
    doc.text('OBSERVAÇÕES FINAIS', margin, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
  };
  drawNotesHeading();
  if (!noteLines.length) {
    doc.setDrawColor(194, 211, 200);
    doc.line(margin, y + 2, width - margin, y + 2);
    doc.line(margin, y + 9, width - margin, y + 9);
  } else {
    for (const line of noteLines) {
      if (y + 4 > bottom - 20) {beginPage(true, false); drawNotesHeading();}
      doc.text(line, margin + 2, y);
      y += 3.8;
    }
  }
  if (!noteLines.length) y += 9;
  if (y + 8 > bottom - 9) beginPage(true, false);
  const signatureWidth = Math.min(130, contentWidth);
  const signatureX = (width - signatureWidth) / 2;
  const signatureY = bottom - 9;
  doc.setDrawColor(86, 112, 95);
  doc.line(signatureX, signatureY, signatureX + signatureWidth, signatureY);
  doc.setTextColor(43, 76, 53);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setFontSize(6.5);
  doc.text('Assinatura', width / 2, signatureY + 5, {align: 'center'});
}
