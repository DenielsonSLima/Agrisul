import type {ContractDiscount} from '../types';
import {formatContractBilling} from './contractFormat';

const rateFormatter=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:6});
export const formatDiscountRate=(rate:string)=>rateFormatter.format(Number(rate))+'/t';

export function formatMonthlyDiscount(discount:ContractDiscount,month:string){
 if(!discount.monthlyBreakdown)return 'Indisponível';
 const entry=discount.monthlyBreakdown.find(item=>item.month===month);
 return entry?formatContractBilling(entry.amount):'—';
}
