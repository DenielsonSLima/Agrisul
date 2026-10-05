'use client';
import {useState,type ReactNode} from 'react';
import {ArrowUpRight,Banknote,Building2,CalendarRange,Download,FileText,Gauge,Landmark,Leaf,MapPinned,Minus,RefreshCw,RotateCcw,Sprout,Target,TrendingDown,TrendingUp,Truck} from 'lucide-react';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {BillingQueryState} from '@/shared/components/BillingQueryState';
import {useWorkspaceCompany} from '@/shared/state/WorkspaceCompanyProvider';
import {dateLabel,decimalLabel,localDay,moneyLabel} from '@/shared/utils/presentation';
import {useExecutiveSummary} from '../hooks/useSummary';
import {defaultRange,monthRange,rangeDays,shiftDay,validRange} from '../filters';
import type {ExecutiveSummaryData,ExecutiveSummarySnapshot,SummaryFilters} from '../types';
import {FarmVolumeChart,FinancialComposition,FinancialEvolution,OperationalEvolution} from './SummaryCharts';
import {SummaryExportDialog} from './SummaryExportDialog';
import {MonthlyOperationsPanel,PerformanceRankings,PlanningPerformanceTable,Progress} from './SummaryOperational';
import {SummaryContracts} from './SummaryContracts';
import '../styles.css';

export function ResumoPage(){
 const workspace=useWorkspaceCompany();
 // Company changes discard local selections and export drafts.
 return <SummaryDashboard key={workspace.activeCompanyId}/>;
}

function SummaryDashboard(){
 const [filters,setFilters]=useState<SummaryFilters>(defaultRange);
 const [draft,setDraft]=useState(()=>({from:filters.from,to:filters.to}));
 const [parentRange,setParentRange]=useState<SummaryFilters|null>(null);
 const [snapshot,setSnapshot]=useState<ExecutiveSummarySnapshot|null>(null);
 const model=useExecutiveSummary(filters.from,filters.to,{contractId:filters.contractId,status:filters.status});
 const data=model.data,invalid=!validRange(draft),busy=model.isFetching;
 const apply=(next:SummaryFilters)=>{setFilters(next);setDraft({from:next.from,to:next.to});setParentRange(null);};
 const preset=(days:number)=>{const to=localDay();apply({...filters,from:shiftDay(to,-days+1),to});};
 const selectMonth=(month:string)=>{
  const next=monthRange(month,filters);
  if(next&&(next.from!==filters.from||next.to!==filters.to)){
   setParentRange(value=>value??filters);setFilters(next);setDraft({from:next.from,to:next.to});
  }
 };
 const restorePeriod=()=>{if(parentRange)apply({...filters,from:parentRange.from,to:parentRange.to});};
 const options=data?.filterOptions;
 const hasSelection=!!filters.contractId||!!filters.status||!!parentRange;
 return <section className="summary-page">
  <header className="summary-heading">
   <div><div className="eyebrow">PAINEL GERENCIAL</div><h2>Sua operação, em perspectiva.</h2><p>Da entrega ao recebimento, acompanhe os resultados e explore cada contrato.</p></div>
   <div className="summary-heading-actions"><span className="summary-company"><Building2 size={16}/><span><small>Empresa ativa</small><strong>{model.company?.name||'Selecione uma empresa'}</strong></span></span>
    <button className="btn company-primary summary-export" type="button" disabled={!data||busy||!!model.errorMessage} onClick={()=>{if(data)setSnapshot({data:structuredClone(data),companyId:model.companyId});}}><Download size={16}/>Exportar PDF completo</button>
   </div>
  </header>
  <form className="summary-filter" aria-label="Filtros do resumo" onSubmit={event=>{event.preventDefault();if(!invalid)apply({...filters,...draft});}}>
   <div className="summary-filter-top"><div className="summary-filter-title"><span><CalendarRange size={20}/></span><div><strong>Período em foco</strong><small>365 dias por padrão · até 5 anos</small></div></div>
    <div className="summary-presets" aria-label="Períodos rápidos">{[30,90,365].map(days=><button key={days} type="button" aria-pressed={!parentRange&&rangeDays(filters)===days} onClick={()=>preset(days)}>{days} dias</button>)}<button type="button" aria-pressed={!parentRange&&filters.from===localDay().slice(0,4)+'-01-01'&&filters.to===localDay()} onClick={()=>apply({...filters,from:localDay().slice(0,4)+'-01-01',to:localDay()})}>Ano atual</button></div>
    <button type="button" className="summary-reset" onClick={()=>apply(defaultRange())}><RotateCcw size={15}/>Limpar filtros</button>
   </div>
   <div className="summary-filter-fields">
    <label>Data inicial<input type="date" min="1900-01-01" max={draft.to||'9999-12-31'} value={draft.from} onInput={event=>{const from=event.currentTarget.value;setDraft(value=>({...value,from}));}}/></label>
    <label>Data final<input type="date" min={draft.from||'1900-01-01'} max="9999-12-31" value={draft.to} onInput={event=>{const to=event.currentTarget.value;setDraft(value=>({...value,to}));}}/></label>
    <label className="summary-contract-filter">Contrato<select value={filters.contractId} disabled={!options} onChange={event=>apply({...filters,contractId:event.target.value})}><option value="">Todos os contratos</option>{options?.contracts.map(item=><option key={item.id} value={item.id}>{item.clientName} · {item.contractNumber||item.title}</option>)}</select></label>
    <label>Status atual<select value={filters.status} disabled={!options} onChange={event=>apply({...filters,status:event.target.value})}><option value="">Todos os status</option>{options?.statuses.map(status=><option key={status} value={status}>{status}</option>)}</select></label>
    <button type="submit" className="btn company-primary" disabled={invalid||(draft.from===filters.from&&draft.to===filters.to)}>Aplicar período</button>
   </div>
   {invalid&&<p className="summary-filter-error" role="alert">Escolha um período entre 1 dia e 5 anos.</p>}
   <div className="summary-filter-context" aria-live="polite"><span><strong>No período</strong> {dateLabel(filters.from)} a {dateLabel(filters.to)}</span>{filters.contractId&&<span>Contrato selecionado</span>}{filters.status&&<span>Status: {filters.status}</span>}{parentRange&&<button type="button" onClick={restorePeriod}>Voltar ao período completo</button>}{hasSelection&&<small>Financeiro e operação seguem esta seleção.</small>}</div>
  </form>
  <BillingQueryState {...model}/>
  {data&&!model.errorMessage&&!model.loading&&<div aria-busy={busy}>
   <div className="summary-results-heading"><span className="summary-kicker">VISÃO DA EMPRESA · NO PERÍODO</span><span className="summary-updated" role="status">{busy?<><RefreshCw size={14} className="animate-spin"/>Atualizando seleção…</>:<>{data.totals.contractCount} contratos na seleção</>}</span></div>
   <dl className="summary-kpis">
    <Metric icon={Banknote} label="Faturamento líquido" value={moneyLabel(data.totals.netAmount)} detail="Entregas após descontos" featured><ChangeBadge value={data.comparison.netChangePercent}/></Metric>
    <Metric icon={Truck} label="Volume carregado" value={`${decimalLabel(data.totals.loadedVolume)} t`} detail={`${data.totals.loadCount} cargas no período`}><ChangeBadge value={data.comparison.volumeChangePercent}/></Metric>
    <Metric icon={Landmark} label="Entradas em caixa" value={moneyLabel(data.totals.receivedAmount)} detail="Adiantamentos + recebimentos − estornos"><ChangeBadge value={data.comparison.receivedChangePercent}/></Metric>
    <Metric icon={Gauge} label="ATR médio ponderado" value={decimalLabel(data.operationalTotals?.averageAtr)} detail="kg ATR/t · ponderado pelo volume"/>
    <Metric icon={FileText} label="Contratos na seleção" value={String(data.totals.contractCount)} detail={`${data.totals.activeContractCount} ativos · inclui contratos sem movimento`}/>
    <Metric icon={Minus} label="Diferença do recorte" value={moneyLabel(data.totals.pendingAmount)} detail="Soma das diferenças positivas entre líquido e caixa por contrato"/>
   </dl>
   {data.totals.billingPending&&<div className="summary-notice" role="status"><strong>Valores a apurar</strong><span>{data.totals.pendingLoadCount} carga(s) com ATR ou cotação incompletos. Os valores pendentes permanecem em aberto.</span></div>}
   {!data.totals.loadCount&&!Number(data.totals.receivedAmount)&&<p className="summary-compact-empty" role="status">Sem movimentação nesta seleção. A carteira de contratos e o workspace continuam disponíveis abaixo.</p>}
   <nav className="summary-section-nav" aria-label="Explorar o resumo"><a href="#summary-financial">Financeiro</a><a href="#summary-operation">Operação</a><a href="#summary-contracts">Contratos</a><a href="#summary-workspace">Workspace agrícola</a></nav>
   <section id="summary-financial" className="summary-block"><BlockHeading kicker="RESULTADO FINANCEIRO" title="Da entrega ao recebimento" description="Mesma seleção nos indicadores, gráficos e detalhamento. Clique em um mês para analisar."/><div className="summary-analytics"><FinancialEvolution data={data.months} onSelectMonth={selectMonth} disabled={busy}/><FinancialComposition totals={data.totals}/></div></section>
   <section id="summary-operation" className="summary-block"><BlockHeading kicker="OPERAÇÃO NO PERÍODO" title="Produção, qualidade e origem" description="Explore as entregas da empresa, dos contratos e dos status selecionados."/><div className="summary-operation-grid"><OperationalEvolution data={data.monthlyOperations??[]} onSelectMonth={selectMonth} disabled={busy}/><FarmVolumeChart farms={data.farms}/></div>{data.operationalTotals&&data.monthlyOperations&&<details className="summary-data-details summary-operational-details"><summary>Ver indicadores operacionais por mês</summary><MonthlyOperationsPanel data={data}/></details>}{data.farmPerformance&&data.plotPerformance&&<PerformanceRankings data={data}/>}</section>
   <SummaryContracts key={JSON.stringify(filters)} data={data} disabled={busy||!options} onSelectContract={id=>apply({...filters,contractId:id})} onSelectStatus={status=>apply({...filters,status})}/>
   <WorkspaceSection data={data}/>
   <p className="summary-footnote">Cargas: data do carregamento. Caixa: data efetiva da entrada, incluindo estornos. Diferença do recorte: líquido menos caixa, limitado a zero por contrato; não representa dívida vencida. Entrega do contrato: acumulado de todas as datas. Cadastro e planejamento: workspace, independente de empresa, contrato e status; a safra em foco acumula execução até a data final.</p>
  </div>}
  {snapshot&&<SummaryExportDialog snapshot={snapshot} onClose={()=>setSnapshot(null)}/>}
 </section>;
}

export function BlockHeading({kicker,title,description}:{kicker:string;title:string;description:string}){
 return <header className="summary-block-heading"><div><span className="summary-kicker">{kicker}</span><h3>{title}</h3><p>{description}</p></div></header>;
}
function WorkspaceSection({data}:{data:ExecutiveSummaryData}){
 return <section id="summary-workspace" className="summary-block summary-workspace">
  <BlockHeading kicker="WORKSPACE AGRÍCOLA" title="Estrutura e planejamento" description="Cadastro atual e safra em foco. Independentes dos filtros de contrato, status e empresa."/>
  <div className="summary-registry-strip"><span><MapPinned size={20}/><strong>Cadastro atual</strong></span><dl><div><dt>Fazendas</dt><dd>{data.agriculture.registeredFarmCount}</dd></div><div><dt>Talhões</dt><dd>{data.agriculture.registeredPlotCount}</dd></div><div><dt>Área cadastrada</dt><dd>{decimalLabel(data.agriculture.farmAreaHa)} ha</dd></div><div><dt>Área mapeada</dt><dd>{decimalLabel(data.agriculture.plotAreaHa)} ha</dd></div></dl></div>
  <div className="summary-planning"><div className="summary-block-heading"><div><span className="summary-kicker"><Target size={15}/>PLANEJAMENTO DO WORKSPACE · SAFRA EM FOCO</span><h3>{data.planning.periodName||'Metas e execução agrícola'}</h3><p>{data.planning.periodName?`Acumulado da safra até ${dateLabel(data.planning.progressAsOf)}. Uma safra em foco para evitar somar metas sobrepostas.`:'Nenhuma safra cruza o período selecionado.'}</p></div><ModuleLink href="/planejamento" className="text-link">Abrir planejamento<ArrowUpRight size={16}/></ModuleLink></div>
   <div className="summary-planning-grid"><ProgressCard icon={Sprout} title="Plantio" hasTarget={Number(data.planning.targetAreaHa)>0} percent={data.planning.plantingPercent} actual={`${decimalLabel(data.planning.plantedAreaHa)} ha`} target={`${decimalLabel(data.planning.targetAreaHa)} ha`} detail={`${decimalLabel(data.planning.allocatedAreaHa)} ha distribuídos`}/><ProgressCard icon={Truck} title="Colheita" hasTarget={Number(data.planning.harvestTargetTons)>0} percent={data.planning.harvestPercent} actual={`${decimalLabel(data.planning.harvestedTons)} t`} target={`${decimalLabel(data.planning.harvestTargetTons)} t`} detail="Cargas dos talhões da safra"/><div className="summary-panel summary-management"><header><span className="summary-kicker"><Leaf size={15}/>MANEJO NA SAFRA</span><h3>{decimalLabel(data.planning.managedAreaHa)} ha</h3><p>{data.planning.managementEventCount} ocorrências</p></header>{data.management.length?<ol>{data.management.slice(0,5).map(item=><li key={item.id}><span><i/>{item.name}</span><strong>{decimalLabel(item.areaHa)} ha</strong><small>{item.eventCount} lançamento(s)</small></li>)}</ol>:<div className="summary-compact-empty">Nenhum manejo registrado na safra em foco.</div>}</div></div>
   <details className="summary-data-details"><summary>Ver metas por fazenda e talhão</summary><PlanningPerformanceTable farms={data.planningPerformance?.farms??[]} plots={data.planningPerformance?.plots??[]}/></details>
  </div>
 </section>;
}
function ChangeBadge({value}:{value:string}){
 const amount=value===''?null:Number(value),Icon=amount===null||amount===0?Minus:amount>0?TrendingUp:TrendingDown;
 return <span className={`summary-change ${amount===null?'neutral':amount>=0?'positive':'negative'}`}><Icon size={13}/>{amount===null?'Sem base anterior':`${amount>0?'+':''}${decimalLabel(amount)}%`}<small>vs. período anterior</small></span>;
}
function Metric({icon:Icon,label,value,detail,featured=false,children}:{icon:typeof Banknote;label:string;value:string;detail:string;featured?:boolean;children?:ReactNode}){
 return <div className={featured?'summary-metric-featured':''}><dt><span>{label}</span><i><Icon size={19}/></i></dt><dd>{value}</dd><small>{detail}</small>{children}</div>;
}
function ProgressCard({icon:Icon,title,percent,actual,target,hasTarget,detail}:{icon:typeof Sprout;title:string;percent:string;actual:string;target:string;hasTarget:boolean;detail:string}){
 return <article className="summary-panel summary-progress"><header><span><Icon size={20}/></span><div><small>PROGRESSO DE {title.toLocaleUpperCase('pt-BR')}</small><h3>{title}</h3></div><strong>{hasTarget?`${decimalLabel(percent)}%`:'Sem meta'}</strong></header>{hasTarget&&<Progress value={percent}/>}<dl><div><dt>Realizado</dt><dd>{actual}</dd></div><div><dt>Meta</dt><dd>{hasTarget?target:'Não definida'}</dd></div></dl><p>{detail}</p></article>;
}
