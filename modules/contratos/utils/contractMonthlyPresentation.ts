import type {BillingContract,ContractFinancialMetrics,ContractMonthlyRow} from '../types';
import {formatContractBilling} from './contractFormat';

export type ContractSummaryMonth=Pick<ContractMonthlyRow,'month'|'atrReferenceMonth'|'loadedVolume'|'averageLoadAtr'|'atrQuote'|'billingAmount'|'billingPending'>&{finance?:ContractFinancialMetrics};

// Join RPC results by reference month for display. Amounts and balances are
// already calculated in Postgres, including rounding and pending ATR values.
export function contractMonthlyPresentation(contract:BillingContract){
 const production=contract.monthlySummary;
 const financial=contract.financialSummary;
 const loads=new Map(production?.months.map(item=>[item.month,item]));
 const finances=new Map(financial?.months.map(item=>[item.month,item]));
 // Include payment-only months, without adding empty months from scheduled discounts.
 const months=[...new Set([...loads.keys(),...(financial?.payments.map(item=>item.referenceMonth)??[]),...(financial?.refunds?.map(item=>item.referenceMonth)??[])])].sort();
 const rows:ContractSummaryMonth[]=months.map(month=>{
  const load=loads.get(month),finance=finances.get(month);
  return {
   month,atrReferenceMonth:load?.atrReferenceMonth??'',atrQuote:load?.atrQuote??'',
   loadedVolume:finance?.loadedVolume??load?.loadedVolume??'',
   averageLoadAtr:finance?.averageAtr??load?.averageLoadAtr??'',
   billingAmount:finance?.grossAmount??load?.billingAmount??'',
   billingPending:finance?.billingPending??load?.billingPending??false,
   finance,
  };
 });
 const finance=financial?.totals??contract.financialTotals;
 return {months:rows,totals:{
  contractedVolume:production?.totals.contractedVolume??contract.contractedVolume,
  loadedVolume:finance?.loadedVolume??production?.totals.loadedVolume??contract.loadedVolume,
  billingAmount:finance?.grossAmount??production?.totals.billingAmount??contract.billingAmount,
  billingPending:finance?.billingPending??production?.totals.billingPending??contract.billingPending,
  finance,
 }};
}

export function contractMonthlyFinanceItems(finance?:ContractFinancialMetrics){
 return [
  {key:'discount',label:'Descontos',value:finance?formatContractBilling(finance.discountAmount):'—',hint:'Acordos por tonelada',pending:false},
  {key:'net',label:'Líquido',value:finance?formatContractBilling(finance.netAmount,finance.billingPending):'—',hint:'Após os descontos',pending:!!finance?.billingPending},
  {key:'received',label:'Recebido',value:finance?formatContractBilling(finance.receivedAmount):'—',hint:'Entradas menos estornos',pending:false},
  {key:'pending',label:'Pendente',value:finance?formatContractBilling(finance.pendingAmount,finance.billingPending):'—',hint:'Saldo a receber',pending:!!finance?.billingPending},
 ] as const;
}
