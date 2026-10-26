'use client';
import {useState} from 'react';
import {ArrowLeft,ArrowUpRight,Building2,Check,ChevronRight,FileText,Filter,Loader2,Pencil,Upload,X} from 'lucide-react';
import {Field} from '@/shared/components/Common';
import {ModuleLink,useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {useClients} from '@/modules/cadastro/clientes/hooks/useClients';
import {dateLabel} from '@/shared/utils/presentation';
import {useImportLedger} from '../hooks/useImportacoes';
import {importClientFiltersFromSearch,importClientHref,importDocumentHref,importTabHref,importUploadHref,type ImportClientFilters} from '../navigation';
import type {ImportField,ImportLedger,ImportLedgerDocument,ImportLedgerGroupBy,ImportLedgerRow,ImportOperationalSummary,ImportStatus} from '../types';
import {MAIN_IMPORT_COLUMNS,importCount,importFieldLabel,importValue} from '../utils/presentation';

const groupChoices:Array<[ImportLedgerGroupBy,string]>=[['none','Sem agrupamento'],['day','Dia'],['farm','Fazenda'],['plot','Talhão'],['source-group','Conjunto']];
const fieldTypeLabels={text:'Texto',decimal:'Número',date:'Data'};

export function ImportClientLedger({clientId,status}:{clientId:string;status:ImportStatus}){
 const {searchParams,navigate}=useModuleNavigation();const filters=importClientFiltersFromSearch(searchParams);const tab=status==='finished'?'finished':'open';
 const model=useImportLedger({clientId,status,...filters,groupBy:filters.groupBy??'none'});const {clients}=useClients();const knownClient=clients.find(client=>client.id===clientId);const title=model.data?.clientName||knownClient?.tradeName||knownClient?.legalName||'Empresa';
 const [allColumns,setAllColumns]=useState(false);const hasFilters=!!(filters.dateFrom||filters.dateTo||filters.farm||filters.plot);
 function changeFilters(change:Partial<ImportClientFilters>){navigate(importClientHref(clientId,tab,{...filters,...change}),{replace:true});}
 return <section className="imports-page imports-company-workspace imports-company-ledger">
  <div className="imports-workspace-navigation"><nav className="imports-breadcrumb" aria-label="Caminho da empresa"><ol><li><ModuleLink href={importTabHref(tab)}>Importações</ModuleLink></li><li><ChevronRight size={13}/><span aria-current="page">{title}</span></li></ol></nav><ModuleLink className="imports-back" href={importTabHref(tab)}><ArrowLeft size={15}/>Voltar às empresas</ModuleLink></div>
  <header className="imports-heading imports-company-heading"><div><div className="eyebrow">LANÇAMENTOS DA EMPRESA</div><h1>{title}</h1><p>{status==='finished'?'Documentos finalizados':'Documentos em aberto'} · confira os lançamentos de todos os PDFs nesta tabela.</p></div><div className="imports-actions"><ModuleLink className="btn small" href={importClientHref(clientId,status==='open'?'finished':'open',filters)}>{status==='open'?'Ver finalizados':'Ver em aberto'}</ModuleLink>{status==='open'&&model.data?.canManage&&<ModuleLink className="btn company-primary" href={importUploadHref(clientId)}><Upload size={15}/>Importar PDF</ModuleLink>}</div></header>
  <div className="imports-ledger-filters" role="group" aria-label="Filtros dos lançamentos" aria-busy={model.loading}><div className="imports-ledger-filter-heading"><span><Filter size={15}/>Filtrar lançamentos</span>{hasFilters&&<button type="button" className="imports-clear-filter" onClick={()=>changeFilters({dateFrom:undefined,dateTo:undefined,farm:undefined,plot:undefined})}><X size={13}/>Limpar filtros</button>}</div><div className="imports-ledger-filter-grid">
   <Field label="Data inicial"><input type="date" aria-label="Data inicial" max="9998-12-31" value={filters.dateFrom??''} onChange={event=>changeFilters({dateFrom:event.target.value||undefined})}/></Field>
   <Field label="Data final"><input type="date" aria-label="Data final" max="9998-12-31" value={filters.dateTo??''} onChange={event=>changeFilters({dateTo:event.target.value||undefined})}/></Field>
   <Field label="Fazenda"><select aria-label="Filtrar por fazenda" value={filters.farm??''} onChange={event=>changeFilters({farm:event.target.value||undefined})}><option value="">Todas as fazendas</option>{filters.farm&&!model.data?.facets.farms.some(farm=>farm.value===filters.farm)&&<option value={filters.farm}>{filters.farm}</option>}{model.data?.facets.farms.map(farm=><option key={farm.value} value={farm.value}>{farm.label}</option>)}</select></Field>
   <Field label="Talhão"><select aria-label="Filtrar por talhão" value={filters.plot??''} onChange={event=>changeFilters({plot:event.target.value||undefined})}><option value="">Todos os talhões</option>{filters.plot&&!model.data?.facets.plots.some(plot=>plot.value===filters.plot)&&<option value={filters.plot}>{filters.plot}</option>}{model.data?.facets.plots.map(plot=><option key={plot.value} value={plot.value}>{plot.label}</option>)}</select></Field>
   <Field label="Agrupar por"><select aria-label="Agrupar lançamentos por" value={filters.groupBy??'none'} onChange={event=>changeFilters({groupBy:event.target.value as ImportLedgerGroupBy})}>{groupChoices.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
  </div><p>Datas do movimento e códigos de fazenda e talhão da planilha de destino.</p></div>
  {model.loading?<div className="imports-state" role="status"><Loader2 className="animate-spin"/>Carregando lançamentos filtrados…</div>:model.error?<div className="imports-state" role="alert"><p>{model.error}</p><button className="btn" onClick={()=>void model.reload()}>Tentar novamente</button></div>:model.data&&<>
   <LedgerSummary summary={model.data.summary} filtered={hasFilters}/>
   <div className="imports-table-toolbar imports-ledger-toolbar"><span>{importCount(model.data.summary.entryCount)} lançamentos{hasFilters?' encontrados':''}</span><div className="imports-table-toolbar-actions"><button type="button" className="btn small" aria-label="Exibir todas as colunas do cliente" aria-pressed={allColumns} onClick={()=>setAllColumns(current=>!current)}>{allColumns?'Colunas principais':'Todas as colunas'}</button></div></div>
   {!model.data.summary.entryCount?<div className="imports-state"><Building2 size={30}/><h3>{hasFilters?'Nenhum lançamento neste filtro':'Nenhum lançamento nesta situação'}</h3><p>{hasFilters?'Ajuste o período, a fazenda ou o talhão para consultar outros lançamentos.':status==='finished'?'Os documentos finalizados aparecerão aqui.':'Importe um PDF para começar a conferir os lançamentos desta empresa.'}</p>{hasFilters&&<button className="btn" onClick={()=>changeFilters({dateFrom:undefined,dateTo:undefined,farm:undefined,plot:undefined})}>Limpar filtros</button>}</div>:<LedgerTables ledger={model.data} allColumns={allColumns} grouped={filters.groupBy!=='none'} filters={filters} tab={tab}/>}
  </>}
 </section>;
}

function LedgerSummary({summary,filtered}:{summary:ImportOperationalSummary;filtered:boolean}){
 return <div className="imports-summary-strip" aria-label={filtered?'Resumo filtrado da empresa':'Resumo da empresa'}><div><span>Dias</span><strong>{importCount(summary.dayCount)}</strong></div><div><span>Documentos PDF</span><strong>{importCount(summary.documentCount)}</strong></div><div><span>Lançamentos</span><strong>{importCount(summary.entryCount)}</strong></div><div><span>Conjuntos</span><strong>{importCount(summary.groupCount)}</strong></div><div className="imports-summary-pending"><span>Para conferir</span><strong>{importCount(summary.pendingCount)}</strong></div></div>;
}

function LedgerTables({ledger,allColumns,grouped,filters,tab}:{ledger:ImportLedger;allColumns:boolean;grouped:boolean;filters:ImportClientFilters;tab:'open'|'finished'}){
 const documents=new Map(ledger.documents.map(document=>[document.id,document]));
 // This is display-column metadata only; rows, grouping and summaries come from Postgres.
 const fields=new Map<string,ImportField>();for(const document of ledger.documents)for(const field of document.fields)if(!fields.has(field.key))fields.set(field.key,field);
 const columns=allColumns?[...fields.keys()]:MAIN_IMPORT_COLUMNS.filter(key=>fields.has(key));
 return <div className="imports-ledger-groups">{ledger.groups.map(group=><section className="imports-ledger-group" key={group.key} data-ledger-group={group.key}>{grouped&&<header className="imports-ledger-group-heading"><h2>{group.label}</h2><span>{importCount(group.summary.entryCount)} lançamentos · {importCount(group.summary.pendingCount)} para conferir</span></header>}<div className="imports-table-wrap imports-operational-table imports-ledger-table"><table className="imports-table" aria-label={grouped?`Lançamentos · ${group.label}`:'Lançamentos da empresa'}><thead><tr><th scope="col" className="imports-row-controls">Ações</th><th scope="col">Dia</th>{columns.map(key=><th scope="col" key={key} title="O tipo de cada valor segue o modelo do PDF de origem">{importFieldLabel(fields.get(key)!)}</th>)}<th scope="col">Conferência</th><th scope="col">Documento de origem</th></tr></thead><tbody>{group.entries.map(row=><LedgerTableRow key={row.documentId+':'+row.entry.id} row={row} document={documents.get(row.documentId)} columns={columns} ledger={ledger} filters={filters} tab={tab}/>)}</tbody></table></div></section>)}</div>;
}

function LedgerTableRow({row,document,columns,ledger,filters,tab}:{row:ImportLedgerRow;document:ImportLedgerDocument|undefined;columns:string[];ledger:ImportLedger;filters:ImportClientFilters;tab:'open'|'finished'}){
 const {entry}=row;const fields=new Map(document?.fields.map(field=>[field.key,field])??[]);const canEdit=ledger.canManage&&document?.status==='open';const documentHref=importDocumentHref(row.documentId,{clientId:ledger.clientId,tab,date:entry.date,filters});const entryHref=importDocumentHref(row.documentId,{clientId:ledger.clientId,tab,date:entry.date,entryId:entry.id,returnToClient:true,filters});
 return <tr data-document-id={row.documentId} data-entry-id={entry.id} data-group-key={entry.groupKey??undefined} data-group-ordinal={entry.groupOrdinal??undefined} data-group-band={row.groupBand==='even'?'alternate':row.groupBand==='odd'?'base':'none'} data-group-start={row.groupStart??false}>
  <th scope="row" className="imports-row-controls"><div>{canEdit?<ModuleLink className="imports-ledger-edit" href={entryHref} aria-label={`Conferir lançamento ${entry.id}`}><Pencil size={13}/>Conferir</ModuleLink>:<ModuleLink className="imports-ledger-edit" href={documentHref}><FileText size={13}/>Ver PDF</ModuleLink>}<ModuleLink className="imports-ledger-open" href={documentHref} aria-label={`Abrir documento ${document?.sourceName??''}`} title="Abrir documento e edição em lote"><ArrowUpRight size={15}/></ModuleLink></div></th>
  <td>{dateLabel(entry.date)}</td>{columns.map(key=>{const field=fields.get(key);return <td key={key} data-field-key={key} data-field-type={field?.type??'unmapped'} title={field?`${field.label} · ${fieldTypeLabels[field.type]} · ${document?.profileName??''}`:'Campo não configurado neste modelo'}>{field?importValue(field,entry.values[key]):'—'}</td>;})}
  <td><span className={'imports-ledger-review '+(entry.reviewed?'reviewed':'pending')}>{entry.reviewed?<Check size={12}/>:<Pencil size={12}/>} {entry.reviewed?'Conferido':'Pendente'}</span>{entry.source.conciliacaoAvisos&&<span className="imports-ledger-source-warning" title={entry.source.conciliacaoAvisos}>Conferir vínculo</span>}</td>
  <td className="imports-ledger-source"><ModuleLink href={documentHref} title={document?.sourceName??''}>{document?.sourceName??'Abrir documento'}</ModuleLink><small title={document?.profileName??''}>{document?.profileName}</small></td>
 </tr>;
}
