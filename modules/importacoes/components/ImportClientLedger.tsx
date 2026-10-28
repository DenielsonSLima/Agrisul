'use client';

import {ArrowLeft,ArrowUpRight,Building2,ChevronRight,FileText,Filter,Loader2,Upload,X} from 'lucide-react';
import {Field} from '@/shared/components/Common';
import {ModuleLink,useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {useClients} from '@/modules/cadastro/clientes/hooks/useClients';
import {dateLabel} from '@/shared/utils/presentation';
import {useImportLedger} from '../hooks/useImportacoes';
import {importClientFiltersFromSearch,importClientHref,importDocumentHref,importTabHref,importUploadHref,type ImportClientFilters} from '../navigation';
import type {ImportLedger,ImportOperationalSummary,ImportStatus} from '../types';
import {importCount} from '../utils/presentation';


export function ImportClientLedger({clientId,status}:{clientId:string;status:ImportStatus}){
 const {searchParams,navigate}=useModuleNavigation();const filters=importClientFiltersFromSearch(searchParams);const tab=status==='finished'?'finished':'open';
 const model=useImportLedger({clientId,status,dateFrom:filters.dateFrom,dateTo:filters.dateTo,farm:filters.farm,plot:filters.plot,groupBy:'none'});const {clients}=useClients();const knownClient=clients.find(client=>client.id===clientId);const title=model.data?.clientName||knownClient?.tradeName||knownClient?.legalName||'Empresa';
 const hasFilters=!!(filters.dateFrom||filters.dateTo||filters.farm||filters.plot);
 function changeFilters(change:Partial<ImportClientFilters>){navigate(importClientHref(clientId,tab,{...filters,...change}),{replace:true});}
 return <section className="imports-page imports-company-workspace imports-company-ledger">
  <div className="imports-workspace-navigation"><nav className="imports-breadcrumb" aria-label="Caminho da empresa"><ol><li><ModuleLink href={importTabHref(tab)}>Importações</ModuleLink></li><li><ChevronRight size={13}/><span aria-current="page">{title}</span></li></ol></nav><ModuleLink className="imports-back" href={importTabHref(tab)}><ArrowLeft size={15}/>Voltar às empresas</ModuleLink></div>
  <header className="imports-heading imports-company-heading"><div><div className="eyebrow">DOCUMENTOS DA EMPRESA</div><h1>{title}</h1><p>{status==='finished'?'Documentos finalizados':'Documentos em aberto'} · um card por PDF enviado. Abra o documento para filtrar colunas e exportar.</p></div><div className="imports-actions"><ModuleLink className="btn small" href={importClientHref(clientId,status==='open'?'finished':'open',filters)}>{status==='open'?'Ver finalizados':'Ver em aberto'}</ModuleLink>{status==='open'&&model.data?.canManage&&<ModuleLink className="btn company-primary" href={importUploadHref(clientId)}><Upload size={15}/>Importar PDF</ModuleLink>}</div></header>
  <div className="imports-ledger-filters" role="group" aria-label="Filtros dos lançamentos" aria-busy={model.loading}><div className="imports-ledger-filter-heading"><span><Filter size={15}/>Filtrar documentos</span>{hasFilters&&<button type="button" className="imports-clear-filter" onClick={()=>changeFilters({dateFrom:undefined,dateTo:undefined,farm:undefined,plot:undefined})}><X size={13}/>Limpar filtros</button>}</div><div className="imports-ledger-filter-grid imports-document-filter-grid">
   <Field label="Data inicial"><input type="date" aria-label="Data inicial" max="9998-12-31" value={filters.dateFrom??''} onChange={event=>changeFilters({dateFrom:event.target.value||undefined})}/></Field>
   <Field label="Data final"><input type="date" aria-label="Data final" max="9998-12-31" value={filters.dateTo??''} onChange={event=>changeFilters({dateTo:event.target.value||undefined})}/></Field>
   <Field label="Fazenda"><select aria-label="Filtrar por fazenda" value={filters.farm??''} onChange={event=>changeFilters({farm:event.target.value||undefined})}><option value="">Todas as fazendas</option>{filters.farm&&!model.data?.facets.farms.some(farm=>farm.value===filters.farm)&&<option value={filters.farm}>{filters.farm}</option>}{model.data?.facets.farms.map(farm=><option key={farm.value} value={farm.value}>{farm.label}</option>)}</select></Field>
   <Field label="Talhão"><select aria-label="Filtrar por talhão" value={filters.plot??''} onChange={event=>changeFilters({plot:event.target.value||undefined})}><option value="">Todos os talhões</option>{filters.plot&&!model.data?.facets.plots.some(plot=>plot.value===filters.plot)&&<option value={filters.plot}>{filters.plot}</option>}{model.data?.facets.plots.map(plot=><option key={plot.value} value={plot.value}>{plot.label}</option>)}</select></Field>
  </div><p>Os filtros também serão aplicados aos lançamentos ao abrir o PDF.</p></div>
  {model.loading?<div className="imports-state" role="status"><Loader2 className="animate-spin"/>Carregando lançamentos filtrados…</div>:model.error?<div className="imports-state" role="alert"><p>{model.error}</p><button className="btn" onClick={()=>void model.reload()}>Tentar novamente</button></div>:model.data&&<>
   <LedgerSummary summary={model.data.summary} filtered={hasFilters}/>
   <p className="imports-help">{importCount(model.data.summary.documentCount)} PDFs · {importCount(model.data.summary.entryCount)} lançamentos{hasFilters?' encontrados':''}</p>
   {!model.data.summary.entryCount?<div className="imports-state"><Building2 size={30}/><h3>{hasFilters?'Nenhum lançamento neste filtro':'Nenhum lançamento nesta situação'}</h3><p>{hasFilters?'Ajuste o período, a fazenda ou o talhão para consultar outros lançamentos.':status==='finished'?'Os documentos finalizados aparecerão aqui.':'Importe um PDF para começar a conferir os lançamentos desta empresa.'}</p>{hasFilters&&<button className="btn" onClick={()=>changeFilters({dateFrom:undefined,dateTo:undefined,farm:undefined,plot:undefined})}>Limpar filtros</button>}</div>:<DocumentCards ledger={model.data} filters={filters} tab={tab}/>}
  </>}
 </section>;
}

function LedgerSummary({summary,filtered}:{summary:ImportOperationalSummary;filtered:boolean}){
 return <div className="imports-summary-strip" aria-label={filtered?'Resumo filtrado da empresa':'Resumo da empresa'}><div><span>Dias</span><strong>{importCount(summary.dayCount)}</strong></div><div><span>Documentos PDF</span><strong>{importCount(summary.documentCount)}</strong></div><div><span>Lançamentos</span><strong>{importCount(summary.entryCount)}</strong></div><div><span>Conjuntos</span><strong>{importCount(summary.groupCount)}</strong></div><div className="imports-summary-pending"><span>Para conferir</span><strong>{importCount(summary.pendingCount)}</strong></div></div>;
}

function DocumentCards({ledger,filters,tab}:{ledger:ImportLedger;filters:ImportClientFilters;tab:'open'|'finished'}){
 return <div className="imports-pdf-grid">{ledger.documents.map(document=>{
  const summary=document.summary;const href=importDocumentHref(document.id,{clientId:ledger.clientId,tab,filters});
  return <article className="imports-pdf-card" key={document.id} data-document-id={document.id}>
   <header><span className="imports-pdf-icon"><FileText size={23}/></span><span className={'imports-badge '+(document.status==='finished'?'complete':'')}>{document.status==='finished'?'Finalizado':'Em aberto'}</span></header>
   <h2><ModuleLink href={href}>{document.sourceName}</ModuleLink></h2><p>{document.profileName}</p>
   {summary&&<><div className="imports-pdf-period">{dateLabel(summary.dateFrom??'')}{summary.dateTo!==summary.dateFrom?' a '+dateLabel(summary.dateTo??''):''}</div><dl><div><dt>Lançamentos</dt><dd>{importCount(summary.entryCount)}</dd></div><div><dt>Para conferir</dt><dd>{importCount(summary.pendingCount)}</dd></div><div><dt>Dias</dt><dd>{importCount(summary.dayCount)}</dd></div></dl></>}
   <footer><span>Filtros por coluna e Excel</span><ModuleLink className="btn company-primary" aria-label={'Abrir documento '+document.sourceName} href={href}>Abrir PDF<ArrowUpRight size={15}/></ModuleLink></footer>
  </article>;
 })}</div>;
}
