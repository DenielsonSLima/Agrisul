'use client';
import {Fragment} from 'react';
import {AlertTriangle,CalendarDays,LandPlot,Sprout,Truck} from 'lucide-react';
import {dateLabel,decimalLabel,monthLabel} from '@/shared/utils/presentation';
import type {PlanningFarm,PlanningHarvestComparisonFarm,PlanningPeriod,PlanningSnapshot} from '../types';

export function PlanningOverview({period,data,onOpenTab,onEditHarvest}:{period:PlanningPeriod;data:PlanningSnapshot;onOpenTab:(tab:'metas'|'areas'|'diario')=>void;onEditHarvest:()=>void}){
 const current=data.farms.reduce((sum,farm)=>sum+Number(farm.plantedAreaHa),0);
 return <div className="planning-overview">
  <div className="planning-summary"><article><span><LandPlot/><small>Área plantada atual</small></span><strong>{decimalLabel(current)} ha</strong><p>Estado físico atual de todos os talhões</p></article><article><span><Sprout/><small>Plantado nesta safra</small></span><strong>{decimalLabel(period.plantedExecutedAreaHa)} ha</strong><p>Apontamentos do Diário de campo</p></article><article className="accent"><span><Truck/><small>Colhido na safra</small></span><strong>{decimalLabel(period.harvestActualTons)} t</strong><p>Importado dos carregamentos dos contratos</p></article><article><span><AlertTriangle/><small>Perdas registradas</small></span><strong>{decimalLabel(period.lostAreaHa)} ha</strong><p>Área morta descontada do plantado atual</p></article></div>
  <div className="planning-overview-grid"><section><header><div><h3>Progresso da safra</h3><p>{dateLabel(period.startDate)} a {dateLabel(period.endDate)}</p></div><button className="text-link" onClick={()=>onOpenTab('metas')}>Ver metas</button></header><Progress label="Plantio" current={period.plantedExecutedAreaHa} target={period.targetAreaHa} unit="ha"/><Progress label="Colheita" current={period.harvestActualTons} target={period.harvestTargetTons} unit="t"/></section><section><header><div><h3>Por mês</h3><p>Plantio, manejo, perdas e carregamentos</p></div><button className="text-link" onClick={()=>onOpenTab('diario')}>Abrir diário</button></header>{data.monthlySummary.length?<div className="planning-month-list">{data.monthlySummary.slice(0,6).map(item=><div key={item.month}><strong>{monthLabel(item.month)}</strong><span>{decimalLabel(item.plantedAreaHa)} ha plantados</span><span>{decimalLabel(item.managedAreaHa)} ha manejados</span><span>{decimalLabel(item.lostAreaHa)} ha perdidos</span><b>{decimalLabel(item.harvestedTons)} t colhidas</b></div>)}</div>:<div className="planning-inline-empty"><CalendarDays/>Nenhum movimento diário ou carregamento nesta safra.</div>}</section></div>
  <HarvestComparison period={period} farms={data.harvestComparison??[]} onEdit={onEditHarvest}/>
  <section className="planning-area-snapshot"><header><div><h3>Fazendas nesta visão</h3><p>Área atual e saldo ainda previsto para plantar.</p></div><button className="text-link" onClick={()=>onOpenTab('areas')}>Abrir áreas</button></header><table><thead><tr><th>Fazenda</th><th>Área total</th><th>Plantada atual</th><th>Saldo desta safra</th><th>Projeção</th></tr></thead><tbody>{data.farms.map((farm:PlanningFarm)=><tr key={farm.id}><td><strong>{farm.name}</strong></td><td>{decimalLabel(farm.totalAreaHa)} ha</td><td>{decimalLabel(farm.plantedAreaHa)} ha</td><td>{decimalLabel(farm.remainingPlannedAreaHa)} ha</td><td>{decimalLabel(Number(farm.plantedAreaHa)+Number(farm.remainingPlannedAreaHa))} ha</td></tr>)}</tbody></table></section>
 </div>;
}

function Progress({label,current,target,unit}:{label:string;current:string;target:string;unit:string}){const percent=Number(target)>0?Math.min(100,Number(current)/Number(target)*100):0;return <div className="planning-overview-progress"><span><strong>{label}</strong><small>{decimalLabel(current)} de {decimalLabel(target)} {unit}</small></span><div><i style={{width:`${percent}%`}}/></div><b>{decimalLabel(percent)}%</b></div>}

function HarvestComparison({period,farms,onEdit}:{period:PlanningPeriod;farms:PlanningHarvestComparisonFarm[];onEdit:()=>void}){
 return <section className="planning-comparison-card">
  <header><div><h3>Metas e colheita por fazenda e talhão</h3><p>A meta geral é distribuída por talhão e comparada aos carregamentos do mesmo período e origem.</p></div><button className="btn" onClick={onEdit}>Distribuir meta</button></header>
  <div className="planning-comparison-kpis">
   <div><span>Meta de colheita</span><strong>{decimalLabel(period.harvestTargetTons)} t</strong></div>
   <div className="accent"><span>Colhido</span><strong>{decimalLabel(period.harvestActualTons)} t</strong></div>
   <div><span>Falta colher</span><strong>{decimalLabel(period.harvestRemainingTons)} t</strong></div>
   <div><span>Atingimento</span><strong>{decimalLabel(period.harvestPercent)}%</strong></div>
  </div>
  {farms.length?<div className="planning-comparison-table"><table><thead><tr><th>Fazenda / talhão</th><th>Meta de plantio</th><th>Plantado</th><th>Meta de colheita</th><th>Colhido</th><th>Falta colher</th><th>Cargas</th><th>Atingimento</th></tr></thead><tbody>{farms.map(farm=><Fragment key={farm.farmId}><ComparisonRow item={farm} kind="farm"/>{farm.plots.map(plot=><ComparisonRow key={plot.plotId} item={plot} kind="plot"/>)}</Fragment>)}</tbody></table></div>:<div className="planning-inline-empty"><LandPlot/>Distribua a meta de colheita entre os talhões para acompanhar cada fazenda.</div>}
 </section>;
}

function ComparisonRow({item,kind}:{item:PlanningHarvestComparisonFarm|PlanningHarvestComparisonFarm['plots'][number];kind:'farm'|'plot'}){
 const name=kind==='farm'?(item as PlanningHarvestComparisonFarm).farmName:(item as PlanningHarvestComparisonFarm['plots'][number]).plotName;
 const count=kind==='farm'?(item as PlanningHarvestComparisonFarm).plots.length:0;
 const percent=Math.min(100,Math.max(0,Number(item.harvestPercent)||0));
 return <tr className={`planning-comparison-${kind}`}><td><strong>{name}</strong>{kind==='farm'&&<small>{count} talhão(ões) no plano</small>}</td><td>{decimalLabel(item.targetAreaHa)} ha</td><td>{decimalLabel(item.plantedAreaHa)} ha</td><td>{decimalLabel(item.targetTons)} t</td><td className="planning-positive">{decimalLabel(item.harvestedTons)} t</td><td>{decimalLabel(item.remainingTons)} t</td><td>{item.harvestLoadCount}</td><td><div className="planning-comparison-progress"><span><i style={{width:`${percent}%`}}/></span><b>{decimalLabel(item.harvestPercent)}%</b></div></td></tr>;
}
