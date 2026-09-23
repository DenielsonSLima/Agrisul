import {
  drawReportPdfHeader,
  drawReportPdfWatermark,
  formatReportCnpj,
  REPORT_MARGIN_MM,
  type ReportPdfBrand,
  type ReportPdfImage,
} from '@/shared/reporting';
import {loadReportImage} from '@/shared/reporting/loadReportImage';
import {dateLabel} from '@/shared/utils/presentation';
import type {jsPDF as JsPdf} from 'jspdf';
import type {QuoteItem, QuoteProvider} from '../types';

export type QuotationRequestItem = QuoteItem & {
  materialImageUrl?: string | null;
};

export type QuotationRequestSnapshot = {
  title: string;
  number: string;
  requestDate: string;
  notes: string;
  items: QuotationRequestItem[];
  provider: QuoteProvider;
};

const TABLE_COLUMNS = [
  {label: 'Foto', width: 24},
  {label: 'Produto', width: 49},
  {label: 'Qtd. solicitada', width: 18},
  {label: 'Qtd. disponível', width: 18},
  {label: 'Valor unitário', width: 19},
  {label: 'Desc. unitário', width: 17},
  {label: 'Desc. total', width: 18},
  {label: 'Valor total', width: 19},
] as const;

const TABLE_HEADER_HEIGHT = 11;
const ITEM_ROW_HEIGHT = 27;
const TOTALS_HEIGHT = 20;

const safeFilePart = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .toLowerCase() || 'prestador';

function providerDocumentLabel(provider: QuoteProvider) {
  const value = provider.providerDocument?.trim() ?? '';
  const digits = value.replace(/\D/g, '');
  const type = provider.providerDocumentType === 'CPF'
    || provider.providerDocumentType === 'CNPJ'
    ? provider.providerDocumentType
    : digits.length === 11 ? 'CPF' : 'CNPJ';

  if (!value) return `${type}: não informado`;
  if (type === 'CNPJ') return `CNPJ: ${formatReportCnpj(value)}`;

  const formatted = digits.length === 11
    ? digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
    : value;
  return `CPF: ${formatted}`;
}

function limitedLines(
  doc: JsPdf,
  value: string,
  width: number,
  limit: number,
) {
  const lines = doc.splitTextToSize(value, width) as string[];
  if (lines.length <= limit) return lines;
  const visible = lines.slice(0, limit);
  const last = visible[limit - 1]?.replace(/[.\s]+$/, '') ?? '';
  visible[limit - 1] = `${last}...`;
  return visible;
}

async function loadItemImages(items: QuotationRequestItem[]) {
  const byUrl = new Map<string, ReportPdfImage | null>();
  const urls = [...new Set(items.map(item => item.materialImageUrl).filter((url): url is string => Boolean(url)))];

  // Keep private signed image requests bounded when a quotation has many items.
  for (let index = 0; index < urls.length; index += 4) {
    const batch = urls.slice(index, index + 4);
    const images = await Promise.all(batch.map(async url => {
      try {
        return await loadReportImage(url);
      } catch {
        // A product photo must not prevent the supplier form from being exported.
        return null;
      }
    }));
    batch.forEach((url, batchIndex) => byUrl.set(url, images[batchIndex] ?? null));
  }

  return items.map(item => item.materialImageUrl ? byUrl.get(item.materialImageUrl) ?? null : null);
}

export async function createQuotationRequestPdf(
  snapshot: QuotationRequestSnapshot,
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
      title: continuation ? 'Solicitação de cotação · continuação' : 'Solicitação de cotação',
    }) + 7;
  };

  const documentLabel = providerDocumentLabel(snapshot.provider);
  let y = addHeader();

  const drawDocumentMetadata = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(72, 91, 78);
    doc.text(limitedLines(doc, snapshot.title, content * .46, 1)[0] ?? '', margin, y);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(121, 137, 126);
    doc.text(
      `Cotação ${snapshot.number || 'sem número'} · Emissão ${dateLabel(snapshot.requestDate)}`,
      width - margin,
      y,
      {align: 'right'},
    );
    y += 5;
  };

  const drawProviderPanel = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    const providerLines = limitedLines(doc, snapshot.provider.providerName, content - 12, 2);
    const panelHeight = providerLines.length > 1 ? 24 : 20;

    doc.setFillColor(242, 247, 243);
    doc.roundedRect(margin, y, content, panelHeight, 1.5, 1.5, 'F');
    doc.setFillColor(43, 124, 76);
    doc.roundedRect(margin, y, 1.5, panelHeight, .7, .7, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.3);
    doc.setTextColor(107, 127, 113);
    doc.text('FORNECEDOR DESTINATÁRIO', margin + 5, y + 4.7);

    doc.setFontSize(11.5);
    doc.setTextColor(38, 77, 50);
    doc.text(providerLines, margin + 5, y + 10, {lineHeightFactor: 1.1});

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.7);
    doc.setTextColor(91, 112, 98);
    doc.text(documentLabel, margin + 5, y + panelHeight - 3.5);
    y += panelHeight + 5;
  };

  const drawCompactProvider = () => {
    doc.setFillColor(246, 249, 247);
    doc.rect(margin, y, content, 9, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.3);
    doc.setTextColor(112, 129, 117);
    doc.text('FORNECEDOR', margin + 3, y + 3.4);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.7);
    doc.setTextColor(46, 78, 56);
    doc.text(
      limitedLines(doc, snapshot.provider.providerName, content - 67, 1)[0] ?? '',
      margin + 3,
      y + 6.7,
    );
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(98, 116, 104);
    doc.text(documentLabel, width - margin - 3, y + 5.7, {align: 'right'});
    y += 13;
  };

  const drawNotes = () => {
    if (!snapshot.notes.trim()) return;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    const noteLines = limitedLines(doc, snapshot.notes.trim(), content - 6, 4);
    const noteHeight = Math.max(10, noteLines.length * 3 + 6);
    doc.setDrawColor(221, 229, 223);
    doc.setFillColor(250, 251, 250);
    doc.roundedRect(margin, y, content, noteHeight, 1, 1, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.4);
    doc.setTextColor(105, 123, 111);
    doc.text('OBSERVAÇÕES DA COTAÇÃO', margin + 3, y + 3.7);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(70, 89, 77);
    doc.text(noteLines, margin + 3, y + 7.3, {lineHeightFactor: 1.15});
    y += noteHeight + 5;
  };

  const drawSectionTitle = (continuation = false) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(48, 75, 57);
    doc.text(
      continuation ? 'Itens para cotação · continuação' : 'Itens para cotação',
      margin,
      y,
    );
    y += 4;
  };

  const drawTableHeader = () => {
    doc.setFillColor(229, 239, 232);
    doc.setDrawColor(194, 211, 200);
    doc.rect(margin, y, content, TABLE_HEADER_HEIGHT, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.1);
    doc.setTextColor(48, 78, 57);

    let x = margin;
    TABLE_COLUMNS.forEach(column => {
      const lines = doc.splitTextToSize(column.label, column.width - 3) as string[];
      const lineStep = 2.7;
      const textY = y + (TABLE_HEADER_HEIGHT - lines.length * lineStep) / 2 + 2.2;
      doc.text(lines, x + column.width / 2, textY, {align: 'center', lineHeightFactor: 1.05});
      x += column.width;
      if (x < width - margin - .1) doc.line(x, y, x, y + TABLE_HEADER_HEIGHT);
    });
    y += TABLE_HEADER_HEIGHT;
  };

  const newTablePage = () => {
    doc.addPage();
    y = addHeader(true);
    drawCompactProvider();
    drawSectionTitle(true);
    drawTableHeader();
  };

  const drawContainedImage = (
    image: ReportPdfImage,
    x: number,
    top: number,
    boxWidth: number,
    boxHeight: number,
  ) => {
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

  const drawBlankField = (x: number, rowTop: number, columnWidth: number) => {
    doc.setDrawColor(139, 157, 145);
    doc.setLineWidth(.25);
    doc.line(x + 2.2, rowTop + ITEM_ROW_HEIGHT * .66, x + columnWidth - 2.2, rowTop + ITEM_ROW_HEIGHT * .66);
  };

  const drawItem = (item: QuotationRequestItem, index: number, image: ReportPdfImage | null) => {
    const rowTop = y;
    if (index % 2 === 0) {
      doc.setFillColor(249, 251, 249);
      doc.rect(margin, rowTop, content, ITEM_ROW_HEIGHT, 'F');
    }

    let x = margin;
    const photoWidth = TABLE_COLUMNS[0].width;
    doc.setFillColor(245, 248, 246);
    doc.roundedRect(x + 2, rowTop + 2, photoWidth - 4, ITEM_ROW_HEIGHT - 4, 1, 1, 'F');
    if (image) {
      drawContainedImage(image, x + 2.7, rowTop + 2.7, photoWidth - 5.4, ITEM_ROW_HEIGHT - 5.4);
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.6);
      doc.setTextColor(153, 165, 157);
      doc.text('SEM FOTO', x + photoWidth / 2, rowTop + ITEM_ROW_HEIGHT / 2 + 1, {align: 'center'});
    }
    x += photoWidth;

    const productWidth = TABLE_COLUMNS[1].width;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.6);
    doc.setTextColor(43, 70, 51);
    const nameLines = limitedLines(doc, `${index + 1}. ${item.materialName}`, productWidth - 5, 2);
    doc.text(nameLines, x + 2.5, rowTop + 5, {lineHeightFactor: 1.15});

    const references = item.materialReferences
      .map(reference => [reference.brand, reference.code].filter(Boolean).join(' '))
      .filter(Boolean)
      .join(' · ');
    const details = [
      item.materialCode && `Cód.: ${item.materialCode}`,
      references && `Ref.: ${references}`,
      item.materialApplication,
      item.notes,
    ].filter(Boolean).join(' · ');
    if (details) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.2);
      doc.setTextColor(100, 118, 106);
      const detailTop = rowTop + 5 + nameLines.length * 3.35;
      const detailLines = limitedLines(doc, details, productWidth - 5, 3);
      doc.text(detailLines, x + 2.5, detailTop, {lineHeightFactor: 1.15});
    }
    x += productWidth;

    const requestedWidth = TABLE_COLUMNS[2].width;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(48, 78, 57);
    doc.text(
      `${item.quantity} ${item.unit}`.trim(),
      x + requestedWidth / 2,
      rowTop + ITEM_ROW_HEIGHT / 2 + 1,
      {align: 'center'},
    );
    x += requestedWidth;

    TABLE_COLUMNS.slice(3).forEach(column => {
      drawBlankField(x, rowTop, column.width);
      x += column.width;
    });

    doc.setDrawColor(201, 215, 206);
    doc.setLineWidth(.2);
    doc.rect(margin, rowTop, content, ITEM_ROW_HEIGHT);
    x = margin;
    TABLE_COLUMNS.forEach(column => {
      x += column.width;
      if (x < width - margin - .1) doc.line(x, rowTop, x, rowTop + ITEM_ROW_HEIGHT);
    });
    y += ITEM_ROW_HEIGHT;
  };

  const drawTotals = () => {
    y += 4;
    const totalsWidth = 72;
    const labelWidth = 39;
    const valueWidth = totalsWidth - labelWidth;
    const totalsX = width - margin - totalsWidth;
    const rows = [
      {label: 'Subtotal', height: 9, fill: [247, 250, 248] as const},
      {label: 'Valor total', height: 11, fill: [229, 239, 232] as const},
    ];

    rows.forEach((row, index) => {
      doc.setFillColor(row.fill[0], row.fill[1], row.fill[2]);
      doc.setDrawColor(190, 208, 196);
      doc.rect(totalsX, y, totalsWidth, row.height, 'FD');
      doc.line(totalsX + labelWidth, y, totalsX + labelWidth, y + row.height);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(index ? 8.5 : 7.5);
      doc.setTextColor(43, 75, 53);
      doc.text(row.label, totalsX + labelWidth - 3, y + row.height / 2 + 1.1, {align: 'right'});
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(91, 112, 98);
      doc.text('R$', totalsX + labelWidth + 2.5, y + row.height / 2 + 1.1);
      doc.setDrawColor(116, 139, 123);
      doc.line(
        totalsX + labelWidth + 9,
        y + row.height / 2 + 1.4,
        totalsX + labelWidth + valueWidth - 2.5,
        y + row.height / 2 + 1.4,
      );
      y += row.height;
    });
  };

  drawDocumentMetadata();
  drawProviderPanel();
  drawNotes();

  const minimumTableSpace = 4 + TABLE_HEADER_HEIGHT + (snapshot.items.length ? ITEM_ROW_HEIGHT : 12);
  if (y + minimumTableSpace > bottom) {
    newTablePage();
  } else {
    drawSectionTitle();
    drawTableHeader();
  }

  if (snapshot.items.length) {
    snapshot.items.forEach((item, index) => {
      const keepTotalsWithLastItem = index === snapshot.items.length - 1 ? TOTALS_HEIGHT + 4 : 0;
      if (y + ITEM_ROW_HEIGHT + keepTotalsWithLastItem > bottom) newTablePage();
      drawItem(item, index, itemImages[index] ?? null);
    });
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(101, 119, 107);
    doc.text('Nenhum produto informado nesta cotação.', margin + 3, y + 7);
    y += 12;
  }

  if (y + TOTALS_HEIGHT + 4 > bottom) newTablePage();
  drawTotals();

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
    fileName: `cotacao-${safeFilePart(snapshot.number || snapshot.title)}-${safeFilePart(snapshot.provider.providerName)}.pdf`,
  };
}
