import type { ImportField, ImportProfileInput } from '../types';

export const PINHEIRO_SOURCE_FIELDS = [
  ['periodoInicio','Início do período agrícola'],['periodoFim','Fim do período agrícola'],
  ['dataHoraBA','Data e hora do boletim'],['dataHoraTara','Data e hora da tara'],
  ['dataChegada','Data do boletim (chegada)'],['horaChegada','Hora do boletim (chegada)'],
  ['dataSaida','Data da tara (saída)'],['horaSaida','Hora da tara (saída)'],
  ['dataMovimento','Dia do movimento agrícola'],['fazendaOrigem','Código do fundo agrícola'],
  ['fazendaNome','Nome do fundo agrícola'],['numeroAnalise','Número do boletim de análise'],
  ['pesoAnalisado','Massa analisada informada (t)'],['brixCana','Brix da cana'],['brixCaldo','Brix do caldo'],
  ['leituraSacarimetricaCorrigida','LS corrigida'],['pbu','PBU'],['ph','pH'],['arCana','AR da cana'],
  ['polCaldo','Pol do caldo'],['fibra','Fibra'],['purezaCana','Pureza da cana'],['purezaCaldo','Pureza do caldo'],
  ['polCana','Pol da cana'],['atr','ATR'],['umidade','Umidade'],['amido','Amido'],['agio','Ágio'],
  ['talhao','Talhão informado na guia (conferir vínculo)'],
  ['quantidadeAnalisesConjunto','Quantidade de análises do conjunto (calculada no banco)'],
  ['entradaSequencialConjunto','Entrada sequencial por conjunto (calculada no banco)'],
  ['sequencia','Sequência da análise no conjunto (calculada no banco)'],
  ['taraConvencional','Tara convencional da sequência (calculada no banco)'],
  ['pesoBrutoConvencional','Bruto convencional: analisada + tara (calculado no banco)'],
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
const fixed:Record<string,string> = {
  COD_GRUPOEMPRESA:'1',COD_EMPRESA:'2',COD_FILIAL:'5',COD_SAFRA:'2026',COD_FRENTE:'26',ZONA:'1',
  COD_FINALIDADE:'4',COD_TIPOCOLHEITA:'2',COD_TERCEIRO:'1',COD_TIPOCULTURA:'1',
};
const sources:Record<string,string> = {
  COD_FAZENDA:'fazendaOrigem',AREA:'talhao',COD_ENTRADA:'entradaSequencialConjunto',
  DATACHEGADA:'dataChegada',HORACHEGADA:'horaChegada',DATASAIDA:'dataSaida',HORASAIDA:'horaSaida',
  DATAMOVIMENTO:'dataMovimento',COD_TIPOCARGA:'quantidadeAnalisesConjunto',
  PESOBRUTO:'pesoBrutoConvencional',TARA:'taraConvencional',
};
const mappings:Record<string,Record<string,string>> = {
  COD_FAZENDA:{'311272':'5032'},AREA:{'15':'19.56','21':'19.52'},
};
// Native NUMBER cells in import01usjp.xlsx, never inferred from a column name.
const numeric = new Set([
  'COD_GRUPOEMPRESA','COD_EMPRESA','COD_FILIAL','COD_SAFRA','COD_FRENTE','COD_FAZENDA','ZONA','COD_TALHAO','AREA',
  'COD_FINALIDADE','COD_ENTRADA','COD_EQUIPAMENTO_TRANSPORTE','COD_TERCEIRO','COD_EQUIPAMENTO_COMPARTIMENTO',
  'PESOBRUTO','TARA','NR_ORDEM_COLHEITA','COD_TIPOCULTURA',
]);
const dates = new Set(['DATACHEGADA','DATASAIDA','DATAMOVIMENTO']);
// Harvest orders are optional; entry and both equipment codes require review.
const optionalManual = new Set(['NR_ORDEM_COLHEITA']);
const required = new Set([...numeric].filter(key=>!optionalManual.has(key)).concat(['COD_TIPOCOLHEITA','DATACHEGADA','DATASAIDA','DATAMOVIMENTO','COD_TIPOCARGA']));
function columnLabel(index:number):string {
  let label='';for(let value=index+1;value>0;value=Math.floor((value-1)/26))label=String.fromCharCode(65+(value-1)%26)+label;
  return label;
}

/** Separate USJP sample: empty columns remain manual text until explicitly configured. */
export function createPinheiroProfile():ImportProfileInput {
  const fields:ImportField[]=headings.map((key,index):ImportField=>({
    key,label:key.replaceAll('_',' '),column:columnLabel(index),
    source:sources[key]?'pdf':Object.hasOwn(fixed,key)?'fixed':'manual',sourceKey:sources[key]||'',
    pattern:'',mappings:{...mappings[key]},type:numeric.has(key)?'decimal':dates.has(key)?'date':'text',
    required:required.has(key),defaultValue:fixed[key]||'',
  }));
  return {name:'Pinheiro · Boletins USJP',clientId:null,parser:'pinheiro-usjp-v1',sheetName:'Plan1',startRow:2,entrySequenceStart:'806',fields};
}
