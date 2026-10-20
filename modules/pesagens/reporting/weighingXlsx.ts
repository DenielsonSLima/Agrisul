import type {WeighingDetail, WeighingEntry, WeighingSummary} from '../types';

// Small OOXML writer: UTF-8 ZIP entries are stored without compression.
// Text uses inlineStr, so plate/ticket content can never become Excel formulas.
type Cell = string | {number: string | null | undefined};
type Row = {cells: Cell[]; style?: number};
type Sheet = {name: string; rows: Row[]; widths: number[]; filter?: boolean};
const number = (value: string | null | undefined): Cell => ({number: value});
const xml = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const encoder = new TextEncoder();
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
function column(index: number) {let result = ''; for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result; return result;}
function crc32(bytes: Uint8Array) {let result = 0xffffffff; for (const byte of bytes) {result ^= byte; for (let bit = 0; bit < 8; bit++) result = (result >>> 1) ^ ((result & 1) ? 0xedb88320 : 0);} return (result ^ 0xffffffff) >>> 0;}
function zip(files: {name: string; content: string}[]) {
  const chunks: Uint8Array[] = [], directory: Uint8Array[] = []; let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name), bytes = encoder.encode(file.content), crc = crc32(bytes);
    const local = new Uint8Array(30 + name.length), view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true); view.setUint16(12, 0x21, true);
    view.setUint32(14, crc, true); view.setUint32(18, bytes.length, true); view.setUint32(22, bytes.length, true); view.setUint16(26, name.length, true); local.set(name, 30);
    const central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true); cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, bytes.length, true); cv.setUint32(24, bytes.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); central.set(name, 46);
    chunks.push(local, bytes); directory.push(central); offset += local.length + bytes.length;
  }
  const size = directory.reduce((total, part) => total + part.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
  const result = new Uint8Array(offset + size + end.length); let cursor = 0;
  for (const chunk of [...chunks, ...directory, end]) {result.set(chunk, cursor); cursor += chunk.length;}
  return result;
}
function sheetXml(sheet: Sheet) {
  const count = sheet.widths.length;
  return declaration + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${column(count - 1)}${sheet.rows.length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${sheet.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${sheet.rows.map((row, index) => `<row r="${index + 1}">${row.cells.map((cell, col) => {
    const address = `${column(col)}${index + 1}`;
    if (typeof cell === 'object') return cell.number == null || cell.number === '' ? `<c r="${address}" s="${row.style || 1}"/>` : /^-?\d+(?:\.\d+)?$/.test(cell.number) ? `<c r="${address}" s="${row.style || 1}"><v>${cell.number}</v></c>` : `<c r="${address}" t="inlineStr"><is><t>${xml(cell.number)}</t></is></c>`;
    return `<c r="${address}" s="${row.style || 0}" t="inlineStr"><is><t xml:space="preserve">${xml(cell)}</t></is></c>`;
  }).join('')}</row>`).join('')}</sheetData>${sheet.filter && sheet.rows.length > 5 ? `<autoFilter ref="A5:${column(count - 1)}${sheet.rows.length}"/>` : ''}<printOptions horizontalCentered="1"/><pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}
function entryRows(entries: WeighingEntry[]): Row[] {
  const rows: Row[] = [];
  for (const entry of entries) {
    entry.components.forEach(component => rows.push({cells: [entry.weighedAt, entry.weighedTime, entry.ticket, component.fleetNumber, component.plate, component.kind === 'truck' ? 'Caminhão' : 'Reboque', number(component.tareKg), number(component.grossKg), number(component.netKg), number(component.partnerNetKg), number(component.differenceKg), entry.notes]}));
    rows.push({style: 3, cells: [entry.weighedAt, entry.weighedTime, 'SUBTOTAL DA VIAGEM', '', '', '', number(entry.tareKg), number(entry.grossKg), number(entry.agrisulNetKg), number(entry.partnerNetKg), number(entry.differenceKg), [entry.agrisulNetKg == null ? 'AGRISUL pendente' : '', !entry.partnerComplete ? 'Parceiro pendente / parcial' : '', entry.notes].filter(Boolean).join(' | ')]});
  }
  return rows;
}
const partialLabel = (entries: WeighingEntry[]) => [entries.some(entry => entry.agrisulNetKg == null) ? 'AGRISUL parcial' : '', entries.some(entry => !entry.partnerComplete) ? 'Parceiro parcial' : ''].filter(Boolean).join(' | ');
const totalsRow = (label: string, summary: WeighingSummary, entries: WeighingEntry[]): Row => ({style: 3, cells: [label, '', '', '', '', '', number(summary.tareKg), number(summary.grossKg), number(summary.agrisulNetKg), number(summary.partnerNetKg), number(summary.differenceKg), partialLabel(entries)]});
export function createWeighingXlsx(detail: WeighingDetail): Uint8Array {
  const header: Row = {style: 2, cells: ['Data', 'Hora', 'Ticket', 'Nº frota', 'Placa', 'Tipo', 'Tara AGRISUL (kg)', 'Bruto AGRISUL (kg)', 'Líquido AGRISUL (kg)', `Líquido ${detail.control.partnerName} (kg)`, 'Diferença (kg)', 'Observações']};
  const preamble: Row[] = [{style: 2, cells: ['COMPARATIVO PESAGEM DE CANA']}, {cells: ['Parceiro', detail.control.partnerName, 'Safra', detail.control.season]}, {cells: ['Início', detail.control.startDate, 'Unidade', 'kg']}, {cells: [['Diferença = parceiro − AGRISUL. Células vazias indicam dados pendentes. Valores calculados pelo sistema.', detail.control.notes].filter(Boolean).join(' | ')]}, header];
  const widths = [14, 10, 24, 13, 14, 13, 22, 22, 24, 28, 22, 48];
  const sheets: Sheet[] = [{name: 'Resumo', widths: [16, 14, 16, 22, 22, 24, 28, 22, 19, 40], rows: [...preamble.slice(0, 4), {style: 2, cells: ['Data', 'Viagens', 'Pendentes', 'Tara AGRISUL (kg)', 'Bruto AGRISUL (kg)', 'Líquido AGRISUL (kg)', `Líquido ${detail.control.partnerName} (kg)`, 'Diferença (kg)', 'Diferença (%)', 'Pendências']}, ...detail.daily.map(day => ({cells: [day.date, String(day.entryCount), String(day.pendingCount), number(day.tareKg), number(day.grossKg), number(day.agrisulNetKg), number(day.partnerNetKg), number(day.differenceKg), number(day.differencePercent), partialLabel(detail.entries.filter(entry => entry.weighedAt === day.date))]})), {style: 3, cells: ['TOTAL', String(detail.summary.entryCount), String(detail.summary.pendingCount), number(detail.summary.tareKg), number(detail.summary.grossKg), number(detail.summary.agrisulNetKg), number(detail.summary.partnerNetKg), number(detail.summary.differenceKg), number(detail.summary.differencePercent), partialLabel(detail.entries)]}]}, {name: 'Comparativo', widths, rows: [...preamble, ...entryRows(detail.entries), totalsRow('TOTAL GERAL', detail.summary, detail.entries)]}];
  for (const day of detail.daily) {const dayEntries = detail.entries.filter(entry => entry.weighedAt === day.date); sheets.push({name: day.date.slice(8) + '.' + day.date.slice(5, 7) + '.' + day.date.slice(2, 4), widths, rows: [...preamble, ...entryRows(dayEntries), totalsRow('TOTAL DO DIA', day, dayEntries)]});}
  const files = [
    {name: '[Content_Types].xml', content: declaration + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`},
    {name: '_rels/.rels', content: declaration + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
    {name: 'xl/workbook.xml', content: declaration + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`},
    {name: 'xl/_rels/workbook.xml.rels', content: declaration + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`},
    {name: 'xl/styles.xml', content: declaration + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.#######;[Red]-#,##0.#######"/></numFmts><fonts count="2"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/><color rgb="FF26563A"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF4ED"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="164" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'},
    ...sheets.map((sheet, index) => ({name: `xl/worksheets/sheet${index + 1}.xml`, content: sheetXml(sheet)})),
  ];
  return zip(files);
}
export function exportWeighingXlsx(detail: WeighingDetail) {
  const bytes = createWeighingXlsx(detail), blob = new Blob([bytes as Uint8Array<ArrayBuffer>], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = `pesagem-cana-${detail.control.startDate}.xlsx`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
