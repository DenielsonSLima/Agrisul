import type {ContractLoadsData} from '../types';

export type ContractDailyLoadPeriod={from:string;to:string};
export type ContractDailyLoadsData=ContractLoadsData;

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

export function contractDailyLoadsChartRows(data:ContractDailyLoadsData){
 const rows=data.groups.map(group=>({
  date:group.key,
  volume:Number(group.volume),
  volumeText:group.volume,
  loadCount:group.loadCount,
 })).sort((a,b)=>a.date.localeCompare(b.date));
 return rows.map((row,index)=>({
  ...row,
  variationPercent:index===0||rows[index-1].volume===0?null:(row.volume-rows[index-1].volume)/rows[index-1].volume*100,
 }));
}
