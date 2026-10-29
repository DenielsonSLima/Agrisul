'use client';

import {useCallback,useRef,useState,type ReactNode} from 'react';
import {Building2,CalendarDays,Check,ChevronDown,ChevronRight,FileText,MapPin,Search,X} from 'lucide-react';
import {defaultRange,validRange} from '../filters';
import type {SummaryFilters,SummaryFilterOptions} from '../types';
import {DashboardPopover} from './DashboardControls';
import {useDashboardValues} from '../dashboardValues';

export type QuickFilterMenu='partner'|'contract'|'origin'|null;
type Selection={partnerIds:string[];contractIds:string[];farmIds:string[];plotIds:string[]};
const searchable=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
const ids=(multiple:string[]|undefined,single?:string)=>[...new Set([...(multiple??[]),...(single?[single]:[])])].sort();
const selectionOf=(filters:SummaryFilters):Selection=>({partnerIds:ids(filters.partnerIds,filters.partnerId),contractIds:ids(filters.contractIds,filters.contractId),farmIds:ids(filters.farmIds,filters.plotId?'':filters.farmId),plotIds:ids(filters.plotIds,filters.plotId)});
const toggleId=(values:string[],id:string,checked:boolean)=>checked?[...new Set([...values,id])].sort():values.filter(value=>value!==id);

function FilterCheckbox({checked,partial=false,onChange,children,label}:{checked:boolean;partial?:boolean;onChange:(checked:boolean)=>void;children:ReactNode;label?:string}){
 return <label className={`dashboard-filter-option ${checked?'is-selected':''}`}>
  <input type="checkbox" checked={checked} aria-label={label} aria-checked={partial?'mixed':checked} ref={node=>{if(node)node.indeterminate=partial;}} onChange={event=>onChange(event.target.checked)}/>
  <span>{children}</span>
 </label>;
}

export function DashboardQuickFilters({filters,options,onChange,onOpen,open,onMenuChange}:{filters:SummaryFilters;options?:SummaryFilterOptions;onChange:(filters:SummaryFilters)=>void;onOpen:()=>void;open:QuickFilterMenu;onMenuChange:(value:QuickFilterMenu)=>void}){
 const {defaultPeriod}=useDashboardValues();
 const [search,setSearch]=useState(''),[expanded,setExpanded]=useState<string[]>([]);
 const [collapsedSearch,setCollapsedSearch]=useState<string[]>([]);
 const [draft,setDraft]=useState<Selection>(()=>selectionOf(filters));
 const [dates,setDates]=useState({from:filters.from,to:filters.to});
 const partnerTrigger=useRef<HTMLButtonElement>(null),contractTrigger=useRef<HTMLButtonElement>(null),originTrigger=useRef<HTMLButtonElement>(null);
 const close=useCallback(()=>onMenuChange(null),[onMenuChange]);
 const returnFocus=()=>{(open==='partner'?partnerTrigger:open==='contract'?contractTrigger:originTrigger).current?.focus({preventScroll:true});};
 const cancel=()=>{returnFocus();close();};
 const changeSearch=(value:string)=>{setSearch(value);setCollapsedSearch([]);};
 const toggle=(next:Exclude<QuickFilterMenu,null>)=>{onOpen();changeSearch('');setDraft(selectionOf(filters));onMenuChange(open===next?null:next);};
 const apply=()=>{if(Object.values(draft).some(values=>values.length>200))return;onChange({...filters,partnerId:'',contractId:'',farmId:'',plotId:'',...draft});cancel();};
 const partners=options?.partners??[],contracts=options?.contracts??[],farms=options?.farms??[];
 const selected=selectionOf(filters),term=searchable(search.trim());
 const matchingPartners=partners.filter(item=>searchable(item.name).includes(term));
 const contractName=(item:SummaryFilterOptions['contracts'][number])=>[item.contractNumber,item.title].filter(Boolean).join(' · ')||'Contrato';
 const matchingContracts=contracts.filter(item=>(!draft.partnerIds.length||draft.partnerIds.includes(item.clientId??''))&&searchable(`${item.contractNumber} ${item.title} ${item.clientName}`).includes(term));
 const matchingFarms=farms.flatMap(item=>{
  const farmMatches=searchable(item.name).includes(term),plots=farmMatches?item.plots:item.plots.filter(plot=>searchable(plot.name).includes(term));
  return farmMatches||plots.length?[{...item,plots,farmMatches}]:[];
 });
 const toggleClient=(id:string,checked:boolean)=>setDraft(value=>{
  const partnerIds=toggleId(value.partnerIds,id,checked);
  const contractIds=partnerIds.length?value.contractIds.filter(id=>contracts.some(contract=>contract.id===id&&partnerIds.includes(contract.clientId??''))):value.contractIds;
  return {...value,partnerIds,contractIds};
 });
 const toggleFarm=(farmId:string,checked:boolean)=>setDraft(value=>{
  const children=new Set(farms.find(farm=>farm.id===farmId)?.plots.map(plot=>plot.id)??[]);
  return {...value,farmIds:toggleId(value.farmIds,farmId,checked),plotIds:value.plotIds.filter(id=>!children.has(id))};
 });
 const togglePlot=(farmId:string,plotId:string,checked:boolean)=>setDraft(value=>{
  const wholeFarm=value.farmIds.includes(farmId);
  const remaining=wholeFarm?(farms.find(farm=>farm.id===farmId)?.plots.map(plot=>plot.id)??[]):[];
  return {...value,farmIds:value.farmIds.filter(id=>id!==farmId),plotIds:toggleId([...new Set([...value.plotIds,...remaining])],plotId,checked)};
 });
 const selectAll=()=>setDraft(value=>{
  if(open==='partner'){
   const partnerIds=[...new Set([...value.partnerIds,...matchingPartners.map(item=>item.id)])].sort();
   return {...value,partnerIds,contractIds:partnerIds.length?value.contractIds.filter(id=>contracts.some(contract=>contract.id===id&&partnerIds.includes(contract.clientId??''))):value.contractIds};
  }
  if(open==='contract')return {...value,contractIds:[...new Set([...value.contractIds,...matchingContracts.map(item=>item.id)])].sort()};
  const full=matchingFarms.filter(item=>item.farmMatches),fullIds=new Set([...value.farmIds,...full.map(item=>item.id)]);
  const childIds=new Set(farms.filter(item=>fullIds.has(item.id)).flatMap(item=>item.plots.map(plot=>plot.id)));
  return {...value,farmIds:[...fullIds].sort(),plotIds:[...new Set([...value.plotIds,...matchingFarms.filter(item=>!item.farmMatches).flatMap(item=>item.plots.map(plot=>plot.id))])].filter(id=>!childIds.has(id)).sort()};
 });
 const clearMenu=()=>setDraft(value=>open==='partner'?{...value,partnerIds:[]}:open==='contract'?{...value,contractIds:[]}:{...value,farmIds:[],plotIds:[]});
 const count=open==='partner'?draft.partnerIds.length:open==='contract'?draft.contractIds.length:draft.farmIds.length+draft.plotIds.length;
 const overLimit=Object.values(draft).some(values=>values.length>200);
 const toolbar=<div className="dashboard-filter-toolbar"><button type="button" onClick={selectAll}>{term?'Selecionar resultados':'Selecionar todos'}</button><button type="button" onClick={clearMenu}>Limpar seleção</button></div>;
 const footer=<>{overLimit&&<p className="dashboard-filter-error" role="alert">Selecione até 200 opções de cada tipo para aplicar.</p>}<footer className="dashboard-filter-footer"><span aria-live="polite">{count?`${count} selecionado(s)`:'Sem seleção: exibir todos'}</span><div><button type="button" onClick={cancel}>Cancelar</button><button type="button" disabled={overLimit} onClick={apply}>Aplicar</button></div></footer></>;
 const partnerLabel=selected.partnerIds.length===1?partners.find(item=>item.id===selected.partnerIds[0])?.name||'1 cliente':selected.partnerIds.length?`${selected.partnerIds.length} clientes`:'Cliente';
 const contractLabel=selected.contractIds.length===1?(()=>{const item=contracts.find(item=>item.id===selected.contractIds[0]);return item?contractName(item):'1 contrato';})():selected.contractIds.length?`${selected.contractIds.length} contratos`:'Contrato';
 const originLabel=selected.farmIds.length+selected.plotIds.length===1?(selected.farmIds.length?farms.find(item=>item.id===selected.farmIds[0])?.name||'1 fazenda':(()=>{const farm=farms.find(item=>item.plots.some(plot=>plot.id===selected.plotIds[0]));return farm?`${farm.name} · ${farm.plots.find(plot=>plot.id===selected.plotIds[0])?.name}`:'1 talhão';})()):[selected.farmIds.length?`${selected.farmIds.length} fazendas`:'',selected.plotIds.length?`${selected.plotIds.length} talhões`:''].filter(Boolean).join(' · ')||'Fazenda / talhão';
 const datesChanged=dates.from!==filters.from||dates.to!==filters.to,datesValid=validRange(dates),defaults=defaultRange(defaultPeriod);
 const filtered=!!(selected.partnerIds.length||selected.contractIds.length||selected.farmIds.length||selected.plotIds.length||filters.status||filters.from!==defaults.from||filters.to!==defaults.to);
 return <div className="dashboard-quick-filters" aria-label="Filtros rápidos do Dashboard">
  <form className="dashboard-period-filter" onSubmit={event=>{event.preventDefault();if(datesValid&&datesChanged)onChange({...filters,...dates});}}>
   <CalendarDays size={13} aria-hidden="true"/>
   <label><span className="sr-only">Data inicial</span><input aria-label="Data inicial" type="date" min="1900-01-01" max={dates.to||'9999-12-31'} value={dates.from} onChange={event=>setDates(value=>({...value,from:event.target.value}))}/></label>
   <span aria-hidden="true">—</span>
   <label><span className="sr-only">Data final</span><input aria-label="Data final" type="date" min={dates.from||'1900-01-01'} max="9999-12-31" value={dates.to} onChange={event=>setDates(value=>({...value,to:event.target.value}))}/></label>
   {datesChanged&&<button type="submit" disabled={!datesValid} aria-label="Aplicar período" title={datesValid?'Aplicar período':'Escolha um período entre 1 dia e 5 anos'}><Check size={15}/></button>}
   {datesChanged&&!datesValid&&<span className="dashboard-period-error" role="alert">Escolha um período entre 1 dia e 5 anos.</span>}
  </form>
  <div className="dashboard-quick-anchor">
   <button ref={partnerTrigger} type="button" className={`dashboard-quick-trigger ${selected.partnerIds.length?'has-selection':''}`} aria-label={`Filtrar por cliente: ${partnerLabel}`} aria-haspopup="dialog" aria-expanded={open==='partner'} aria-controls={open==='partner'?'dashboard-partner-filter':undefined} onClick={()=>toggle('partner')} title={partnerLabel}><Building2 size={13}/><span>{partnerLabel}</span><ChevronDown size={12}/></button>
   {open==='partner'&&<DashboardPopover title="Clientes" id="dashboard-partner-filter" onClose={close} onReturnFocus={returnFocus}>
    <label className="dashboard-filter-search"><Search size={15}/><input type="search" aria-label="Buscar cliente" placeholder="Buscar cliente…" value={search} onChange={event=>changeSearch(event.target.value)}/></label>
    {toolbar}<div className="dashboard-filter-results" role="group" aria-label="Seleção de clientes">
     {matchingPartners.map(item=><FilterCheckbox key={item.id} checked={draft.partnerIds.includes(item.id)} onChange={checked=>toggleClient(item.id,checked)} label={`Selecionar cliente ${item.name}`}>{item.name}</FilterCheckbox>)}
     {!matchingPartners.length&&<p className="dashboard-filter-empty">{options?'Nenhum cliente encontrado.':'Carregando clientes…'}</p>}
    </div>{footer}
   </DashboardPopover>}
  </div>
  <div className="dashboard-quick-anchor dashboard-contract-anchor">
   <button ref={contractTrigger} type="button" className={`dashboard-quick-trigger ${selected.contractIds.length?'has-selection':''}`} aria-label={`Filtrar por contrato: ${contractLabel}`} aria-haspopup="dialog" aria-expanded={open==='contract'} aria-controls={open==='contract'?'dashboard-contract-filter':undefined} onClick={()=>toggle('contract')} title={contractLabel}><FileText size={13}/><span>{contractLabel}</span><ChevronDown size={12}/></button>
   {open==='contract'&&<DashboardPopover title="Contratos" id="dashboard-contract-filter" onClose={close} onReturnFocus={returnFocus}>
    <label className="dashboard-filter-search"><Search size={15}/><input type="search" aria-label="Buscar contrato" placeholder="Buscar número, título ou cliente…" value={search} onChange={event=>changeSearch(event.target.value)}/></label>
    {toolbar}<div className="dashboard-filter-results" role="group" aria-label="Seleção de contratos">
     {matchingContracts.map(item=><FilterCheckbox key={item.id} checked={draft.contractIds.includes(item.id)} onChange={checked=>setDraft(value=>({...value,contractIds:toggleId(value.contractIds,item.id,checked)}))} label={`Selecionar contrato ${contractName(item)}`}><strong>{contractName(item)}</strong><small>{item.clientName} · {item.status}</small></FilterCheckbox>)}
     {!matchingContracts.length&&<p className="dashboard-filter-empty">{options?'Nenhum contrato encontrado.':'Carregando contratos…'}</p>}
    </div>{footer}
   </DashboardPopover>}
  </div>
  <div className="dashboard-quick-anchor dashboard-origin-anchor">
   <button ref={originTrigger} type="button" className={`dashboard-quick-trigger ${selected.farmIds.length||selected.plotIds.length?'has-selection':''}`} aria-label={`Filtrar por fazenda ou talhão: ${originLabel}`} aria-haspopup="dialog" aria-expanded={open==='origin'} aria-controls={open==='origin'?'dashboard-origin-filter':undefined} onClick={()=>toggle('origin')} title={originLabel}><MapPin size={13}/><span>{originLabel}</span><ChevronDown size={12}/></button>
   {open==='origin'&&<DashboardPopover title="Fazendas e talhões" id="dashboard-origin-filter" onClose={close} onReturnFocus={returnFocus}>
    <label className="dashboard-filter-search"><Search size={15}/><input type="search" aria-label="Buscar fazenda ou talhão" placeholder="Buscar fazenda ou talhão…" value={search} onChange={event=>changeSearch(event.target.value)}/></label>
    {toolbar}<div className="dashboard-filter-results" role="group" aria-label="Seleção de fazendas e talhões">
     {matchingFarms.map(item=>{
      const isExpanded=term?!collapsedSearch.includes(item.id):expanded.includes(item.id),full=draft.farmIds.includes(item.id),partial=!full&&farms.find(farm=>farm.id===item.id)!.plots.some(plot=>draft.plotIds.includes(plot.id));
      return <div className="dashboard-farm-card" key={item.id}>
       <div className="dashboard-farm-heading"><FilterCheckbox checked={full} partial={partial} onChange={checked=>toggleFarm(item.id,checked)} label={`Selecionar fazenda ${item.name}`}><MapPin size={13}/>{item.name}</FilterCheckbox>
        <button type="button" className="dashboard-farm-expand" disabled={!item.plots.length} aria-label={`${isExpanded?'Recolher':'Expandir'} talhões de ${item.name}`} aria-expanded={isExpanded} aria-controls={`dashboard-farm-plots-${item.id}`} onClick={()=>term?setCollapsedSearch(value=>toggleId(value,item.id,isExpanded)):setExpanded(value=>toggleId(value,item.id,!isExpanded))}>{isExpanded?<ChevronDown size={16}/>:<ChevronRight size={16}/>}</button></div>
       {isExpanded&&<div className="dashboard-farm-plots" id={`dashboard-farm-plots-${item.id}`} role="group" aria-label={`Talhões de ${item.name}`}>
        {item.plots.map(plot=><FilterCheckbox key={plot.id} checked={full||draft.plotIds.includes(plot.id)} onChange={checked=>togglePlot(item.id,plot.id,checked)} label={`Selecionar talhão ${plot.name} de ${item.name}`}>{plot.name}</FilterCheckbox>)}
        {!item.plots.length&&<p className="dashboard-filter-empty">Nenhum talhão cadastrado.</p>}
       </div>}
      </div>;
     })}
     {!matchingFarms.length&&<p className="dashboard-filter-empty">{options?'Nenhuma fazenda ou talhão encontrado.':'Carregando fazendas…'}</p>}
    </div>{footer}
   </DashboardPopover>}
  </div>
  {(filtered||datesChanged)&&<button type="button" className="dashboard-clear-filters" aria-label="Limpar filtros" onClick={()=>{const cleared=defaultRange(defaultPeriod);setDates(cleared);onChange(cleared);close();}} title="Limpar filtros e restaurar o período padrão"><X size={12}/><span>Limpar</span></button>}
 </div>;
}
