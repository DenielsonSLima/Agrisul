import {useEffect,useRef,useState} from 'react';
import {Banknote,CalendarDays,ChevronDown,FlaskConical,Layers3,Loader2,MapPinned,Pencil,Plus,ReceiptText,Search,SlidersHorizontal,Trash2,Truck,Wallet,Weight,X} from 'lucide-react';
import {notifications,useConfirmation} from '@/shared/feedback';
import type {BillingContract,ContractLoad,ContractLoadFilters} from '../../types';
import {defaultLoadFilters,type useContractLoads} from '../../hooks/useContractLoads';
import {useContractLoadsMutation} from '../../hooks/useContracts';
import {formatAtr,formatContractLoadAmount,formatContractDate,formatContractMonth,formatContractVolume} from '../../utils/contractFormat';
import {ContractLoadDialog} from './ContractLoadDialog';

export function ContractLoadsTab({contract,filters,onFilters,query}:{contract:BillingContract;filters:ContractLoadFilters;onFilters:(filters:ContractLoadFilters)=>void;query:ReturnType<typeof useContractLoads>}){
 const [editor,setEditor]=useState<ContractLoad|'new'|null>(null);
 const trigger=useRef<HTMLElement|null>(null),mounted=useRef(true),inFlight=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const openEditor=(value:ContractLoad|'new')=>{trigger.current=document.activeElement as HTMLElement;setEditor(value);};
 const mutation=useContractLoadsMutation(),confirm=useConfirmation();
 const {data,loading,error}=query;const filtered=!!(filters.search||filters.from||filters.to);
 const set=(key:keyof ContractLoadFilters,value:string)=>onFilters({...filters,[key]:value});
 const remove=async(load:ContractLoad)=>{
  if(inFlight.current||!await confirm({title:'Excluir carregamento?',description:`O registro de ${formatContractDate(load.loadedAt)}, da ${load.farmName} · ${load.plotName}, com ${formatContractVolume(load.volume)}, será excluído. O saldo e o faturamento do contrato serão atualizados.`,confirmLabel:'Excluir carregamento',tone:'destructive'}))return;
  if(!mounted.current||inFlight.current)return;inFlight.current=true;
  try{await mutation.remove(contract.id,load.id);if(mounted.current)notifications.deleted('O carregamento foi excluído e os indicadores foram atualizados.');}catch(reason){if(mounted.current)notifications.error((reason as Error).message);}finally{inFlight.current=false;}
 };
 return <div className="contract-detail-tab loads-workspace">
  <header className="loads-heading"><div><span className="loads-eyebrow"><Truck size={14}/>CONTROLE DE CARREGAMENTOS</span><h3>Da origem ao volume carregado</h3><p>Acompanhe as saídas e os valores de cada carregamento.</p></div><button className="btn company-primary" onClick={()=>openEditor('new')}><Plus size={17}/>Novo carregamento</button></header>
  <section className="loads-filters" aria-label="Filtros dos carregamentos">
   <label className="loads-search"><span>Buscar carregamentos</span><div><Search size={17}/><input type="search" name="loadSearch" maxLength={200} placeholder="Fazenda, talhão, documento ou observação" value={filters.search} onChange={e=>set('search',e.target.value)}/></div></label>
   <label><span>Carregado de</span><input type="date" name="loadFrom" min="1900-01-01" max="9999-12-31" value={filters.from} onChange={e=>set('from',e.target.value)}/></label>
   <label><span>Até</span><input type="date" name="loadTo" min="1900-01-01" max="9999-12-31" value={filters.to} onChange={e=>set('to',e.target.value)}/></label>
   <button className="btn loads-clear" disabled={!filtered} onClick={()=>onFilters({...defaultLoadFilters,groupBy:filters.groupBy})}><X size={15}/>Limpar</button>
  </section>
  <div className="loads-scope"><span><SlidersHorizontal size={13}/>{filtered?'Indicadores dos carregamentos filtrados':'Indicadores de todos os carregamentos'}</span><small>Período pela data do carregamento</small></div>
  <section className="loads-kpis" aria-label="Indicadores dos carregamentos" aria-busy={loading}>
   <article className="loads-kpi-featured"><Weight/><div><small>Quantidade carregada</small><strong>{loading||error||!data?'—':formatContractVolume(data.summary.volume)}</strong><span>Toneladas líquidas</span></div></article>
   <article><Truck/><div><small>Carregamentos</small><strong>{loading||error||!data?'—':data.summary.loadCount}</strong><span>Registros no período</span></div></article>
   <article><MapPinned/><div><small>Fazendas de origem</small><strong>{loading||error||!data?'—':data.summary.farmCount}</strong><span>{loading||error||!data?'Talhões de origem':`${data.summary.plotCount} talhões de origem`}</span></div></article>
   <article><FlaskConical/><div><small>ATR médio</small><strong>{loading||error?'—':formatAtr(data?.summary.averageAtr??'')}</strong><span>Ponderado pelo volume · kg/t</span></div></article>
   <article className="loads-kpi-money summary-money-gross"><Banknote/><div><small>Faturamento</small><strong>{loading||error?'—':formatContractLoadAmount(data?.summary.grossAmount,data?.summary.billingPending)}</strong><span>Total dos carregamentos</span></div></article>
   <article className="loads-kpi-money loads-kpi-discount summary-money-discount"><ReceiptText/><div><small>Descontos</small><strong>{loading||error?'—':formatContractLoadAmount(data?.summary.discountAmount)}</strong><span>Descontos aplicados</span></div></article>
   <article className="loads-kpi-money loads-kpi-net summary-money-net"><Wallet/><div><small>Valor líquido</small><strong>{loading||error?'—':formatContractLoadAmount(data?.summary.netAmount,data?.summary.billingPending)}</strong><span>Após os descontos</span></div></article>
  </section>
  <section className="loads-results" aria-label="Carregamentos lançados" aria-busy={loading||mutation.saving}>
   <header className="loads-results-heading"><div><h3>Carregamentos lançados</h3><span role="status">{loading?'Buscando carregamentos…':error?'Não foi possível carregar':`${data?.summary.loadCount??0} registros${filtered?' encontrados':''}`}</span></div><label><Layers3 size={15}/><span>Agrupar por</span><select aria-label="Agrupar carregamentos por" value={filters.groupBy} onChange={e=>set('groupBy',e.target.value)}><option value="month">Mês</option><option value="farm">Fazenda</option><option value="none">Sem agrupamento</option></select></label></header>
   {error?<div className="loads-empty" role="alert"><Search/><h4>Confira os filtros ou tente novamente</h4><p>{error}</p><button className="btn" onClick={()=>void query.reload()}>Tentar novamente</button></div>:loading?<div className="loads-empty" role="status"><Loader2 className="animate-spin"/><p>Carregando registros e indicadores…</p></div>:!data?.summary.loadCount?<div className="loads-empty"><span className="loads-empty-icon">{filtered?<Search/>:<Truck/>}</span><h4>{filtered?'Nenhum carregamento neste filtro':'Seu próximo carregamento começa aqui'}</h4><p>{filtered?'Ajuste a busca ou o período para encontrar outros registros.':'Informe a data, selecione a fazenda e o talhão e registre a quantidade carregada.'}</p><button className="btn company-primary" onClick={()=>filtered?onFilters({...defaultLoadFilters,groupBy:filters.groupBy}):openEditor('new')}>{filtered?<X size={16}/>:<Plus size={16}/>} {filtered?'Limpar filtros':'Lançar primeiro carregamento'}</button></div>:<div className="loads-groups">{data.groups.map(group=><details className="loads-group" key={filters.groupBy+':'+group.key} open>
    <summary><span className="loads-group-icon">{filters.groupBy==='farm'?<MapPinned size={18}/>:<CalendarDays size={18}/>}</span><div><h4>{filters.groupBy==='month'?formatContractMonth(group.label):group.label}</h4><small>{group.loadCount} carregamentos · ATR médio {formatAtr(group.averageAtr)}</small></div><strong>{formatContractVolume(group.volume)}</strong><ChevronDown className="loads-chevron" size={17}/></summary>
    <div className="loads-table-wrap"><table className="loads-table"><thead><tr><th>Data carregada</th><th>Origem</th><th>Documento / observações</th><th className="numeric">Quantidade (t)</th><th className="numeric">ATR (kg/t)</th><th className="numeric">Faturamento</th><th className="numeric">Desconto</th><th className="numeric">Valor líquido</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{group.loads.map(load=><tr key={load.id}><td><time dateTime={load.loadedAt}>{formatContractDate(load.loadedAt)}</time></td><td><strong>{load.farmName}</strong><span>{load.plotName}</span></td><td><span>{load.document||'—'}</span>{load.notes&&<small>{load.notes}</small>}</td><td className="numeric"><strong>{formatContractVolume(load.volume)}</strong></td><td className="numeric">{formatAtr(load.atr)}</td><td className={`numeric loads-money${load.billingPending?' loads-money-pending':''}`} title={load.billingPending?'Informe o ATR do carregamento e a cotação do mês de referência para calcular.':`Cotação de ${formatContractMonth(load.atrReferenceMonth)}`}>{formatContractLoadAmount(load.grossAmount,load.billingPending)}</td><td className="numeric loads-money loads-discount">{formatContractLoadAmount(load.discountAmount)}</td><td className={`numeric loads-money loads-net${load.billingPending?' loads-money-pending':''}`}><strong>{formatContractLoadAmount(load.netAmount,load.billingPending)}</strong></td><td><div className="loads-row-actions"><button type="button" title="Editar carregamento" aria-label={`Editar carregamento de ${load.farmName} em ${formatContractDate(load.loadedAt)}`} disabled={mutation.saving} onClick={()=>openEditor(load)}><Pencil size={15}/></button><button type="button" title="Excluir carregamento" aria-label={`Excluir carregamento de ${load.farmName} em ${formatContractDate(load.loadedAt)}`} disabled={mutation.saving} onClick={()=>void remove(load)}><Trash2 size={15}/></button></div></td></tr>)}</tbody></table></div>
   </details>)}</div>}
  </section>
  {editor&&<ContractLoadDialog key={editor==='new'?'new':editor.id} contract={contract} load={editor==='new'?undefined:editor} onClose={()=>setEditor(null)} returnFocus={()=>{if(trigger.current?.isConnected)trigger.current.focus();}}/>}
 </div>;
}

