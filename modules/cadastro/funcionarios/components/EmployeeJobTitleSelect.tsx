'use client';
import {useRef,useState} from 'react';
import {Plus} from 'lucide-react';
import {Combobox,ComboboxContent,ComboboxEmpty,ComboboxInput,ComboboxItem,ComboboxList} from '@/components/ui/combobox';
import {normalize} from '@/shared/utils/format';
import '../styles.css';

type JobOption={value:string;create?:boolean};
export function employeeJobTitles(employees:{jobTitle:string}[]){
 const titles=new Map<string,string>();
 for(const employee of employees){const title=employee.jobTitle.trim().replace(/\s+/g,' ');if(title&&!titles.has(normalize(title)))titles.set(normalize(title),title);}
 return [...titles.values()].sort((a,b)=>a.localeCompare(b,'pt-BR',{sensitivity:'base'}));
}

export function EmployeeJobTitleSelect({titles,value,onChange,label,allowCreate=false,required=false,disabled=false}:{titles:string[];value:string;onChange:(value:string)=>void;label:string;allowCreate?:boolean;required?:boolean;disabled?:boolean}){
 const [search,setSearch]=useState<string|null>(null),[open,setOpen]=useState(false);
 const [container,setContainer]=useState<HTMLDivElement|null>(null),anchor=useRef<HTMLDivElement>(null);
 const term=normalize((search??'').trim());
 const options:JobOption[]=[...(!allowCreate?[{value:''}]:[]),...titles.map(title=>({value:title}))];
 const candidate=(search??value).trim().replace(/\s+/g,' ');
 if(allowCreate&&candidate&&!titles.some(title=>normalize(title)===normalize(candidate)))options.push({value:candidate,create:true});
 const selected=options.find(option=>normalize(option.value)===normalize(value))??null;
 const filtered=options.filter(option=>!term||!option.value||normalize(option.value).includes(term));
 return <div className="employee-job-picker" ref={setContainer}>
  <Combobox items={options} filteredItems={filtered} value={selected} inputValue={search??selected?.value??value} open={open} autoHighlight openOnInputClick filter={null} disabled={disabled}
   itemToStringLabel={option=>option.value||'Todos os cargos'} itemToStringValue={option=>option.value} isItemEqualToValue={(a,b)=>a.value===b.value}
   onOpenChange={next=>{setOpen(next);if(!next)setSearch(null);}}
   onValueChange={option=>{onChange(option?.value??'');setSearch(null);}}
   onInputValueChange={(next,event)=>{if(event.reason==='input-change'){setSearch(next);if(allowCreate)onChange(next);}}}>
   <div ref={anchor}><ComboboxInput className="employee-job-combobox" aria-label={label} required={required} maxLength={100} autoComplete="off" placeholder={allowCreate?'Selecione ou digite um novo cargo':'Todos os cargos'}/></div>
   <ComboboxContent anchor={anchor} portalContainer={container} className="employee-job-options">
    <ComboboxEmpty>Nenhum cargo encontrado.</ComboboxEmpty>
    <ComboboxList>{(option:JobOption)=><ComboboxItem key={option.value} value={option}>{option.create?<><Plus size={14}/>Criar cargo “{option.value}”</>:option.value||'Todos os cargos'}</ComboboxItem>}</ComboboxList>
   </ComboboxContent>
  </Combobox>
 </div>;
}
