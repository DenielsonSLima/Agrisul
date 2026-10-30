'use client';
import {Fragment,useCallback,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import {Activity,ArrowDownRight,ArrowUpRight,Building2,CalendarDays,Eye,EyeOff,Filter,Gauge,Maximize2,Minimize2,MonitorPlay,Newspaper,Pause,Play,RefreshCw,Square,Tags,Truck,Wallet,WifiOff} from 'lucide-react';
import {BillingQueryState} from '@/shared/components/BillingQueryState';
import {useWorkspaceCompany} from '@/shared/state/WorkspaceCompanyProvider';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {decimalLabel,localDay} from '@/shared/utils/presentation';
import {MarketTicker} from '@/modules/dashboard-market/MarketTicker';
import {DashboardNews} from '@/modules/dashboard-news/DashboardNews';
import {useAgroNews} from '@/modules/dashboard-news/useAgroNews';
import {useDashboardAtr} from '@/modules/dashboard-news/useDashboardAtr';
import {useExecutiveSummary} from '../hooks/useSummary';
import {DASHBOARD_SCENES,useDashboardPresentation} from '../hooks/useDashboardPresentation';
import {useDashboardSceneTransition} from '../hooks/useDashboardSceneTransition';
import {useDashboardFilters} from '../hooks/useDashboardFilters';
import {DASHBOARD_DEFAULT_PERIODS} from '../defaultPeriod';
import {defaultRange,shiftDay,validRange} from '../filters';
import type {ExecutiveSummaryData} from '../types';
import type {DashboardSceneId} from '../presentationSettings';
import {useWeeklyRange,useWeeklySummary} from '../hooks/useWeeklySummary';
import {DashboardWeekly,WeeklyContext} from './DashboardWeekly';
import {DashboardValuesProvider,useDashboardValues} from '../dashboardValues';
import {FinancialComposition,FinancialEvolution,OperationalEvolution} from './SummaryCharts';
import {DashboardAnalysis,DashboardBars,DashboardHarvest} from './DashboardVisuals';
import {DashboardClientList} from './DashboardClientList';
import {DashboardContractAnalysis} from './DashboardContractAnalysis';
import {DashboardClock,DashboardPopover,DashboardSceneNavigation,DashboardSettings} from './DashboardControls';
import {DashboardQuickFilters,type QuickFilterMenu} from './DashboardQuickFilters';

export function ResumoPage(){const workspace=useWorkspaceCompany(),{user}=useAuth();return <DashboardValuesProvider key={user?.id} userId={user?.id}><SummaryDashboard key={workspace.activeCompanyId}/></DashboardValuesProvider>;}

function SummaryDashboard(){
 const {visible,toggle,financialGrouping,setFinancialGrouping,defaultPeriod,setDefaultPeriod,newsScope,setNewsScope}=useDashboardValues();
 const rootRef=useRef<HTMLElement>(null),filterTrigger=useRef<HTMLButtonElement>(null);
 const presentation=useDashboardPresentation(rootRef);
 const transition=useDashboardSceneTransition(presentation.scene);
 const news=useAgroNews(),atr=useDashboardAtr();
 const {filters,setFilters,draft,setDraft}=useDashboardFilters(defaultPeriod);
 const [filtersOpen,setFiltersOpen]=useState(false),[settingsOpen,setSettingsOpen]=useState(false);
 const [quickMenu,setQuickMenu]=useState<QuickFilterMenu>(null);
 const closeSettings=useCallback(()=>setSettingsOpen(false),[]),closeFilters=useCallback(()=>setFiltersOpen(false),[]);
 const weeklyRange=useWeeklyRange();
 const scene=DASHBOARD_SCENES[presentation.scene],displayedScene=DASHBOARD_SCENES[transition.scene];
 const weeklyScene=scene.id==='dashboard-weekly',showWeekly=displayedScene.id==='dashboard-weekly';
 const weeklyModel=useWeeklySummary(weeklyRange.from,weeklyRange.to,filters,weeklyScene||showWeekly);
 const generalModel=useExecutiveSummary(filters.from,filters.to,{contractId:filters.contractId,status:filters.status,partnerId:filters.partnerId,farmId:filters.farmId,plotId:filters.plotId,partnerIds:filters.partnerIds,contractIds:filters.contractIds,farmIds:filters.farmIds,plotIds:filters.plotIds,contractMethod:filters.contractMethod},!weeklyScene||!showWeekly),data=generalModel.data;
 const model=weeklyScene?weeklyModel:generalModel;
 const effectiveFilters=weeklyScene?{...filters,...weeklyRange}:filters;
 const applyFilters=(next:typeof filters)=>setFilters(weeklyScene?{...next,from:filters.from,to:filters.to}:next);
 const busy=model.isFetching,failed=!!model.errorMessage;
 const newsScene=scene.id==='dashboard-news',showNews=DASHBOARD_SCENES[transition.scene].id==='dashboard-news';
 const activeBusy=newsScene?news.isFetching:busy,activeFailed=newsScene?news.isError:failed,updatedAt=newsScene?news.dataUpdatedAt:model.dataUpdatedAt;
 const start=()=>{closeSettings();closeFilters();setQuickMenu(null);void presentation.startPresentation();};
 const preset=(days:number)=>{const to=localDay();setDraft(value=>({...value,from:shiftDay(to,-days+1),to}));};
 return <section ref={rootRef} className={`dashboard-page executive-dashboard ${presentation.presenting?'executive-presenting':''}`} aria-label="Dashboard de acompanhamento">
  <MarketTicker actions={<DashboardSettings newsScope={newsScope} onNewsScopeChange={setNewsScope} defaultPeriod={defaultPeriod} onDefaultPeriodChange={setDefaultPeriod} financialGrouping={financialGrouping} onFinancialGroupingChange={setFinancialGrouping} presentation={presentation} open={settingsOpen} onToggle={()=>{closeFilters();setQuickMenu(null);setSettingsOpen(value=>!value);}} onClose={closeSettings}/>}/>
  <header className="executive-header"><div className="executive-heading"><div><h2>Dashboard</h2><span className="executive-company" title={model.company?.name}><Building2 size={13}/>{model.company?.name||'Selecione uma empresa'}</span></div></div>
   <div className="executive-actions"><DashboardClock/>
    <div className="executive-filter-anchor"><button ref={filterTrigger} type="button" disabled={newsScene} className={`executive-button ${filtersOpen?'is-active':''}`} aria-label="Filtros do Dashboard" aria-expanded={filtersOpen} aria-controls="dashboard-filters" onClick={()=>{closeSettings();setQuickMenu(null);setDraft(effectiveFilters);setFiltersOpen(value=>!value);}}><Filter size={15}/><span>Filtros</span></button>
     {filtersOpen&&<DashboardPopover title="Filtros do Dashboard" id="dashboard-filters" onClose={closeFilters} onReturnFocus={()=>filterTrigger.current?.focus()}><form className="executive-filter-form" onSubmit={event=>{event.preventDefault();if(validRange(draft)){applyFilters(draft);closeFilters();}}}>
      <p hidden={weeklyScene}>Padrão: {DASHBOARD_DEFAULT_PERIODS.find(item=>item.id===defaultPeriod)?.label} · consulte até 5 anos.</p><div className="executive-filter-presets" hidden={weeklyScene}>{[30,90,365].map(days=><button type="button" key={days} onClick={()=>preset(days)}>{days} dias</button>)}</div>
      <div className="executive-filter-grid" hidden={weeklyScene}><label>De<input type="date" min="1900-01-01" max={draft.to} value={draft.from} onChange={event=>setDraft(value=>({...value,from:event.target.value}))}/></label><label>Até<input type="date" min={draft.from} max="9999-12-31" value={draft.to} onChange={event=>setDraft(value=>({...value,to:event.target.value}))}/></label></div>
      <p>{weeklyScene?'Últimos 7 dias fixos. Use os filtros de cliente, contrato e origem da linha do período.':'Clientes, contratos e origens podem ser combinados nos seletores da linha do período.'}</p>
      <label>Status<select value={draft.status} onChange={event=>setDraft(value=>({...value,status:event.target.value}))}><option value="">Todos os status</option>{model.data?.filterOptions?.statuses.map(status=><option key={status}>{status}</option>)}</select></label>
      {!validRange(draft)&&<p className="executive-form-error" role="alert">Escolha um período entre 1 dia e 5 anos.</p>}
      <div className="executive-filter-footer"><button type="button" onClick={()=>setDraft(weeklyScene?{...defaultRange(defaultPeriod),...weeklyRange}:defaultRange(defaultPeriod))}>Limpar filtros</button><button type="submit" disabled={!validRange(draft)}>Aplicar filtros</button></div>
     </form></DashboardPopover>}
    </div>
    <button type="button" className={`executive-button executive-icon-button ${visible?'':'is-active'}`} aria-label={visible?'Ocultar valores financeiros':'Exibir valores financeiros'} title={visible?'Ocultar valores financeiros':'Exibir valores financeiros'} aria-pressed={!visible} onClick={toggle}>{visible?<Eye size={16}/>:<EyeOff size={16}/>}</button>
    <button type="button" className="executive-button" aria-label={presentation.fullscreen?'Sair da tela cheia':'Tela cheia'} onClick={()=>void presentation.toggleFullscreen()}>{presentation.fullscreen?<Minimize2 size={16}/>:<Maximize2 size={16}/>}<span>{presentation.fullscreen?'Sair':'Tela cheia'}</span></button>
    {presentation.presenting?<><button type="button" className="executive-button executive-button-primary" onClick={presentation.togglePause}>{presentation.paused?<Play size={15}/>:<Pause size={15}/>}<span>{presentation.paused?'Continuar':'Pausar'}</span></button><button type="button" className="executive-button executive-icon-button" aria-label="Encerrar apresentação" title="Encerrar apresentação" onClick={presentation.stopPresentation}><Square size={14}/></button></>:<button type="button" disabled={newsScene?news.isPending:!model.data||model.loading||failed} className="executive-button executive-button-primary" onClick={start}><MonitorPlay size={16}/><span>Apresentar</span></button>}
   </div>
  </header>
  <div className="executive-context">{newsScene?<span><CalendarDays size={13}/>Cana, açúcar, etanol e agronegócio</span>:<DashboardQuickFilters key={`${weeklyScene}:${effectiveFilters.from}:${effectiveFilters.to}`} weekly={weeklyScene} filters={effectiveFilters} options={model.data?.filterOptions} onChange={applyFilters} open={quickMenu} onMenuChange={setQuickMenu} onOpen={()=>{closeSettings();closeFilters();}}/>}{!newsScene&&filters.status&&<span className="executive-filter-chip">{filters.status}</span>}
   <span className={`executive-sync ${!presentation.online||activeFailed?'is-warning':''}`} role="status">{!presentation.online?<WifiOff size={12}/>:activeBusy?<RefreshCw size={12} className="animate-spin"/>:<i/>}{!presentation.online?'Sem conexão · últimos dados':activeFailed?'Atualização indisponível':activeBusy?'Sincronizando':'Atualização automática'}<small>{updatedAt?new Date(updatedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}):''}</small></span>
  </div>
  <DashboardSceneNavigation presentation={presentation}/>
  {presentation.error&&<p className="executive-inline-error" role="alert">{presentation.error}</p>}
  <div className="executive-stage" aria-busy={activeBusy||transition.leaving}>
   {showNews||(showWeekly?!!weeklyModel.data&&!weeklyModel.loading:!!data&&!generalModel.loading)?<div id={displayedScene.id} className={`executive-tab-panel${transition.leaving?' is-leaving':''}`} inert={transition.leaving} role="tabpanel" aria-labelledby={`tab-${displayedScene.id}`} tabIndex={0}>
    <Fragment key={DASHBOARD_SCENES[transition.scene].id+JSON.stringify(filters)}>
     {showWeekly&&<WeeklyContext {...weeklyRange}/>}
     {showWeekly?weeklyModel.data&&<DashboardWeekly data={weeklyModel.data} presenting={presentation.presenting&&!presentation.paused} slideDurationMs={presentation.minutesByScene['dashboard-weekly']*60000}/>:showNews?<DashboardNews key={newsScope} scope={newsScope} news={news} atr={atr} presenting={presentation.presenting&&!presentation.paused} slideDurationMs={presentation.minutesByScene['dashboard-news']*60000}/>:data&&<>
     <DashboardMetrics data={data} scene={displayedScene.id}/>
     {displayedScene.id==='dashboard-general'&&<DashboardAnalysis labels={['Evolução','Composição']} first={<FinancialEvolution compareVolume grouping={financialGrouping} periodData={financialGrouping==='week'?data.financialGroupings?.week:financialGrouping==='fortnight'?data.financialGroupings?.fortnight:undefined} data={data.months} dailyData={data.financialTimeline} presenting={presentation.presenting&&!presentation.paused} slideDurationMs={presentation.minutesByScene['dashboard-general']*60000}/>} second={<FinancialComposition totals={data.totals}/>}/>}
     {displayedScene.id==='dashboard-production'&&<DashboardAnalysis labels={['Produção e ATR','Fazendas']} first={<OperationalEvolution grouping={financialGrouping} data={data.monthlyOperations} dailyData={data.operationalTimeline} periodData={financialGrouping==='week'?data.operationalGroupings?.week:financialGrouping==='fortnight'?data.operationalGroupings?.fortnight:undefined} presenting={presentation.presenting&&!presentation.paused} slideDurationMs={presentation.minutesByScene['dashboard-production']*60000}/>} second={<DashboardBars showValues showAtr rows={data.farmPerformance} title="Produção por fazenda" eyebrow="ORIGEM DA PRODUÇÃO" subtitle="Volume carregado e ATR médio ponderado de cada fazenda."/>}/>}
     {displayedScene.id==='dashboard-financial'&&<DashboardAnalysis labels={['Evolução','Composição']} first={<FinancialEvolution title="Evolução do faturamento" grouping={financialGrouping} periodData={financialGrouping==='week'?data.financialGroupings?.week:financialGrouping==='fortnight'?data.financialGroupings?.fortnight:undefined} data={data.months} dailyData={data.financialTimeline} presenting={presentation.presenting&&!presentation.paused} slideDurationMs={presentation.minutesByScene['dashboard-financial']*60000}/>} second={<FinancialComposition totals={data.totals}/>}/>}
     {displayedScene.id==='dashboard-suppliers'&&<DashboardAnalysis labels={['Entregas','Por cliente']} first={<DashboardBars showValues showAtr minRowHeight={74} rows={data.dimensions?.partners??[]} title="Entregas por cliente" eyebrow="ENTREGAS NO PERÍODO" subtitle="Toneladas entregues e ATR médio ponderado por cliente."/>} second={<DashboardClientList rows={data.dimensions?.partners??[]} presenting={presentation.presenting&&!presentation.paused} slideDurationMs={presentation.minutesByScene['dashboard-suppliers']*60000}/>}/>}
     {displayedScene.id==='dashboard-contracts'&&<DashboardContractAnalysis data={data} presenting={presentation.presenting&&!presentation.paused} slideDurationMs={presentation.minutesByScene['dashboard-contracts']*60000}/>}
     {displayedScene.id==='dashboard-types'&&<DashboardAnalysis labels={['Colheita','Tipos de contrato']} first={<DashboardHarvest data={data}/>} second={<DashboardBars showValues rows={data.dimensions?.contractTypes??[]} title="Volume por tipo de contrato" eyebrow="COMPOSIÇÃO DA CARTEIRA" subtitle="Tipos cadastrados dos contratos selecionados."/>}/>}
     </>}
    </Fragment>
   </div>:<div className="executive-query-state"><BillingQueryState {...model}/></div>}
  </div>
  <footer className="executive-footer"><span>{newsScene?<><Newspaper size={12}/>Fontes do agro · datas de publicação nas manchetes</>:model.data?.totals.billingPending?<><i className="executive-footer-warning"/>{model.data.totals.pendingLoadCount} carga(s) com ATR ou cotação pendentes</>:<><Activity size={12}/>Dados dos contratos da empresa ativa</>}</span><span>{presentation.fullscreen&&<span className="executive-session-note">Sessão mantida durante exibição · </span>}{presentation.presenting?(presentation.paused?'Rotação pausada':`Próxima aba em ${presentation.minutes} min`):'Selecione uma aba para explorar'}</span></footer>
 </section>;
}

function DashboardMetrics({data,scene}:{data:ExecutiveSummaryData;scene:DashboardSceneId}){
 const {money}=useDashboardValues();
 const t=data.totals,operation=data.operationalTotals,change=data.comparison.volumeChangePercent,daily=data.dailyProductivity;
 const comparisonFor=(previous:string,financial=false)=>({from:data.comparison.from,to:data.comparison.to,previous,financial});
 if(scene==='dashboard-contracts'){
  const comparison=data.contractComparison;
  const groups=[{name:'Geral',marker:'loaded-volume',stats:comparison?.overall,featured:true},{name:'Manual',marker:'manual-volume',stats:comparison?.types.find(row=>row.code==='1'),tone:'gold'},{name:'Mecanizada',marker:'mechanized-volume',stats:comparison?.types.find(row=>row.code==='2'),tone:'blue'}];
  return <dl className="executive-metrics executive-contract-metrics" data-metric-count={3} aria-label="Comparativo dos contratos por modalidade">{groups.map(group=><Metric key={group.marker} icon={Truck} name={group.name} value={decimalLabel(group.stats?.loadedVolume)} unit={group.stats?'t':undefined} atr={group.stats?.averageAtr??''} hint={group.stats?`${group.stats.contractCount} contrato(s)`:'Atualizando comparativo dos contratos'} featured={group.featured} tone={group.tone} marker={group.marker}/>)}</dl>;
 }
 if(scene==='dashboard-suppliers')return <dl className="executive-metrics" data-metric-count={4} aria-label="Indicadores dos clientes">
  <Metric icon={Truck} name="Entregue aos clientes" value={decimalLabel(t.loadedVolume)} unit="t" hint={`${t.loadCount} carregamentos no período`} featured marker="loaded-volume"/>
  <Metric icon={Wallet} name="Recebido no período" value={money(t.receivedAmount)} hint="Adiantamentos e recebimentos, menos devoluções" tone="blue" marker="received-amount" change={data.comparison.receivedChangePercent} comparison={comparisonFor(money(data.comparison.receivedAmount),true)}/>
  <Metric icon={Wallet} name="A receber no período" value={money(t.pendingAmount)} hint="Saldo da seleção, por contrato" tone="violet" marker="pending-amount"/>
  <Metric icon={Gauge} name="ATR médio ponderado" value={decimalLabel(operation.averageAtr)} unit={operation.averageAtr?'kg/t':''} hint="Qualidade ponderada pelas toneladas entregues" tone="gold" marker="average-atr"/>
 </dl>;
 if(scene==='dashboard-financial')return <dl className="executive-metrics executive-billing-metrics" data-metric-count={6} aria-label="Indicadores de faturamento">
  <Metric icon={Wallet} name="Faturamento bruto" value={money(t.grossAmount)} hint={t.billingPending?'Aguardando ATR ou cotação':'Valor das entregas antes dos descontos'} featured marker="gross-amount"/>
  <Metric icon={Wallet} name="Faturamento líquido" value={money(t.netAmount)} hint={t.billingPending?'Aguardando ATR ou cotação':'Valor das entregas após os descontos'} tone="blue" marker="net-amount" change={t.billingPending?'':data.comparison.netChangePercent} comparison={comparisonFor(money(data.comparison.netAmount),true)}/>
  <Metric icon={Tags} name="Descontos" value={money(t.discountAmount)} hint="Descontos aplicados às entregas" tone="gold" marker="discount-amount"/>
  <Metric icon={Truck} name="Toneladas carregadas" value={decimalLabel(t.loadedVolume)} unit="t" hint={`${t.loadCount} carregamentos no período`} tone="violet" marker="loaded-volume"/>
  <Metric icon={Wallet} name="Preço médio líquido / t" value={money(data.averageNetPricePerTon??'')} unit="/t" hint={t.billingPending?'Aguardando ATR ou cotação':'Valor efetivo após os descontos'} tone="blue" marker="average-net-price" footer={<BillingPriceMethods methods={data.billingPriceMethods} kind="averageNetPricePerTon"/>}/>
  <Metric icon={Wallet} name="Preço médio bruto / t" value={money(data.averageGrossPricePerTon??'')} unit="/t" hint={t.billingPending?'Aguardando ATR ou cotação':'Valor das entregas antes dos descontos'} tone="gold" marker="average-gross-price" footer={<BillingPriceMethods methods={data.billingPriceMethods} kind="averageGrossPricePerTon"/>}/>
 </dl>;
 const productionDays=daily?daily.productionDayCount===0?'Nenhum dia com produção':`${daily.productionDayCount} ${daily.productionDayCount===1?'dia':'dias'} com produção`:'Aguardando atualização';
 return <dl className="executive-metrics" data-metric-count={scene==='dashboard-production'?4:5}>
  <Metric icon={Truck} name="Volume carregado" value={decimalLabel(t.loadedVolume)} unit="t" hint={`${t.loadCount} carregamentos no período`} featured marker="loaded-volume" change={change} comparison={comparisonFor(`${decimalLabel(data.comparison.loadedVolume)} t`)}/>
  <Metric icon={Gauge} name="ATR médio ponderado" value={decimalLabel(operation.averageAtr)} unit={operation.averageAtr?'kg/t':''} hint="Qualidade ponderada pelo volume" tone="gold"/>
  {scene==='dashboard-production'?<><Metric icon={CalendarDays} name="Média carregada / dia" value={daily?decimalLabel(daily.averageLoadedVolume):'A apurar'} unit={daily?'t/dia':''} hint={productionDays} tone="blue" marker="average-daily-volume"/><Metric icon={Wallet} name="Venda média bruta / t" value={money(data.averageGrossPricePerTon??'')} unit="/t" hint={t.billingPending?'Aguardando ATR ou cotação':'Faturamento bruto por tonelada'} tone="violet" marker="average-gross-price"/></>:<><Metric icon={Wallet} name="Faturamento líquido" value={money(t.netAmount)} hint={t.billingPending?'Aguardando ATR ou cotação':'Entregas após os descontos'} tone="blue" change={t.billingPending?'':data.comparison.netChangePercent} comparison={comparisonFor(money(data.comparison.netAmount),true)}/><Metric icon={CalendarDays} name="Média carregada / dia" value={daily?decimalLabel(daily.averageLoadedVolume):'A apurar'} unit={daily?'t/dia':''} hint={productionDays} tone="violet" marker="average-daily-volume"/><Metric icon={Wallet} name="Faturamento médio / dia" value={money(daily?.averageNetAmount??'')} hint={daily?.billingPending?'Aguardando ATR ou cotação':`Líquido · ${productionDays}`} tone="gold" marker="average-daily-revenue"/></>}
 </dl>;
}
function BillingPriceMethods({methods,kind}:{methods:ExecutiveSummaryData['billingPriceMethods'];kind:'averageNetPricePerTon'|'averageGrossPricePerTon'}){
 const {money,visible}=useDashboardValues();
 return <div className="billing-price-methods">{[{code:'2',name:'Mecanizada'},{code:'1',name:'Manual'}].map(method=>{const row=methods?.find(row=>row.code===method.code),value=!visible?'••••••':!row?'Atualizando':row.loadedVolume==='0'?'Sem entregas':money(row[kind]);return <div key={method.code} data-billing-price-method={method.code}><span>{method.name}</span><strong>{value}{visible&&row&&row.loadedVolume!=='0'&&row[kind]!==''&&<small> /t</small>}</strong></div>;})}</div>;
}
function Metric({icon:Icon,name,value,unit,hint,tone,featured=false,marker,change,comparison,atr,footer}:{icon:typeof Truck;name:string;value:string;unit?:string;hint:string;tone?:string;featured?:boolean;marker?:string;change?:string;comparison?:{from:string;to:string;previous:string;financial:boolean};atr?:string;footer?:ReactNode}){
 const {visible}=useDashboardValues();
 const changed=change!==undefined&&change!=='';
 const masked=comparison?.financial&&!visible;
 const changeLabel=masked?'••••••':changed?`${Number(change)>0?'+':''}${decimalLabel(change)}%`:'Sem comparação';
 const comparisonDates=comparison?.from&&comparison.to?`${comparison.from.split('-').reverse().join('/')} a ${comparison.to.split('-').reverse().join('/')}`:'';
 return <div className={`executive-metric ${featured?'is-featured':''} ${tone?`tone-${tone}`:''} ${footer?'has-footer':''}`} data-dashboard-metric={marker}><dt><span>{name}</span><i><Icon size={18}/></i></dt><dd title={value} style={{'--metric-value-width':Math.max(1,value.length)*.64,'--metric-unit-space':`${unit?unit.length*7+6:0}px`} as CSSProperties}><span>{value}</span>{unit&&<small>{unit}</small>}</dd>{atr!==undefined&&<div className="executive-contract-atr"><span>ATR médio</span><strong title={decimalLabel(atr)}>{decimalLabel(atr)}{atr&&<small> kg/t</small>}</strong></div>}<div><span>{hint}</span></div>{comparison&&<div className="executive-metric-comparison"><span>vs. período anterior{comparisonDates&&<small>{comparisonDates}</small>}</span><span><strong>{!masked&&changed&&(Number(change)>0?<ArrowUpRight size={12} aria-hidden="true"/>:Number(change)<0?<ArrowDownRight size={12} aria-hidden="true"/>:null)}{changeLabel}</strong><small>Anterior: {comparison.previous}</small></span></div>}{footer}</div>;
}
