import type {ContractLoadsData} from '../types';

export type ContractDailyLoadPeriod={from:string;to:string};
export type ContractDailyLoadsData=ContractLoadsData;
export type ContractDailyLoadsChartRow={
 date:string;
 volume:number;
 volumeText:string;
 loadCount:number;
 averageAtrText:string;
 averageAtr:number|null;
};

const inputDate=(date:Date)=>{
 const year=date.getFullYear(),month=String(date.getMonth()+1).padStart(2,'0'),day=String(date.getDate()).padStart(2,'0');
 return `${year}-${month}-${day}`;
};
const nullableNumber=(value:string)=>{const parsed=Number(value);return value!==''&&Number.isFinite(parsed)?parsed:null;};

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
  averageAtr:nullableNumber(group.averageAtr),
 })).sort((a,b)=>a.date.localeCompare(b.date));
 return rows;
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
