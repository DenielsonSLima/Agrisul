import type {jsPDF} from 'jspdf';
import {documentBlockText, documentSignatureLabel, pointsToMillimeters} from '@/modules/cadastro/modelos-documentos/presentation';
import type {DocumentBlock, DocumentLayout, DocumentPreviewData, DocumentSignatureRole} from '@/modules/cadastro/modelos-documentos/types';
import type {ReportPdfImage} from '@/shared/reporting/pdfHeader';
import {qrMatrix} from '@/shared/reporting/qrCode';
import {isStandardServiceRequestLayout, layoutWithReportHeader} from '@/modules/cadastro/modelos-documentos/reportHeaderLayout';

type Images = Partial<Record<DocumentSignatureRole, ReportPdfImage | null>>;
type Overflow = {label: string; text?: string; items?: DocumentPreviewData['items']; signature?: DocumentSignatureRole; verification?: boolean};
const fontNames = {sans: 'helvetica', serif: 'times', mono: 'courier'} as const;
const colors = {ink: '#183e2f', muted: '#61786b', border: '#dbe6df', paper: '#f6f9f7'};
const table = {leftRatio: .62, paddingX: 2.5, paddingY: 1.8, header: 8, minRow: 9};

export function drawPdfQr(doc: jsPDF, url: string, x: number, y: number, size: number) {
  const matrix = qrMatrix(url), unit = size / (matrix.length + 8);
  doc.setFillColor(255, 255, 255); doc.rect(x, y, size, size, 'F');
  doc.setFillColor(0, 0, 0);
  matrix.forEach((row, rowIndex) => row.forEach((filled, column) => {
    if (filled) doc.rect(x + (column + 4) * unit, y + (rowIndex + 4) * unit, unit, unit, 'F');
  }));
  doc.link(x, y, size, size, {url});
}

/** Same physical millimeter coordinates as the editor. Oversized data is continued, never discarded. */
export function renderDocumentPdf(doc: jsPDF, sourceLayout: DocumentLayout, data: DocumentPreviewData, images: Images = {}, drawPageBackground?: () => number | void) {
  const contentTop = drawPageBackground?.();
  const layout = typeof contentTop === 'number' ? layoutWithReportHeader(sourceLayout) : sourceLayout;
  if (isStandardServiceRequestLayout(layout)) {
    doc.setFillColor('#eaf2ed'); doc.roundedRect(14, 47, 182, 16, 1.5, 1.5, 'F');
    doc.setFillColor(colors.paper); doc.roundedRect(14, 161, 182, 20, 1.5, 1.5, 'F');
    doc.setDrawColor(colors.border); doc.setLineWidth(.2);
    doc.line(105, 164, 105, 178); doc.line(14, 203, 196, 203);
  }
  const overflow: Overflow[] = [];
  const setFont = (block: DocumentBlock, size = block.fontSize ?? 10) => {
    doc.setFont(fontNames[block.fontFamily ?? 'sans'], block.fontWeight ?? 'normal');
    doc.setFontSize(size); doc.setTextColor(colors.ink);
  };
  const continuationHint = (block: DocumentBlock) => {
    const size = 7, lineHeight = pointsToMillimeters(size) * 1.25, hint = 'Ver complemento.';
    setFont(block, size);
    if (block.height < lineHeight || doc.getTextWidth(hint) > block.width) return;
    doc.setTextColor(colors.muted); doc.text(hint, block.x, block.y + lineHeight * .8);
  };
  const text = (block: DocumentBlock, value: string, label: string) => {
    setFont(block);
    const lineHeight = pointsToMillimeters(block.fontSize ?? 10) * 1.25;
    const lines = doc.splitTextToSize(value, Math.max(1, block.width - 1)) as string[];
    const capacity = Math.max(0, Math.floor(block.height / lineHeight));
    if (capacity < 1 || (capacity === 1 && lines.length > 1) || lines.some(line => doc.getTextWidth(line) > block.width)) {
      overflow.push({label, text: value}); continuationHint(block); return;
    }
    const continued = lines.length > capacity;
    const hint = 'Ver complemento.';
    const showHint = continued && capacity > 0 && doc.getTextWidth(hint) <= block.width;
    const visibleCount = Math.max(0, capacity - (showHint ? 1 : 0));
    const visible = continued ? lines.slice(0, visibleCount) : lines;
    if (continued) {
      overflow.push({label, text: lines.slice(visibleCount).join('\n')});
      if (showHint) visible.push(hint);
    }
    const align = block.align ?? 'left';
    const x = block.x + (align === 'center' ? block.width / 2 : align === 'right' ? block.width : 0);
    visible.forEach((line, i) => doc.text(line, x, block.y + lineHeight * (i + .8), {align}));
  };

  const signature = (block: DocumentBlock, role: DocumentSignatureRole, allowOverflow: boolean) => {
    const entry = data.signatures[role] ?? {name: ''};
    const image = images[role];
    const nameSize = block.fontSize ?? 8;
    doc.setFont(fontNames[block.fontFamily ?? 'sans'], 'bold'); doc.setFontSize(7.5);
    const labelWidth = doc.getTextWidth(documentSignatureLabel(role));
    doc.setFontSize(nameSize);
    const names = doc.splitTextToSize(entry.name, Math.max(1, block.width - 2)) as string[];
    doc.setFont(fontNames[block.fontFamily ?? 'sans'], 'normal'); doc.setFontSize(6);
    const hashLines = entry.hash ? doc.splitTextToSize(`Hash do registro: ${entry.hash}`, Math.max(1, block.width - 2)) as string[] : [];
    const timestampLines = entry.timestamp ? doc.splitTextToSize(`${entry.timestamp} · Brasília`, Math.max(1, block.width - 2)) as string[] : [];
    const needed = 24 + names.length * pointsToMillimeters(nameSize) * 1.25 + timestampLines.length * 3 + hashLines.length * 2.6;
    if (allowOverflow && (block.width < Math.max(30, labelWidth + 2) || needed > block.height)) {
      continuationHint(block);
      overflow.push({label: documentSignatureLabel(role), signature: role}); return;
    }
    const center = block.x + block.width / 2;
    doc.setFont(fontNames[block.fontFamily ?? 'sans'], 'bold');
    doc.setTextColor(colors.muted); doc.setFontSize(7.5);
    doc.text(documentSignatureLabel(role), center, block.y + 3, {align: 'center'});
    if (image) {
      const width = Math.min(block.width - 6, 13 * image.ratio), height = width / image.ratio;
      doc.addImage(image.bytes, image.format, center - width / 2, block.y + 5 + (13 - height) / 2, width, height);
    } else {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(colors.muted);
      const hint = role === 'director' && data.fields.status === 'Pendente' ? 'Aguardando aprovação' : 'Assinatura manual';
      doc.text(hint, center, block.y + 13, {align: 'center'});
    }
    doc.setDrawColor(colors.border); doc.setLineWidth(.3); doc.line(block.x + 1, block.y + 20, block.x + block.width - 1, block.y + 20);
    let y = block.y + 24;
    doc.setFont(fontNames[block.fontFamily ?? 'sans'], 'bold'); doc.setFontSize(nameSize); doc.setTextColor(colors.ink);
    for (const line of names) {doc.text(line, center, y, {align: 'center'}); y += pointsToMillimeters(nameSize) * 1.25;}
    doc.setFont(fontNames[block.fontFamily ?? 'sans'], 'normal'); doc.setFontSize(6); doc.setTextColor(colors.muted);
    for (const line of timestampLines) {doc.text(line, center, y, {align: 'center'}); y += 3;}
    for (const line of hashLines) {doc.text(line, center, y, {align: 'center'}); y += 2.6;}
  };

  const tableHeader = (block: DocumentBlock, y: number) => {
    doc.setFillColor(colors.ink); doc.rect(block.x, y, block.width, table.header, 'F');
    doc.setFont(fontNames[block.fontFamily ?? 'sans'], 'bold'); doc.setFontSize(Math.min(block.fontSize ?? 9, 8)); doc.setTextColor('#ffffff');
    doc.text('Equipamento / material / serviço', block.x + table.paddingX, y + 5.2);
    doc.text('Aplicação', block.x + block.width * table.leftRatio + table.paddingX, y + 5.2);
  };
  const tableFits = (block: DocumentBlock) => {
    doc.setFont(fontNames[block.fontFamily ?? 'sans'], 'bold'); doc.setFontSize(Math.min(block.fontSize ?? 9, 8));
    return block.height >= table.header + (data.items.length ? table.minRow : 0)
      && doc.getTextWidth('Equipamento / material / serviço') <= block.width * table.leftRatio - table.paddingX * 2
      && doc.getTextWidth('Aplicação') <= block.width * (1 - table.leftRatio) - table.paddingX * 2;
  };
  const itemLines = (block: DocumentBlock, item: DocumentPreviewData['items'][number]) => {
    setFont(block, block.fontSize ?? 9);
    return {
      left: doc.splitTextToSize(item.description, Math.max(1, block.width * table.leftRatio - table.paddingX * 2)) as string[],
      right: doc.splitTextToSize(item.application, Math.max(1, block.width * (1 - table.leftRatio) - table.paddingX * 2)) as string[],
    };
  };
  const tableRow = (block: DocumentBlock, y: number, lines: {left: string[]; right: string[]}, height: number, index: number) => {
    if (index % 2 === 0) {doc.setFillColor(colors.paper); doc.rect(block.x, y, block.width, height, 'F');}
    setFont(block, block.fontSize ?? 9);
    const step = pointsToMillimeters(block.fontSize ?? 9) * 1.4;
    lines.left.forEach((line, i) => doc.text(line, block.x + table.paddingX, y + table.paddingY + (i + .8) * step));
    lines.right.forEach((line, i) => doc.text(line, block.x + block.width * table.leftRatio + table.paddingX, y + table.paddingY + (i + .8) * step));
    doc.setDrawColor(colors.border); doc.setLineWidth(.15); doc.line(block.x, y + height, block.x + block.width, y + height);
  };
  const verification = (block: DocumentBlock, allowOverflow: boolean) => {
    const size = Math.min(block.height, block.width * .3, 30);
    const copy: DocumentBlock = {...block, x: block.x + size + 4, y: block.y + 2, height: Math.max(1, block.height - 2), width: Math.max(1, block.width - size - 4), fontSize: Math.min(block.fontSize ?? 8, 8)};
    const value = documentBlockText(block, data);
    setFont(copy);
    const lines = doc.splitTextToSize(value, Math.max(1, copy.width - 1)) as string[];
    const requiredHeight = lines.length * pointsToMillimeters(copy.fontSize!) * 1.25;
    if (allowOverflow && (size < 20 || copy.width < 20 || requiredHeight > copy.height || lines.some(line => doc.getTextWidth(line) > copy.width))) {
      continuationHint(block); overflow.push({label: 'Conferência do documento', verification: true}); return;
    }
    if (data.verification?.url) drawPdfQr(doc, data.verification.url, block.x, block.y, size);
    text(copy, value, 'Conferência do documento');
  };

  for (const block of layout.blocks) {
    if (block.type === 'line') {
      doc.setDrawColor(colors.border); doc.setLineWidth(Math.min(.5, block.height));
      doc.line(block.x, block.y + block.height / 2, block.x + block.width, block.y + block.height / 2);
    } else if (block.type === 'signature') {
      signature(block, block.field === 'director' ? 'director' : 'requester', true);
    } else if (block.type === 'verification') {
      verification(block, true);
    } else if (block.type === 'items') {
      if (!tableFits(block)) {
        continuationHint(block); overflow.push({label: 'Serviços — continuação', items: data.items}); continue;
      }
      const lineHeight = pointsToMillimeters(block.fontSize ?? 9) * 1.4;
      tableHeader(block, block.y);
      let y = block.y + table.header;
      for (let index = 0; index < data.items.length; index++) {
        const lines = itemLines(block, data.items[index]);
        const height = Math.max(table.minRow, Math.max(lines.left.length, lines.right.length) * lineHeight + table.paddingY * 2);
        const continuationSpace = index + 1 < data.items.length ? 5 : 0;
        if (y + height + continuationSpace > block.y + block.height) {
          continuationHint({...block, x: block.x + table.paddingX, y: y + 1, width: block.width - table.paddingX * 2, height: block.y + block.height - y - 1});
          overflow.push({label: 'Serviços — continuação', items: data.items.slice(index)}); break;
        }
        tableRow(block, y, lines, height, index); y += height;
      }
    } else text(block, documentBlockText(block, data), block.type === 'field' ? `Campo: ${block.field}` : 'Texto do modelo');
  }

  let y = 300, continuationTop = typeof contentTop === 'number' ? contentTop : 16;
  const ensure = (space: number) => {
    if (y + space <= 278) return;
    doc.addPage(); const top = drawPageBackground?.() ?? 16; continuationTop = top; doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(colors.ink);
    doc.text(`Solicitação ${data.fields.requestNumber ?? ''} · continuação`, 16, top + 4);
    y = top + 12;
  };
  const paragraph = (value: string, size = 9) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size);
    const lines = doc.splitTextToSize(value, 178) as string[];
    for (const line of lines) {ensure(5); doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(colors.ink); doc.text(line, 16, y); y += 4.5;}
    y += 3;
  };
  for (const entry of overflow) {
    ensure(22); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(colors.ink); doc.text(entry.label, 16, y); y += 7;
    if (entry.text) paragraph(entry.text);
    if (entry.items) {
      const block: DocumentBlock = {id: 'continued-items', type: 'items', x: 16, y, width: 178, height: 200, fontSize: 9};
      const step = pointsToMillimeters(9) * 1.4;
      const startTable = () => {ensure(table.header + table.minRow); tableHeader(block, y); y += table.header;};
      startTable();
      entry.items.forEach((item, index) => {
        const lines = itemLines(block, item);
        let offset = 0;
        const count = Math.max(lines.left.length, lines.right.length);
        const wholeHeight = Math.max(table.minRow, count * step + table.paddingY * 2);
        const pageCapacity = 278 - continuationTop - 12 - table.header;
        if (wholeHeight <= pageCapacity && y + wholeHeight > 278) {y = 300; startTable();}
        while (offset < count) {
          let capacity = Math.floor((278 - y - table.paddingY * 2) / step);
          if (capacity < 1) {y = 300; startTable(); capacity = Math.floor((278 - y - table.paddingY * 2) / step);}
          const take = Math.min(count - offset, capacity);
          const height = Math.max(table.minRow, take * step + table.paddingY * 2);
          if (y + height > 278) {y = 300; startTable(); continue;}
          tableRow(block, y, {left: lines.left.slice(offset, offset + take), right: lines.right.slice(offset, offset + take)}, height, index);
          y += height; offset += take;
        }
      });
      y += 7;
    }
    if (entry.signature) {
      // A full-width continuation accommodates even the longest allowed name.
      ensure(65); signature({id: 'continued', type: 'signature', x: 16, y, width: 178, height: 65, fontSize: 8}, entry.signature, false); y += 65;
    }
    if (entry.verification) {
      ensure(32); verification({id: 'continued-verification', type: 'verification', x: 16, y, width: 178, height: 26, fontSize: 8}, false); y += 32;
    }
  }
  return {overflowCount: overflow.length};
}
