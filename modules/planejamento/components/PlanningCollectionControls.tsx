import {useEffect,useState,type FormEvent} from 'react';
import {CalendarRange,ChevronLeft,ChevronRight,Search,X} from 'lucide-react';
import type {PlanningPagination} from '../types';

export function PlanningSearchBar({value,placeholder,pagination,onSearch}:{value:string;placeholder:string;pagination:PlanningPagination;onSearch:(value:string)=>void}){
 const [draft,setDraft]=useState(value);
 const submit=(event:FormEvent)=>{event.preventDefault();onSearch(draft.trim());};
 return <form className="planning-list-toolbar" onSubmit={submit} role="search"><label className="local-search"><Search size={16}/><span className="sr-only">{placeholder}</span><input type="search" maxLength={160} value={draft} onChange={event=>setDraft(event.target.value)} placeholder={placeholder}/>{(draft||value)&&<button type="button" className="planning-search-clear" aria-label="Limpar busca" onClick={()=>{setDraft('');onSearch('');}}><X size={14}/></button>}</label><button className="btn" type="submit">Buscar</button><span aria-live="polite">{pagination.total} resultado{pagination.total===1?'':'s'}</span></form>;
}

export function PlanningPeriodFilter({dateFrom,dateTo,minDate,maxDate,onApply}:{dateFrom:string;dateTo:string;minDate:string;maxDate:string;onApply:(dateFrom:string,dateTo:string)=>void}){
 const [from,setFrom]=useState(dateFrom);const [to,setTo]=useState(dateTo);const [error,setError]=useState('');
 useEffect(()=>{setFrom(dateFrom);setTo(dateTo);setError('');},[dateFrom,dateTo]);
 const submit=(event:FormEvent)=>{event.preventDefault();if(from&&to&&from>to){setError('A data inicial deve ser anterior à final.');return;}setError('');onApply(from,to);};
 const clear=()=>{setFrom('');setTo('');setError('');onApply('','');};
 return <form className="planning-period-filter" onSubmit={submit} aria-label="Filtrar Diário por período">
  <CalendarRange size={17}/><label><span>De</span><input type="date" value={from} min={minDate} max={maxDate} onChange={event=>setFrom(event.target.value)}/></label><label><span>Até</span><input type="date" value={to} min={minDate} max={maxDate} onChange={event=>setTo(event.target.value)}/></label><button className="btn" type="submit">Filtrar período</button>{(dateFrom||dateTo)&&<button className="icon-btn" type="button" title="Limpar período" aria-label="Limpar período" onClick={clear}><X size={15}/></button>}{error&&<span role="alert">{error}</span>}
 </form>;
}

export function PlanningPaginationNav({pagination,onPage}:{pagination:PlanningPagination;onPage:(page:number)=>void}){
 if(!pagination.total)return null;
 const first=(pagination.page-1)*pagination.pageSize+1,last=Math.min(pagination.page*pagination.pageSize,pagination.total);
 return <nav className="planning-pagination" aria-label="Paginação do planejamento"><span><strong>{first}–{last}</strong> de {pagination.total} registros</span><div><button className="btn" type="button" disabled={!pagination.hasPrevious} onClick={()=>onPage(pagination.page-1)}><ChevronLeft size={16}/>Anterior</button><span>Página <strong>{pagination.page}</strong> de {pagination.totalPages}</span><button className="btn" type="button" disabled={!pagination.hasNext} onClick={()=>onPage(pagination.page+1)}>Próxima<ChevronRight size={16}/></button></div></nav>;
}
