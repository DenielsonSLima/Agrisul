// Public reference data only. Never replace an unavailable quote with a made-up
// price, or label daily/monthly publications as a real-time exchange feed.
import {Buffer} from 'node:buffer';
export const EPAGRI_URL='https://docweb.epagri.sc.gov.br/website_cepa/precos/Historico_precos_diario.xlsx';
export const EPAGRI_SOURCE='https://cepa.epagri.sc.gov.br/index.php/mercado-agricola/';
export const CANE_URL='https://www.sistemafaep.org.br/consecana/';
export const AWESOME_URL='https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL';
const months=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
export const agriculturalProducts=[
  ['soy','Soja industrial - sc 60 kg','Oeste'],
  ['corn','Milho-amarelo - sc 60 kg','Oeste'],
  ['cattle','Boi gordo - arroba','Oeste'],
  ['wheat','Trigo superior PH78 - sc 60 kg','Oeste'],
  ['rice','Arroz irrigado em casca - sc 50 kg','Litoral Sul'],
  ['beans','Feijão-carioca - sc 60 kg','Oeste'],
  ['pork','Suíno vivo - produtores independentes - kg','Oeste'],
  ['chicken','Frango de corte - vivo - kg','Oeste'],
];
const products=agriculturalProducts;
const clean=text=>String(text).replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim();
const decimal=value=>{const number=Number(value);return Number.isFinite(number)&&number>0?String(number):null;};
export function unavailable(id,source,sourceUrl,note='Fonte temporariamente indisponível'){
  return {id,value:null,date:null,source,sourceUrl,note,status:'unavailable'};
}
export function emptyAgriculturalQuotes(){return products.map(([id,,place])=>unavailable(id,'Epagri/Cepa',EPAGRI_SOURCE,`Preço ao produtor · ${place}/SC · aguardando publicação`));}

// Consume worksheet rows as a stream: the original workbook contains several
// years and must never be materialized as a giant editable Workbook in memory.
export function consumeAgriculturalRow(result,values){
  const [,year,month,day,product,place,,price]=values;
  const match=products.find(([,name,town])=>name===product&&town===place);
  if(!match||!Number.isInteger(year)||!Number.isInteger(day))return;
  const index=months.indexOf(String(month).toLocaleLowerCase('pt-BR'));
  if(index<0)return;
  const parsed=new Date(Date.UTC(year,index,day));
  if(parsed.getUTCMonth()!==index||parsed.getUTCDate()!==day)return;
  const date=parsed.toISOString().slice(0,10),value=decimal(price);
  if(!value)return;
  const item=result.find(quote=>quote.id===match[0]);
  if(!item||item.date===date)return;
  if(item.date&&item.date>date){
    if(!item.previousDate||item.previousDate<date)Object.assign(item,{previousValue:value,previousDate:date});
    return;
  }
  if(item.date)Object.assign(item,{previousValue:item.value,previousDate:item.date});
  Object.assign(item,{value,date,status:'available',note:`Preço mais comum ao produtor · ${place}/SC · diário`});
}
export function parseCurrency(body,id){
  const expected=id==='usd'?'USD':'EUR';
  const rows=Array.isArray(body)?body.filter(row=>row?.base===expected&&row?.quote==='BRL'&&/^\d{4}-\d{2}-\d{2}$/.test(row?.date??'')&&decimal(row.rate)).sort((a,b)=>b.date.localeCompare(a.date)):[];
  const item=rows[0],previous=rows.find(row=>row.date<item.date);
  const value=decimal(item?.rate);
  if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(item?.date??''))throw new Error('Cotação cambial inválida');
  return {id,value,date:item.date,...(previous?{previousValue:decimal(previous.rate),previousDate:previous.date}:{}),source:'Frankfurter · bancos centrais',sourceUrl:'https://frankfurter.dev/',note:'Taxa de referência diária · não é câmbio intradiário',status:'available'};
}
export function parseAwesomeCurrency(body,id){
  const expected=id==='usd'?'USD':'EUR';
  const item=body?.[`${expected}BRL`];
  const value=decimal(item?.bid),seconds=Number(item?.timestamp);
  if(item?.code!==expected||item?.codein!=='BRL'||!value||!Number.isFinite(seconds)||seconds<946684800||seconds>4102444800)throw new Error('Cotação cambial intradiária inválida');
  const observedAt=new Date(seconds*1000).toISOString();
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(observedAt));
  const change=typeof item.pctChange==='string'&&/^-?\d+(?:\.\d+)?$/.test(item.pctChange)?item.pctChange:undefined;
  return {id,value,date,observedAt,...(change===undefined?{}:{changePercent:change}),source:'AwesomeAPI',sourceUrl:'https://docs.awesomeapi.com.br/api-de-moedas',note:'Câmbio comercial · compra (bid) · variação informada pela fonte · API pública com cache de 1 minuto',status:'available'};
}
export function parseCane(html){
  const section=html.match(/<h2[^>]*>\s*Safra\s+\d{4}\/\d{4}\s*[-–]\s*(\d{2})\/(\d{2})\/(\d{4})\s*<\/h2>([\s\S]*?)<\/table>/i);
  const row=section?.[4].match(/<tr[^>]*>\s*<td[^>]*>\s*PRE(?:Ç|&Ccedil;|&#199;)O B(?:Á|&Aacute;|&#193;)SICO\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
  const value=row?decimal(clean(row[1]).replace(/\./g,'').replace(',','.')):null;
  if(!section||!value)throw new Error('Referência de cana não publicada');
  return {id:'cane',value,date:`${section[3]}-${section[2]}-${section[1]}`,source:'Consecana-PR · Sistema FAEP',sourceUrl:CANE_URL,note:'Cana básica no campo · PR · projeção de safra · data da publicação',status:'available'};
}
async function remote(url,timeout=25000){
  const response=await fetch(url,{signal:AbortSignal.timeout(timeout),headers:{Accept:'application/json, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, text/html'}});
  if(!response.ok)throw new Error('Fonte indisponível');
  return response;
}
export async function fetchAgriculturalQuotes(){
  const response=await remote(EPAGRI_URL);
  const length=Number(response.headers.get('content-length'));
  if(length>12_000_000)throw new Error('Planilha acima do limite');
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength>12_000_000)throw new Error('Planilha acima do limite');
  const [{default:ExcelJS},{Readable}]=await Promise.all([import('exceljs'),import('node:stream')]);
  const reader=new ExcelJS.stream.xlsx.WorkbookReader(Readable.from([Buffer.from(bytes)]),{worksheets:'emit',sharedStrings:'cache',hyperlinks:'ignore',styles:'ignore'});
  const quotes=emptyAgriculturalQuotes();
  for await(const sheet of reader)for await(const row of sheet)consumeAgriculturalRow(quotes,row.values);
  return quotes;
}
async function fetchCurrency(id){
  const latest=parseCurrency(await(await remote(`https://api.frankfurter.dev/v2/rates?base=${id.toUpperCase()}&quotes=BRL`,8000)).json(),id);
  const from=new Date(Date.parse(latest.date+'T00:00:00Z')-14*86400000).toISOString().slice(0,10);
  try{return parseCurrency(await(await remote(`https://api.frankfurter.dev/v2/rates?base=${id.toUpperCase()}&quotes=BRL&from=${from}&to=${latest.date}`,8000)).json(),id);}catch{return latest;}
}
export async function fetchCurrencyQuotes(){
  let body;
  try{body=await(await remote(AWESOME_URL,8000)).json();}catch{}
  return Promise.all(['usd','eur'].map(async id=>{
    try{return parseAwesomeCurrency(body,id);}catch{}
    try{
      const quote=await fetchCurrency(id);
      return {...quote,note:`Câmbio intradiário indisponível. Referência diária alternativa: ${quote.note}`};
    }catch{return unavailable(id,'AwesomeAPI / Frankfurter','https://docs.awesomeapi.com.br/api-de-moedas');}
  }));
}

// Keep the last successful publication per indicator across provider failures.
// A failed refresh changes availability, never the publication date or value.
export function mergeMarketQuotes(previous,current){
  const lastGood=new Map(previous.filter(quote=>quote.value!==null&&quote.date).map(quote=>[quote.id,quote]));
  return current.map(quote=>{
    const saved=lastGood.get(quote.id);
    if(!saved)return quote;
    if(quote.status==='available'&&quote.date>=saved.date){
      if(quote.observedAt&&saved.observedAt&&quote.observedAt<saved.observedAt)return {...saved,status:'stale'};
      return quote;
    }
    return {...saved,status:'stale'};
  });
}
// The currency refresh must not download and parse the multi-year workbook.
// Each provider keeps its own request, success cache and last good references.
export function createMarketProvider(fetcher,fallback,ttl,now=Date.now){
  let cache=null,pending=null;
  return async()=>{
    if(cache&&cache.until>now())return cache.quotes;
    if(pending)return pending;
    pending=(async()=>{
      let incoming;
      try{const result=await fetcher();incoming=Array.isArray(result)?result:[result];}
      catch{incoming=fallback();}
      const quotes=mergeMarketQuotes(cache?.quotes??[],incoming);
      const failed=quotes.some(quote=>quote.status!=='available');
      cache={quotes,until:now()+(failed?60000:ttl)};
      return quotes;
    })();
    try{return await pending;}finally{pending=null;}
  };
}
const currencyProvider=createMarketProvider(fetchCurrencyQuotes,()=>['usd','eur'].map(id=>unavailable(id,'AwesomeAPI / Frankfurter','https://docs.awesomeapi.com.br/api-de-moedas')),60000);
const agriculturalProvider=createMarketProvider(fetchAgriculturalQuotes,emptyAgriculturalQuotes,600000);
const caneProvider=createMarketProvider(()=>remote(CANE_URL).then(response=>response.text()).then(parseCane),()=>[unavailable('cane','Consecana-PR · Sistema FAEP',CANE_URL)],600000);
const marketProviders={currency:currencyProvider,agriculture:agriculturalProvider,cane:caneProvider};
/** @param {'currency'|'agriculture'|'cane'} [group] */
export async function getMarketFeed(group){
  if(group!==undefined){
    if(!Object.hasOwn(marketProviders,group))throw new RangeError('Grupo de mercado inválido.');
    // Invoke only the requested provider. A currency-only request must not even
    // start downloading the multi-year agricultural workbook or the cane page.
    const quotes=await marketProviders[group]();
    return {quotes,checkedAt:new Date().toISOString(),refreshSeconds:group==='currency'?60:600};
  }
  const results=await Promise.all([currencyProvider(),agriculturalProvider(),caneProvider()]);
  return {quotes:results.flat(),checkedAt:new Date().toISOString(),refreshSeconds:60};
}
