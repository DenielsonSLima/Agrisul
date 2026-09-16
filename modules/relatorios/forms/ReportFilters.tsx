import type {ReportKind} from '../types';
export function ReportFilters({kind, month, onMonth}: {kind: ReportKind; month: string; onMonth: (value: string) => void}) {
  return <div className="reports-filters">{['loads','financial'].includes(kind) ? <label>Mês de referência<input type="month" min="1900-01" max="9998-12" aria-label="Mês do relatório" value={month} onChange={e => {if(e.target.value)onMonth(e.target.value);}}/></label> : <p>{kind === 'farms' ? 'As fazendas são compartilhadas por todas as empresas do espaço de trabalho.' : 'Todos os contratos da empresa selecionada, incluindo os finalizados.'}</p>}</div>;
}
