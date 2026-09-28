import {useId,useState} from 'react';
import {ChevronDown,Landmark} from 'lucide-react';
import type {BillingContract} from '../../types';
import {formatContractBilling,formatContractDate,formatContractMonth} from '../../utils/contractFormat';
import {contractMonthlyBalanceRows,type ContractMonthlyBalanceEntry} from '../../utils/contractMonthlyBalances';
import type {ContractMonthlyPeriod} from '../../utils/contractMonthlyPeriod';
import {summaryReceivedNote} from '../../utils/contractSummaryDetails';
import styles from './ContractMonthlyBalancesTable.module.css';

type ContractMonthlyBalancesTableProps={contract:BillingContract;period?:ContractMonthlyPeriod};

const columns=['Mês','Adiantamentos','Recebimentos','Estornos','Total recebido','Saldo a receber','Crédito'];

export function ContractMonthlyBalancesTable({contract,period}:ContractMonthlyBalancesTableProps){
 const rows=contractMonthlyBalanceRows(contract,period),instanceId=useId();
 const [expandedMonths,setExpandedMonths]=useState<Set<string>>(()=>new Set());
 const toggle=(month:string)=>setExpandedMonths(current=>{
  const next=new Set(current);
  if(next.has(month))next.delete(month);else next.add(month);
  return next;
 });
 return <section className={styles.section} aria-labelledby={`${instanceId}-title`}>
  <h4 id={`${instanceId}-title`}>Entradas e saldos por mês</h4>
  <p>{summaryReceivedNote}</p>
  {!rows.length?<p className={styles.empty}>Nenhuma movimentação lançada.</p>:<div className={styles.summaryScroll} role="region" aria-label="Entradas e saldos por mês" tabIndex={0}>
   <table className={styles.summaryTable}>
    <thead><tr>{columns.map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead>
    <tbody>{rows.map(row=>{
     const monthLabel=formatContractMonth(row.month),expanded=expandedMonths.has(row.month),hasEntries=row.entries.length>0;
     const detailId=`${instanceId}-${row.month}-entries`,finance=row.finance;
     const money=(value:string|undefined,pending=false)=>value===undefined?'—':formatContractBilling(value,pending&&!!finance?.billingPending);
     return [<tr key={`${row.month}-summary`} className={expanded?styles.expandedRow:undefined}>
      <th scope="row"><span className={styles.monthCell}>{hasEntries?<button type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={detailId} aria-label={`${expanded?'Recolher':'Expandir'} lançamentos de ${monthLabel}`} onClick={()=>toggle(row.month)}><ChevronDown size={15}/></button>:<span className={styles.togglePlaceholder} aria-hidden="true"/>}<span>{monthLabel}</span>{hasEntries&&<small>{row.entries.length}</small>}</span></th>
      <td>{money(finance?.advanceAmount)}</td>
      <td>{money(finance?.receiptAmount)}</td>
      <td>{money(finance?.refundedAmount)}</td>
      <td>{money(finance?.receivedAmount)}</td>
      <td>{money(finance?.pendingAmount,true)}</td>
      <td>{money(finance?.creditAmount,true)}</td>
     </tr>,hasEntries&&<tr key={`${row.month}-entries`} className={styles.detailRow} hidden={!expanded}><td colSpan={columns.length}><div id={detailId} className={styles.detailPanel} role="region" aria-label={`Lançamentos de ${monthLabel}`}><header><span><Landmark size={15}/><strong>Lançamentos de {monthLabel}</strong></span><small>{row.entries.length} {row.entries.length===1?'lançamento':'lançamentos'}</small></header><EntryTable entries={row.entries}/></div></td></tr>];
    })}</tbody>
   </table>
  </div>}
 </section>;
}

function EntryTable({entries}:{entries:ContractMonthlyBalanceEntry[]}){
 return <div className={styles.entryScroll} tabIndex={0} role="region" aria-label="Detalhes dos lançamentos financeiros"><table className={styles.entryTable}><thead><tr><th scope="col">Data</th><th scope="col">Tipo</th><th scope="col">Valor</th><th scope="col">Documento / observações</th></tr></thead><tbody>{entries.map(entry=><tr key={`${entry.type}-${entry.id}`}>
  <td data-label="Data"><time dateTime={entry.date}>{formatContractDate(entry.date)}</time></td>
  <td data-label="Tipo"><strong>{entry.type}</strong></td>
  <td data-label="Valor">{formatContractBilling(entry.amount)}</td>
  <td data-label="Documento / observações"><span>{entry.document||'—'}</span>{entry.notes&&<small>{entry.notes}</small>}</td>
 </tr>)}</tbody></table></div>;
}
