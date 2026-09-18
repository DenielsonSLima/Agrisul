import {useState} from 'react';
import {Search, SlidersHorizontal, X} from 'lucide-react';
import type {LoadReportFilters, LoadReportOrigin, ReportKind} from '../types';

export function ReportFilters({kind,month,onMonth,filters,origins,onFilters}:{kind:ReportKind;month:string;onMonth:(value:string)=>void;filters:LoadReportFilters;origins:LoadReportOrigin[];onFilters:(value:LoadReportFilters)=>void}) {
  const [draft,setDraft]=useState(filters);
  if(kind==='loads'){
    const plots=origins.find(origin=>origin.id===draft.farmId)?.plots??[];
    return <form className="reports-filters reports-load-filters" onSubmit={event=>{event.preventDefault();const from=draft.from||draft.to,to=draft.to||draft.from;if(from&&to)onFilters({...draft,search:draft.search.trim(),from,to});}}>
      <div className="reports-filter-title"><SlidersHorizontal size={16}/><strong>Filtrar carregamentos</strong><span>O período inclui as duas datas. Para consultar somente um dia, repita a data nos dois campos.</span></div>
      <div className="reports-filter-grid">
        <label className="reports-filter-search">Busca<input maxLength={200} value={draft.search} onChange={event=>setDraft({...draft,search:event.target.value})} placeholder="Contrato, cliente, documento ou observação"/></label>
        <label>Data inicial<input type="date" min="1900-01-01" max="9999-12-31" required value={draft.from} onChange={event=>setDraft({...draft,from:event.target.value})}/></label>
        <label>Data final<input type="date" min="1900-01-01" max="9999-12-31" required value={draft.to} onChange={event=>setDraft({...draft,to:event.target.value})}/></label>
        <label>Fazenda<select value={draft.farmId} onChange={event=>setDraft({...draft,farmId:event.target.value,plotId:''})}><option value="">Todas</option>{origins.map(origin=><option key={origin.id} value={origin.id}>{origin.name}</option>)}</select></label>
        <label>Talhão<select value={draft.plotId} disabled={!draft.farmId} onChange={event=>setDraft({...draft,plotId:event.target.value})}><option value="">Todos</option>{plots.map(plot=><option key={plot.id} value={plot.id}>{plot.name}</option>)}</select></label>
      </div>
      <div className="reports-filter-actions"><button type="button" className="btn company-secondary" onClick={()=>onFilters({...filters,search:'',farmId:'',plotId:''})}><X size={15}/>Limpar</button><button className="btn company-primary"><Search size={15}/>Aplicar filtros</button></div>
    </form>;
  }
  return <div className="reports-filters">{kind==='financial'?<label>Mês de referência<input type="month" min="1900-01" max="9998-12" aria-label="Mês do relatório" value={month} onChange={e=>{if(e.target.value)onMonth(e.target.value);}}/></label>:<p>{kind==='farms'?'As fazendas são compartilhadas por todas as empresas do espaço de trabalho.':'Todos os contratos da empresa selecionada, incluindo os finalizados.'}</p>}</div>;
}
