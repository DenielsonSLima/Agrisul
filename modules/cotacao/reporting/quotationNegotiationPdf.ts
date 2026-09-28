import {
  drawReportPdfHeader,
  drawReportPdfWatermark,
  REPORT_MARGIN_MM,
  type ReportPdfBrand,
  type ReportPdfImage,
} from '@/shared/reporting';
import {loadReportImage} from '@/shared/reporting/loadReportImage';
import {dateLabel, moneyLabel} from '@/shared/utils/presentation';
import type {jsPDF as JsPdf} from 'jspdf';
import type {Quote, QuoteItem, QuoteOffer, QuoteProvider} from '../types';

export type QuotationNegotiationItem = QuoteItem & {
  materialImageUrl: string | null;
};

export type QuotationNegotiationSnapshot = {
  title: string;
  number: string;
  requestDate: string;
  requester: string;
  items: QuotationNegotiationItem[];
  providers: QuoteProvider[];
  approvedProviderByItem: Record<string, string>;
  awardedItemCount: number;
  awardedGrossTotal: string;
  awardedTotal: string;
};

const MATERIAL_COLUMN_WIDTH = 62;
const MIN_PROVIDER_COLUMN_WIDTH = 42;
const TABLE_HEADER_HEIGHT = 14;
const ITEM_ROW_HEIGHT = 15.5;
const TOTALS_ROW_HEIGHT = 32;
const GENERAL_TOTALS_HEIGHT = 17;

const safeFilePart = (value: string, maxLength = 80) => {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, maxLength)
    .replace(/-$/g, '');
  return normalized || 'cotacao';
};

function limitedLines(doc: JsPdf, value: string, width: number, limit: number) {
  const lines = doc.splitTextToSize(value, Math.max(width, 1)) as string[];
  if (lines.length <= limit) return lines;
  const visible = lines.slice(0, limit);
  const last = visible[limit - 1]?.replace(/[.\s]+$/, '') ?? '';
  visible[limit - 1] = `${last}...`;
  return visible;
}

function discountLabel(offer: QuoteOffer) {
  if (offer.discountType === 'percentage') {
    return `Desc. ${offer.discountValue.replace('.', ',')}%`;
  }
  if (offer.discountType === 'amount') return `Desc. ${moneyLabel(offer.discountValue)}`;
  return 'Sem desconto';
}

async function loadItemImages(items: QuotationNegotiationItem[]) {
  const byUrl = new Map<string, ReportPdfImage | null>();
  const urls = [...new Set(items
    .map(item => item.materialImageUrl)
    .filter((url): url is string => Boolean(url)))];

  for (let index = 0; index < urls.length; index += 4) {
    const batch = urls.slice(index, index + 4);
    const images = await Promise.all(batch.map(async url => {
      try {
        return await loadReportImage(url, {maxWidth: 240, maxHeight: 240, quality: .82});
      } catch {
        return null;
      }
    }));
    batch.forEach((url, batchIndex) => byUrl.set(url, images[batchIndex] ?? null));
  }

  return new Map(items.map(item => [
    item.id,
    item.materialImageUrl ? byUrl.get(item.materialImageUrl) ?? null : null,
  ]));
}

/**
 * Freezes the server projection used on the negotiation screen for PDF export.
 * Monetary values are copied verbatim; the browser does not recalculate totals.
 */
export function createQuotationNegotiationSnapshot(
  quote: Quote,
  materialImages: ReadonlyMap<string, string | null>,
): QuotationNegotiationSnapshot {
  return {
    title: quote.title,
    number: quote.number,
    requestDate: quote.requestDate,
    requester: quote.requester,
    items: quote.items.map(item => ({
      ...item,
      materialReferences: item.materialReferences.map(reference => ({...reference})),
      materialImageUrl: materialImages.get(item.materialId) ?? item.materialImageUrl ?? null,
    })),
    providers: quote.providers.map(provider => ({
      ...provider,
      values: {...provider.values},
      offers: provider.offers
        ? Object.fromEntries(Object.entries(provider.offers).map(([itemId, offer]) => [
          itemId,
          {...offer},
        ]))
        : undefined,
    })),
    approvedProviderByItem: Object.fromEntries(
      (quote.itemAwards ?? []).map(award => [award.itemId, award.providerId]),
    ),
    awardedItemCount: quote.awardedItemCount,
    awardedGrossTotal: quote.awardedGrossTotal,
    awardedTotal: quote.awardedTotal,
  };
}

export async function createQuotationNegotiationPdf(
  snapshot: QuotationNegotiationSnapshot,
  brand: ReportPdfBrand,
) {
  const {jsPDF} = await import('@/shared/reporting/jsPdfRuntime');
  const doc = new jsPDF({orientation: 'landscape', unit: 'mm', format: 'a4', compress: true});
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = REPORT_MARGIN_MM;
  const contentWidth = width - margin * 2;
  const bottom = height - margin - 9;
  const providersPerGroup = Math.max(
    1,
    Math.floor((contentWidth - MATERIAL_COLUMN_WIDTH) / MIN_PROVIDER_COLUMN_WIDTH),
  );
  const providerGroups = Array.from(
    {length: Math.max(1, Math.ceil(snapshot.providers.length / providersPerGroup))},
    (_, index) => snapshot.providers.slice(
      index * providersPerGroup,
      (index + 1) * providersPerGroup,
    ),
  );
  const [logo, watermark, images] = await Promise.all([
    loadReportImage(brand.company?.logoUrl ?? null),
    loadReportImage(brand.watermark.imageUrl),
    loadItemImages(snapshot.items),
  ]);
  let hasPage = false;
  let y = 0;

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

  const drawMetadata = (groupIndex: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(52, 76, 59);
    doc.text(limitedLines(doc, snapshot.title, contentWidth * .5, 1)[0] ?? '', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(112, 128, 117);
    const groupLabel = providerGroups.length > 1
      ? ` · fornecedores ${groupIndex * providersPerGroup + 1}-${groupIndex * providersPerGroup + providerGroups[groupIndex].length} de ${snapshot.providers.length}`
      : ` · ${snapshot.providers.length} fornecedor(es)`;
    doc.text(
      `${snapshot.number || 'Sem número'} · ${dateLabel(snapshot.requestDate)} · ${snapshot.requester}${groupLabel}`,
      width - margin,
      y,
      {align: 'right'},
    );
    y += 5;
  };

  const drawTableHeader = (providers: QuoteProvider[]) => {
    const providerWidth = (contentWidth - MATERIAL_COLUMN_WIDTH) / providers.length;
    const top = y;
    doc.setFillColor(229, 239, 232);
    doc.setDrawColor(194, 211, 200);
    doc.rect(margin, top, contentWidth, TABLE_HEADER_HEIGHT, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.7);
    doc.setTextColor(48, 78, 57);
    doc.text('MATERIAL', margin + 3, top + 8);
    let x = margin + MATERIAL_COLUMN_WIDTH;
    providers.forEach((provider, index) => {
      doc.line(x, top, x, top + TABLE_HEADER_HEIGHT);
      doc.setFontSize(5.3);
      doc.setTextColor(102, 121, 108);
      doc.text(`FORNECEDOR ${index + 1}`, x + providerWidth / 2, top + 3.4, {align: 'center'});
      doc.setFontSize(7.1);
      doc.setTextColor(43, 76, 53);
      const lines = limitedLines(doc, provider.providerName, providerWidth - 5, 2);
      doc.text(lines, x + providerWidth / 2, top + 7.4, {align: 'center', lineHeightFactor: 1.05});
      x += providerWidth;
    });
    y += TABLE_HEADER_HEIGHT;
    return providerWidth;
  };

  const beginPage = (providers: QuoteProvider[], groupIndex: number, continuation: boolean) => {
    if (hasPage) doc.addPage();
    hasPage = true;
    drawReportPdfWatermark(doc, width, height, brand.watermark, watermark);
    y = drawReportPdfHeader({
      doc,
      pageWidth: width,
      margin,
      orientation: 'landscape',
      settings: brand.header,
      company: brand.company,
      logo,
      title: continuation ? 'Mapa de negociação · continuação' : 'Mapa de negociação',
    }) + 6;
    drawMetadata(groupIndex);
    return drawTableHeader(providers);
  };

  const drawMaterial = (item: QuotationNegotiationItem, rowTop: number, rowIndex: number) => {
    if (rowIndex % 2 === 0) {
      doc.setFillColor(249, 251, 249);
      doc.rect(margin, rowTop, MATERIAL_COLUMN_WIDTH, ITEM_ROW_HEIGHT, 'F');
    }
    const image = images.get(item.id) ?? null;
    const imageBox = 10.5;
    const imageX = margin + 2;
    const imageY = rowTop + (ITEM_ROW_HEIGHT - imageBox) / 2;
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(225, 232, 227);
    doc.roundedRect(imageX, imageY, imageBox, imageBox, 1, 1, 'FD');
    if (image) {
      drawContainedImage(image, imageX + .7, imageY + .7, imageBox - 1.4, imageBox - 1.4);
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(4.2);
      doc.setTextColor(155, 167, 159);
      doc.text('SEM FOTO', imageX + imageBox / 2, imageY + imageBox / 2 + .8, {align: 'center'});
    }
    const copyX = imageX + imageBox + 2;
    const copyWidth = MATERIAL_COLUMN_WIDTH - imageBox - 8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(43, 70, 51);
    doc.text(limitedLines(doc, item.materialName, copyWidth, 2), copyX, rowTop + 3.8, {lineHeightFactor: 1.03});
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(4.8);
    doc.setTextColor(100, 118, 106);
    const references = item.materialReferences
      .map(reference => [reference.brand, reference.code].filter(Boolean).join(' '))
      .filter(Boolean)
      .join(' · ');
    if (references) {
      doc.text(limitedLines(doc, references, copyWidth, 1)[0] ?? '', copyX, rowTop + 10.4);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.3);
    doc.setTextColor(55, 100, 68);
    doc.text(`${item.quantity} ${item.unit}`.trim(), copyX, rowTop + 14.1);
  };

  const drawOffer = (
    item: QuotationNegotiationItem,
    provider: QuoteProvider,
    x: number,
    rowTop: number,
    providerWidth: number,
  ) => {
    const offer = provider.offers?.[item.id];
    const currentPrice = provider.values[item.id] ?? '';
    const approved = snapshot.approvedProviderByItem[item.id] === provider.id;
    if (approved) {
      doc.setFillColor(232, 247, 237);
      doc.rect(x, rowTop, providerWidth, ITEM_ROW_HEIGHT, 'F');
      doc.setFillColor(39, 126, 75);
      doc.roundedRect(x + providerWidth - 15.5, rowTop + 1, 13.5, 3.4, 1.1, 1.1, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(4.1);
      doc.setTextColor(255, 255, 255);
      doc.text('APROVADO', x + providerWidth - 8.75, rowTop + 3.35, {align: 'center'});
    }
    if (!offer && !currentPrice) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.2);
      doc.setTextColor(139, 153, 144);
      doc.text('Sem preço informado', x + providerWidth / 2, rowTop + 8.8, {align: 'center'});
      return;
    }

    const inset = 3;
    const discounted = Boolean(offer && offer.discountType !== 'none');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(32, 111, 65);
    doc.text(
      moneyLabel(discounted ? offer?.netUnitPrice : offer?.unitPrice ?? currentPrice),
      x + inset,
      rowTop + 4.9,
    );
    if (discounted && offer) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(4.8);
      doc.setTextColor(117, 132, 122);
      const grossLabel = `Bruto ${moneyLabel(offer.unitPrice)}`;
      doc.text(grossLabel, x + inset, rowTop + 7.9);
      doc.setDrawColor(117, 132, 122);
      doc.line(
        x + inset,
        rowTop + 6.6,
        Math.min(x + providerWidth - inset, x + inset + doc.getTextWidth(grossLabel)),
        rowTop + 6.6,
      );
      doc.setFontSize(4.7);
      doc.text(
        limitedLines(
          doc,
          `${discountLabel(offer)} · -${moneyLabel(offer.discountAmount)}`,
          providerWidth - inset * 2,
          1,
        )[0] ?? '',
        x + inset,
        rowTop + 10.9,
      );
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(4.8);
      doc.setTextColor(117, 132, 122);
      doc.text('Sem desconto', x + inset, rowTop + 9.3);
    }
    if (offer) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.3);
      doc.setTextColor(54, 87, 63);
      doc.text(`Total ${moneyLabel(offer.lineTotal)}`, x + inset, rowTop + 14.1);
    }
  };

  const drawItemRow = (
    item: QuotationNegotiationItem,
    rowIndex: number,
    providers: QuoteProvider[],
    providerWidth: number,
  ) => {
    const rowTop = y;
    drawMaterial(item, rowTop, rowIndex);
    let x = margin + MATERIAL_COLUMN_WIDTH;
    providers.forEach(provider => {
      drawOffer(item, provider, x, rowTop, providerWidth);
      x += providerWidth;
    });
    doc.setDrawColor(205, 217, 209);
    doc.setLineWidth(.18);
    doc.rect(margin, rowTop, contentWidth, ITEM_ROW_HEIGHT);
    doc.line(margin + MATERIAL_COLUMN_WIDTH, rowTop, margin + MATERIAL_COLUMN_WIDTH, rowTop + ITEM_ROW_HEIGHT);
    x = margin + MATERIAL_COLUMN_WIDTH;
    providers.slice(0, -1).forEach(() => {
      x += providerWidth;
      doc.line(x, rowTop, x, rowTop + ITEM_ROW_HEIGHT);
    });
    y += ITEM_ROW_HEIGHT;
  };

  const drawProviderTotals = (providers: QuoteProvider[], providerWidth: number) => {
    const top = y;
    doc.setFillColor(237, 246, 240);
    doc.setDrawColor(194, 211, 200);
    doc.rect(margin, top, contentWidth, TOTALS_ROW_HEIGHT, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.4);
    doc.setTextColor(43, 75, 53);
    doc.text('TOTAIS POR FORNECEDOR', margin + 3, top + 8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.6);
    doc.setTextColor(99, 119, 105);
    doc.text('Valores calculados no cadastro da cotação', margin + 3, top + 13);
    let x = margin + MATERIAL_COLUMN_WIDTH;
    providers.forEach(provider => {
      doc.line(x, top, x, top + TOTALS_ROW_HEIGHT);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.8);
      doc.setTextColor(48, 101, 65);
      doc.text(
        `${provider.awardedItemCount ?? 0} de ${snapshot.items.length} itens aprovados`,
        x + 2.5,
        top + 4.5,
      );
      const rows = [
        ['Valor total', provider.grossTotal ?? provider.total ?? '0'],
        ['Total com desconto', provider.total ?? '0'],
        ['Valor aprovado', provider.awardedGrossTotal ?? provider.awardedTotal ?? '0'],
        ['Total aprovado com desconto', provider.awardedTotal ?? '0'],
      ] as const;
      rows.forEach(([label, value], index) => {
        const lineY = top + 9.5 + index * 6;
        if (index === 3) {
          doc.setFillColor(218, 240, 225);
          doc.roundedRect(x + 1.5, lineY - 4.2, providerWidth - 3, 5.7, 1, 1, 'F');
        }
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(index >= 2 ? 5.7 : 5.4);
        doc.setTextColor(index === 3 ? 42 : 88, index === 3 ? 105 : 112, index === 3 ? 61 : 96);
        doc.text(label, x + 2.5, lineY);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(index === 3 ? 7.8 : index === 2 ? 6.8 : 6.4);
        doc.setTextColor(index === 3 ? 22 : 43, index === 3 ? 115 : 82, index === 3 ? 64 : 56);
        doc.text(moneyLabel(value), x + providerWidth - 2.5, lineY, {align: 'right'});
      });
      x += providerWidth;
    });
    y += TOTALS_ROW_HEIGHT;
  };

  const drawGeneralTotals = () => {
    const top = y + 4;
    doc.setFillColor(226, 244, 232);
    doc.setDrawColor(154, 203, 171);
    doc.roundedRect(margin, top, contentWidth, GENERAL_TOTALS_HEIGHT, 2, 2, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    doc.setTextColor(77, 111, 88);
    doc.text('VALOR GERAL APROVADO', margin + 4, top + 5.2);
    doc.text('VALOR GERAL APROVADO COM DESCONTO', margin + 67, top + 5.2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.2);
    doc.setTextColor(26, 112, 63);
    doc.text(moneyLabel(snapshot.awardedGrossTotal), margin + 4, top + 12.7);
    doc.text(moneyLabel(snapshot.awardedTotal), margin + 67, top + 12.7);
    doc.setFontSize(7);
    doc.text(
      `${snapshot.awardedItemCount} de ${snapshot.items.length} itens aprovados`,
      width - margin - 4,
      top + 10.2,
      {align: 'right'},
    );
    y = top + GENERAL_TOTALS_HEIGHT;
  };

  providerGroups.forEach((providers, groupIndex) => {
    let providerWidth = beginPage(providers, groupIndex, groupIndex > 0);
    snapshot.items.forEach((item, rowIndex) => {
      if (y + ITEM_ROW_HEIGHT > bottom) {
        providerWidth = beginPage(providers, groupIndex, true);
      }
      drawItemRow(item, rowIndex, providers, providerWidth);
    });
    const isLastGroup = groupIndex === providerGroups.length - 1;
    const requiredHeight = TOTALS_ROW_HEIGHT + (isLastGroup ? GENERAL_TOTALS_HEIGHT + 7 : 0);
    if (y + requiredHeight > bottom) providerWidth = beginPage(providers, groupIndex, true);
    drawProviderTotals(providers, providerWidth);
    if (isLastGroup) drawGeneralTotals();
  });

  const pages = doc.getNumberOfPages();
  const issued = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(brand.issuedAt);
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(232, 237, 233);
    doc.line(margin, height - margin - 3, width - margin, height - margin - 3);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.3);
    doc.setTextColor(131, 147, 137);
    doc.text(`Emitido por ${brand.issuer.name} · ${issued}`, margin, height - margin);
    doc.text(`${page} / ${pages}`, width - margin, height - margin, {align: 'right'});
  }

  return {
    doc,
    fileName: `negociacao-${safeFilePart(
      snapshot.providers.map(provider => provider.providerName).join('-') || 'todos-fornecedores',
      96,
    )}-${safeFilePart(snapshot.title, 72)}-${safeFilePart(snapshot.number, 32)}.pdf`,
  };
}
