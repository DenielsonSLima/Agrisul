'use client';
import {useMemo,useState} from 'react';
import {ArrowLeft,ChevronDown,Gauge,LandPlot,Loader2,Save,Sprout,Target,Truck} from 'lucide-react';
import {Field} from '@/shared/components/Common';
import {notifications} from '@/shared/feedback';
import {dateLabel,decimalLabel} from '@/shared/utils/presentation';
import type {PlanningFarm,PlanningHarvestComparisonFarm,PlanningPagination,PlanningPeriod} from '../types';
import {PlanningPaginationNav,PlanningSearchBar} from './PlanningCollectionControls';

type HarvestTarget={plotId:string;targetTons:string};

function numberValue(value:string){const normalized=value.trim().replace(',','.');return /^\d+(?:\.\d{1,6})?$/.test(normalized)?Number(normalized):Number.NaN;}

export function PlanningHarvestDistribution({period,farms,visibleFarms,comparison,search,pagination,onSearch,onPage,onBack,onSave}:{
 period:PlanningPeriod;farms:PlanningFarm[];visibleFarms:PlanningFarm[];comparison:PlanningHarvestComparisonFarm[];
 search:string;pagination:PlanningPagination;onSearch:(value:string)=>void;onPage:(page:number)=>void;onBack:()=>void;
 onSave:(targetTons:string,targets:HarvestTarget[],reason:string)=>Promise<void>;
}){
 const allPlots=useMemo(()=>farms.flatMap(farm=>farm.plots.map(plot=>({farm,plot}))),[farms]);
 const existing=useMemo(()=>new Map(comparison.flatMap(farm=>farm.plots.map(plot=>[plot.plotId,plot] as const))),[comparison]);
 const farmMetrics=useMemo(()=>new Map(comparison.map(farm=>[farm.farmId,farm] as const)),[comparison]);
 const [targetTons,setTargetTons]=useState(period.harvestTargetTons.replace('.',','));
 const [targets,setTargets]=useState<Record<string,string>>(()=>Object.fromEntries(allPlots.map(({plot})=>[plot.id,(existing.get(plot.id)?.targetTons??'').replace('.',',')])));
 const [reason,setReason]=useState('');const [saving,setSaving]=useState(false);const [error,setError]=useState('');
 const general=numberValue(targetTons);const distributed=Object.values(targets).reduce((sum,value)=>{const parsed=numberValue(value);return sum+(Number.isFinite(parsed)?parsed:0);},0);
 const difference=(Number.isFinite(general)?general:0)-distributed;const balanced=Number.isFinite(general)&&general>=0&&Math.abs(difference)<0.0000005;
 const targetPlotCount=Object.values(targets).filter(value=>{const parsed=numberValue(value);return Number.isFinite(parsed)&&parsed>0;}).length;
 const save=async()=>{setError('');if(!balanced){setError('A soma das metas dos talhões deve ser exatamente igual à meta geral.');return;}if(reason.trim().length<3){setError('Informe o motivo da definição ou alteração.');return;}const distribution=allPlots.map(({plot})=>({plotId:plot.id,targetTons:(targets[plot.id]??'').trim().replace(',','.')})).filter(item=>Number(item.targetTons)>0);try{setSaving(true);await onSave(targetTons,distribution,reason);}catch(caught){const message=(caught as Error).message;setError(message);notifications.error(message);}finally{setSaving(false);}};
 return <div className="planning-harvest-page">
  <button className="planning-back" onClick={onBack}><ArrowLeft size={16}/>Voltar para metas</button>
  <div className="planning-heading planning-detail-heading"><div><span className="eyebrow">{period.name} / METAS</span><h2>Distribuição da meta de colheita</h2><p>{dateLabel(period.startDate)} a {dateLabel(period.endDate)} · Distribua a meta pelas fazendas e talhões.</p></div><button className="btn company-primary" onClick={()=>void save()} disabled={saving||!balanced}>{saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>}Salvar distribuição</button></div>
  <div className="planning-harvest-page-kpis">
   <article><span><Target/>Meta geral</span><strong>{decimalLabel(Number.isFinite(general)?general:0)} t</strong><small>{targetPlotCount} talhão(ões) com meta</small></article>
   <article><span><Truck/>Meta distribuída</span><strong>{decimalLabel(distributed)} t</strong><small>{balanced?'Distribuição fechada':`${decimalLabel(Math.abs(difference))} t ${difference>=0?'a distribuir':'excedentes'}`}</small></article>
   <article><span><LandPlot/>Área distribuída</span><strong>{decimalLabel(period.allocatedAreaHa)} ha</strong><small>Meta de plantio nos talhões</small></article>
   <article><span><Sprout/>Plantado na safra</span><strong>{decimalLabel(period.plantedExecutedAreaHa)} ha</strong><small>Apontamentos do Diário</small></article>
   <article className="accent"><span><Truck/>Colhido</span><strong>{decimalLabel(period.harvestActualTons)} t</strong><small>Carregamentos dos contratos</small></article>
   <article><span><Gauge/>Atingimento</span><strong>{decimalLabel(period.harvestPercent)}%</strong><small>{decimalLabel(period.harvestRemainingTons)} t restantes</small></article>
  </div>
  <section className="planning-harvest-page-settings"><div><Field label="Meta geral de colheita"><div className="farm-area-input"><input inputMode="decimal" value={targetTons} onChange={event=>setTargetTons(event.target.value)} aria-label="Meta geral de colheita"/><span>t</span></div></Field><p>A soma das metas dos talhões deve fechar exatamente com a meta geral.</p></div><div className={`planning-harvest-balance ${balanced?'balanced':'pending'}`}><div><span>Meta geral</span><strong>{decimalLabel(Number.isFinite(general)?general:0)} t</strong></div><div><span>Distribuído</span><strong>{decimalLabel(distributed)} t</strong></div><div><span>{difference>=0?'Falta distribuir':'Excedente'}</span><strong>{decimalLabel(Math.abs(difference))} t</strong></div></div></section>
  <PlanningSearchBar key={`harvest:${search}`} value={search} placeholder="Buscar fazenda, cidade ou talhão…" pagination={pagination} onSearch={onSearch}/>
  <section className="planning-harvest-farms"><header><div><h3>Fazendas e talhões</h3><p>Abra uma fazenda para distribuir a meta e acompanhar o realizado de cada talhão.</p></div></header>{visibleFarms.length?visibleFarms.map(farm=>{const metric=farmMetrics.get(farm.id);const farmTarget=farm.plots.reduce((sum,plot)=>{const parsed=numberValue(targets[plot.id]??'');return sum+(Number.isFinite(parsed)?parsed:0);},0);return <details key={farm.id} open={search?true:undefined}><summary><span><strong>{farm.name}</strong><small>{farm.city} / {farm.state} · {farm.plots.length} talhão(ões)</small></span><dl><div><dt>Área distribuída</dt><dd>{decimalLabel(metric?.targetAreaHa??0)} ha</dd></div><div><dt>Meta</dt><dd>{decimalLabel(farmTarget)} t</dd></div><div><dt>Colhido</dt><dd>{decimalLabel(metric?.harvestedTons??0)} t</dd></div><div><dt>Atingimento</dt><dd>{decimalLabel(metric?.harvestPercent??0)}%</dd></div></dl><ChevronDown/></summary><div className="planning-harvest-plots-table"><table><thead><tr><th>Talhão</th><th>Área física</th><th>Meta de plantio</th><th>Plantado</th><th>Meta de colheita</th><th>Colhido</th><th>Falta colher</th><th>Atingimento</th></tr></thead><tbody>{farm.plots.map(plot=>{const plotMetric=existing.get(plot.id);return <tr key={plot.id}><td><strong>{plot.name}</strong></td><td>{decimalLabel(plot.areaHa)} ha</td><td>{decimalLabel(plot.allocation?.areaHa??0)} ha</td><td>{decimalLabel(plotMetric?.plantedAreaHa??0)} ha</td><td><div className="farm-area-input"><input inputMode="decimal" value={targets[plot.id]??''} onChange={event=>setTargets(current=>({...current,[plot.id]:event.target.value}))} placeholder="0,00" aria-label={`Meta de colheita de ${farm.name}, ${plot.name}`}/><span>t</span></div></td><td className="planning-positive">{decimalLabel(plotMetric?.harvestedTons??0)} t</td><td>{decimalLabel(plotMetric?.remainingTons??0)} t</td><td>{decimalLabel(plotMetric?.harvestPercent??0)}%</td></tr>;})}</tbody></table></div></details>; }):<div className="planning-inline-empty">Nenhuma fazenda ou talhão corresponde à busca.</div>}</section>
  <PlanningPaginationNav pagination={pagination} onPage={onPage}/>
  <section className="planning-harvest-page-footer"><Field label="Motivo da definição ou alteração"><input value={reason} onChange={event=>setReason(event.target.value)} minLength={3} maxLength={500} placeholder="Ex.: Distribuição aprovada para a safra"/></Field>{error&&<p className="form-error" role="alert">{error}</p>}<div><button className="btn" type="button" onClick={onBack} disabled={saving}>Voltar</button><button className="btn company-primary" type="button" onClick={()=>void save()} disabled={saving||!balanced}>{saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>}Salvar distribuição</button></div></section>
 </div>;
}
