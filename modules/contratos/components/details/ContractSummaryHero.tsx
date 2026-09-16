import {Fragment} from 'react';
import {Gauge,PackageCheck,Scale,Truck} from 'lucide-react';
import type {BillingContract} from '../../types';
import type {ContractSummaryDetails} from '../../utils/contractSummaryDetails';
import {formatAtr,formatContractVolume,statusClass} from '../../utils/contractFormat';
import '../../summary-details.css';

export function ContractSummaryHero({contract,summary}:{contract:BillingContract;summary:ContractSummaryDetails}){
 const loaded=Number(summary.totals.loadedVolume),total=Number(summary.totals.contractedVolume);
 const percent=total>0?Math.min(100,loaded/total*100):0,percentLabel=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(percent)+'%';
 const quantities=[
  {icon:Scale,label:'Quantidade do contrato',value:formatContractVolume(summary.totals.contractedVolume),hint:'Total acordado'},
  {icon:PackageCheck,label:'Quantidade entregue',value:formatContractVolume(summary.totals.loadedVolume),hint:`ATR médio: ${formatAtr(summary.totals.finance?.averageAtr??contract.averageAtr)} kg/t`},
  {icon:Truck,label:'Falta entregar',value:formatContractVolume(contract.monthlySummary?.totals.remainingVolume??contract.remainingVolume),hint:'Saldo em toneladas'},
 ];
 const balances=summary.financialItems.filter(item=>item.key==='received'||item.key==='pending'||item.key==='credit');
 return <div className="contract-summary-hero contract-summary-hero-compact">
  <section className="contract-volume-overview">
   <div className="contract-summary-section-heading"><span className="contract-summary-icon"><Gauge size={17}/></span><div><small>Visão operacional</small><h3>Avanço do carregamento</h3></div><span className={'billing-status '+statusClass(contract.status)}>{contract.status}</span></div>
   <div className="contract-volume-body">
    <div className="contract-progress-ring" style={{background:`conic-gradient(#35a56d ${percent*3.6}deg,#dfeae3 0deg)`}} role="progressbar" aria-label="Quantidade carregada" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><span><strong>{percentLabel}</strong><small>carregado</small></span></div>
    <div className="contract-volume-copy"><p>{percent>0?'O contrato já está em andamento.':'O carregamento ainda não foi iniciado.'}</p><div className="contract-volume-values"><span><small>Carregado</small><strong>{formatContractVolume(summary.totals.loadedVolume)}</strong></span><span><small>Do contrato</small><strong>{formatContractVolume(summary.totals.contractedVolume)}</strong></span></div><div className="contract-progress" aria-hidden="true"><span style={{width:`${percent}%`}}/></div></div>
   </div>
  </section>
  <div className="contract-summary-kpis" role="group" aria-label="Quantidades e saldos do contrato">
   {quantities.map((item,index)=>{const Icon=item.icon,balance=balances[index];return <Fragment key={item.label}>
    <article><span className="contract-kpi-icon"><Icon size={17}/></span><div><small>{item.label}</small><strong>{item.value}</strong><p>{item.hint}</p></div></article>
    <article className={'summary-money-'+balance.key}><div><small>{balance.label}</small><strong>{balance.value}</strong><p>{balance.hint}</p></div></article>
   </Fragment>;})}
  </div>
 </div>;
}
