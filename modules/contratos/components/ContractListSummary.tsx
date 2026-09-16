import {ArrowDownToLine,ChartNoAxesCombined,CircleDollarSign,Clock3,Percent,Scale,Wallet} from 'lucide-react';
import type {ContractBucket,ContractListSummary as Summary} from '../types';
import {contractSummaryItems,contractSummaryPendingNote} from '../utils/contractSummaryPresentation';
import '../summary.css';

const icons={volume:Scale,atr:ChartNoAxesCombined,gross:CircleDollarSign,discount:Percent,net:Wallet,received:ArrowDownToLine,pending:Clock3};
export function ContractListSummary({summary,bucket,total,loading}:{summary:Summary|null;bucket:ContractBucket;total:number;loading:boolean}){
 return <section className="contracts-overview" aria-label="Resumo dos contratos filtrados" aria-busy={loading}>
  <div className="contracts-overview-heading"><h3><ChartNoAxesCombined size={16} aria-hidden="true"/>Visão dos contratos</h3><span>{bucket==='open'?'Em aberto':'Finalizados'}<i aria-hidden="true"/> {loading?'Atualizando…':`${total} contrato${total===1?'':'s'}`}</span></div>
  <div className="contracts-overview-scroll" tabIndex={0} role="region" aria-label="Indicadores; role para o lado em telas menores">
   <dl className="contracts-overview-metrics">{summary&&!loading?contractSummaryItems(summary).map(item=>{const Icon=icons[item.key];return <div className={`contracts-overview-item contracts-overview-${item.key}`} key={item.key}><dt><Icon size={14} aria-hidden="true"/>{item.label}</dt><dd>{item.value}</dd><span>{item.hint}</span></div>;}):Object.keys(icons).map(key=><div key={key} className="contracts-overview-item contracts-overview-skeleton" aria-hidden="true"><span/><span/><span/></div>)}</dl>
  </div>
  {summary?.billingPending&&!loading&&<p className="contracts-overview-note" role="status">{contractSummaryPendingNote}</p>}
 </section>;
}
