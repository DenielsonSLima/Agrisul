'use client';
import {useMemo,useState} from 'react';
import Link from 'next/link';
import {ArrowLeft,CalendarDays,CalendarRange,FileDown,History,LandPlot,Loader2,Pencil,Plus,RefreshCw,Target} from 'lucide-react';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {ModuleLink,useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {useWorkspaceCompany} from '@/shared/state/WorkspaceCompanyProvider';
import {notifications} from '@/shared/feedback';
import {dateLabel,decimalLabel} from '@/shared/utils/presentation';
import {useCultures} from '@/modules/cadastro/culturas/hooks/useCultures';
import {usePlanning} from '../hooks/usePlanning';
import {PlanningPeriodForm} from '../forms/PlanningPeriodForm';
import {FieldLogForm} from '../forms/PlanningSeasonForms';
import {PlanningPlans} from './PlanningPlans';
import {PlanningDistribution} from './PlanningDistribution';
import {PlanningHistoryList} from './PlanningHistoryList';
import {PlanningGoals} from './PlanningGoals';
import {PlanningOverview} from './PlanningOverview';
import {PlanningDiary} from './PlanningDiary';
import {PlanningPaginationNav,PlanningPeriodFilter,PlanningSearchBar} from './PlanningCollectionControls';
import {PlanningExportDialog} from './PlanningExportDialog';
import {PlanningHarvestDistribution} from './PlanningHarvestDistribution';
import type {PlanningExportSnapshot,PlanningPeriod,PlanningPeriodInput,PlanningSection} from '../types';
import '../styles.css';

const tabs=['resumo','metas','areas','diario','historico'] as const;
type PlanningTab=typeof tabs[number];
const pageSize=10;

function planningHref(periodId:string,tab:PlanningTab,search='',page=1,dateFrom='',dateTo=''){
 const params=new URLSearchParams();
 if(periodId){params.set('plano',periodId);params.set('aba',tab);}
 if(search)params.set('busca',search);
 if(page>1)params.set('pagina',String(page));
 if(tab==='diario'&&dateFrom)params.set('de',dateFrom);
 if(tab==='diario'&&dateTo)params.set('ate',dateTo);
 const query=params.toString();return `/planejamento${query?'?'+query:''}`;
}

function planningHarvestHref(periodId:string,search='',page=1){
 const params=new URLSearchParams({plano:periodId,tela:'distribuicao-colheita'});
 if(search)params.set('busca',search);
 if(page>1)params.set('pagina',String(page));
 return `/planejamento?${params.toString()}`;
}

export function PlanejamentoPage(){
 const {searchParams,navigate}=useModuleNavigation();const workspace=useWorkspaceCompany();
 const requestedId=searchParams.get('plano')??'';const requestedTab=searchParams.get('aba') as PlanningTab|null;
 const distributionView=!!requestedId&&searchParams.get('tela')==='distribuicao-colheita';
 const tab=tabs.includes(requestedTab as PlanningTab)?requestedTab!:'resumo';const search=(searchParams.get('busca')??'').slice(0,160);
 const rawDateFrom=searchParams.get('de')??'',rawDateTo=searchParams.get('ate')??'';
 const dateFrom=tab==='diario'&&/^\d{4}-\d{2}-\d{2}$/.test(rawDateFrom)?rawDateFrom:'';
 const dateTo=tab==='diario'&&/^\d{4}-\d{2}-\d{2}$/.test(rawDateTo)?rawDateTo:'';
 const rawPage=searchParams.get('pagina')??'1';const page=/^[1-9]\d*$/.test(rawPage)?Number(rawPage):1;
 const section:PlanningSection=requestedId?(distributionView?'areas':tab):'seasons';
 const m=usePlanning({periodId:requestedId,search,page,pageSize,section,dateFrom,dateTo});const cultures=useCultures();
 const [form,setForm]=useState<{period?:PlanningPeriod}|null>(null);
 const [logPlotId,setLogPlotId]=useState<string|null>(null);const [exportSnapshot,setExportSnapshot]=useState<PlanningExportSnapshot|null>(null);
 const periods=useMemo(()=>m.data?.periods??[],[m.data?.periods]);const selected=periods.find(item=>item.id===requestedId);
 const visiblePeriodIds=new Set(m.data?.visiblePeriodIds??[]),visibleFarmIds=new Set(m.data?.visibleFarmIds??[]),visibleHistoryIds=new Set(m.data?.visibleHistoryIds??[]);
 const listedPeriods=periods.filter(item=>visiblePeriodIds.has(item.id));const listedFarms=(m.data?.farms??[]).filter(item=>visibleFarmIds.has(item.id));
 const listedHistory=(m.data?.history??[]).filter(item=>visibleHistoryIds.has(item.id));
 const pagination=m.data?.pagination??{page:1,pageSize,total:0,totalPages:1,hasPrevious:false,hasNext:false};
 const changeLocation=(periodId:string,nextTab:PlanningTab='resumo')=>navigate(planningHref(periodId,nextTab));
 const changeSearch=(value:string)=>navigate(distributionView?planningHarvestHref(requestedId,value,1):planningHref(requestedId,tab,value,1,dateFrom,dateTo));
 const changePage=(nextPage:number)=>navigate(distributionView?planningHarvestHref(requestedId,search,nextPage):planningHref(requestedId,tab,search,nextPage,dateFrom,dateTo));
 const changeDiaryPeriod=(from:string,to:string)=>navigate(planningHref(requestedId,'diario',search,1,from,to));
 const totalArea=m.data?.farms.reduce((sum,farm)=>sum+Number(farm.totalAreaHa),0)??0;
 const totalPlanted=m.data?.farms.reduce((sum,farm)=>sum+Number(farm.plantedAreaHa),0)??0;

 if(m.loading||cultures.loading)return <div className="company-empty" role="status"><Loader2 size={22} className="animate-spin"/><p>Carregando planejamento…</p></div>;
 if(m.authRequired||cultures.authRequired)return <div className="company-empty"><span className="company-empty-icon"><CalendarRange size={25}/></span><h3>Acesse o Planejamento</h3><p>Entre para consultar e salvar as safras agrícolas.</p><Link className="btn company-primary" href="/login?returnTo=%2Fplanejamento" target="_top">Entrar</Link></div>;
 if(m.error||cultures.error)return <div className="company-empty" role="alert"><h3>Não foi possível carregar</h3><p>{m.error||cultures.error}</p><button className="btn" onClick={()=>void Promise.all([m.reload(),cultures.reload()])}><RefreshCw size={16}/>Tentar novamente</button></div>;

 return <section className="planning-workspace">
  {!selected?<><div className="planning-heading"><div><span className="eyebrow">PLANEJAMENTO AGRÍCOLA</span><h2>Safras e planos</h2><p>Escolha uma safra para abrir metas, áreas, Diário de campo e histórico.</p></div><button className="btn company-primary" onClick={()=>setForm({})} disabled={!cultures.cultures.some(item=>item.subtypes.length)}><Plus size={17}/>Nova safra</button></div>
   {!cultures.cultures.some(item=>item.subtypes.length)&&<div className="planning-setup-note"><CalendarRange size={18}/><div><strong>Cadastre cultura e ciclo para criar a safra.</strong><p>Os manejos disponíveis dependem dessa combinação.</p></div><ModuleLink className="btn" href="/cadastro?secao=culturas">Abrir Culturas</ModuleLink></div>}
   <div className="planning-portfolio-summary"><article><span>Safras cadastradas</span><strong>{periods.length}</strong></article><article><span>Área das fazendas</span><strong>{decimalLabel(totalArea)} ha</strong></article><article><span>Área plantada atual</span><strong>{decimalLabel(totalPlanted)} ha</strong></article></div>
   <PlanningSearchBar key={`seasons:${search}`} value={search} placeholder="Buscar safra, cultura ou situação…" pagination={pagination} onSearch={changeSearch}/>
   <PlanningPlans periods={listedPeriods} hasPeriods={!!periods.length} onSelect={id=>changeLocation(id)} onEdit={period=>setForm({period})}/>
   <PlanningPaginationNav pagination={pagination} onPage={changePage}/>
  </>:distributionView&&m.data?<PlanningHarvestDistribution
   key={`${selected.id}:${selected.revision}`}
   period={selected}
   farms={m.data.farms}
   visibleFarms={listedFarms}
   comparison={m.data.harvestComparison}
   search={search}
   pagination={pagination}
   onSearch={changeSearch}
   onPage={changePage}
   onBack={()=>navigate(planningHref(selected.id,'metas'))}
   onSave={async(targetTons,targets,reason)=>{
    await m.save({action:'save-harvest-goal',periodId:selected.id,targetTons,targets,reason,expectedRevision:selected.revision});
    notifications.saved('A meta geral e a distribuição por talhão foram atualizadas.');
   }}
  />:<>
   <button className="planning-back" onClick={()=>navigate('/planejamento')}><ArrowLeft size={16}/>Voltar para safras</button>
   <div className="planning-heading planning-detail-heading"><div><span className="eyebrow">SAFRA / PLANO</span><h2>{selected.name}</h2><p>{dateLabel(selected.startDate)} a {dateLabel(selected.endDate)} · {selected.cultureName} · {selected.cultureSubtypeName}</p></div><div className="farm-heading-actions"><button className="btn" onClick={()=>setForm({period:selected})}><Pencil size={16}/>Editar safra</button><button className="btn" disabled={!m.data} onClick={()=>{if(m.data)setExportSnapshot({data:structuredClone(m.data),period:structuredClone(selected),companyId:workspace.activeCompanyId,kind:tab==='diario'?'diary':'planning'});}}><FileDown size={16}/>Exportar</button><button className="btn company-primary" onClick={()=>setLogPlotId('')}><Plus size={16}/>Lançar o dia</button></div></div>
   <Tabs value={tab} onValueChange={value=>changeLocation(selected.id,value as PlanningTab)} className="planning-tabs"><TabsList variant="line" aria-label="Etapas da safra"><TabsTrigger value="resumo"><CalendarRange/>Resumo</TabsTrigger><TabsTrigger value="metas"><Target/>Metas</TabsTrigger><TabsTrigger value="areas"><LandPlot/>Áreas e talhões</TabsTrigger><TabsTrigger value="diario"><CalendarDays/>Diário de campo</TabsTrigger><TabsTrigger value="historico"><History/>Histórico</TabsTrigger></TabsList>
    <TabsContent value="resumo">{m.data&&<PlanningOverview period={selected} data={m.data} onOpenTab={next=>changeLocation(selected.id,next)} onEditHarvest={()=>navigate(planningHarvestHref(selected.id))}/>}</TabsContent>
    <TabsContent value="metas"><PlanningGoals period={selected} comparison={m.data?.harvestComparison??[]} onEditPlan={()=>setForm({period:selected})} onEditHarvest={()=>navigate(planningHarvestHref(selected.id))}/></TabsContent>
    <TabsContent value="areas">{m.data&&<><PlanningSearchBar key={`areas:${search}`} value={search} placeholder="Buscar fazenda, cidade ou talhão…" pagination={pagination} onSearch={changeSearch}/><PlanningDistribution periodId={selected.id} farms={listedFarms} allFarms={m.data.farms} practices={m.data.practices} save={m.save} onNewLog={plotId=>setLogPlotId(plotId)}/><PlanningPaginationNav pagination={pagination} onPage={changePage}/></>}</TabsContent>
    <TabsContent value="diario">{m.data&&<><div className="planning-diary-filters"><PlanningSearchBar key={`diario:${search}`} value={search} placeholder="Buscar fazenda, talhão, manejo, contrato ou observação…" pagination={pagination} onSearch={changeSearch}/><PlanningPeriodFilter dateFrom={dateFrom} dateTo={dateTo} minDate={selected.startDate} maxDate={selected.endDate} onApply={changeDiaryPeriod}/></div><PlanningDiary data={m.data} fieldLogIds={m.data.visibleFieldLogIds} harvestLoadIds={m.data.visibleHarvestLoadIds} save={m.save} onNew={()=>setLogPlotId('')}/><PlanningPaginationNav pagination={pagination} onPage={changePage}/></>}</TabsContent>
    <TabsContent value="historico">{m.data&&<><PlanningSearchBar key={`historico:${search}`} value={search} placeholder="Buscar ação, motivo ou responsável…" pagination={pagination} onSearch={changeSearch}/><PlanningHistoryList history={listedHistory} hasHistory={!!m.data.history.length}/><PlanningPaginationNav pagination={pagination} onPage={changePage}/></>}</TabsContent>
   </Tabs>
  </>}
  <Dialog open={!!form} onOpenChange={value=>{if(!value)setForm(null);}}><DialogContent className="form-modal planning-period-modal"><DialogHeader><DialogTitle>{form?.period?'Editar safra':'Nova safra agrícola'}</DialogTitle><DialogDescription>O nome é livre; as datas definem o período real das metas e do Diário.</DialogDescription></DialogHeader>{form&&<PlanningPeriodForm period={form.period} cultures={cultures.cultures} onClose={()=>setForm(null)} onSave={async(input:PlanningPeriodInput)=>{const result=await m.save({action:'save-period',input,id:form.period?.id,expectedRevision:form.period?.revision});if('period' in result){changeLocation(result.period.id);if(form.period)notifications.updated('A safra e suas metas foram atualizadas.');else notifications.created('A safra foi criada. Agora distribua as áreas e configure a colheita.');}}}/>}</DialogContent></Dialog>
  <Dialog open={logPlotId!==null} onOpenChange={value=>{if(!value)setLogPlotId(null);}}><DialogContent className="form-modal planning-field-log-modal"><DialogHeader><DialogTitle>Novo apontamento diário</DialogTitle><DialogDescription>Transcreva o boletim recebido do campo. O saldo e os resumos serão atualizados automaticamente.</DialogDescription></DialogHeader>{selected&&m.data&&logPlotId!==null&&<FieldLogForm period={selected} farms={m.data.farms} practices={m.data.practices} initialPlotId={logPlotId||undefined} onClose={()=>setLogPlotId(null)} onSave={async input=>{await m.save({action:'save-field-log',periodId:selected.id,...input});notifications.created(input.kind==='loss'?'A perda foi registrada e a área plantada foi reduzida.':'O boletim de campo foi registrado no Diário.');}}/>}</DialogContent></Dialog>
  {exportSnapshot&&<PlanningExportDialog snapshot={exportSnapshot} onClose={()=>setExportSnapshot(null)}/>}
 </section>;
}
