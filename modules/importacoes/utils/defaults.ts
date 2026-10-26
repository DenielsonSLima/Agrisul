import type { ImportField, ImportProfileInput } from '../types';

export const TAQUARI_SOURCE_FIELDS = [
  ['entrada', 'Entrada na usina'], ['sequencia', 'Sequência do compartimento'],
  ['dataChegada', 'Data de chegada'], ['horaChegada', 'Hora de chegada'],
  ['dataSaida', 'Data de saída'], ['horaSaida', 'Hora de saída'],
  ['dataMovimento', 'Data do movimento'], ['fazendaOrigem', 'Código do fundo agrícola'],
  ['fazendaNome', 'Nome do fundo agrícola'], ['zona', 'Zona'], ['talhao', 'Talhão'],
  ['itens', 'Itens'], ['ordemCorte', 'Ordem de corte'], ['numeroAnalise', 'Número da análise'],
  ['bituca', 'Bituca'], ['enc', 'Encerramento'], ['equipamento', 'Equipamento da linha'],
  ['notaFiscal', 'Nota fiscal'], ['pesoBruto', 'Peso bruto (t)'], ['tara', 'Tara (t)'],
  ['pesoLiquido', 'Peso líquido informado (t)'],
  ['equipamentoPrincipal', 'Equipamento da sequência 1 da entrada'], ['fazendaZonaTalhao', 'Fundo, zona e talhão (código composto)'],
  ['quantidadeVeiculosConjunto', 'Quantidade de reboques do conjunto (calculada ao importar)'],
  ['entradaSequencialConjunto', 'Entrada sequencial por conjunto (calculada no banco)'],
] as const;

const headings = [
  'COD_GRUPOEMPRESA','COD_EMPRESA','COD_FILIAL','COD_SAFRA','COD_FRENTE','COD_FAZENDA','ZONA','COD_TALHAO','AREA',
  'COD_FINALIDADE','COD_TIPOCOLHEITA','COD_ENTRADA','DATACHEGADA','HORACHEGADA','DATASAIDA','HORASAIDA','DATAMOVIMENTO',
  'COD_TIPOCARGA','COD_EQUIPAMENTO_TRANSPORTE','COD_FUNCIONARIO','COD_TERCEIRO','DATACARREGAMENTO','HORACARREGAMENTO',
  'ORDEM_CARREGAMENTO','COD_EQUIPAMENTO_COMPARTIMENTO','NUMERO_ANALISE','PESOBRUTO','TARA','NR_ORDEM_COLHEITA',
  'PBU','LEITURA_SACARIMETRICA','BRIX','POL','COD_COLHEDORA','COD_OPER_COLHEDORA_TERCEIRO','COD_OPER_COLHEDORA_FUNCIONARIO',
  'COD_TRANSBORDO','COD_OPER_TRANSBORDO_TERCEIRO','COD_OPER_TRANSBORDO_FUNCIONA','COD_CARREGADEIRA',
  'COD_OPER_CARREGADEIRA_TERCEIRO','COD_OPER_CARREGADEIRA_FUNCIONA','COD_TRATOR_REBOQUE',
  'COD_OPER_TRATOREBO_TERCEIRO','COD_OPER_TRATOREBO_FUNCIONARIO','COD_TIPOCULTURA',
];

/** These are editable examples read from the supplied workbook, never inferred ERP identities. */
const fixedExamples: Record<string, string> = {
  COD_GRUPOEMPRESA:'1', COD_EMPRESA:'2', COD_FILIAL:'5', COD_SAFRA:'2026', COD_FRENTE:'28',
  COD_FINALIDADE:'4', COD_TERCEIRO:'77', COD_TIPOCULTURA:'1',
};
const sourceKeys: Record<string, string> = {
  COD_FAZENDA:'fazendaOrigem', ZONA:'zona', COD_TALHAO:'talhao', DATACHEGADA:'dataChegada', HORACHEGADA:'horaChegada',
  DATASAIDA:'dataSaida', HORASAIDA:'horaSaida', DATAMOVIMENTO:'dataMovimento',
  NUMERO_ANALISE:'numeroAnalise', PESOBRUTO:'pesoBruto', TARA:'tara', AREA:'fazendaZonaTalhao',
  COD_TIPOCOLHEITA:'fazendaOrigem', COD_TIPOCARGA:'quantidadeVeiculosConjunto',
  COD_EQUIPAMENTO_TRANSPORTE:'equipamentoPrincipal', COD_EQUIPAMENTO_COMPARTIMENTO:'equipamentoPrincipal',
  NR_ORDEM_COLHEITA:'ordemCorte',COD_ENTRADA:'entradaSequencialConjunto',
};
const explicitMappings:Record<string,Record<string,string>> = {
  COD_FAZENDA:{'1582':'5010','1591':'5011'},
  AREA:{'1582-1-54':'18.07','1591-1-19':'11.1'},
  COD_TIPOCOLHEITA:{'1582':'2','1591':'1'},
  NR_ORDEM_COLHEITA:{'552':'134','550':'135'},
};
const mandatory = new Set([
  'COD_GRUPOEMPRESA','COD_EMPRESA','COD_FILIAL','COD_SAFRA','COD_FRENTE','COD_FAZENDA','ZONA','COD_TALHAO',
  'AREA','COD_FINALIDADE','COD_TIPOCOLHEITA','COD_ENTRADA','DATACHEGADA','DATASAIDA','DATAMOVIMENTO',
  'COD_TIPOCARGA','COD_EQUIPAMENTO_TRANSPORTE','COD_TERCEIRO','COD_EQUIPAMENTO_COMPARTIMENTO',
  'PESOBRUTO','TARA','NR_ORDEM_COLHEITA','COD_TIPOCULTURA',
]);
const decimal = new Set(['COD_ENTRADA','AREA','PESOBRUTO','TARA','PBU','LEITURA_SACARIMETRICA','BRIX','POL']);
const dates = new Set(['DATACHEGADA','DATASAIDA','DATAMOVIMENTO','DATACARREGAMENTO']);

export function excelColumn(index: number): string {
  let label = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    label = String.fromCharCode(65 + (value - 1) % 26) + label;
  }
  return label;
}

export function createTaquariProfile(): ImportProfileInput {
  const fields: ImportField[] = headings.map((key, index):ImportField => ({
    key, label:key.replaceAll('_', ' '), column:excelColumn(index),
    source:sourceKeys[key] ? 'pdf' : key in fixedExamples ? 'fixed' : 'manual',
    sourceKey:sourceKeys[key] || '', pattern:'', mappings:{...explicitMappings[key]},
    type:decimal.has(key) ? 'decimal' : dates.has(key) ? 'date' : 'text',
    required:mandatory.has(key), defaultValue:fixedExamples[key] || '',
  }));
  return {name:'Taquari · Colheita por equipamento', clientId:null, parser:'taquari-equipment-v1', sheetName:'Plan1', startRow:2, fields};
}
