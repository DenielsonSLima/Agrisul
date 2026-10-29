import type {ExecutiveFinancialDay,ExecutiveSummaryMonth} from '../types';
export type FinancialChartRow={key:string;granularity:'day'|'month';loadCount:number;billingPending:boolean;grossAmount:string;netAmount:string;receivedAmount:string};
const nonzero=(value:string)=>/[1-9]/.test(value);
export function financialChartRows(months:readonly ExecutiveSummaryMonth[],days?:readonly ExecutiveFinancialDay[]):FinancialChartRow[]{
 return (days===undefined?months.map(row=>({...row,key:row.month,granularity:'month' as const})):days.map(row=>({...row,key:row.date,granularity:'day' as const})))
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
