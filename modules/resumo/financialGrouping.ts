export const FINANCIAL_GROUPINGS=[{id:'month',label:'Mensal'},{id:'fortnight',label:'Quinzenal'},{id:'week',label:'Semanal'},{id:'day',label:'Diário'}] as const;
export type FinancialGrouping=typeof FINANCIAL_GROUPINGS[number]['id'];
export function readFinancialGrouping(value:string|null|undefined):FinancialGrouping{return FINANCIAL_GROUPINGS.find(item=>item.id===value)?.id??'month';}
export const financialGroupingKey=(userId:string|null|undefined)=>userId?`billing:dashboard-financial-grouping:v1:${encodeURIComponent(userId)}`:null;
