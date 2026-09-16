'use client';
import {useState} from 'react';
import {ArrowUpRight, FileChartColumn, Truck} from 'lucide-react';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {BillingQueryState} from '@/shared/components/BillingQueryState';
import {currentMonth, decimalLabel, moneyLabel, monthLabel} from '@/shared/utils/presentation';
import {useSummary} from '../hooks/useSummary';
import '../styles.css';

export function ResumoPage() {
  const [month, setMonth] = useState(currentMonth);
  const model = useSummary(month);
  const totals = model.data?.totals;
  return <section className="summary-page"><div className="companies-heading"><div><div className="eyebrow">VISÃO GERAL</div><h2>Resumo</h2><p>Os principais números de {model.company?.name || 'sua empresa'}, em um só lugar.</p></div><label className="summary-period">Mês de referência<input type="month" aria-label="Mês do resumo" min="1900-01" max="9998-12" value={month} onChange={e => {if(e.target.value)setMonth(e.target.value);}}/></label></div>
    <BillingQueryState {...model}/>
    {totals && !model.errorMessage && <div aria-busy={model.isFetching}>
      <div className="summary-highlight"><div><span>MOVIMENTO DE {monthLabel(month).toLocaleUpperCase('pt-BR')}</span><h3>{moneyLabel(totals.netAmount)}</h3><p>Valor líquido após os descontos do mês</p></div><Truck size={38} strokeWidth={1.2}/><div className="summary-highlight-volume"><strong>{decimalLabel(totals.loadedVolume)} <small>t</small></strong><p>Quantidade carregada</p></div></div>
      <dl className="summary-metrics">{[{label:'Faturamento bruto',value:moneyLabel(totals.grossAmount)},{label:'Descontos',value:moneyLabel(totals.discountAmount)},{label:'Recebido e adiantado',value:moneyLabel(totals.receivedAmount)},{label:'Saldo pendente',value:moneyLabel(totals.pendingAmount)}].map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
      {totals.billingPending && <p className="summary-notice" role="status">Há {totals.pendingContractCount} contrato(s) com ATR ou cotação pendente. Os valores financeiros incompletos aparecem como “A apurar”.</p>}
      <div className="summary-context"><span><strong>{totals.activeCount}</strong> contratos ativos de <strong>{totals.contractCount}</strong> cadastrados</span><span>Crédito do mês: <strong>{moneyLabel(totals.creditAmount)}</strong></span>{model.isFetching && <span role="status">Atualizando…</span>}</div>
      <div className="summary-section-heading"><div><h3>Por contrato</h3><p>Valores pela competência do mês selecionado.</p></div><ModuleLink href={`/relatorios?tipo=financial&mes=${month}`} className="text-link">Abrir relatório<FileChartColumn size={16}/></ModuleLink></div>
      {model.data?.contracts.length ? <div className="summary-table-wrap"><table className="summary-table"><thead><tr><th>Cliente / contrato</th><th>Quantidade</th><th>Líquido</th><th>Recebido</th><th>Pendente</th><th><span className="sr-only">Abrir</span></th></tr></thead><tbody>{model.data.contracts.map(contract => <tr key={contract.id}><td><strong>{contract.clientName}</strong><small>{contract.contractNumber || contract.title} · {contract.status}</small></td><td>{decimalLabel(contract.loadedVolume)} t</td><td>{moneyLabel(contract.netAmount)}</td><td>{moneyLabel(contract.receivedAmount)}</td><td>{moneyLabel(contract.pendingAmount)}</td><td><ModuleLink aria-label={`Abrir contrato ${contract.contractNumber || contract.clientName}`} href={`/contratos?contrato=${contract.id}`}><ArrowUpRight size={18}/></ModuleLink></td></tr>)}</tbody></table></div> : <div className="company-empty"><h3>Nenhum contrato cadastrado</h3><p>Cadastre um contrato para acompanhar os resultados da empresa.</p><ModuleLink className="btn" href="/contratos">Abrir contratos</ModuleLink></div>}
      <p className="summary-footnote">Recebimentos e adiantamentos seguem o mês de referência do financeiro. Na Agenda, aparecem no dia em que foram recebidos. Créditos de um contrato não abatem o saldo de outro.</p>
    </div>}
  </section>;
}
