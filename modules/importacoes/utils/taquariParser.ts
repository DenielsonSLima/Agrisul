import type { ImportField, ImportProfileInput } from '../types';

export interface ExtractedPage { number:number; lines:string[] }
export interface ParsedImportEntry {
  date:string; values:Record<string,string>; source:Record<string,string>; sourcePage:number; sourceLine:string;
}
export interface ParsedImport { entries:ParsedImportEntry[]; warnings:string[] }

const datePattern = '(\\d{2}/\\d{2}/\\d{4})';
const timePattern = '(\\d{2}:\\d{2}(?::\\d{2})?)';
const weightPattern = '([\\d.]+,\\d+)';
const rowPattern = new RegExp(
  '^\\s*(\\d+)\\s+(\\d+)\\s+' + datePattern + '\\s+' + timePattern + '\\s+' + datePattern + '\\s+' + timePattern +
  '\\s+' + datePattern + '\\s+(\\d+)\\s*-\\s*(\\d+)\\s*-\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+([SN])\\s+([SN])\\s+(\\S+)\\s+' +
  '(?:(\\S+)\\s+)?' + weightPattern + '\\s+' + weightPattern + '\\s+' + weightPattern + '\\s*$', 'i',
);
const rowCandidate = /^\s*\d+\s+\d+\s+\d{2}\/\d{2}\/\d{4}\s+\d{2}:/;

export function isoDate(value:string):string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Data inválida no documento: ${value}`);
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0,10) !== iso) throw new Error(`Data inválida no documento: ${value}`);
  return iso;
}

/** Lexical conversion only: no weights, totals or business rules are calculated here. */
export function documentDecimal(value:string):string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const normalized = trimmed.includes(',') ? trimmed.replaceAll('.', '').replace(',', '.') : trimmed;
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error(`Número inválido no documento: ${value}`);
  return normalized;
}

function extractValue(field:ImportField, source:Record<string,string>, sourceLine:string):string {
  if (field.source !== 'pdf') return field.defaultValue || '';
  let result = source[field.sourceKey || field.key] || '';
  if (field.pattern) {
    if (field.pattern.length > 500) throw new Error(`Expressão de ${field.label} excede 500 caracteres.`);
    try {
      const match = new RegExp(field.pattern, 'u').exec(sourceLine);
      result = match?.[1] ?? match?.[0] ?? '';
    } catch { throw new Error(`Expressão de extração inválida em ${field.label}.`); }
  }
  if (field.mappings && Object.keys(field.mappings).length) result = Object.hasOwn(field.mappings,result) ? field.mappings[result] : '';
  if (!result) return field.defaultValue || '';
  if (field.type === 'date') return isoDate(result);
  if (field.type === 'decimal') return documentDecimal(result);
  return result;
}

export function parseTaquariPages(pages:ExtractedPage[], profile:Pick<ImportProfileInput,'parser'|'fields'>):ParsedImport {
  if (profile.parser !== 'taquari-equipment-v1') throw new Error('Este perfil não possui um extrator PDF compatível.');
  const entries:ParsedImportEntry[] = [];
  const warnings:string[] = [];
  const unrecognized:Array<{page:number; line:string}> = [];
  let farmName = '';
  let farmCode = '';
  const signatures = new Set<string>();
  for (const page of pages) {
    for (const original of page.lines) {
      const line = original.replace(/\u00a0/g, ' ').trim();
      const farm = /Fdo\s+Agr[ií]cola\s*:\s*(\d+)\s*-\s*(.+)$/i.exec(line);
      if (farm) { farmCode = farm[1]; farmName = farm[2].trim(); }
      if (!rowCandidate.test(line)) continue;
      const match = rowPattern.exec(line);
      if (!match) { unrecognized.push({page:page.number, line}); continue; }
      const [, entrada, sequencia, chegada, horaChegada, saida, horaSaida, movimento,
        fazendaOrigem, zona, talhao, itens, ordemCorte, numeroAnalise, bituca, enc, equipamento,
        notaFiscal, bruto, tara, liquido] = match;
      const source:Record<string,string> = {
        entrada, sequencia, dataChegada:isoDate(chegada), horaChegada, dataSaida:isoDate(saida), horaSaida,
        dataMovimento:isoDate(movimento), fazendaOrigem, fazendaNome:farmCode === fazendaOrigem ? farmName : '',
        zona, talhao, itens, ordemCorte, numeroAnalise, bituca, enc, equipamento, notaFiscal:notaFiscal || '',
        pesoBruto:documentDecimal(bruto), tara:documentDecimal(tara), pesoLiquido:documentDecimal(liquido),
      };
      const signature = `${source.dataMovimento}|${entrada}|${sequencia}|${numeroAnalise}`;
      if (signatures.has(signature)) throw new Error(`Linha repetida no PDF: entrada ${entrada}, sequência ${sequencia}, análise ${numeroAnalise}. Confira o arquivo.`);
      signatures.add(signature);
      const values:Record<string,string> = Object.fromEntries(profile.fields.map(field => [field.key, extractValue(field,source,line)]));
      entries.push({date:source.dataMovimento, values, source, sourcePage:page.number, sourceLine:line});
    }
  }
  if (unrecognized.length) {
    const first = unrecognized[0];
    throw new Error(`${unrecognized.length} lançamento(s) não puderam ser lidos. Primeiro na página ${first.page}: ${first.line.slice(0,100)}. Importe um PDF no layout Taquari por equipamento.`);
  }
  if (!entries.length) throw new Error('Nenhum lançamento Taquari foi encontrado. Use o relatório analítico por equipamento com texto selecionável; PDFs digitalizados precisam de OCR.');
  if (profile.fields.some(field => field.source === 'manual' && field.required && !field.defaultValue)) {
    warnings.push('Códigos de destino e informações manuais devem ser preenchidos e conferidos antes de finalizar.');
  }
  warnings.push('Cada sequência do PDF é um lançamento separado. Equipamentos, entradas e ordens do sistema de destino podem ter códigos diferentes dos impressos.');
  return {entries,warnings};
}
