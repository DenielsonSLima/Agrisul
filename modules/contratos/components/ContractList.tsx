import {useDeferredValue,useState} from 'react';
import {CalendarDays,FileDown,FileText,Plus,Search} from 'lucide-react';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {LocalSearch} from '@/shared/components/Common';
import {useContracts} from '../hooks/useContracts';
import type {ContractBucket} from '../types';
import {ContractCardGrid} from '../cards';
import {ContractLoadState} from './ContractLoadState';
import {ContractReportDialog} from './ContractReportDialog';
import {ContractListSummary} from './ContractListSummary';

export function ContractList(){
 const [query,setQuery]=useState(''),deferredQuery=useDeferredValue(query);const [bucket,setBucket]=useState<ContractBucket>('open'),[from,setFrom]=useState(''),[to,setTo]=useState(''),[reportOpen,setReportOpen]=useState(false);
 const invalidPeriod=!!from&&!!to&&from>to;const filters={bucket,search:deferredQuery.trim(),from:invalidPeriod?'':from,to:invalidPeriod?'':to};const m=useContracts(undefined,filters);
 const tabLabel=bucket==='open'?'Em aberto':'Finalizado';
 const updatingSearch=query!==deferredQuery;const canReport=!m.loading&&!m.error&&!invalidPeriod&&!updatingSearch&&!!m.summary;
 return <section><div className="companies-heading"><div><h2>Contratos</h2><p>Acompanhe os contratos da empresa ativa, seus volumes e carregamentos.</p></div>{m.status!==401&&<div className="contract-heading-actions"><button type="button" className="btn" disabled={!canReport} onClick={()=>setReportOpen(true)}><FileDown size={16}/>Exportar PDF</button><ModuleLink className="btn company-primary" href="/contratos?novo=1"><Plus size={16}/>Novo contrato</ModuleLink></div>}</div>
 {!m.error&&!invalidPeriod&&(m.loading||!!m.summary)&&<ContractListSummary summary={m.summary} bucket={bucket} total={m.total} loading={m.loading||updatingSearch}/>}
 <Tabs value={bucket} onValueChange={value=>setBucket(value as ContractBucket)} className="contract-list-tabs"><TabsList variant="line" aria-label="Situação dos contratos"><TabsTrigger value="open">Em aberto <span>{m.counts.open}</span></TabsTrigger><TabsTrigger value="finished">Finalizado <span>{m.counts.finished}</span></TabsTrigger></TabsList></Tabs>
 <div className="contract-toolbar"><LocalSearch value={query} onChange={setQuery} placeholder="Buscar cliente, CNPJ ou contrato"/><label><span>Data inicial</span><div><CalendarDays size={14}/><input aria-label="Data inicial do contrato" type="date" min="1900-01-01" max={to||'9999-12-31'} value={from} onChange={event=>setFrom(event.target.value)}/></div></label><label><span>Data final</span><div><CalendarDays size={14}/><input aria-label="Data final do contrato" type="date" min={from||'1900-01-01'} max="9999-12-31" value={to} onChange={event=>setTo(event.target.value)}/></div></label><span aria-live="polite">{m.total} contrato{m.total===1?'':'s'}</span></div>
 {invalidPeriod&&<p className="form-error" role="alert">A data inicial deve ser igual ou anterior à data final.</p>}
 {invalidPeriod?null:m.loading||m.error?<ContractLoadState {...m} onRetry={m.reload}/>:!m.contracts.length?<div className="company-empty"><span className="company-empty-icon"><FileText size={25}/></span><h3>{query||from||to?'Nenhum contrato encontrado':`Nenhum contrato ${tabLabel.toLowerCase()}`}</h3><p>{query||from||to?'Revise a busca ou o período informado.':'Os contratos desta situação aparecerão aqui.'}</p>{!query&&!from&&!to&&bucket==='open'&&<ModuleLink className="btn company-primary" href="/contratos?novo=1"><Plus size={16}/>Novo contrato</ModuleLink>}</div>:<ContractCardGrid contracts={m.contracts}/>} 
 {!m.loading&&!m.error&&!!m.contracts.length&&query!==deferredQuery&&<div className="client-loading"><Search size={16}/>Atualizando busca…</div>}
 {canReport&&m.summary&&<ContractReportDialog open={reportOpen} onOpenChange={setReportOpen} contracts={m.contracts} summary={m.summary} total={m.total} filters={filters}/>}
 </section>;
}
