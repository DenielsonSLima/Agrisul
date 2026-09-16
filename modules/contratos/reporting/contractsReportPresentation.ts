import type {BillingContract} from '../types';
import {formatCnpj} from '@/shared/utils/cnpj';
import {formatAtr,formatAtrQuote,formatAtrCriterion,formatContractBilling,formatContractDate,formatContractVolume} from '../utils/contractFormat';

export const contractsReportOrientation='landscape' as const;
export const contractsReportColumns=[
 {key:'client',label:'Cliente',width:24},
 {key:'number',label:'Contrato',width:10},
 {key:'date',label:'Data',width:9},
 {key:'contracted',label:'Qtd. contratada\n(t)',width:11},
 {key:'loaded',label:'Qtd. carregada\n(t)',width:11},
 {key:'remaining',label:'Qtd. pendente\n(t)',width:11},
 {key:'atr',label:'ATR médio\n(kg/t)',width:10},
 {key:'quote',label:'Cotação média ATR¹\n(R$/kg ATR)',width:14},
] as const;

// Company green, warm green tints and charcoal text, shared by preview and PDF.
const neutralMetric={background:'#f5f9f1',accent:'#006b2d',text:'#263322'} as const;
export const contractsReportColors={
 neutral:neutralMetric,
 volume:neutralMetric,
 atr:neutralMetric,
 gross:neutralMetric,
 discount:neutralMetric,
 net:{background:'#e4f0dc',accent:'#006b2d',text:'#004f20'},
 received:{background:'#eff7e9',accent:'#006b2d',text:'#004f20'},
 pending:{background:'#eaf3e3',accent:'#006b2d',text:'#004f20'},
 advance:neutralMetric,
 credit:neutralMetric,
} as const;
export type ContractsReportTone=keyof typeof contractsReportColors;
export type ContractsReportCell={key:string;label:string;value:string;detail?:string;tone:ContractsReportTone};
export const contractsReportNote='¹ Cotação ponderada pelo volume, pelo critério do contrato e pelo mês anterior ao carregamento. ² Despesas: descontos e acordos do financeiro. ³ Recebidos já incluem adiantamentos; não somar novamente. Excedente recebido é o valor acima do líquido. Qtd. pendente é o volume a carregar.';

// Presentation only: quantities, balances and pending flags all come from the RPC.
export function contractsReportRow(contract:BillingContract){
 const quote=contract.atrQuoteSummary,finance=contract.financialTotals;
 const quotation=quote?.pending?'Pendente':quote?.average?formatAtrQuote(quote.average):'—';
 const financialValue=(key:'grossAmount'|'discountAmount'|'netAmount'|'receivedAmount'|'advanceAmount'|'pendingAmount'|'creditAmount',dependsOnAtr=false)=>{
  if(!finance)return '—';
  if(dependsOnAtr&&finance.billingPending)return 'Aguardando ATR';
  return finance[key]==null||finance[key]===''?'—':formatContractBilling(finance[key]);
 };
 const operational:ContractsReportCell[]=[
  {key:'number',label:'Contrato',value:contract.contractNumber||'—',tone:'neutral'},
  {key:'date',label:'Data',value:formatContractDate(contract.startDate),tone:'neutral'},
  {key:'contracted',label:'Qtd. contratada',value:formatContractVolume(contract.contractedVolume),tone:'volume'},
  {key:'loaded',label:'Qtd. carregada',value:formatContractVolume(contract.loadedVolume),tone:'volume'},
  {key:'remaining',label:'Qtd. pendente',value:formatContractVolume(contract.remainingVolume),tone:'pending'},
  {key:'atr',label:'ATR médio',value:formatAtr(contract.averageAtr),tone:'atr'},
  {key:'quote',label:'Cotação média ATR¹',value:quotation,detail:formatAtrCriterion(contract.atrPriceType,contract.atrPeriodType),tone:'atr'},
 ];
 const financial:ContractsReportCell[]=[
  {key:'gross',label:'Faturado bruto',value:financialValue('grossAmount',true),tone:'gross'},
  {key:'discount',label:'Despesas²',value:financialValue('discountAmount'),tone:'discount'},
  {key:'net',label:'Líquido',value:financialValue('netAmount',true),tone:'net'},
  {key:'received',label:'Recebidos³',value:financialValue('receivedAmount'),tone:'received'},
  {key:'advance',label:'Adiantamentos³',value:financialValue('advanceAmount'),tone:'advance'},
  {key:'pending',label:'A receber',value:financialValue('pendingAmount',true),tone:'pending'},
  {key:'credit',label:'Excedente recebido',value:financialValue('creditAmount',true),tone:'credit'},
 ];
 return {client:contract.clientName,cnpj:formatCnpj(contract.clientCnpj),operational,financial};
}
