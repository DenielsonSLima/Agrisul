import type {ContractLoadsData} from '../types';

export const contractDailyLoadGranularities=['day','week','fortnight','month'] as const;
export type ContractDailyLoadGranularity=typeof contractDailyLoadGranularities[number];
export type ContractDailyLoadPeriod={from:string;to:string;granularity:ContractDailyLoadGranularity};
export type ContractDailyLoadsData=ContractLoadsData;
export type ContractDailyLoadsChartRow={
 key:string;
 date:string;
 endDate:string;
 label:string;
 volume:number;
 volumeText:string;
 loadCount:number;
 averageAtrText:string;
 averageAtr:number|null;
};
export type ContractLoadFinancialChartRow=ContractDailyLoadsChartRow&{
 gross:number|null;
 net:number|null;
 billingPending:boolean;
};

const inputDate=(date:Date)=>{
 const year=date.getUTCFullYear(),month=String(date.getUTCMonth()+1).padStart(2,'0'),day=String(date.getUTCDate()).padStart(2,'0');
 return `${year}-${month}-${day}`;
};
const nullableNumber=(value:string)=>{const parsed=Number(value);return value!==''&&Number.isFinite(parsed)?parsed:null;};
const parseInputDate=(value:string)=>{const [year,month,day]=value.split('-').map(Number);return new Date(Date.UTC(year,month-1,day));};
const shiftDate=(date:Date,days:number)=>new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()+days));
const monthNames=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const shortDate=(date:Date)=>`${String(date.getUTCDate()).padStart(2,'0')}/${String(date.getUTCMonth()+1).padStart(2,'0')}`;
const preciseNumberText=(value:number)=>String(Number(value.toFixed(6)));

const bucketFor=(value:string,granularity:ContractDailyLoadGranularity)=>{
 const date=parseInputDate(value),year=date.getUTCFullYear(),month=date.getUTCMonth(),day=date.getUTCDate();
 if(granularity==='day')return {start:date,end:date,label:shortDate(date)};
 if(granularity==='week'){
  const start=shiftDate(date,-((date.getUTCDay()+6)%7)),end=shiftDate(start,6);
  const label=start.getUTCMonth()===end.getUTCMonth()?`${String(start.getUTCDate()).padStart(2,'0')}–${shortDate(end)}`:`${shortDate(start)}–${shortDate(end)}`;
  return {start,end,label};
 }
 if(granularity==='fortnight'){
  const first=day<=15,start=new Date(Date.UTC(year,month,first?1:16)),end=new Date(Date.UTC(year,month,first?15:new Date(Date.UTC(year,month+1,0)).getUTCDate()));
  return {start,end,label:`${first?'1ª':'2ª'} quinz. ${monthNames[month]}/${year}`};
 }
 const start=new Date(Date.UTC(year,month,1)),end=new Date(Date.UTC(year,month+1,0));
 return {start,end,label:`${monthNames[month]}/${year}`};
};

export const contractDailyLoadGranularityCopy:Record<ContractDailyLoadGranularity,{option:string;average:string;noun:string;plural:string;title:string;quantity:string;atr:string}>={
 day:{option:'Diário',average:'diária',noun:'dia',plural:'dias',title:'Quantidade carregada por dia',quantity:'Quantidade diária',atr:'ATR médio diário'},
 week:{option:'Semanal',average:'semanal',noun:'semana',plural:'semanas',title:'Quantidade carregada por semana',quantity:'Quantidade semanal',atr:'ATR médio semanal'},
 fortnight:{option:'Quinzenal',average:'quinzenal',noun:'quinzena',plural:'quinzenas',title:'Quantidade carregada por quinzena',quantity:'Quantidade quinzenal',atr:'ATR médio quinzenal'},
 month:{option:'Mensal',average:'mensal',noun:'mês',plural:'meses',title:'Quantidade carregada por mês',quantity:'Quantidade mensal',atr:'ATR médio mensal'},
};

export function defaultContractDailyLoadPeriod(today=new Date()):ContractDailyLoadPeriod{
 const end=new Date(Date.UTC(today.getFullYear(),today.getMonth(),today.getDate()));
 const startMonth=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()-6,1));
 const lastDayOfStartMonth=new Date(Date.UTC(startMonth.getUTCFullYear(),startMonth.getUTCMonth()+1,0)).getUTCDate();
 const start=new Date(Date.UTC(startMonth.getUTCFullYear(),startMonth.getUTCMonth(),Math.min(end.getUTCDate(),lastDayOfStartMonth)));
 return {from:inputDate(start),to:inputDate(end),granularity:'day'};
}

export function contractDailyLoadPeriodError({from,to}:Pick<ContractDailyLoadPeriod,'from'|'to'>){
 if(!from||!to)return 'Informe a data inicial e a data final.';
 if(from>to)return 'A data inicial deve ser igual ou anterior à data final.';
 return '';
}

export function contractDailyLoadsChartRows(data:ContractDailyLoadsData,granularity:ContractDailyLoadGranularity='day'):ContractDailyLoadsChartRow[]{
 const buckets=new Map<string,{start:Date;end:Date;label:string;volume:number;loadCount:number;weightedAtr:number;atrVolume:number;dailyAtrText:string}>();
 for(const group of data.groups){
  const bucket=bucketFor(group.key,granularity),key=inputDate(bucket.start),volume=Number(group.volume),averageAtr=nullableNumber(group.averageAtr);
  const current=buckets.get(key)??{...bucket,volume:0,loadCount:0,weightedAtr:0,atrVolume:0,dailyAtrText:''};
  if(Number.isFinite(volume)){
   current.volume+=volume;
   if(averageAtr!==null){current.weightedAtr+=averageAtr*volume;current.atrVolume+=volume;}
  }
  current.loadCount+=group.loadCount;
  if(granularity==='day')current.dailyAtrText=group.averageAtr;
  buckets.set(key,current);
 }
 return [...buckets.entries()].sort(([left],[right])=>left.localeCompare(right)).map(([key,bucket])=>{
  const averageAtr=bucket.atrVolume>0?bucket.weightedAtr/bucket.atrVolume:null;
  return {
   key,date:key,endDate:inputDate(bucket.end),label:bucket.label,
   volume:bucket.volume,volumeText:preciseNumberText(bucket.volume),loadCount:bucket.loadCount,
   averageAtrText:granularity==='day'?bucket.dailyAtrText:averageAtr===null?'':preciseNumberText(averageAtr),averageAtr,
  };
 });
}

export function contractLoadFinancialChartRows(data:ContractDailyLoadsData,granularity:ContractDailyLoadGranularity='day'):ContractLoadFinancialChartRow[]{
 const buckets=new Map<string,{start:Date;end:Date;label:string;volume:number;loadCount:number;weightedAtr:number;atrVolume:number;gross:number;net:number;billingPending:boolean}>();
 for(const group of data.groups){
  for(const load of group.loads){
   const bucket=bucketFor(load.loadedAt,granularity),key=inputDate(bucket.start),volume=Number(load.volume),atr=nullableNumber(load.atr),gross=nullableNumber(load.grossAmount),net=nullableNumber(load.netAmount);
   const current=buckets.get(key)??{...bucket,volume:0,loadCount:0,weightedAtr:0,atrVolume:0,gross:0,net:0,billingPending:false};
   current.loadCount+=1;
   if(Number.isFinite(volume)){
    current.volume+=volume;
    if(atr!==null){current.weightedAtr+=atr*volume;current.atrVolume+=volume;}
   }
   current.billingPending=current.billingPending||load.billingPending||gross===null||net===null;
   if(gross!==null)current.gross+=gross;
   if(net!==null)current.net+=net;
   buckets.set(key,current);
  }
 }
 return [...buckets.entries()].sort(([left],[right])=>left.localeCompare(right)).map(([key,bucket])=>{
  const averageAtr=bucket.atrVolume>0?bucket.weightedAtr/bucket.atrVolume:null;
  return {
   key,date:key,endDate:inputDate(bucket.end),label:bucket.label,
   volume:bucket.volume,volumeText:preciseNumberText(bucket.volume),loadCount:bucket.loadCount,
   averageAtrText:averageAtr===null?'':preciseNumberText(averageAtr),averageAtr,
   gross:bucket.billingPending?null:bucket.gross,net:bucket.billingPending?null:bucket.net,billingPending:bucket.billingPending,
  };
 });
}

export function contractDailyLoadsChartPages<T>(rows:readonly T[],pageSize=8):T[][]{
 if(!Number.isInteger(pageSize)||pageSize<2)throw new RangeError('O gráfico paginado precisa exibir ao menos duas barras por página.');
 const pages:T[][]=[];
 for(let offset=0;offset<rows.length;){
  const page=rows.slice(offset,offset+pageSize);
  pages.push(page);
  if(offset+page.length>=rows.length)break;
  offset+=pageSize-1;
 }
 return pages;
}
