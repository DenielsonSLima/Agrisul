import type {BillingContract,ContractLoadsData,ContractPricedLoad} from '../types';
import {monthIsInContractPeriod,type ContractMonthlyPeriod} from './contractMonthlyPeriod';

export type ContractMonthlyDeliveryRow={
 month:string;
 loadedVolume:string;
 averageAtr:string;
 atrQuote:string;
 atrReferenceMonth:string;
 grossAmount:string;
 discountAmount:string;
 netAmount:string;
 billingPending:boolean;
 loads:ContractPricedLoad[];
};

// Presentation model only. Monthly totals and every load amount come from the RPC snapshots.
export function contractMonthlyDeliveryRows(contract:BillingContract,loadsData?:ContractLoadsData,period?:ContractMonthlyPeriod):ContractMonthlyDeliveryRow[]{
 const production=new Map(contract.monthlySummary?.months.map(item=>[item.month,item]));
 const finances=new Map(contract.financialSummary?.months.map(item=>[item.month,item]));
 const loadGroups=new Map((loadsData?.groups??[]).map(group=>[group.key,group.loads]));
 const months=[...new Set([...production.keys(),...finances.keys(),...loadGroups.keys()])].sort().filter(month=>monthIsInContractPeriod(month,period));
 return months.map(month=>{
  const productionMonth=production.get(month),financeMonth=finances.get(month);
  return {
   month,
   loadedVolume:financeMonth?.loadedVolume??productionMonth?.loadedVolume??'0',
   averageAtr:financeMonth?.averageAtr??productionMonth?.averageLoadAtr??'',
   atrQuote:productionMonth?.atrQuote??'',
   atrReferenceMonth:productionMonth?.atrReferenceMonth??'',
   grossAmount:financeMonth?.grossAmount??productionMonth?.billingAmount??'',
   discountAmount:financeMonth?.discountAmount??'',
   netAmount:financeMonth?.netAmount??'',
   billingPending:financeMonth?.billingPending??productionMonth?.billingPending??false,
   loads:loadGroups.get(month)??[],
  };
 });
}
