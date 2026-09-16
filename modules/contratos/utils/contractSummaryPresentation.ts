import type {ContractListSummary} from '../types';
import {formatAtr,formatContractBilling,formatContractVolume} from './contractFormat';

// Presentation only. Every value and pending flag comes from contracts/list.
export function contractSummaryItems(summary:ContractListSummary){
 return [
  {key:'volume',label:'Volume carregado',value:formatContractVolume(summary.loadedVolume),hint:'Total em toneladas'},
  {key:'atr',label:'Média ATR',value:summary.averageAtr?formatAtr(summary.averageAtr):summary.billingPending?'Aguardando ATR':'—',hint:'Ponderada por volume · kg/t'},
  {key:'gross',label:'Faturado bruto',value:summary.billingPending?'Aguardando ATR':formatContractBilling(summary.grossAmount),hint:'Antes dos descontos'},
  {key:'discount',label:'Descontos',value:formatContractBilling(summary.discountAmount),hint:'Acordos aplicados'},
  {key:'net',label:'Líquido',value:summary.billingPending?'Aguardando ATR':formatContractBilling(summary.netAmount),hint:'Após os descontos'},
  {key:'received',label:'Recebidos',value:formatContractBilling(summary.receivedAmount),hint:'Inclui adiantamentos'},
  {key:'pending',label:'Pendentes',value:summary.billingPending?'Aguardando ATR':formatContractBilling(summary.pendingAmount),hint:'Saldo a receber'},
 ] as const;
}
export const contractSummaryPendingNote='Há contratos sem ATR medido ou cotação. Os indicadores dependentes aguardam o cálculo completo.';
