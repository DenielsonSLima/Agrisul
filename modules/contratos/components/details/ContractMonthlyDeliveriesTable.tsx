import {useId,useState} from 'react';
import {ChevronDown,Loader2,RotateCcw,Truck} from 'lucide-react';
import {loadPlotLabel} from '@/shared/utils/presentation';
import type {BillingContract,ContractLoadsData,ContractPricedLoad} from '../../types';
import {formatAtr,formatAtrQuote,formatContractDate,formatContractLoadAmount,formatContractMonth,formatContractVolume} from '../../utils/contractFormat';
import {contractMonthlyDeliveryRows} from '../../utils/contractMonthlyDeliveries';
import type {ContractMonthlyPeriod} from '../../utils/contractMonthlyPeriod';
import styles from './ContractMonthlyDeliveriesTable.module.css';

type ContractMonthlyDeliveriesTableProps={
 contract:BillingContract;
 data?:ContractLoadsData;
 loading?:boolean;
 error?:string;
 onRetry?:()=>void|Promise<void>;
 period?:ContractMonthlyPeriod;
};

const columns=['Mês','Entregue (t)','ATR médio (kg/t)','Cotação ATR','Faturado bruto','Descontos','Valor líquido'];

export function ContractMonthlyDeliveriesTable({contract,data,loading=false,error='',onRetry,period}:ContractMonthlyDeliveriesTableProps){
 const rows=contractMonthlyDeliveryRows(contract,data,period),instanceId=useId();
 const [expandedMonths,setExpandedMonths]=useState<Set<string>>(()=>new Set());
 const toggle=(month:string)=>setExpandedMonths(current=>{
  const next=new Set(current);
  if(next.has(month))next.delete(month);else next.add(month);
  return next;
 });
 return <section className={styles.section} aria-labelledby={`${instanceId}-title`}>
  <h4 id={`${instanceId}-title`}>Entregas e faturamento por mês</h4>
  <p>A cotação usa o mês do carregamento; quando ela ainda não existe, usa a referência disponível do mês anterior.</p>
  {error&&<div className={styles.feedback} role="alert"><span>{error}</span>{onRetry&&<button type="button" onClick={()=>void onRetry()}><RotateCcw size={14}/>Tentar novamente</button>}</div>}
  {!rows.length?<p className={styles.empty}>Nenhuma movimentação lançada.</p>:<div className={styles.summaryScroll} role="region" aria-label="Entregas e faturamento por mês" tabIndex={0}>
   <table className={styles.summaryTable}>
    <thead><tr>{columns.map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead>
    <tbody>{rows.map(row=>{
     const monthLabel=formatContractMonth(row.month),expanded=expandedMonths.has(row.month),hasLoads=row.loads.length>0;
     const detailId=`${instanceId}-${row.month}-loads`;
     return [<tr key={`${row.month}-summary`} className={expanded?styles.expandedRow:undefined}>
      <th scope="row"><span className={styles.monthCell}>{hasLoads?<button type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={detailId} aria-label={`${expanded?'Recolher':'Expandir'} carregamentos de ${monthLabel}`} onClick={()=>toggle(row.month)}><ChevronDown size={15}/></button>:loading?<span className={styles.loadingIcon} role="status" aria-label={`Carregando carregamentos de ${monthLabel}`}><Loader2 size={14}/></span>:<span className={styles.togglePlaceholder} aria-hidden="true"/>}<span>{monthLabel}</span>{hasLoads&&<small>{row.loads.length}</small>}</span></th>
      <td>{formatContractVolume(row.loadedVolume)}</td>
      <td>{formatAtr(row.averageAtr)}</td>
      <td>{row.atrReferenceMonth?<><span>{formatAtrQuote(row.atrQuote)}</span><small>Ref. {formatContractMonth(row.atrReferenceMonth)}</small></>:'—'}</td>
      <td>{formatContractLoadAmount(row.grossAmount,row.billingPending)}</td>
      <td>{row.discountAmount?formatContractLoadAmount(row.discountAmount):'—'}</td>
      <td>{formatContractLoadAmount(row.netAmount,row.billingPending)}</td>
     </tr>,hasLoads&&<tr key={`${row.month}-loads`} className={styles.detailRow} hidden={!expanded}><td colSpan={columns.length}><div id={detailId} className={styles.detailPanel} role="region" aria-label={`Carregamentos de ${monthLabel}`}><header><span><Truck size={15}/><strong>Carregamentos de {monthLabel}</strong></span><small>{row.loads.length} {row.loads.length===1?'carregamento':'carregamentos'}</small></header><LoadTable loads={row.loads}/></div></td></tr>];
    })}</tbody>
   </table>
  </div>}
 </section>;
}

function LoadTable({loads}:{loads:ContractPricedLoad[]}){
 return <div className={styles.loadScroll} tabIndex={0} role="region" aria-label="Detalhes dos carregamentos"><table className={styles.loadTable}><thead><tr><th scope="col">Data</th><th scope="col">Origem</th><th scope="col">Quantidade</th><th scope="col">ATR</th><th scope="col">Cotação / referência</th><th scope="col">Faturamento</th><th scope="col">Desconto</th><th scope="col">Valor líquido</th><th scope="col">Documento / observações</th></tr></thead><tbody>{loads.map(load=><tr key={load.id}>
  <td data-label="Data"><time dateTime={load.loadedAt}>{formatContractDate(load.loadedAt)}</time></td>
  <td data-label="Origem"><strong>{load.farmName}</strong><small className={!load.plotId.trim()?styles.missingPlot:undefined}>{loadPlotLabel(load.plotName)}</small></td>
  <td data-label="Quantidade">{formatContractVolume(load.volume)}</td>
  <td data-label="ATR">{formatAtr(load.atr)}</td>
  <td data-label="Cotação / referência"><span>{formatAtrQuote(load.atrQuote)}</span><small>{load.atrReferenceMonth?`Ref. ${formatContractMonth(load.atrReferenceMonth)}`:'Referência indisponível'}</small></td>
  <td data-label="Faturamento">{formatContractLoadAmount(load.grossAmount,load.billingPending)}</td>
  <td data-label="Desconto">{formatContractLoadAmount(load.discountAmount)}</td>
  <td data-label="Valor líquido"><strong>{formatContractLoadAmount(load.netAmount,load.billingPending)}</strong></td>
  <td data-label="Documento / observações"><span>{load.document||'—'}</span>{load.notes&&<small>{load.notes}</small>}</td>
 </tr>)}</tbody></table></div>;
}
