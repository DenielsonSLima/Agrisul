'use client';
import {useRef,useState} from 'react';
import {Plus,Search,Users} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {normalize} from '@/shared/utils/format';
import type {OvertimeEmployee} from '../types';

export function OvertimeAddEmployeesModal({employees,maxSelections,onClose,onAdd}:{employees:OvertimeEmployee[];maxSelections:number;onClose:()=>void;onAdd:(ids:string[])=>void}){
 const [search,setSearch]=useState(''),[selected,setSelected]=useState<Set<string>>(()=>new Set());
 const title=useRef<HTMLHeadingElement>(null);
 const term=normalize(search.trim());
 const filtered=employees.filter(employee=>normalize(`${employee.fullName} ${employee.registrationNumber} ${employee.jobTitle}`).includes(term));
 const ordered=[...filtered].sort((a,b)=>a.fullName.localeCompare(b.fullName,'pt-BR',{sensitivity:'base'}));
 const toggle=(id:string)=>setSelected(current=>{
  const next=new Set(current);
  if(next.has(id))next.delete(id);else if(next.size<maxSelections)next.add(id);
  return next;
 });
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}>
  <DialogContent className="form-modal overtime-add-employees-modal" onOpenAutoFocus={event=>{event.preventDefault();title.current?.focus();}}>
   <DialogHeader><DialogTitle ref={title} tabIndex={-1}>Adicionar funcionários</DialogTitle><DialogDescription>Selecione uma ou mais pessoas para incluir no relatório. Quem já foi adicionado não aparece aqui.</DialogDescription></DialogHeader>
   <div className="overtime-bulk-search"><Search size={18}/><input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Nome, matrícula ou cargo" aria-label="Buscar funcionários para adicionar"/></div>
   <div className="overtime-bulk-count" role="status">{selected.size} selecionado(s){selected.size===maxSelections&&' · Limite do relatório atingido'}</div>
   <div className="overtime-bulk-list" aria-label="Funcionários disponíveis">
    {ordered.length?ordered.map(employee=><label className="overtime-bulk-option" key={employee.id} data-selected={selected.has(employee.id)}>
     <input type="checkbox" checked={selected.has(employee.id)} disabled={!selected.has(employee.id)&&selected.size>=maxSelections} onChange={()=>toggle(employee.id)}/>
     <span><strong>{employee.fullName}</strong><small>{employee.registrationNumber||'Sem matrícula'} · {employee.jobTitle||'Cargo não informado'}</small></span>
    </label>):<div className="overtime-bulk-empty"><Users size={26}/><p>{employees.length?'Nenhum funcionário encontrado.':'Todos os funcionários já estão no relatório.'}</p></div>}
   </div>
   <div className="overtime-bulk-actions"><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="button" className="btn company-primary" disabled={!selected.size} onClick={()=>onAdd([...selected])}><Plus size={17}/>Adicionar{selected.size?` (${selected.size})`:''}</button></div>
  </DialogContent>
 </Dialog>;
}
