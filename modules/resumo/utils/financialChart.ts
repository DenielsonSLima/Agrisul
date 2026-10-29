import type {ExecutiveFinancialDay,ExecutiveFinancialPeriod,ExecutiveSummaryMonth,ExecutiveGrossVariation} from '../types';
import type {FinancialGrouping} from '../financialGrouping';
export type FinancialChartRow=ExecutiveGrossVariation&{key:string;endDate?:string;granularity:FinancialGrouping;loadCount:number;billingPending:boolean;grossAmount:string;netAmount:string;receivedAmount:string};
/** Format the percentage supplied by Postgres; no client-side variation math. */
export function grossChangeLabel(row:ExecutiveGrossVariation){
 if(row.grossChangePercent===undefined)return 'A apurar';
 if(row.grossChangePercent==='')return row.grossChangeReason==='zero-base'?'Sem base':row.grossChangeReason==='initial'?'—':'A apurar';
 const value=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2,signDisplay:'exceptZero'}).format(Number(row.grossChangePercent));
 return `${value}%`;
}
const nonzero=(value:string)=>/[1-9]/.test(value);
export function financialChartRows(months:readonly ExecutiveSummaryMonth[],days?:readonly ExecutiveFinancialDay[],grouping:FinancialGrouping=days===undefined?'month':'day',periods?:readonly ExecutiveFinancialPeriod[]):FinancialChartRow[]{
 return (grouping==='month'?months.map(row=>({...row,key:row.month,granularity:'month' as const})):(grouping==='day'?days??[]:periods??[]).map(row=>({...row,key:row.date,granularity:grouping})))
  .filter(row=>row.loadCount>0||row.billingPending||nonzero(row.grossAmount)||nonzero(row.netAmount)||nonzero(row.receivedAmount));
}
/** Geometry only: choose a readable number of periods without aggregating money. */
export function financialChartCapacity(width:number,longestLabel:number){
 const usable=Math.max(0,width-76),minimum=Math.max(180,Math.min(370,longestLabel*6.8*2+32));
 return Math.max(1,Math.min(16,Math.floor(usable/minimum)));
}
export function financialChartPage<T>(rows:readonly T[],capacity:number,page:number):T[]{
 const end=Math.max(0,rows.length-Math.max(0,page)*Math.max(1,capacity));
 return rows.slice(Math.max(0,end-Math.max(1,capacity)),end);
}
