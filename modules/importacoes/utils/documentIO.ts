import type { ImportExport, ImportField, ImportProfileInput } from '../types';
import { excelColumn } from './defaults';
import { isoDate, parseTaquariPages, type ExtractedPage, type ParsedImport } from './taquariParser';
export { createTaquariProfile, TAQUARI_SOURCE_FIELDS } from './defaults';

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;

export async function parseImportPdf(file:File, profile:ImportProfileInput):Promise<ParsedImport> {
  if (!file.name.toLowerCase().endsWith('.pdf')) throw new Error('Selecione um arquivo PDF.');
  if (file.size > MAX_PDF_BYTES) throw new Error('O PDF deve ter até 25 MB.');
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const loadingTask = pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())});
  try {
    const document = await loadingTask.promise;
    if (document.numPages > 250) throw new Error('Importe um relatório com até 250 páginas por vez.');
    const pages:ExtractedPage[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const positioned = content.items.flatMap(item => 'str' in item && item.str.trim()
        ? [{text:item.str, x:item.transform[4], y:item.transform[5]}] : []);
      positioned.sort((a,b) => b.y-a.y || a.x-b.x);
      const rows:Array<{y:number; parts:typeof positioned}> = [];
      for (const item of positioned) {
        const row = rows[rows.length-1];
        if (row && Math.abs(row.y-item.y) < 2) row.parts.push(item);
        else rows.push({y:item.y,parts:[item]});
      }
      pages.push({number,lines:rows.map(row => row.parts.sort((a,b) => a.x-b.x).map(item => item.text).join(' '))});
      page.cleanup();
    }
    return parseTaquariPages(pages,profile);
  } catch (error) {
    if (error instanceof Error && /password/i.test(error.message)) throw new Error('O PDF está protegido por senha. Exporte uma cópia sem senha para importar.');
    throw error;
  } finally { await loadingTask.destroy(); }
}

export async function sourceFileHash(file:File):Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('');
}

async function newWorkbook() {
  const excel = await import('exceljs');
  return new excel.default.Workbook();
}

export interface WorkbookTemplateInspection {
  sheetNames:string[]; sheetName:string; startRow:number; fields:ImportField[]; templateBase64:string; templateName:string;
  columnTypes:WorkbookColumnType[]; warnings:string[];
}

export interface WorkbookColumnType {
  key:string; column:string; inferredType:ImportField['type']|null; observedTypes:ImportField['type'][];
  formats:string[]; sampleRows:number[]; mixed:boolean; reason:string;
}

type NumberFormatType = ImportField['type']|'general'|'time'|'unknown';

/** Inspect format tokens, ignoring literals, colors, conditions and the text-only fourth section. */
function numberFormatType(format:string|undefined):NumberFormatType {
  if (!format || /^general$/i.test(format.trim())) return 'general';
  const firstSection = format.match(/^(?:"[^"]*"|\\.|[^;])*/)?.[0] || '';
  const tokens = firstSection.replace(/"[^"]*"/g,'').replace(/\\./g,'').replace(/[_*]./g,'')
    .replace(/\[([^\]]+)\]/g,(_whole,body:string)=>/^[hms]+$/i.test(body)?body:'').toLowerCase();
  if (/[dy]/.test(tokens)) return 'date';
  if (/[hs]/.test(tokens)) return 'time';
  if (/m/.test(tokens) && !/[#0?]/.test(tokens)) return 'date';
  if (/[#0?]/.test(tokens)) return 'decimal';
  if (tokens.includes('@')) return 'text';
  return 'unknown';
}

function nativeCellType(value:unknown):ImportField['type']|'unsupported'|null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return 'date';
  if (typeof value === 'string') return 'text';
  if (typeof value === 'number') return Number.isFinite(value)?'decimal':'unsupported';
  if (typeof value === 'object') {
    if ('result' in value) return nativeCellType(value.result);
    if ('formula' in value || 'sharedFormula' in value) return null;
    if ('text' in value || 'richText' in value) return 'text';
  }
  return 'unsupported';
}

function isCompatibleFormat(format:string|undefined,type:ImportField['type']):boolean {
  const formatType = numberFormatType(format);
  return formatType === type || (formatType === 'general' && type !== 'date');
}

/** The public ExcelJS model includes sparse styled rows, including empty model cells. */
function existingRowNumbers(sheet:{model:unknown}):number[] {
  const model = sheet.model as {rows?:Array<{number:number}>};
  return (model.rows || []).map(row=>row.number);
}

function excelNumericValue(value:string,field:{label:string;key:string},address:string):number {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error(`Valor numérico inválido em ${field.label || field.key} (${address}). O tipo da coluna continua Número; corrija o valor antes de exportar.`);
  // Trailing zeros do not consume decimal precision (e.g. 61.310 has four significant digits).
  const significantDigits = value.replace(/[^0-9]/g,'').replace(/^0+/,'').replace(/0+$/,'').length;
  const numeric = Number(value);
  if (significantDigits > 15 || !Number.isFinite(numeric) || (numeric === 0 && /[1-9]/.test(value))) {
    throw new Error(`O valor de ${field.label || field.key} em ${address} excede a precisão numérica do Excel (15 dígitos significativos). A coluna permanece Número. Ajuste o valor ou altere o tipo explicitamente para Texto antes de exportar.`);
  }
  return numeric;
}

export async function inspectWorkbookTemplate(file:File):Promise<WorkbookTemplateInspection> {
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Selecione um modelo Excel no formato .xlsx.');
  if (file.size > MAX_WORKBOOK_BYTES) throw new Error('O modelo Excel deve ter até 5 MB.');
  const buffer = await file.arrayBuffer();
  const workbook = await newWorkbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('A planilha não contém abas.');
  let headerRow = 0;
  sheet.eachRow({includeEmpty:false}, row => { if (!headerRow && row.cellCount) headerRow = row.number; });
  if (!headerRow) throw new Error('A primeira aba está vazia.');
  const keys = new Set<string>();
  const fields:ImportField[] = [];
  const columnTypes:WorkbookColumnType[] = [];
  const warnings:string[] = [];
  const dataRows = existingRowNumbers(sheet).filter(number=>number>headerRow);
  sheet.getRow(headerRow).eachCell({includeEmpty:false}, (cell, number) => {
    const label = cell.text.trim();
    if (!label) return;
    const key = label.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_]+/g,'_').replace(/^_+|_+$/g,'').toUpperCase();
    if (!key || keys.has(key)) throw new Error(`Cabeçalho vazio ou repetido na coluna ${excelColumn(number-1)}.`);
    keys.add(key);
    const observedTypes = new Set<ImportField['type']>();
    const formats = new Set<string>();
    const sampleRows:number[] = [];
    let unsupported = false;
    const inspectFormat = (format:string|undefined)=>{
      if (!format || /^general$/i.test(format.trim())) return;
      formats.add(format);
      const inferred = numberFormatType(format);
      if (inferred === 'text' || inferred === 'decimal' || inferred === 'date') observedTypes.add(inferred);
      else if (inferred === 'time') unsupported = true;
    };
    inspectFormat(sheet.getColumn(number).numFmt);
    for (const sampleRow of dataRows) {
      const sample = sheet.getCell(sampleRow,number);
      const nativeType = nativeCellType(sample.value);
      if (nativeType === 'unsupported') unsupported = true;
      else if (nativeType) observedTypes.add(nativeType);
      inspectFormat(sample.numFmt);
      if ((nativeType || numberFormatType(sample.numFmt) !== 'general') && sampleRows.length < 8) sampleRows.push(sampleRow);
    }
    const column = excelColumn(number-1);
    const mixed = observedTypes.size > 1 || unsupported;
    const inferredType = !mixed && observedTypes.size === 1 ? [...observedTypes][0] : null;
    const reason = unsupported ? 'Há formatos de hora, valores lógicos ou erros que exigem escolha explícita do tipo.'
      : mixed ? 'Os valores e formatos da coluna indicam tipos diferentes. Escolha explicitamente o tipo.'
      : inferredType ? 'Tipo identificado pelos valores e formatos reais da coluna.'
      : 'Sem valores ou formato explícito suficientes; conserve o tipo já configurado ou escolha um tipo.';
    columnTypes.push({key,column,inferredType,observedTypes:[...observedTypes],formats:[...formats],sampleRows,mixed,reason});
    if (mixed) warnings.push(`Coluna ${column} (${label}): ${reason}`);
    fields.push({key,label,column,source:'manual',type:inferredType || 'text',required:false,defaultValue:'',sourceKey:'',pattern:'',mappings:{}});
  });
  if (!fields.length) throw new Error('Não foram encontrados cabeçalhos de coluna.');
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset,offset+8192));
  return {sheetNames:workbook.worksheets.map(item => item.name),sheetName:sheet.name,startRow:headerRow+1,fields,templateBase64:btoa(binary),templateName:file.name,columnTypes,warnings};
}

/** Export is a projection of server-approved cells; configured text never becomes an Excel formula. */
export async function createImportWorkbook(payload:ImportExport, templateFile?:File):Promise<Uint8Array> {
  const workbook = await newWorkbook();
  const templateBase64 = payload.document.profileSnapshot.templateBase64;
  const usesTemplate = Boolean(templateFile || templateBase64);
  if (templateFile) await workbook.xlsx.load(await templateFile.arrayBuffer());
  else if (templateBase64) {
    const bytes = Uint8Array.from(atob(templateBase64), char => char.charCodeAt(0));
    await workbook.xlsx.load(bytes.buffer);
  }
  let sheet = workbook.getWorksheet(payload.sheetName);
  if (!sheet) sheet = workbook.addWorksheet(payload.sheetName);
  const formatFallbacks = new Map<string,string>();
  const templateRows = existingRowNumbers(sheet).filter(number=>number>=payload.startRow);
  const templateRowSet = new Set(templateRows);
  for (const field of payload.columns) {
    const columnFormat = sheet.getColumn(field.column).numFmt;
    if (columnFormat && numberFormatType(columnFormat) !== 'general' && isCompatibleFormat(columnFormat,field.type)) formatFallbacks.set(field.column,columnFormat);
    for (const number of templateRows) {
      if (formatFallbacks.has(field.column)) break;
      const format = sheet.getCell(`${field.column}${number}`).numFmt;
      if (format && numberFormatType(format) !== 'general' && isCompatibleFormat(format,field.type)) formatFallbacks.set(field.column,format);
    }
    // General is a valid numeric template format, including for output beyond its existing rows.
    if (!formatFallbacks.has(field.column) && usesTemplate && field.type === 'decimal') formatFallbacks.set(field.column,'General');
  }
  // Erase historical operational rows from the template while retaining its layout and other tabs.
  sheet.eachRow({includeEmpty:false}, row => {
    if (row.number >= payload.startRow) row.eachCell({includeEmpty:false}, cell => { cell.value = null; });
  });
  if (payload.startRow > 1) for (const field of payload.columns) {
    const header = sheet.getCell(`${field.column}${payload.startRow-1}`);
    if (!header.value) header.value = field.key;
  }
  payload.rows.forEach((row,index) => {
    for (const field of payload.columns) {
      const cell = sheet!.getCell(`${field.column}${payload.startRow+index}`);
      const value = row.values[field.column] || '';
      if (value === '') { cell.value = null; continue; }
      // ExcelJS shares loaded style objects across cells. Isolate changes to this cell's type format.
      cell.style = {...cell.style};
      const currentFormat = cell.numFmt;
      const fallback = formatFallbacks.get(field.column);
      const preserveNumericGeneral = usesTemplate && field.type === 'decimal'
        && templateRowSet.has(payload.startRow+index) && numberFormatType(currentFormat) === 'general';
      const chosenFormat = numberFormatType(currentFormat) !== 'general' && isCompatibleFormat(currentFormat,field.type) ? currentFormat
        : preserveNumericGeneral ? 'General' : fallback || (field.type === 'date' ? 'dd/mm/yyyy' : field.type === 'decimal' ? '0.###############' : '@');
      if (field.type === 'date') {
        cell.value = new Date(`${isoDate(value)}T00:00:00Z`);
      } else if (field.type === 'decimal') {
        cell.value = excelNumericValue(value,field,cell.address);
      } else cell.value = value;
      cell.numFmt = chosenFormat;
    }
  });
  workbook.calcProperties.fullCalcOnLoad = true;
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export async function exportImportWorkbook(payload:ImportExport, templateFile?:File):Promise<void> {
  const bytes = await createImportWorkbook(payload,templateFile);
  const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${payload.document.sourceName.replace(/\.pdf$/i,'') || 'importacao'}.xlsx`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
