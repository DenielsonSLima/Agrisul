import {Pencil,Trash2} from 'lucide-react';
import type {ContractDiscount,ContractFinancialSummary} from '../../types';
import {formatContractBilling as money,formatContractMonth,formatContractVolume} from '../../utils/contractFormat';
import {formatDiscountRate,formatMonthlyDiscount} from '../../utils/contractDiscountPresentation';

type Props={
 summary:ContractFinancialSummary;
 month:string;
 busy:boolean;
 onMonth:(month:string)=>void;
 onEdit:(discount:ContractDiscount)=>void;
 onRemove:(discount:ContractDiscount)=>void;
};

export function ContractDiscountTables({summary,month,busy,onMonth,onEdit,onRemove}:Props){
 const columnClass=(index:number)=>'finance-discount-column '+(index%2===0?'finance-discount-column-green':'finance-discount-column-sand');
 return <div className="finance-discount-tables">
   <p className="finance-card-hint">Cada coluna representa um tipo de desconto. Compare os valores mês a mês e consulte a observação no cabeçalho de cada acordo.</p>
   <div className="contract-table-wrap finance-discount-table-wrap" role="region" aria-label="Descontos por mês e tipo" tabIndex={0}>
    <table className="contract-table finance-discount-table finance-discount-monthly-table" style={{minWidth:430+summary.discounts.length*180}}>
     <colgroup><col style={{width:120}}/><col style={{width:150}}/>{summary.discounts.map(entry=><col key={entry.id}/>)}<col style={{width:160}}/></colgroup>
     <thead><tr><th scope="col">Mês</th><th scope="col">Toneladas carregadas</th>{summary.discounts.map((entry,index)=><th scope="col" key={entry.id} className={columnClass(index)} data-discount-id={entry.id}>
      <div className="finance-discount-column-heading"><strong>{entry.title}</strong><span className="finance-discount-rate">{formatDiscountRate(entry.ratePerTon)}</span>
       <div className="finance-entry-actions">
        <button type="button" aria-label={'Editar desconto '+entry.title} disabled={busy} onClick={()=>onEdit(entry)}><Pencil size={15}/></button>
        <button type="button" aria-label={'Excluir desconto '+entry.title} disabled={busy} onClick={()=>onRemove(entry)}><Trash2 size={15}/></button>
       </div>
       <details className="finance-discount-notes"><summary>Observação<span className="sr-only"> de {entry.title}</span></summary><p>{entry.notes||'Não informada.'}</p></details>
      </div>
     </th>)}<th scope="col">Total de descontos</th></tr></thead>
     <tbody>{summary.months.map(item=><tr key={item.month} className={item.month===month?'finance-selected-row':''}>
      <th scope="row"><button type="button" onClick={()=>onMonth(item.month)} aria-pressed={item.month===month}>{formatContractMonth(item.month)}</button></th>
      <td>{formatContractVolume(item.loadedVolume)}</td>
      {summary.discounts.map((entry,index)=><td key={entry.id} className={columnClass(index)} data-discount-id={entry.id}>{formatMonthlyDiscount(entry,item.month)}</td>)}
      <td className="finance-discount-month-total">{money(item.discountAmount)}</td>
     </tr>)}</tbody>
     <tfoot><tr><th scope="row">Geral do contrato</th><td>{formatContractVolume(summary.totals.loadedVolume)}</td>{summary.discounts.map((entry,index)=><td key={entry.id} className={columnClass(index)} data-discount-id={entry.id}>{money(entry.amount)}</td>)}<td>{money(summary.totals.discountAmount)}</td></tr></tfoot>
    </table>
   </div>
   <p className="finance-discount-legend">— Desconto não aplicado no mês. R$ 0,00 indica um mês selecionado sem desconto gerado.</p>
 </div>;
}
