'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowDownAZ,ArrowUpAZ,Filter,X} from 'lucide-react';
import type {ImportField,ImportTableFilters} from '../types';
import {importValue} from '../utils/presentation';

type Props={field:Pick<ImportField,'key'|'label'|'type'>;values:string[];filters:ImportTableFilters;onChange:(change:Partial<ImportTableFilters>)=>void};
export function ImportColumnFilter(props:Props){
 const [position,setPosition]=useState<{top:number;left:number}|null>(null);const trigger=useRef<HTMLButtonElement>(null);
 const active=props.filters.columnFilters?.[props.field.key]!==undefined;const sorted=props.filters.sortKey===props.field.key;
 return <><button ref={trigger} type="button" className="imports-column-filter-trigger" data-active={active||sorted} aria-label={`Filtrar e ordenar ${props.field.label}`} aria-haspopup="dialog" aria-expanded={!!position} title={`Filtrar e ordenar ${props.field.label}`} onClick={()=>{const rect=trigger.current?.getBoundingClientRect();if(rect)setPosition({top:Math.max(8,Math.min(rect.bottom+5,window.innerHeight-440)),left:Math.max(8,Math.min(rect.right-290,window.innerWidth-298))});}}><Filter size={14}/>{sorted&&<span>{props.filters.sortDirection==='desc'?'↓':'↑'}</span>}</button>{position&&createPortal(<ColumnMenu {...props} position={position} onClose={()=>{setPosition(null);trigger.current?.focus();}}/>,document.body)}</>;
}
function ColumnMenu({field,values,filters,onChange,position,onClose}:Props&{position:{top:number;left:number};onClose:()=>void}){
 const [search,setSearch]=useState('');const [selected,setSelected]=useState(()=>new Set(filters.columnFilters?.[field.key]??values));const panel=useRef<HTMLDivElement>(null);const searchInput=useRef<HTMLInputElement>(null);
 const label=(value:string)=>value===''?'(Vazias)':field.key==='$reviewed'?(value==='true'?'Conferido':'Pendente'):importValue(field as ImportField,value);
 const needle=search.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
 const options=values.filter(value=>(label(value)+' '+value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').includes(needle));
 useEffect(()=>{searchInput.current?.focus();const close=()=>onClose();window.addEventListener('resize',close);return()=>window.removeEventListener('resize',close);},[onClose]);
 function clear(){const next={...filters.columnFilters};delete next[field.key];onChange({columnFilters:Object.keys(next).length?next:undefined});onClose();}
 function sort(direction:'asc'|'desc'){onChange({sortKey:field.key,sortDirection:direction});onClose();}
 function apply(){const next={...filters.columnFilters};if(values.every(value=>selected.has(value)))delete next[field.key];else next[field.key]=[...selected];onChange({columnFilters:Object.keys(next).length?next:undefined});onClose();}
 return <div className="imports-filter-overlay" onPointerDown={event=>{if(event.target===event.currentTarget)onClose();}}><div ref={panel} className="imports-column-menu" role="dialog" aria-modal="true" aria-label={`Filtro de ${field.label}`} style={position} onKeyDown={event=>{
  if(event.key==='Escape'){event.stopPropagation();onClose();}
  if(event.key==='Tab'){const focusable=panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input');if(!focusable?.length)return;const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
 }}><header><strong>{field.label}</strong><button type="button" className="icon-btn" aria-label="Fechar filtro" onClick={onClose}><X size={15}/></button></header>
 <button type="button" className="imports-sort-option" onClick={()=>sort('asc')}><ArrowDownAZ size={16}/>{field.type==='decimal'?'Do menor para o maior':field.type==='date'?'Da mais antiga para a mais recente':'Ordenar de A a Z'}</button>
 <button type="button" className="imports-sort-option" onClick={()=>sort('desc')}><ArrowUpAZ size={16}/>{field.type==='decimal'?'Do maior para o menor':field.type==='date'?'Da mais recente para a mais antiga':'Ordenar de Z a A'}</button>
 {filters.sortKey===field.key&&<button type="button" className="imports-sort-option" onClick={()=>{onChange({sortKey:undefined,sortDirection:undefined});onClose();}}>Remover ordenação</button>}
 <button type="button" className="imports-sort-option" disabled={filters.columnFilters?.[field.key]===undefined} onClick={clear}>Limpar filtro desta coluna</button>
 <input ref={searchInput} className="imports-filter-search" aria-label={`Pesquisar valores de ${field.label}`} placeholder="Pesquisar valores…" value={search} onChange={event=>setSearch(event.target.value)}/>
 {search&&<button type="button" className="imports-sort-option" onClick={()=>setSelected(new Set(options))}>Marcar apenas os resultados da busca</button>}
 <label className="imports-filter-choice imports-filter-select-all"><input type="checkbox" checked={options.length>0&&options.every(value=>selected.has(value))} onChange={event=>{const checked=event.target.checked;setSelected(current=>{const next=new Set(current);for(const value of options)if(checked)next.add(value);else next.delete(value);return next;});}}/>{search?'Selecionar resultados':'Selecionar tudo'}</label>
 <div className="imports-filter-values">{options.map(value=><label className="imports-filter-choice" key={value}><input type="checkbox" checked={selected.has(value)} onChange={event=>{const checked=event.target.checked;setSelected(current=>{const next=new Set(current);if(checked)next.add(value);else next.delete(value);return next;});}}/><span title={label(value)}>{label(value)}</span></label>)}{!options.length&&<p>Nenhum valor encontrado.</p>}</div>
 <footer><button type="button" className="btn small" onClick={onClose}>Cancelar</button><button type="button" className="btn small company-primary" onClick={apply}>Aplicar filtro</button></footer>
 </div></div>;
}
