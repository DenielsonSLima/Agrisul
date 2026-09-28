import type {ContractLoadsData} from '../types';

export type ContractDailyLoadPeriod={from:string;to:string};
export type ContractDailyLoadsData=ContractLoadsData;

const inputDate=(date:Date)=>{
 const year=date.getFullYear(),month=String(date.getMonth()+1).padStart(2,'0'),day=String(date.getDate()).padStart(2,'0');
 return `${year}-${month}-${day}`;
};

export function defaultContractDailyLoadPeriod(today=new Date()):ContractDailyLoadPeriod{
 const end=new Date(today.getFullYear(),today.getMonth(),today.getDate());
 const start=new Date(end);start.setDate(start.getDate()-29);
 return {from:inputDate(start),to:inputDate(end)};
}

export function contractDailyLoadPeriodError({from,to}:ContractDailyLoadPeriod){
 if(!from||!to)return 'Informe a data inicial e a data final.';
 if(from>to)return 'A data inicial deve ser igual ou anterior à data final.';
 return '';
}

export function contractDailyLoadsChartRows(data:ContractDailyLoadsData){
 return data.groups.map(group=>({
  date:group.key,
  volume:Number(group.volume),
  volumeText:group.volume,
  loadCount:group.loadCount,
 })).sort((a,b)=>a.date.localeCompare(b.date));
}
