import type {ContractLoadsData} from '../types';

export type ContractDailyLoadPeriod={from:string;to:string};
export type ContractDailyLoadsData=ContractLoadsData;
export type ContractDailyLoadsChartRow={
 date:string;
 volume:number;
 volumeText:string;
 loadCount:number;
 averageAtrText:string;
 variationPercent:number|null;
};
export type ContractDailyLoadsChartSlot=
 |({kind:'day';slotKey:string;linePercent:number|null;variationLabel:null;isVariationBase:boolean}&Omit<ContractDailyLoadsChartRow,'variationPercent'>)
 |{kind:'variation';slotKey:string;date:'';volume:null;volumeText:'';loadCount:0;averageAtrText:'';linePercent:number;variationLabel:number;variationPercent:number;fromDate:string;toDate:string;baseVolume:number;baseVolumeText:string;currentVolume:number;currentVolumeText:string};

const inputDate=(date:Date)=>{
 const year=date.getFullYear(),month=String(date.getMonth()+1).padStart(2,'0'),day=String(date.getDate()).padStart(2,'0');
 return `${year}-${month}-${day}`;
};

export function defaultContractDailyLoadPeriod(today=new Date()):ContractDailyLoadPeriod{
 const end=new Date(today.getFullYear(),today.getMonth(),today.getDate());
 const startMonth=new Date(end.getFullYear(),end.getMonth()-6,1);
 const lastDayOfStartMonth=new Date(startMonth.getFullYear(),startMonth.getMonth()+1,0).getDate();
 const start=new Date(startMonth.getFullYear(),startMonth.getMonth(),Math.min(end.getDate(),lastDayOfStartMonth));
 return {from:inputDate(start),to:inputDate(end)};
}

export function contractDailyLoadPeriodError({from,to}:ContractDailyLoadPeriod){
 if(!from||!to)return 'Informe a data inicial e a data final.';
 if(from>to)return 'A data inicial deve ser igual ou anterior à data final.';
 return '';
}

export function contractDailyLoadsChartRows(data:ContractDailyLoadsData):ContractDailyLoadsChartRow[]{
 const rows=data.groups.map(group=>({
  date:group.key,
  volume:Number(group.volume),
  volumeText:group.volume,
  loadCount:group.loadCount,
  averageAtrText:group.averageAtr,
 })).sort((a,b)=>a.date.localeCompare(b.date));
 return rows.map((row,index)=>({
  ...row,
  variationPercent:index===0||rows[index-1].volume===0?null:(row.volume-rows[index-1].volume)/rows[index-1].volume*100,
 }));
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

export function contractDailyLoadsChartSlots(data:ContractDailyLoadsData):ContractDailyLoadsChartSlot[]{
 const rows=contractDailyLoadsChartRows(data);
 return rows.flatMap((row,index)=>{
  const day:ContractDailyLoadsChartSlot={
   kind:'day',slotKey:`day:${row.date}`,date:row.date,volume:row.volume,volumeText:row.volumeText,loadCount:row.loadCount,averageAtrText:row.averageAtrText,
   linePercent:index===0?0:null,variationLabel:null,isVariationBase:index===0,
  };
  if(index===0)return [day];
  const previous=rows[index-1],variationPercent=row.variationPercent;
  if(variationPercent===null||!Number.isFinite(variationPercent))return [day];
  const transition:ContractDailyLoadsChartSlot={
   kind:'variation',slotKey:`variation:${previous.date}:${row.date}`,date:'',volume:null,volumeText:'',loadCount:0,averageAtrText:'',
   linePercent:variationPercent,variationLabel:variationPercent,variationPercent,
   fromDate:previous.date,toDate:row.date,baseVolume:previous.volume,baseVolumeText:previous.volumeText,currentVolume:row.volume,currentVolumeText:row.volumeText,
  };
  return [transition,day];
 });
}
