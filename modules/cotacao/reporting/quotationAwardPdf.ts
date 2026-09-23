import {
  drawReportPdfHeader,
  drawReportPdfWatermark,
  formatReportCnpj,
  REPORT_MARGIN_MM,
  type ReportPdfBrand,
  type ReportPdfImage,
} from '@/shared/reporting';
import {loadReportImage} from '@/shared/reporting/loadReportImage';
import {dateLabel, moneyLabel} from '@/shared/utils/presentation';
import type {jsPDF as JsPdf} from 'jspdf';
import type {Quote, QuoteItem, QuoteProvider} from '../types';

export type QuotationAwardItem = QuoteItem & {
  materialImageUrl?: string | null;
  unitPrice: string;
  lineTotal: string;
};

export type QuotationAwardSnapshot = {
  title: string;
  number: string;
  requestDate: string;
  notes: string;
  items: QuotationAwardItem[];
  provider: QuoteProvider;
  total: string;
};

const COLUMNS = [
  {label: 'Foto', width: 24},
  {label: 'Produto aprovado', width: 76},
  {label: 'Quantidade', width: 24},
  {label: 'Valor unitário', width: 27},
  {label: 'Valor total', width: 31},
] as const;
const HEADER_HEIGHT = 10;
const ROW_HEIGHT = 25;

const safeFilePart = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .toLowerCase() || 'fornecedor';

function providerDocumentLabel(provider: QuoteProvider) {
  const value = provider.providerDocument?.trim() ?? '';
  const digits = value.replace(/\D/g, '');
  const type = provider.providerDocumentType === 'CPF'
    || provider.providerDocumentType === 'CNPJ'
    ? provider.providerDocumentType
    : digits.length === 11 ? 'CPF' : 'CNPJ';
  if (!value) return `${type}: não informado`;
  if (type === 'CNPJ') return `CNPJ: ${formatReportCnpj(value)}`;
  return `CPF: ${digits.length === 11
    ? digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
    : value}`;
}

function limitedLines(doc: JsPdf, value: string, width: number, limit: number) {
  const lines = doc.splitTextToSize(value, width) as string[];
  if (lines.length <= limit) return lines;
  const visible = lines.slice(0, limit);
  const last = visible[limit - 1]?.replace(/[.\s]+$/, '') ?? '';
  visible[limit - 1] = `${last}...`;
  return visible;
}

async function loadItemImages(items: QuotationAwardItem[]) {
  const byUrl = new Map<string, ReportPdfImage | null>();
  const urls = [...new Set(items
    .map(item => item.materialImageUrl)
    .filter((url): url is string => Boolean(url)))];
  for (let index = 0; index < urls.length; index += 4) {
    const batch = urls.slice(index, index + 4);
    const images = await Promise.all(batch.map(async url => {
      try {
        return await loadReportImage(url);
      } catch {
        return null;
      }
    }));
    batch.forEach((url, batchIndex) => byUrl.set(url, images[batchIndex] ?? null));
  }
  return items.map(item => item.materialImageUrl
    ? byUrl.get(item.materialImageUrl) ?? null
    : null);
}

/**
 * Creates an immutable export snapshot from server-calculated awards.
 * Unit and line totals are never recalculated in the browser.
 */
export function createQuotationAwardSnapshot(
  quote: Quote,
  provider: QuoteProvider,
  materialImages: ReadonlyMap<string, string | null>,
): QuotationAwardSnapshot {
  const awards = new Map(
    (quote.itemAwards ?? [])
      .filter(award => award.providerId === provider.id)
      .map(award => [award.itemId, award] as const),
  );
  return {
    title: quote.title,
    number: quote.number,
    requestDate: quote.requestDate,
    notes: quote.notes,
    provider,
    total: provider.awardedTotal ?? '0',
    items: quote.items.flatMap(item => {
      const award = awards.get(item.id);
      return award ? [{
        ...item,
        materialImageUrl: materialImages.get(item.materialId) ?? null,
        unitPrice: award.unitPrice,
        lineTotal: award.lineTotal,
      }] : [];
    }),
  };
}

export async function createQuotationAwardPdf(
  snapshot: QuotationAwardSnapshot,
  brand: ReportPdfBrand,
) {
  const {jsPDF} = await import('@/shared/reporting/jsPdfRuntime');
  const doc = new jsPDF({orientation: 'portrait', unit: 'mm', format: 'a4', compress: true});
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = REPORT_MARGIN_MM;
  const content = width - margin * 2;
  const bottom = height - margin - 9;
  const [logo, watermark, itemImages] = await Promise.all([
    loadReportImage(brand.company?.logoUrl ?? null),
    loadReportImage(brand.watermark.imageUrl),
    loadItemImages(snapshot.items),
  ]);

  const addHeader = (continuation = false) => {
    drawReportPdfWatermark(doc, width, height, brand.watermark, watermark);
    return drawReportPdfHeader({
      doc,
      pageWidth: width,
      margin,
      orientation: 'portrait',
      settings: brand.header,
      company: brand.company,
      logo,
      title: continuation ? 'Resultado da cotação · continuação' : 'Resultado da cotação',
    }) + 7;
  };

  let y = addHeader();
  const documentLabel = providerDocumentLabel(snapshot.provider);

  const drawMetadata = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(72, 91, 78);
    doc.text(limitedLines(doc, snapshot.title, content * .5, 1)[0] ?? '', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(121, 137, 126);
    doc.text(
      `Cotação ${snapshot.number || 'sem número'} · ${dateLabel(snapshot.requestDate)}`,
      width - margin,
      y,
      {align: 'right'},
    );
    y += 5;
  };

  const drawProvider = (compact = false) => {
    const panelHeight = compact ? 12 : 20;
    doc.setFillColor(242, 247, 243);
    doc.roundedRect(margin, y, content, panelHeight, 1.5, 1.5, 'F');
    doc.setFillColor(43, 124, 76);
    doc.roundedRect(margin, y, 1.5, panelHeight, .7, .7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(compact ? 6 : 6.3);
    doc.setTextColor(107, 127, 113);
    doc.text('FORNECEDOR', margin + 5, y + 4.2);
    doc.setFontSize(compact ? 8 : 11);
    doc.setTextColor(38, 77, 50);
    doc.text(
      limitedLines(doc, snapshot.provider.providerName, content - 10, compact ? 1 : 2),
      margin + 5,
      y + (compact ? 8.2 : 9.8),
      {lineHeightFactor: 1.1},
    );
    if (!compact) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(91, 112, 98);
      doc.text(documentLabel, margin + 5, y + panelHeight - 3.3);
    }
    y += panelHeight + 5;
  };

  const drawSectionTitle = (continuation = false) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(48, 75, 57);
    doc.text(continuation ? 'Itens aprovados · continuação' : 'Itens aprovados', margin, y);
    y += 4;
  };

  const drawTableHeader = () => {
    doc.setFillColor(229, 239, 232);
    doc.setDrawColor(194, 211, 200);
    doc.rect(margin, y, content, HEADER_HEIGHT, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(48, 78, 57);
    let x = margin;
    COLUMNS.forEach(column => {
      const lines = doc.splitTextToSize(column.label, column.width - 3) as string[];
      doc.text(lines, x + column.width / 2, y + 4.2, {align: 'center', lineHeightFactor: 1.05});
      x += column.width;
      if (x < width - margin - .1) doc.line(x, y, x, y + HEADER_HEIGHT);
    });
    y += HEADER_HEIGHT;
  };

  const newPage = () => {
    doc.addPage();
    y = addHeader(true);
    drawProvider(true);
    drawSectionTitle(true);
    drawTableHeader();
  };

  const drawImage = (image: ReportPdfImage, x: number, top: number, boxWidth: number, boxHeight: number) => {
    let imageWidth = boxWidth;
    let imageHeight = imageWidth / image.ratio;
    if (imageHeight > boxHeight) {
      imageHeight = boxHeight;
      imageWidth = imageHeight * image.ratio;
    }
    doc.addImage(
      image.bytes,
      image.format,
      x + (boxWidth - imageWidth) / 2,
      top + (boxHeight - imageHeight) / 2,
      imageWidth,
      imageHeight,
      undefined,
      'FAST',
    );
  };

  const drawItem = (item: QuotationAwardItem, index: number, image: ReportPdfImage | null) => {
    const top = y;
    if (index % 2 === 0) {
      doc.setFillColor(249, 251, 249);
      doc.rect(margin, top, content, ROW_HEIGHT, 'F');
    }
    let x = margin;
    const photoWidth = COLUMNS[0].width;
    doc.setFillColor(245, 248, 246);
    doc.roundedRect(x + 2, top + 2, photoWidth - 4, ROW_HEIGHT - 4, 1, 1, 'F');
    if (image) drawImage(image, x + 2.7, top + 2.7, photoWidth - 5.4, ROW_HEIGHT - 5.4);
    else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.5);
      doc.setTextColor(153, 165, 157);
      doc.text('SEM FOTO', x + photoWidth / 2, top + ROW_HEIGHT / 2 + 1, {align: 'center'});
    }
    x += photoWidth;

    const productWidth = COLUMNS[1].width;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(43, 70, 51);
    const names = limitedLines(doc, `${index + 1}. ${item.materialName}`, productWidth - 5, 2);
    doc.text(names, x + 2.5, top + 5, {lineHeightFactor: 1.15});
    const references = item.materialReferences
      .map(reference => [reference.brand, reference.code].filter(Boolean).join(' '))
      .filter(Boolean)
      .join(' · ');
    const details = [
      item.materialCode && `Cód.: ${item.materialCode}`,
      references && `Ref.: ${references}`,
      item.notes,
    ].filter(Boolean).join(' · ');
    if (details) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.1);
      doc.setTextColor(100, 118, 106);
      doc.text(
        limitedLines(doc, details, productWidth - 5, 3),
        x + 2.5,
        top + 5 + names.length * 3.4,
        {lineHeightFactor: 1.15},
      );
    }
    x += productWidth;

    const cells = [
      `${item.quantity} ${item.unit}`.trim(),
      moneyLabel(item.unitPrice),
      moneyLabel(item.lineTotal),
    ];
    COLUMNS.slice(2).forEach((column, cellIndex) => {
      doc.setFont('helvetica', cellIndex === 2 ? 'bold' : 'normal');
      doc.setFontSize(cellIndex === 0 ? 7.1 : 6.8);
      doc.setTextColor(48, 78, 57);
      doc.text(cells[cellIndex], x + column.width / 2, top + ROW_HEIGHT / 2 + 1, {align: 'center'});
      x += column.width;
    });

    doc.setDrawColor(201, 215, 206);
    doc.setLineWidth(.2);
    doc.rect(margin, top, content, ROW_HEIGHT);
    x = margin;
    COLUMNS.forEach(column => {
      x += column.width;
      if (x < width - margin - .1) doc.line(x, top, x, top + ROW_HEIGHT);
    });
    y += ROW_HEIGHT;
  };

  const drawTotal = () => {
    y += 5;
    const boxWidth = 73;
    const boxX = width - margin - boxWidth;
    doc.setFillColor(225, 240, 230);
    doc.setDrawColor(177, 205, 186);
    doc.roundedRect(boxX, y, boxWidth, 14, 1.2, 1.2, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(92, 113, 99);
    doc.text('TOTAL APROVADO', boxX + 4, y + 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(33, 105, 62);
    doc.text(moneyLabel(snapshot.total), boxX + boxWidth - 4, y + 10.5, {align: 'right'});
    y += 18;
  };

  drawMetadata();
  drawProvider();
  drawSectionTitle();
  drawTableHeader();

  snapshot.items.forEach((item, index) => {
    if (y + ROW_HEIGHT + (index === snapshot.items.length - 1 ? 23 : 0) > bottom) newPage();
    drawItem(item, index, itemImages[index] ?? null);
  });
  if (y + 19 > bottom) newPage();
  drawTotal();

  if (snapshot.notes.trim() && y + 18 <= bottom) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(107, 127, 113);
    doc.text('OBSERVAÇÕES DA COTAÇÃO', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(70, 89, 77);
    doc.text(limitedLines(doc, snapshot.notes.trim(), content, 3), margin, y + 4, {lineHeightFactor: 1.15});
  }

  const pages = doc.getNumberOfPages();
  const issued = new Intl.DateTimeFormat('pt-BR', {dateStyle: 'short', timeStyle: 'short'}).format(brand.issuedAt);
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(232, 237, 233);
    doc.line(margin, height - margin - 3, width - margin, height - margin - 3);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(131, 147, 137);
    doc.text(`Emitido por ${brand.issuer.name} · ${issued}`, margin, height - margin);
    doc.text(`${page} / ${pages}`, width - margin, height - margin, {align: 'right'});
  }

  return {
    doc,
    fileName: `cotacao-aprovada-${safeFilePart(snapshot.number || snapshot.title)}-${safeFilePart(snapshot.provider.providerName)}.pdf`,
  };
}
