import type {AtrRecord} from '../types';
export const atrMonths=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
export const formatAtrValue=(value:string)=>value.replace('.',',');
export function groupAtrByYear(records:AtrRecord[]){
  const years=new Map<number,AtrRecord[]>();
  for(const record of records){const group=years.get(record.year)||[];group.push(record);years.set(record.year,group);}
  return [...years.entries()].sort(([a],[b])=>b-a).map(([year,items])=>({year,records:items.sort((a,b)=>b.month-a.month)}));
}
