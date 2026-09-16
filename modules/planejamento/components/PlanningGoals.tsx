import {Sprout,Target,Tractor,Truck} from 'lucide-react';
import {decimalLabel} from '@/shared/utils/presentation';
import type {PlanningHarvestComparisonFarm,PlanningPeriod} from '../types';

export function PlanningGoals({period,comparison,onEditPlan,onEditHarvest}:{period:PlanningPeriod;comparison:PlanningHarvestComparisonFarm[];onEditPlan:()=>void;onEditHarvest:()=>void}){
 const planting=Number(period.targetAreaHa)>0?Math.min(100,Number(period.plantedExecutedAreaHa)/Number(period.targetAreaHa)*100):0;
 const harvest=Number(period.harvestPercent);
 const distributed=comparison.reduce((sum,farm)=>sum+Number(farm.targetTons),0);const targetPlots=comparison.flatMap(farm=>farm.plots).filter(plot=>Number(plot.targetTons)>0).length;
 return <div className="planning-goals-grid">
  <article><header><span><Sprout/>Meta de plantio</span><button className="btn" onClick={onEditPlan}>Alterar meta</button></header><strong>{decimalLabel(period.targetAreaHa)} ha</strong><p>{decimalLabel(period.allocatedAreaHa)} ha distribuídos entre {period.allocationCount} talhão(ões)</p><div className="planning-goal-progress"><i style={{width:`${planting}%`}}/></div><dl><div><dt>Plantado no diário</dt><dd>{decimalLabel(period.plantedExecutedAreaHa)} ha</dd></div><div><dt>Falta realizar</dt><dd>{decimalLabel(period.plantingRemainingAreaHa)} ha</dd></div><div><dt>Perdas registradas</dt><dd>{decimalLabel(period.lostAreaHa)} ha</dd></div></dl></article>
  <article><header><span><Truck/>Meta de colheita</span><button className="btn" onClick={onEditHarvest}>{Number(period.harvestTargetTons)>0?'Alterar distribuição':'Definir e distribuir'}</button></header><strong>{decimalLabel(period.harvestTargetTons)} t</strong><p>{decimalLabel(distributed)} t distribuídas entre {targetPlots} talhão(ões)</p><div className="planning-goal-progress harvest"><i style={{width:`${Math.min(100,harvest)}%`}}/></div><dl><div><dt>Carregado</dt><dd>{decimalLabel(period.harvestActualTons)} t</dd></div><div><dt>Falta colher</dt><dd>{decimalLabel(period.harvestRemainingTons)} t</dd></div><div><dt>Atingimento</dt><dd>{decimalLabel(period.harvestPercent)}%</dd></div></dl></article>
  <aside><Target/><div><strong>Como as metas funcionam</strong><p>Distribua a meta de colheita entre fazendas e talhões. O realizado não é digitado aqui: ele vem automaticamente dos carregamentos dos contratos, usando data e talhão.</p></div></aside>
  <aside><Tractor/><div><strong>Passagem para a próxima safra</strong><p>Ao registrar plantio, a área plantada atual aumenta. Crie a safra seguinte para definir novas datas e metas; ela já enxergará a área acumulada.</p></div></aside>
 </div>;
}
