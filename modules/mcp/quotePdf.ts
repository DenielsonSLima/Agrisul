import {createHash} from 'node:crypto';
import {jsPDF} from 'jspdf';

export type McpQuotationPdfImage = {
  bytes: Uint8Array;
  format: 'JPEG' | 'PNG';
  width: number;
  height: number;
};

export type McpQuotationPdfItem = {
  materialName: string;
  materialCode: string;
  quantity: string | number;
  unit: string;
  materialReferences?: {brand?: string | null; code: string}[];
  image?: McpQuotationPdfImage;
};

export type McpQuotationPdfInput = {
  title: string;
  number: string;
  requestDate: string;
  requester: string;
  notes: string;
  items: McpQuotationPdfItem[];
};

type McpQuotationPdfOptions = {
  companyName?: string;
};

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 16;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_Y = PAGE_HEIGHT - 10;
const CONTENT_BOTTOM = PAGE_HEIGHT - 20;

function plainText(value: string | number | null | undefined): string {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
}

function dateLabel(value: string): string {
  const trimmed = plainText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(trimmed);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : trimmed;
}

function referenceLabel(item: McpQuotationPdfItem): string {
  const references = (item.materialReferences ?? [])
    .map(reference => [plainText(reference.brand), plainText(reference.code)].filter(Boolean).join(' '))
    .filter(Boolean);
  return references.length ? `Referências: ${references.join(' | ')}` : '';
}

function validImage(image: McpQuotationPdfImage | undefined): image is McpQuotationPdfImage {
  return Boolean(
    image
    && image.bytes instanceof Uint8Array
    && image.bytes.byteLength > 0
    && image.bytes.byteLength <= 2_000_000
    && (image.format === 'JPEG' || image.format === 'PNG')
    && Number.isFinite(image.width)
    && Number.isFinite(image.height)
    && image.width > 0
    && image.height > 0
    && image.width <= 4096
    && image.height <= 4096,
  );
}

/** Renders a quotation snapshot supplied by the authenticated MCP flow. No network or DOM APIs are used. */
export async function createMcpQuotationPdf(
  quote: McpQuotationPdfInput,
  options: McpQuotationPdfOptions = {},
): Promise<Uint8Array> {
  const doc = new jsPDF({orientation: 'portrait', unit: 'mm', format: 'a4', compress: false});
  const date = /^\d{4}-\d{2}-\d{2}$/.test(quote.requestDate)
    ? new Date(`${quote.requestDate}T12:00:00.000Z`) : new Date('2000-01-01T12:00:00.000Z');
  doc.setCreationDate(Number.isNaN(date.getTime()) ? new Date('2000-01-01T12:00:00.000Z') : date);
  doc.setFileId(createHash('sha256').update(JSON.stringify({
    title: quote.title, number: quote.number, date: quote.requestDate,
    requester: quote.requester, itemCount: quote.items.length,
  })).digest('hex').slice(0, 32).toUpperCase());
  let y = MARGIN;

  const drawHeader = (continuation: boolean, section: 'Itens' | 'Observações' = 'Itens') => {
    y = MARGIN;
    const company = plainText(options.companyName);
    if (company) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(45, 100, 63);
      doc.text(doc.splitTextToSize(company, CONTENT_WIDTH), MARGIN, y);
      y += 8;
    }

    doc.setFillColor(45, 111, 67);
    doc.rect(MARGIN, y, CONTENT_WIDTH, 1.2, 'F');
    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.setTextColor(35, 66, 43);
    doc.text(continuation ? 'Cotação - continuação' : 'Cotação', MARGIN, y);
    y += 8;

    if (!continuation) {
      const title = plainText(quote.title);
      if (title) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(56, 72, 60);
        const lines = doc.splitTextToSize(title, CONTENT_WIDTH) as string[];
        doc.text(lines, MARGIN, y);
        y += Math.max(6, lines.length * 4.5 + 2);
      }

      doc.setFontSize(8);
      doc.setTextColor(88, 102, 91);
      const metadata = [
        ['Número', plainText(quote.number)],
        ['Data', dateLabel(quote.requestDate)],
        ['Solicitante', plainText(quote.requester)],
      ];
      for (const [label, value] of metadata) {
        if (!value) continue;
        doc.setFont('helvetica', 'bold');
        doc.text(`${label}:`, MARGIN, y);
        doc.setFont('helvetica', 'normal');
        const lines = doc.splitTextToSize(value, CONTENT_WIDTH - 30) as string[];
        doc.text(lines, MARGIN + 30, y);
        y += Math.max(5, lines.length * 4);
      }
      y += 4;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(35, 66, 43);
    doc.text(section, MARGIN, y);
    y += 6;
  };

  const nextPage = (section: 'Itens' | 'Observações' = 'Itens') => {
    doc.addPage();
    drawHeader(true, section);
  };

  drawHeader(false);

  if (quote.items.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(88, 102, 91);
    doc.text('Nenhum item cadastrado.', MARGIN, y + 4);
    y += 12;
  }

  for (const [index, item] of quote.items.entries()) {
    const name = plainText(item.materialName);
    const code = plainText(item.materialCode);
    const quantity = `${plainText(item.quantity)} ${plainText(item.unit)}`.trim();
    const references = referenceLabel(item);
    const itemTextX = MARGIN + 27;
    const itemTextWidth = CONTENT_WIDTH - 65;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    const nameLines = doc.splitTextToSize(name, itemTextWidth) as string[];
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    const codeLines = code ? doc.splitTextToSize(`Código: ${code}`, itemTextWidth) as string[] : [];
    const referenceLines = references ? doc.splitTextToSize(references, itemTextWidth) as string[] : [];
    let nextReferenceLine = 0;
    let continuation = false;
    while (true) {
      const segmentNameLines = continuation
        ? doc.splitTextToSize(`${name} (continuação)`, itemTextWidth) as string[]
        : nameLines;
      const segmentCodeLines = continuation ? [] : codeLines;
      const baseHeight = 8 + segmentNameLines.length * 4.2 + segmentCodeLines.length * 3.7 + 4;
      if (y + Math.max(26, baseHeight) > CONTENT_BOTTOM) nextPage();
      const available = CONTENT_BOTTOM - y;
      const referenceCount = Math.max(0, Math.floor((available - baseHeight) / 3.7));
      const segmentReferences = referenceLines.slice(nextReferenceLine, nextReferenceLine + referenceCount);
      const rowHeight = Math.max(26, baseHeight + segmentReferences.length * 3.7);

      doc.setDrawColor(220, 230, 222);
      doc.setFillColor(index % 2 === 0 ? 250 : 255, index % 2 === 0 ? 252 : 255, index % 2 === 0 ? 250 : 255);
      doc.roundedRect(MARGIN, y, CONTENT_WIDTH, rowHeight - 2, 1.5, 1.5, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(54, 97, 65);
      doc.text(`${String(index + 1).padStart(2, '0')}${continuation ? ' cont.' : ''}`, MARGIN + 3, y + 6);

      if (!continuation && validImage(item.image)) {
        const maxEdge = 19;
        const scale = Math.min(maxEdge / item.image.width, maxEdge / item.image.height);
        const imageWidth = item.image.width * scale;
        const imageHeight = item.image.height * scale;
        try {
          doc.addImage({
            imageData: item.image.bytes,
            format: item.image.format,
            x: MARGIN + 6 + (maxEdge - imageWidth) / 2,
            y: y + 3 + (maxEdge - imageHeight) / 2,
            width: imageWidth,
            height: imageHeight,
          });
        } catch {
          // A rejected or damaged image does not hide the item from the quotation.
        }
      }

      let itemY = y + 6;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(40, 58, 44);
      doc.text(segmentNameLines, itemTextX, itemY);
      itemY += segmentNameLines.length * 4.2;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(91, 104, 94);
      if (segmentCodeLines.length) {
        doc.text(segmentCodeLines, itemTextX, itemY);
        itemY += segmentCodeLines.length * 3.7;
      }
      if (segmentReferences.length) doc.text(segmentReferences, itemTextX, itemY);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(40, 70, 47);
      doc.text(quantity, PAGE_WIDTH - MARGIN - 4, y + 6, {align: 'right'});
      y += rowHeight;
      nextReferenceLine += segmentReferences.length;
      if (nextReferenceLine >= referenceLines.length) break;
      continuation = true;
      nextPage();
    }
  }

  const notes = plainText(quote.notes);
  if (notes) {
    if (y + 15 > CONTENT_BOTTOM) {
      nextPage('Observações');
    } else {
      y += 4;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(35, 66, 43);
      doc.text('Observações', MARGIN, y);
      y += 5;
    }
    const setNotesStyle = () => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(63, 78, 67);
    };
    setNotesStyle();
    for (const line of doc.splitTextToSize(notes, CONTENT_WIDTH) as string[]) {
      if (y + 4 > CONTENT_BOTTOM) {
        nextPage('Observações');
        setNotesStyle();
      }
      doc.text(line, MARGIN, y);
      y += 4;
    }
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(221, 229, 222);
    doc.line(MARGIN, FOOTER_Y - 7, PAGE_WIDTH - MARGIN, FOOTER_Y - 7);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(111, 124, 113);
    doc.text(`Página ${page} de ${pageCount}`, PAGE_WIDTH - MARGIN, FOOTER_Y, {align: 'right'});
  }

  return new Uint8Array(doc.output('arraybuffer'));
}
