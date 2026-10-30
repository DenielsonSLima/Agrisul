'use client';
import {useId,useRef,useState} from 'react';
import {Plus} from 'lucide-react';
import {Combobox,ComboboxContent,ComboboxEmpty,ComboboxInput,ComboboxItem,ComboboxList} from '@/components/ui/combobox';
import {normalize} from '@/shared/utils/format';
import type {OvertimeEmployee} from '../types';

export function OvertimeEmployeeSelect({employees,value,onChange,label,onCreate}:{employees:OvertimeEmployee[];value:string;onChange:(id:string)=>void;label:string;onCreate?:()=>void}){
 const [search,setSearch]=useState<string|null>(null),[open,setOpen]=useState(false);
 const container=useRef<HTMLDivElement>(null),anchor=useRef<HTMLDivElement>(null),inputId=useId();
 const selected=employees.find(employee=>employee.id===value);
 const filtered=search===null?employees:employees.filter(employee=>normalize(employee.fullName+' '+employee.registrationNumber+' '+employee.jobTitle).includes(normalize(search.trim())));
 return <div className="overtime-employee-picker" ref={container}>
  <Combobox items={employees} filteredItems={filtered} value={selected??null} inputValue={search??selected?.fullName??''} open={open} autoHighlight openOnInputClick filter={null}
   itemToStringLabel={employee=>employee.fullName} itemToStringValue={employee=>employee.id} isItemEqualToValue={(a,b)=>a.id===b.id}
   onOpenChange={next=>{setOpen(next);if(!next)setSearch(null);}}
   onValueChange={employee=>{onChange(employee?.id??'');setSearch(null);}}
   onInputValueChange={(text,event)=>{if(event.reason==='input-change')setSearch(text);}}>
   <div ref={anchor}><ComboboxInput id={inputId} className="overtime-employee-combobox" aria-label={label} aria-required="true" placeholder="Digite o nome ou a matrícula" autoComplete="off"/></div>
   <ComboboxContent anchor={anchor} className="overtime-employee-options">
    <ComboboxEmpty>Nenhum funcionário encontrado.</ComboboxEmpty>
    <ComboboxList>{(employee:OvertimeEmployee)=><ComboboxItem key={employee.id} value={employee} data-employee-id={employee.id}><span><strong>{employee.fullName}</strong><small>{employee.registrationNumber||'Sem matrícula'} · {employee.jobTitle||'Cargo não informado'}</small></span></ComboboxItem>}</ComboboxList>
    {onCreate&&<div className="overtime-employee-create"><button type="button" className="btn small" onClick={()=>{setOpen(false);setSearch(null);onCreate();}}><Plus size={15}/>Cadastrar funcionário</button></div>}
   </ComboboxContent>
  </Combobox>
 </div>;
}
