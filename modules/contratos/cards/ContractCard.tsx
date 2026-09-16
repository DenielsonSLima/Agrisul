import {ArrowUpRight,CalendarDays,CircleDollarSign,FileText,Scale,Truck,Wallet} from 'lucide-react';
import {formatCnpj} from '@/shared/utils/cnpj';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import type {BillingContract} from '../types';
import {contractHref,formatContractBilling,formatContractDate,formatContractVolume,statusClass} from '../utils/contractFormat';
import './contractCard.css';

export function ContractCard({contract:c}:{contract:BillingContract}){
 const contracted=Number(c.contractedVolume||0),loaded=Number(c.loadedVolume||0);const rawPercentage=contracted>0?loaded/contracted*100:0;const percentage=Number.isFinite(rawPercentage)?Math.max(0,Math.min(100,rawPercentage)):0;
 const percentageLabel=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(rawPercentage||0)+'%';
 const typeName=c.typeName.replace(/^contrato\s+/i,'')||c.typeName;
 const finance=c.financialTotals;
 const billingPending=finance?.billingPending??c.billingPending;
 const financialValue=(key:'grossAmount'|'discountAmount'|'netAmount'|'receivedAmount'|'pendingAmount'|'creditAmount',dependsOnAtr=false)=>{
  if(dependsOnAtr&&billingPending)return 'Aguardando ATR';
  const value=finance?.[key];
  return value==null||value===''?'—':formatContractBilling(value);
 };
 const hasCredit=!billingPending&&Number(finance?.creditAmount)>0;
 const balanceKey=hasCredit?'creditAmount':'pendingAmount';
 const balanceAvailable=finance?.[balanceKey]!=null&&finance[balanceKey]!=='';
 const hasPending=!billingPending&&Number(finance?.pendingAmount)>0;
 const balanceLabel=hasCredit?'Crédito do cliente':'Saldo a receber';
 const balanceNote=billingPending?'Aguardando ATR para apurar o saldo':!balanceAvailable?'Resumo financeiro indisponível':hasCredit?'Recebido acima do valor líquido':hasPending?'Pendente de recebimento':'Sem valor pendente de recebimento';
 const balanceTone=billingPending||!balanceAvailable?'unavailable':hasCredit?'credit':hasPending?'pending':'settled';
 return <ModuleLink className="contract-card" href={contractHref(c.id)} aria-label={'Abrir contrato '+(c.contractNumber?c.contractNumber+' de ':'de ')+c.clientName}>
  <header className="contract-card-identity">
   <div className="contract-card-heading"><h3 title={c.clientName}>{c.clientName}</h3><span className={'billing-status '+statusClass(c.status)}>{c.status}</span></div>
   <p className="contract-card-cnpj">{c.clientCnpj?'CNPJ: '+formatCnpj(c.clientCnpj):'CNPJ não informado'}</p>
   <div className="contract-card-reference">
    <p className="contract-card-number"><FileText size={13} aria-hidden="true"/><span>Contrato <strong>{c.contractNumber?'Nº '+c.contractNumber:'não informado'}</strong></span></p>
    <span className="contract-card-type-badge" aria-label={'Tipo do contrato: '+typeName} title={typeName}>{typeName}</span>
   </div>
  </header>
  <div className="contract-card-footer"><span><CalendarDays size={15} aria-hidden="true"/><small>Data do contrato</small><strong>{formatContractDate(c.startDate)}</strong></span><span><Scale size={15} aria-hidden="true"/><small>Volume do contrato</small><strong>{formatContractVolume(c.contractedVolume)}</strong></span></div>
  <section className="contract-card-section contract-card-delivery" aria-label="Resumo das entregas">
   <div className="contract-card-section-heading"><h4><Truck size={14} aria-hidden="true"/>Entregas</h4><span>{percentageLabel} entregue</span></div>
   <dl className="contract-card-metrics"><div className="contract-card-delivered"><dt>Entregue</dt><dd>{formatContractVolume(c.loadedVolume)}</dd></div><div className="contract-card-to-deliver"><dt>Pendente de entrega</dt><dd>{formatContractVolume(c.remainingVolume)}</dd></div></dl>
   <span className="contract-card-progress" role="progressbar" aria-label="Progresso do volume carregado" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percentage)} aria-valuetext={`${formatContractVolume(c.loadedVolume)} carregadas de ${formatContractVolume(c.contractedVolume)} · ${percentageLabel}`}><span style={{width:`${percentage}%`}}/></span>
  </section>
  <section className="contract-card-section contract-card-financial" aria-label="Resumo financeiro">
   <div className="contract-card-section-heading"><h4><CircleDollarSign size={14} aria-hidden="true"/>Financeiro</h4></div>
   <dl className="contract-card-metrics">
    <div><dt>Faturado bruto</dt><dd>{financialValue('grossAmount',true)}</dd></div>
    <div><dt>Descontos</dt><dd>{financialValue('discountAmount')}</dd></div>
    <div className="contract-card-net"><dt>Valor líquido</dt><dd>{financialValue('netAmount',true)}</dd></div>
    <div className="contract-card-received"><dt>Recebido</dt><dd>{financialValue('receivedAmount')}</dd></div>
   </dl>
   <p className="contract-card-financial-note">Recebido inclui adiantamentos.</p>
  </section>
  <section className={'contract-card-balance contract-card-balance-'+balanceTone} aria-label="Saldo financeiro do contrato">
   <div><Wallet size={15} aria-hidden="true"/><span>{balanceLabel}</span></div>
   <strong>{financialValue(balanceKey,true)}</strong>
   <p>{balanceNote}</p>
  </section>
  <span className="contract-card-open">Ver contrato <ArrowUpRight size={15} aria-hidden="true"/></span>
 </ModuleLink>;
}
