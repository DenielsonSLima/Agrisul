import type { ImportField, ImportProfileInput } from '../types';
import type { ExtractedPage, ParsedImport, ParsedImportEntry } from './taquariParser';

const dateToken='\\d{2}/\\d{2}(?:/\\d{4})?';
const rowPattern=new RegExp(`^(\\d+)\\s*-\\s*(.+?)\\s+(${dateToken})\\s+(\\d{2}:\\d{2})\\s+(${dateToken})\\s+(\\d{2}:\\d{2})\\s+(\\d+)\\s+(.+)$`);
// A damaged date must not make a farm/analysis row disappear from the preview.
const rowCandidate=/^\s*\d+\s*-\s*.+\s+\d/;
const serverSources=new Set(['quantidadeAnalisesConjunto','entradaSequencialConjunto','sequencia','taraConvencional','pesoBrutoConvencional']);
const baseAnalysisKeys=['pesoAnalisado','brixCana','brixCaldo','leituraSacarimetricaCorrigida','pbu'];
const middleAnalysisKeys=['arCana','polCaldo','fibra','purezaCana','purezaCaldo','polCana','atr','umidade'];

function isoDate(value:string):string {
  const match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  const iso=match?`${match[3]}-${match[2]}-${match[1]}`:value;
  const date=new Date(`${iso}T12:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)||Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==iso)throw new Error(`Data inválida no relatório USJP: ${value}.`);
  return iso;
}
function minute(date:string,time:string):string {
  if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error(`Hora inválida no relatório USJP: ${time}.`);
  return `${isoDate(date)}T${time}`;
}
/** Decimal separator normalization only; conventional weights belong to Postgres. */
function decimal(value:string):string {
  const result=value.includes(',')?value.replaceAll('.','').replace(',','.'):value;
  if(!/^-?\d+(?:\.\d+)?$/.test(result))throw new Error(`Número inválido no relatório USJP: ${value}.`);
  return result;
}
function period(pages:ExtractedPage[]):{start:string;end:string} {
  const text=pages.flatMap(page=>page.lines).join(' ');
  const pattern=/In[ií]cio\s*:?\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})\s*[-–—]?\s*Fim\s*:?\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})/gi;
  const found=[...text.matchAll(pattern)].map(match=>({start:minute(match[1],match[2]),end:minute(match[3],match[4])}));
  if(!found.length)throw new Error('Período agrícola USJP não encontrado. O cabeçalho deve informar Início e Fim com data, ano e hora.');
  const first=found[0];
  if(first.start>first.end)throw new Error('Período agrícola USJP inválido: o início está depois do fim.');
  if(found.some(item=>item.start!==first.start||item.end!==first.end))throw new Error('O documento contém períodos agrícolas diferentes. Separe os relatórios antes de importar.');
  return first;
}
function resolveMinute(date:string,time:string,range:{start:string;end:string}):string {
  const dates=date.length===10?[date]:[...new Set([range.start.slice(0,4),range.end.slice(0,4)])].map(year=>`${date}/${year}`);
  let invalid:unknown;
  const candidates=dates.flatMap(candidate=>{try{return [minute(candidate,time)];}catch(error){invalid=error;return [];}});
  if(!candidates.length)throw invalid;
  const valid=candidates.filter(value=>value>=range.start&&value<=range.end);
  if(valid.length!==1)throw new Error(`Data/hora ${date} ${time} fora do período agrícola USJP ou com ano ambíguo.`);
  return valid[0];
}
function resolveTaraMinute(date:string,time:string,ba:string):string {
  let candidate=date;
  if(date.length!==10){
    const month=date.slice(3,5),baMonth=ba.slice(5,7);
    const year=Number(ba.slice(0,4))+(baMonth==='12'&&month==='01'?1:0);
    candidate=`${date}/${year}`;
  }
  const value=minute(candidate,time);
  if(value<ba)throw new Error(`Data/hora da tara ${date} ${time} anterior ao BA. Confira o ano e os horários.`);
  return value;
}
function analysisValues(tail:string):Record<string,string> {
  const tokens=tail.trim().split(/\s+/);
  if(tokens.length<14||tokens.length>16)throw new Error(`Esperadas 14 a 16 colunas analíticas; encontradas ${tokens.length}.`);
  tokens.forEach(decimal);
  let hasPh=false,hasAmido=false;
  if(tokens.length===16){hasPh=true;hasAmido=true;}
  if(tokens.length===15){
    // The printed optional pH uses one decimal (0,0), while optional starch is
    // an integer (0). If typography does not distinguish the position, refuse
    // the row rather than shift every subsequent analytical measurement.
    const phToken=/^\d+(?:[,.]\d)?$/.test(tokens[5]);
    const amidoToken=/^\d+$/.test(tokens[tokens.length-2]);
    if(phToken===amidoToken)throw new Error('pH/Amido opcionais ambíguos nesta linha; confira as colunas do PDF.');
    hasPh=phToken;hasAmido=amidoToken;
  }
  const result:Record<string,string>={ph:'',amido:''};let cursor=0;
  for(const key of baseAnalysisKeys)result[key]=decimal(tokens[cursor++]);
  if(hasPh)result.ph=decimal(tokens[cursor++]);
  for(const key of middleAnalysisKeys)result[key]=decimal(tokens[cursor++]);
  if(hasAmido)result.amido=decimal(tokens[cursor++]);
  result.agio=decimal(tokens[cursor]);
  return result;
}
function fieldValue(field:ImportField,source:Record<string,string>,line:string):string {
  if(field.key==='NUMERO_ANALISE')return '';
  if(field.source!=='pdf')return field.defaultValue||'';
  const key=field.sourceKey||field.key;
  if(serverSources.has(key))return '';
  let value=source[key]||'';
  if(field.pattern){
    if(field.pattern.length>500)throw new Error(`Expressão de ${field.label} excede 500 caracteres.`);
    try{const match=new RegExp(field.pattern,'u').exec(line);value=match?.[1]??match?.[0]??'';}
    catch{throw new Error(`Expressão de extração inválida em ${field.label}.`);}
  }
  if(field.mappings&&Object.keys(field.mappings).length)value=Object.hasOwn(field.mappings,value)?field.mappings[value]:'';
  if(!value)return field.defaultValue||'';
  return field.type==='date'?isoDate(value):field.type==='decimal'?decimal(value):value;
}

export function parsePinheiroPages(pages:ExtractedPage[],profile:Pick<ImportProfileInput,'parser'|'fields'>):ParsedImport {
  if(profile.parser!=='pinheiro-usjp-v1')throw new Error('Este perfil não possui o extrator Pinheiro/USJP.');
  const range=period(pages),entries:ParsedImportEntry[]=[],seen=new Set<string>();
  const malformed:Array<{page:number;line:string;reason:string}>=[];
  for(const page of pages)for(const original of page.lines){
    const line=original.replace(/\u00a0/g,' ').trim();
    if(!rowCandidate.test(line))continue;
    try{
      const match=rowPattern.exec(line);if(!match)throw new Error('Estrutura da linha não reconhecida.');
      const [,fazendaOrigem,fazendaNome,taraDate,taraTime,baDate,baTime,numeroAnalise,tail]=match;
      if(seen.has(numeroAnalise))throw new Error(`BA repetido ${numeroAnalise}.`);
      const dataHoraBA=resolveMinute(baDate,baTime,range),dataHoraTara=resolveTaraMinute(taraDate,taraTime,dataHoraBA);
      const source:Record<string,string>={
        periodoInicio:range.start,periodoFim:range.end,dataHoraBA,dataHoraTara,
        dataChegada:dataHoraBA.slice(0,10),horaChegada:baTime,dataSaida:dataHoraTara.slice(0,10),horaSaida:taraTime,
        dataMovimento:range.start.slice(0,10),fazendaOrigem,fazendaNome:fazendaNome.trim(),numeroAnalise,
        ...analysisValues(tail),talhao:'',quantidadeAnalisesConjunto:'',entradaSequencialConjunto:'',sequencia:'',taraConvencional:'',pesoBrutoConvencional:'',
      };
      // Retain source-row order. Counts, sequences, group identity and weights
      // are validated/calculated by the import RPC, never by this preview.
      entries.push({date:source.dataMovimento,source,values:Object.fromEntries(profile.fields.map(field=>[field.key,fieldValue(field,source,line)])),sourcePage:page.number,sourceLine:line});
      seen.add(numeroAnalise);
    }catch(error){malformed.push({page:page.number,line,reason:error instanceof Error?error.message:String(error)});}
  }
  if(malformed.length){const first=malformed[0];throw new Error(`${malformed.length} lançamento(s) USJP não puderam ser lidos. Página ${first.page}: ${first.reason} ${first.line.slice(0,100)}`);}
  if(!entries.length)throw new Error('Nenhum boletim USJP foi encontrado. Use o relatório detalhado com texto selecionável; fotos e PDFs digitalizados precisam de OCR e conferência.');
  return {entries,warnings:[
    'Cada BA é um lançamento. Conjuntos, entradas sequenciais, sequências, tara convencional e bruto convencional serão calculados e validados no banco ao importar.',
    'Datas de chegada e saída preservam o dia civil; o movimento usa o início do período agrícola e será validado pelo servidor.',
    'A entrada se repete no conjunto; próximos PDFs continuam a sequência do cliente e conjuntos já importados reaproveitam o código. Guias, talhões e equipamentos exigem vínculo e conferência. Nenhum código de caminhão foi gerado a partir da placa.',
    'Os campos analíticos originais ficam preservados na origem. Campos de destino vazios da amostra continuam manuais até configurar um mapeamento.',
  ]};
}
