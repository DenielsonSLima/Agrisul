'use client';
import {useCallback,useRef,useState} from 'react';
import {Activity,ArrowDownRight,ArrowUpRight,Building2,CalendarDays,Download,FileText,Filter,Gauge,Maximize2,Minimize2,MonitorPlay,Pause,Play,RefreshCw,Square,Truck,Wallet,WifiOff} from 'lucide-react';
import {BillingQueryState} from '@/shared/components/BillingQueryState';
import {useWorkspaceCompany} from '@/shared/state/WorkspaceCompanyProvider';
import {dateLabel,decimalLabel,localDay,moneyLabel} from '@/shared/utils/presentation';
import {MarketTicker} from '@/modules/dashboard-market/MarketTicker';
import {useExecutiveSummary} from '../hooks/useSummary';
import {DASHBOARD_SCENES,useDashboardPresentation} from '../hooks/useDashboardPresentation';
import {defaultRange,shiftDay,validRange} from '../filters';
import type {ExecutiveSummaryData,ExecutiveSummarySnapshot,SummaryFilters} from '../types';
import {FinancialComposition,FinancialEvolution,OperationalEvolution} from './SummaryCharts';
import {DashboardAnalysis,DashboardBars,DashboardContractList,DashboardDimensionList,DashboardHarvest,DashboardSeason} from './DashboardVisuals';
import {DashboardClock,DashboardPopover,DashboardSceneNavigation,DashboardSettings} from './DashboardControls';
import {SummaryExportDialog} from './SummaryExportDialog';

export function ResumoPage(){const workspace=useWorkspaceCompany();return <SummaryDashboard key={workspace.activeCompanyId}/>;}

function SummaryDashboard(){
 const rootRef=useRef<HTMLElement>(null),filterTrigger=useRef<HTMLButtonElement>(null);
 const presentation=useDashboardPresentation(rootRef);
 const [filters,setFilters]=useState<SummaryFilters>(defaultRange),[draft,setDraft]=useState<SummaryFilters>(defaultRange);
 const [filtersOpen,setFiltersOpen]=useState(false),[settingsOpen,setSettingsOpen]=useState(false),[snapshot,setSnapshot]=useState<ExecutiveSummarySnapshot|null>(null);
 const closeSettings=useCallback(()=>setSettingsOpen(false),[]),closeFilters=useCallback(()=>setFiltersOpen(false),[]);
 const model=useExecutiveSummary(filters.from,filters.to,{contractId:filters.contractId,status:filters.status}),data=model.data;
 const busy=model.isFetching,failed=!!model.errorMessage,scene=DASHBOARD_SCENES[presentation.scene];
 const openExport=async()=>{if(!data)return;const next={data:structuredClone(data),companyId:model.companyId};if(presentation.fullscreen){await presentation.toggleFullscreen();if(document.fullscreenElement)return;}setSnapshot(next);};
 const start=()=>{closeSettings();closeFilters();void presentation.startPresentation();};
 const preset=(days:number)=>{const to=localDay();setDraft(value=>({...value,from:shiftDay(to,-days+1),to}));};
 return <section ref={rootRef} className={`dashboard-page executive-dashboard ${presentation.presenting?'executive-presenting':''}`} aria-label="Dashboard de acompanhamento">
  <MarketTicker actions={<DashboardSettings presentation={presentation} open={settingsOpen} onToggle={()=>{closeFilters();setSettingsOpen(value=>!value);}} onClose={closeSettings}/>}/>
  <header className="executive-header"><div className="executive-heading"><span className="executive-eyebrow">INTELIGÊNCIA DA OPERAÇÃO</span><div><h2>Dashboard</h2><span className="executive-company" title={model.company?.name}><Building2 size={13}/>{model.company?.name||'Selecione uma empresa'}</span></div></div>
   <div className="executive-actions"><DashboardClock/>
    <div className="executive-filter-anchor"><button ref={filterTrigger} type="button" className={`executive-button ${filtersOpen?'is-active':''}`} aria-label="Filtros do Dashboard" aria-expanded={filtersOpen} aria-controls="dashboard-filters" onClick={()=>{closeSettings();setDraft(filters);setFiltersOpen(value=>!value);}}><Filter size={15}/><span>Filtros</span></button>
     {filtersOpen&&<DashboardPopover title="Filtros do Dashboard" id="dashboard-filters" onClose={closeFilters} onReturnFocus={()=>filterTrigger.current?.focus()}><form className="executive-filter-form" onSubmit={event=>{event.preventDefault();if(validRange(draft)){setFilters(draft);closeFilters();}}}>
      <p>365 dias por padrão · consulte até 5 anos.</p><div className="executive-filter-presets">{[30,90,365].map(days=><button type="button" key={days} onClick={()=>preset(days)}>{days} dias</button>)}</div>
      <div className="executive-filter-grid"><label>De<input type="date" min="1900-01-01" max={draft.to} value={draft.from} onChange={event=>setDraft(value=>({...value,from:event.target.value}))}/></label><label>Até<input type="date" min={draft.from} max="9999-12-31" value={draft.to} onChange={event=>setDraft(value=>({...value,to:event.target.value}))}/></label></div>
      <label>Contrato<select value={draft.contractId} onChange={event=>setDraft(value=>({...value,contractId:event.target.value}))}><option value="">Todos os contratos</option>{data?.filterOptions?.contracts.map(item=><option key={item.id} value={item.id}>{item.clientName} · {item.contractNumber||item.title}</option>)}</select></label>
      <label>Status<select value={draft.status} onChange={event=>setDraft(value=>({...value,status:event.target.value}))}><option value="">Todos os status</option>{data?.filterOptions?.statuses.map(status=><option key={status}>{status}</option>)}</select></label>
      {!validRange(draft)&&<p className="executive-form-error" role="alert">Escolha um período entre 1 dia e 5 anos.</p>}
      <div className="executive-filter-footer"><button type="button" onClick={()=>setDraft(defaultRange())}>Limpar filtros</button><button type="submit" disabled={!validRange(draft)}>Aplicar filtros</button></div>
     </form></DashboardPopover>}
    </div>
    <button type="button" className="executive-button executive-icon-button" aria-label="Exportar PDF completo" title="Exportar PDF completo" disabled={!data||busy||failed} onClick={()=>void openExport()}><Download size={16}/></button>
    <button type="button" className="executive-button" aria-label={presentation.fullscreen?'Sair da tela cheia':'Tela cheia'} onClick={()=>void presentation.toggleFullscreen()}>{presentation.fullscreen?<Minimize2 size={16}/>:<Maximize2 size={16}/>}<span>{presentation.fullscreen?'Sair':'Tela cheia'}</span></button>
    {presentation.presenting?<><button type="button" className="executive-button executive-button-primary" onClick={presentation.togglePause}>{presentation.paused?<Play size={15}/>:<Pause size={15}/>}<span>{presentation.paused?'Continuar':'Pausar'}</span></button><button type="button" className="executive-button executive-icon-button" aria-label="Encerrar apresentação" title="Encerrar apresentação" onClick={presentation.stopPresentation}><Square size={14}/></button></>:<button type="button" disabled={!data||model.loading||failed} className="executive-button executive-button-primary" onClick={start}><MonitorPlay size={16}/><span>Apresentar</span></button>}
   </div>
  </header>
  <div className="executive-context"><span><CalendarDays size={13}/>{dateLabel(filters.from)} <i>—</i> {dateLabel(filters.to)}</span>{filters.contractId&&<span className="executive-filter-chip" title={data?.filters?.contractLabel}>{data?.filters?.contractLabel||'Contrato selecionado'}</span>}{filters.status&&<span className="executive-filter-chip">{filters.status}</span>}
   <span className={`executive-sync ${!presentation.online||failed?'is-warning':''}`} role="status">{!presentation.online?<WifiOff size={12}/>:busy?<RefreshCw size={12} className="animate-spin"/>:<i/>}{!presentation.online?'Sem conexão · últimos dados':failed?'Atualização indisponível':busy?'Sincronizando':'Atualização automática'}<small>{model.dataUpdatedAt?new Date(model.dataUpdatedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}):''}</small></span>
  </div>
  <DashboardSceneNavigation presentation={presentation}/>
  {presentation.error&&<p className="executive-inline-error" role="alert">{presentation.error}</p>}
  <div className="executive-stage" aria-busy={busy}>
   {data&&!model.loading?<div key={scene.id+JSON.stringify(filters)} id={scene.id} className="executive-tab-panel" role="tabpanel" aria-labelledby={`tab-${scene.id}`} tabIndex={0}>
    <DashboardMetrics data={data} scene={presentation.scene}/>
    {presentation.scene===0&&<><DashboardAnalysis labels={['Evolução','Composição']} first={<FinancialEvolution data={data.months}/>} second={<FinancialComposition totals={data.totals}/>}/><DashboardSeason data={data}/></>}
    {presentation.scene===1&&<DashboardAnalysis labels={['Produção e ATR','Fazendas']} first={<OperationalEvolution data={data.monthlyOperations}/>} second={<DashboardBars rows={data.farms} title="Produção por fazenda" eyebrow="ORIGEM DA PRODUÇÃO" subtitle="Carregamentos vinculados à empresa ativa."/>}/>}
    {presentation.scene===2&&<DashboardAnalysis labels={['Volume','Indicadores']} first={<DashboardBars rows={data.dimensions?.partners??[]} title="Volume por fornecedor" eyebrow="PARCEIROS DOS CONTRATOS" subtitle="Usinas e parceiros · empresa e período selecionados."/>} second={<DashboardDimensionList rows={data.dimensions?.partners??[]} title="Participação dos fornecedores"/>}/>}
    {presentation.scene===3&&<DashboardAnalysis labels={['Volume','Andamento']} first={<DashboardBars rows={data.contracts.map(row=>({id:row.id,name:row.contractNumber||row.title,loadedVolume:row.loadedVolume}))} title="Produção por contrato" eyebrow="VOLUME NO PERÍODO" subtitle="Compare a movimentação dos contratos selecionados."/>} second={<DashboardContractList data={data}/>}/>}
    {presentation.scene===4&&<DashboardAnalysis labels={['Colheita','Tipos de contrato']} first={<DashboardHarvest data={data}/>} second={<DashboardBars rows={data.dimensions?.contractTypes??[]} title="Volume por tipo de contrato" eyebrow="COMPOSIÇÃO DA CARTEIRA" subtitle="Tipos cadastrados dos contratos selecionados."/>}/>}
   </div>:<div className="executive-query-state"><BillingQueryState {...model}/></div>}
  </div>
  <footer className="executive-footer"><span>{data?.totals.billingPending?<><i className="executive-footer-warning"/>{data.totals.pendingLoadCount} carga(s) com ATR ou cotação pendentes</>:<><Activity size={12}/>Dados dos contratos da empresa ativa</>}</span><span>{presentation.fullscreen&&<span className="executive-session-note">Sessão mantida durante exibição · </span>}{presentation.presenting?(presentation.paused?'Rotação pausada':`Próxima aba em ${presentation.minutes} min`):'Selecione uma aba para explorar'}</span></footer>
  {snapshot&&<SummaryExportDialog snapshot={snapshot} onClose={()=>setSnapshot(null)}/>}
 </section>;
}

function DashboardMetrics({data,scene}:{data:ExecutiveSummaryData;scene:number}){
 const t=data.totals,operation=data.operationalTotals,change=data.comparison.volumeChangePercent;
 return <dl className="executive-metrics">
  <Metric icon={Truck} name="Volume carregado" value={decimalLabel(t.loadedVolume)} unit="t" hint={`${t.loadCount} carregamentos no período`} featured marker="loaded-volume" change={change}/>
  <Metric icon={Gauge} name="ATR médio ponderado" value={decimalLabel(operation.averageAtr)} unit={operation.averageAtr?'kg/t':''} hint="Qualidade ponderada pelo volume" tone="gold"/>
  {scene===1?<><Metric icon={FileText} name="Carregamentos" value={String(operation.loadCount)} hint={`${operation.farmCount} fazenda(s) de origem`} tone="blue"/><Metric icon={Truck} name="Carga média" value={decimalLabel(operation.averageLoadVolume)} unit="t" hint="Volume médio por carregamento" tone="violet"/></>:<><Metric icon={Wallet} name="Faturamento líquido" value={moneyLabel(t.netAmount)} hint={t.billingPending?'Aguardando ATR ou cotação':'Entregas após os descontos'} tone="blue"/><Metric icon={FileText} name="Contratos na seleção" value={String(t.contractCount)} hint={`${t.activeContractCount} ativos na carteira`} tone="violet"/></>}
 </dl>;
}
function Metric({icon:Icon,name,value,unit,hint,tone,featured=false,marker,change}:{icon:typeof Truck;name:string;value:string;unit?:string;hint:string;tone?:string;featured?:boolean;marker?:string;change?:string}){
 const changed=change!==undefined&&change!=='';
 return <div className={`executive-metric ${featured?'is-featured':''} ${tone?`tone-${tone}`:''}`} data-dashboard-metric={marker}><dt><span>{name}</span><i><Icon size={18}/></i></dt><dd title={value}>{value}{unit&&<small>{unit}</small>}</dd><div><span>{hint}</span>{changed&&<span className="executive-metric-change">{Number(change)>=0?<ArrowUpRight size={12}/>:<ArrowDownRight size={12}/>} {decimalLabel(change)}%</span>}</div></div>;
}
