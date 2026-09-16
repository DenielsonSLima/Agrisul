import type {BillingContract,ContractFinancialMetrics} from '../types';
import {contractMonthlyPresentation} from './contractMonthlyPresentation';
import {formatDiscountRate} from './contractDiscountPresentation';
import {contractPeriod,formatAtr,formatAtrCriterion,formatAtrQuote,formatContractBilling,formatContractDate,formatContractMonth,formatContractVolume} from './contractFormat';

export const summaryReceivedNote='O total recebido inclui adiantamentos e recebimentos. Os saldos mensais consideram o mês de referência de cada lançamento; o saldo geral é o do contrato inteiro.';
export const summaryPendingNote='Há entregas sem ATR medido ou cotação. Faturamento, líquido, saldo a receber e crédito aguardam o cálculo completo. Os valores recebidos continuam disponíveis.';
export const summaryUnavailableNote='Os dados financeiros não estão disponíveis neste resumo. Atualize o contrato para consultar recebimentos, descontos e saldos.';

// Presentation only: amounts, aggregates and balances are supplied by the RPC.
export function summaryFinancialItems(finance?:ContractFinancialMetrics){
 const amount=(key:keyof ContractFinancialMetrics,pending=false)=>finance?formatContractBilling(String(finance[key]),pending&&finance.billingPending):'—';
 return [
  {key:'gross',label:'Faturado bruto',value:amount('grossAmount',true),hint:'Valor das entregas, antes dos descontos'},
  {key:'discount',label:'Descontos',value:amount('discountAmount'),hint:'Acordos aplicados às entregas'},
  {key:'net',label:'Valor líquido',value:amount('netAmount',true),hint:'Faturamento após descontos'},
  {key:'advance',label:'Adiantamentos',value:amount('advanceAmount'),hint:'Antecipações já recebidas'},
  {key:'receipt',label:'Recebimentos',value:amount('receiptAmount'),hint:'Pagamentos além dos adiantamentos'},
  {key:'received',label:'Total recebido',value:amount('receivedAmount'),hint:'Adiantamentos + recebimentos'},
  {key:'pending',label:'Saldo a receber',value:amount('pendingAmount',true),hint:'Saldo geral após as entradas'},
  {key:'credit',label:'Crédito do contrato',value:amount('creditAmount',true),hint:'Recebido além do valor líquido'},
 ] as const;
}

export type SummaryTable={title:string;description:string;columns:string[];widths:number[];rows:string[][];empty:string};

export function contractSummaryDetails(contract:BillingContract){
 const presentation=contractMonthlyPresentation(contract);
 const financial=contract.financialSummary;
 const production=new Map(contract.monthlySummary?.months.map(item=>[item.month,item]));
 const finances=new Map(financial?.months.map(item=>[item.month,item]));
 // Use the financial calendar, including months with payments or agreed discounts.
 // The RPC also includes the current month; an entirely empty contract stays empty.
 const hasRecords=!!(production.size||financial?.payments.length||financial?.discounts.length);
 const months=hasRecords?[...new Set([...production.keys(),...finances.keys()])].sort():[];
 const rows=months.map(month=>({month,production:production.get(month),finance:finances.get(month)}));
 const finance=presentation.totals.finance;
 const remaining=contract.monthlySummary?.totals.remainingVolume??contract.remainingVolume;
 const averageAtr=finance?.averageAtr??contract.monthlySummary?.totals.averageLoadAtr??contract.averageAtr;
 const financialItems=[...summaryFinancialItems(finance)];
 if(!finance)financialItems[0]={...financialItems[0],value:formatContractBilling(presentation.totals.billingAmount,presentation.totals.billingPending)};
 const monthlyMoney=(entry:typeof rows[number],key:keyof ContractFinancialMetrics,pending=false)=>entry.finance?formatContractBilling(String(entry.finance[key]),pending&&entry.finance.billingPending):'—';
 const deliveryTable:SummaryTable={
  title:'Entregas e faturamento por mês',description:'Cotação do mês anterior, conforme o critério do ATR do contrato.',
  columns:['Mês','Entregue (t)','ATR médio (kg/t)','Cotação ATR','Faturado bruto','Descontos','Valor líquido'],widths:[.10,.14,.13,.13,.18,.15,.17],
  rows:rows.map(entry=>[formatContractMonth(entry.month),formatContractVolume(entry.finance?.loadedVolume??entry.production?.loadedVolume??'0'),formatAtr(entry.finance?.averageAtr??entry.production?.averageLoadAtr??''),entry.production?`${formatAtrQuote(entry.production.atrQuote)}\nRef. ${formatContractMonth(entry.production.atrReferenceMonth)}`:'—',entry.finance?monthlyMoney(entry,'grossAmount',true):formatContractBilling(entry.production?.billingAmount??'',entry.production?.billingPending),monthlyMoney(entry,'discountAmount'),monthlyMoney(entry,'netAmount',true)]),
  empty:'Nenhuma movimentação lançada.',
 };
 const balanceTable:SummaryTable={
  title:'Entradas e saldos por mês',description:summaryReceivedNote,
  columns:['Mês','Adiantamentos','Recebimentos','Total recebido','Saldo a receber','Crédito'],widths:[.10,.18,.18,.18,.18,.18],
  rows:rows.map(entry=>[formatContractMonth(entry.month),monthlyMoney(entry,'advanceAmount'),monthlyMoney(entry,'receiptAmount'),monthlyMoney(entry,'receivedAmount'),monthlyMoney(entry,'pendingAmount',true),monthlyMoney(entry,'creditAmount',true)]),empty:'Nenhuma movimentação lançada.',
 };
 const payments:SummaryTable={
  title:'Histórico de adiantamentos e recebimentos',description:'Data de entrada, referência no contrato e comprovantes dos valores recebidos.',
  columns:['Recebido em','Referência','Tipo','Valor','Documento / observações'],widths:[.14,.13,.17,.20,.36],
  rows:(financial?.payments??[]).map(entry=>[formatContractDate(entry.receivedAt),formatContractMonth(entry.referenceMonth),entry.kind==='advance'?'Adiantamento':'Recebimento',formatContractBilling(entry.amount),[entry.document,entry.notes].filter(Boolean).join('\n')||'—']),empty:financial?'Nenhum adiantamento ou recebimento lançado.':'Histórico financeiro indisponível.',
 };
 const discounts:SummaryTable={
  title:'Acordos de desconto',description:'Valores por tonelada e meses aos quais cada acordo se aplica.',
  columns:['Acordo / observações','Valor por tonelada','Meses de aplicação','Base entregue','Desconto total'],widths:[.27,.16,.23,.16,.18],
  rows:(financial?.discounts??[]).map(entry=>[[entry.title,entry.notes].filter(Boolean).join('\n'),formatDiscountRate(entry.ratePerTon),entry.months.map(formatContractMonth).join(', '),formatContractVolume(entry.loadedVolume),formatContractBilling(entry.amount)]),empty:financial?'Nenhum acordo de desconto cadastrado.':'Acordos financeiros indisponíveis.',
 };
 return {
  ...presentation,months:rows,financialItems,
  chartMonths:rows.map(entry=>({month:entry.month,atrReferenceMonth:entry.production?.atrReferenceMonth??'',atrQuote:entry.production?.atrQuote??'',loadedVolume:entry.finance?.loadedVolume??entry.production?.loadedVolume??'0',averageLoadAtr:entry.finance?.averageAtr??entry.production?.averageLoadAtr??'',billingAmount:entry.finance?.grossAmount??entry.production?.billingAmount??'',billingPending:entry.finance?.billingPending??entry.production?.billingPending??false,finance:entry.finance})),
  operationalItems:[
   {label:'Quantidade do contrato',value:formatContractVolume(presentation.totals.contractedVolume),hint:'Total acordado'},
   {label:'Quantidade entregue',value:formatContractVolume(presentation.totals.loadedVolume),hint:'Carregamentos realizados'},
   {label:'Falta entregar',value:formatContractVolume(remaining),hint:'Saldo em toneladas'},
   {label:'ATR médio',value:formatAtr(averageAtr),hint:'Ponderado pelas entregas · kg/t'},
  ],
  conditions:[{label:'Número do contrato',value:contract.contractNumber||'Não informado'},{label:'Empresa',value:contract.companyName},{label:'Cliente',value:contract.clientName},{label:'Tipo de contrato',value:contract.typeName},{label:'Situação',value:contract.status},{label:'Vigência',value:contractPeriod(contract.startDate,contract.endDate)},{label:'Critério do ATR',value:formatAtrCriterion(contract.atrPriceType,contract.atrPeriodType)}],
  notice:!finance?summaryUnavailableNote:finance.billingPending?summaryPendingNote:'',
  tables:[deliveryTable,balanceTable,payments,discounts],
 };
}

export type ContractSummaryDetails=ReturnType<typeof contractSummaryDetails>;
