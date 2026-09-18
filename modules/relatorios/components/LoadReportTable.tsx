import {dateLabel, decimalLabel, moneyLabel, monthLabel} from '@/shared/utils/presentation';
import type {LoadReportData} from '../types';

const value=(text:string,kind:'decimal'|'money')=>kind==='money'?moneyLabel(text):decimalLabel(text);

export function LoadReportTable({data}:{data:LoadReportData}) {
  if (!data.groups.length) return <div className="company-empty"><h3>Nenhum carregamento encontrado</h3><p>Ajuste o período, a busca ou os filtros de origem.</p></div>;
  return <div className="reports-table-wrap reports-loads-wrap" role="region" aria-label="Carregamentos agrupados por contrato" tabIndex={0}>
    <table className="reports-table reports-loads-table">
      <caption>Carregamentos por contrato — {dateLabel(data.period.from)} a {dateLabel(data.period.to)}</caption>
      <thead><tr><th scope="col">Data / carga</th><th scope="col">Fazenda</th><th scope="col" className="numeric">Quantidade (t)</th><th scope="col" className="numeric">ATR (kg/t)</th><th scope="col" className="numeric">Faturamento</th><th scope="col" className="numeric">Descontos</th><th scope="col" className="numeric">Valor líquido</th></tr></thead>
      {data.groups.map(group=><tbody className="reports-contract-group" key={group.contractId}>
        <tr className="reports-contract-heading"><th scope="rowgroup" colSpan={7}><span>{group.clientName}</span><strong>Contrato {group.contractNumber||group.contractTitle}</strong>{group.contractNumber&&group.contractTitle&&<small>{group.contractTitle}</small>}</th></tr>
        {group.loads.map((load,index)=>[
          <tr className={`reports-load-primary load-tone-${index%2}`} key={`${load.id}-primary`}>
            <th scope="row"><span className="load-index">Carga {index+1}</span><time dateTime={load.loadedAt}>{dateLabel(load.loadedAt)}</time></th>
            <td>{load.farmName}</td><td className="numeric">{value(load.volume,'decimal')}</td><td className="numeric">{value(load.atr,'decimal')}</td><td className="numeric">{value(load.grossAmount,'money')}</td><td className="numeric discount-value">{value(load.discountAmount,'money')}</td><td className="numeric net-value">{value(load.netAmount,'money')}</td>
          </tr>,
          <tr className={`reports-load-detail load-tone-${index%2}`} key={`${load.id}-detail`}>
            <th scope="row"><span className={`load-status ${load.billingPending?'pending':''}`}>{load.billingPending?'A apurar':'Apurado'}</span></th>
            <td colSpan={6}><span><strong>Talhão:</strong> {load.plotName}</span><span><strong>Documento:</strong> {load.document||'—'}</span><span><strong>Referência ATR:</strong> {load.atrReferenceMonth?monthLabel(load.atrReferenceMonth):'—'}</span><span><strong>Cotação:</strong> {value(load.atrQuote,'money')}</span>{load.notes&&<span className="load-notes"><strong>Observações:</strong> {load.notes}</span>}</td>
          </tr>,
        ])}
        <tr className="reports-contract-subtotal"><th scope="row" colSpan={2}>Subtotal do contrato · {group.totals.loadCount} carga(s)</th><td className="numeric">{value(group.totals.volume,'decimal')}</td><td className="numeric">{value(group.totals.averageAtr,'decimal')}</td><td className="numeric">{value(group.totals.grossAmount,'money')}</td><td className="numeric discount-value">{value(group.totals.discountAmount,'money')}</td><td className="numeric net-value">{value(group.totals.netAmount,'money')}</td></tr>
      </tbody>)}
    </table>
  </div>;
}
