'use client';

import {useDeferredValue,useMemo,useState} from 'react';
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {LocalSearch} from '@/shared/components/Common';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {dateLabel} from '@/shared/utils/presentation';
import {useMaterials,useQuotes} from '../hooks/useQuotes';
import type {Quote,QuoteStatus} from '../types';
import {newHref,QuotationBreadcrumb} from './QuoteShared';

const quoteHref=(id:string)=>`/cotacao?cotacao=${encodeURIComponent(id)}`;
const plural=(value:number,singular:string,pluralLabel=`${singular}s`)=>`${value} ${value===1?singular:pluralLabel}`;

function winnerName(quote:Quote){
 const winnerId=quote.winnerProviderId??quote.winningProviderIds?.[0];
 if(!winnerId)return '';
 return quote.providers.find(provider=>provider.id===winnerId||provider.providerId===winnerId)?.providerName??'';
}

export function QuoteList(){
 const materials=useMaterials().materials;
 const [status,setStatus]=useState<QuoteStatus>('open');
 const openQuery=useQuotes('open'),finishedQuery=useQuotes('finished');
 const query=status==='open'?openQuery:finishedQuery;
 const [search,setSearch]=useState(''),deferred=useDeferredValue(search);
 const [material,setMaterial]=useState('all'),[provider,setProvider]=useState('all');
 const allQuotes=useMemo(()=>[...openQuery.quotes,...finishedQuery.quotes],[openQuery.quotes,finishedQuery.quotes]);
 const providerNames=useMemo(()=>[...new Set(allQuotes.flatMap(quote=>quote.providers.map(item=>item.providerName)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')),[allQuotes]);
 const filtered=useMemo(()=>{
  const value=deferred.trim().toLocaleLowerCase('pt-BR');
  return query.quotes.filter(quote=>{
   const searchable=[quote.title,quote.number,quote.requester,...quote.items.flatMap(item=>[item.materialName,item.materialCode]),...quote.providers.map(item=>item.providerName)].join(' ').toLocaleLowerCase('pt-BR');
   return (!value||searchable.includes(value))
    &&(material==='all'||quote.items.some(item=>item.materialId===material))
    &&(provider==='all'||quote.providers.some(item=>item.providerName===provider));
  });
 },[deferred,material,provider,query.quotes]);
 const filtersActive=!!search.trim()||material!=='all'||provider!=='all';
 const visibleItems=filtered.reduce((total,quote)=>total+quote.items.length,0);
 const visibleProviders=filtered.reduce((total,quote)=>total+quote.providers.length,0);
 const clearFilters=()=>{setSearch('');setMaterial('all');setProvider('all');};

 return <section className="cotacao-page quote-list-page">
  <QuotationBreadcrumb/>
  <header className="quote-list-hero">
   <div className="quote-list-hero-copy">
    <span className="quote-eyebrow">CENTRAL DE COMPRAS</span>
    <h2>Cotações</h2>
    <p>Acompanhe solicitações, propostas recebidas e decisões de compra em um só lugar.</p>
   </div>
   <ModuleLink className="btn company-primary quote-list-create" href={newHref}><Plus size={18}/>Nova cotação</ModuleLink>
  </header>

  <section className="quote-list-kpis" aria-label="Resumo das cotações">
   <article>
    <span className="quote-list-kpi-icon open"><Clock3 size={19}/></span>
    <div><small>Em aberto</small><strong>{openQuery.loading?'—':openQuery.total}</strong><p>Aguardando comparação</p></div>
   </article>
   <article>
    <span className="quote-list-kpi-icon finished"><CheckCircle2 size={19}/></span>
    <div><small>Finalizadas</small><strong>{finishedQuery.loading?'—':finishedQuery.total}</strong><p>Decisões concluídas</p></div>
   </article>
   <article>
    <span className="quote-list-kpi-icon"><Boxes size={19}/></span>
    <div><small>Materiais na seleção</small><strong>{query.loading?'—':visibleItems}</strong><p>{status==='open'?'Em negociação':'Já cotados'}</p></div>
   </article>
   <article>
    <span className="quote-list-kpi-icon"><Users size={19}/></span>
    <div><small>Prestadores na seleção</small><strong>{query.loading?'—':visibleProviders}</strong><p>Convites vinculados</p></div>
   </article>
  </section>

  <section className="quote-list-workspace" aria-labelledby="quote-list-title">
   <header className="quote-list-workspace-header">
    <div>
     <span className="quote-list-workspace-icon"><ClipboardList size={19}/></span>
     <div><h3 id="quote-list-title">Painel de cotações</h3><p>Filtre, acompanhe as respostas e abra uma cotação para negociar.</p></div>
    </div>
    <span className="quote-result-count" aria-live="polite">{filtered.length===query.total?plural(query.total,'cotação','cotações'):`${filtered.length} de ${query.total} cotações`}</span>
   </header>

   <Tabs value={status} onValueChange={value=>setStatus(value as QuoteStatus)} className="quote-list-status-tabs">
    <TabsList variant="line" aria-label="Situação das cotações">
     <TabsTrigger value="open"><Clock3 size={15}/>Em aberto <span>{openQuery.total}</span></TabsTrigger>
     <TabsTrigger value="finished"><CheckCircle2 size={15}/>Finalizadas <span>{finishedQuery.total}</span></TabsTrigger>
    </TabsList>
   </Tabs>

   <div className="quote-list-toolbar">
    <div className="quote-list-search"><LocalSearch value={search} onChange={setSearch} placeholder="Buscar por número, material ou solicitante"/></div>
    <label><span>Material</span><select value={material} onChange={event=>setMaterial(event.target.value)}><option value="all">Todos os materiais</option>{materials.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label><span>Prestador</span><select value={provider} onChange={event=>setProvider(event.target.value)}><option value="all">Todos os prestadores</option>{providerNames.map(name=><option key={name} value={name}>{name}</option>)}</select></label>
    <button type="button" className="btn quote-list-clear" disabled={!filtersActive} onClick={clearFilters}><X size={15}/>Limpar filtros</button>
   </div>

   {query.loading
    ?<div className="client-loading quote-list-state" role="status"><Loader2 className="animate-spin" size={20}/>Carregando cotações…</div>
    :query.error
     ?<div className="company-empty quote-list-state" role="alert"><h3>Não foi possível carregar</h3><p>{query.error}</p><button type="button" className="btn" onClick={()=>void query.reload()}><RefreshCw size={16}/>Tentar novamente</button></div>
     :!filtered.length
      ?<div className="company-empty quote-list-state"><span className="company-empty-icon">{filtersActive?<SlidersHorizontal size={24}/>:<FileText size={24}/>}</span><h3>{filtersActive?'Nenhuma cotação corresponde aos filtros':'Nenhuma cotação encontrada'}</h3><p>{filtersActive?'Limpe ou ajuste os filtros para ampliar a busca.':'Crie uma cotação para solicitar preços aos prestadores.'}</p>{filtersActive?<button type="button" className="btn" onClick={clearFilters}><X size={15}/>Limpar filtros</button>:<ModuleLink className="btn company-primary" href={newHref}><Plus size={16}/>Nova cotação</ModuleLink>}</div>
      :<div className="quote-list-card-grid" role="list" aria-label="Cotações encontradas">
       {filtered.map(quote=>{
          const completed=quote.completeProviderCount,providersTotal=quote.providers.length;
         const ready=providersTotal>0&&completed===providersTotal;
         const progress=providersTotal?Math.min(100,Math.round(completed/providersTotal*100)):0;
         const winner=winnerName(quote);
         const materialPreview=quote.items.slice(0,2).map(item=>item.materialName).join(', ');
         return <article className={`quote-list-card ${quote.status}`} role="listitem" aria-labelledby={`quote-card-${quote.id}`} key={quote.id}>
          <header className="quote-list-card-header">
           <span className="quote-list-card-icon"><FileText size={19}/></span>
           <div className="quote-list-card-title">
            <span>{quote.number||'Numeração automática'}</span>
            <h4 id={`quote-card-${quote.id}`} title={quote.title}>{quote.title}</h4>
           </div>
           <span className={`quote-list-status ${quote.status==='finished'?'finished':'open'}`}>
            {quote.status==='finished'?<CheckCircle2 size={13}/>:<Clock3 size={13}/>}
            {quote.status==='finished'?'Finalizada':'Em aberto'}
           </span>
          </header>

          <dl className="quote-list-card-meta">
           <div><dt>Emissão</dt><dd className="quote-list-date">{dateLabel(quote.requestDate)}</dd></div>
           <div><dt>Solicitante</dt><dd className="quote-list-requester" title={quote.requester||'Não informado'}>{quote.requester||'Não informado'}</dd></div>
          </dl>

          <div className="quote-list-card-scope">
           <div><strong>{plural(quote.items.length,'material')}</strong><span className="quote-list-provider-count"><Users size={12}/>{plural(providersTotal,'prestador')}</span></div>
           <p title={materialPreview}>{materialPreview||'Nenhum material'}{quote.items.length>2?` +${quote.items.length-2}`:''}</p>
          </div>

          {quote.status==='finished'
           ?<div className="quote-list-progress-copy"><span className="quote-list-status finished"><CheckCircle2 size={13}/>Compra concluída</span><small title={winner?`Vencedor: ${winner}`:undefined}>{winner?`Vencedor: ${winner}`:'Cotação finalizada'}</small></div>
           :<div className="quote-list-progress-copy"><span className={`quote-list-status ${!providersTotal?'empty':ready?'ready':'open'}`}>{!providersTotal?<Users size={13}/>:ready?<CheckCircle2 size={13}/>:<Clock3 size={13}/>} {!providersTotal?'Sem prestadores':ready?'Pronta para comparar':'Coletando preços'}</span>{providersTotal>0&&<div className="quote-list-progress" role="progressbar" aria-label="Propostas completas" aria-valuemin={0} aria-valuemax={providersTotal} aria-valuenow={completed}><span style={{width:`${progress}%`}}/></div>}<small>{providersTotal?`${completed} de ${providersTotal} propostas completas`:'Nenhum prestador vinculado'}</small></div>}

          <footer className="quote-list-card-footer"><ModuleLink className="btn quote-list-card-open" href={quoteHref(quote.id)} aria-label={`Abrir ${quote.number||quote.title}`}>Abrir cotação <ArrowRight size={15}/></ModuleLink></footer>
         </article>;
        })}
      </div>}
  </section>
 </section>;
}
