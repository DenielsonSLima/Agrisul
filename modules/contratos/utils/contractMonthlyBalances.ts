import type {BillingContract,ContractFinancialMetrics} from '../types';
import {monthIsInContractPeriod,type ContractMonthlyPeriod} from './contractMonthlyPeriod';

export type ContractMonthlyBalanceEntry={
 id:string;
 date:string;
 type:'Adiantamento'|'Recebimento'|'Estorno';
 amount:string;
 document:string;
 notes:string;
};

export type ContractMonthlyBalanceRow={
 month:string;
 finance?:ContractFinancialMetrics;
 entries:ContractMonthlyBalanceEntry[];
};

// Presentation model only. Monthly balances and entry values are snapshots supplied by the RPC.
export function contractMonthlyBalanceRows(contract:BillingContract,period?:ContractMonthlyPeriod):ContractMonthlyBalanceRow[]{
 const financial=contract.financialSummary;
 const productionMonths=contract.monthlySummary?.months.map(item=>item.month)??[];
 const payments=financial?.payments??[],refunds=financial?.refunds??[],discounts=financial?.discounts??[];
 const hasRecords=!!(productionMonths.length||payments.length||refunds.length||discounts.length);
 if(!hasRecords)return [];
 const financeByMonth=new Map(financial?.months.map(item=>[item.month,item]));
 const entriesByMonth=new Map<string,ContractMonthlyBalanceEntry[]>();
 const append=(month:string,entry:ContractMonthlyBalanceEntry)=>entriesByMonth.set(month,[...(entriesByMonth.get(month)??[]),entry]);
 for(const payment of payments)append(payment.referenceMonth,{id:payment.id,date:payment.receivedAt,type:payment.kind==='advance'?'Adiantamento':'Recebimento',amount:payment.amount,document:payment.document,notes:payment.notes});
 for(const refund of refunds)append(refund.referenceMonth,{id:refund.id,date:refund.refundedAt,type:'Estorno',amount:refund.amount,document:refund.document,notes:refund.notes});
 for(const entries of entriesByMonth.values())entries.sort((left,right)=>right.date.localeCompare(left.date));
 const months=[...new Set([...productionMonths,...financeByMonth.keys(),...entriesByMonth.keys()])].sort().filter(month=>monthIsInContractPeriod(month,period));
 return months.map(month=>({month,finance:financeByMonth.get(month),entries:entriesByMonth.get(month)??[]}));
}
