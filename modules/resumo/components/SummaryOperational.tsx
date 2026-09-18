'use client';
import {Fragment,useMemo,useState} from 'react';
import {Activity,CalendarDays,Gauge,MapPinned,Sprout,Trophy} from 'lucide-react';
import {decimalLabel,monthLabel} from '@/shared/utils/presentation';
import type {ExecutiveFarmPerformance,ExecutivePlanningFarmPerformance,ExecutivePlanningPlotPerformance,ExecutiveSummaryData} from '../types';

export function MonthlyOperationsPanel({data}:{data:ExecutiveSummaryData}){
 const rows=data.monthlyOperations.filter(row=>row.loadCount>0||Number(row.loadedVolume)>0),totals=data.operationalTotals;
 if(!rows.length)return null;
 return <section className="summary-panel summary-monthly-operations" aria-labelledby="summary-monthly-operations-title">
  <header className="summary-monthly-heading"><div><span className="summary-kicker"><CalendarDays size={14}/>MOVIMENTAÇÃO MENSAL</span><h3 id="summary-monthly-operations-title">Somente meses com carregamentos</h3></div><div className="summary-inline-stats"><span><strong>{decimalLabel(totals.averageAtr)}</strong> kg ATR/t</span><span><strong>{decimalLabel(totals.averageLoadVolume)}</strong> t/carga</span><span><strong>{totals.plotCount}</strong> talhões</span></div></header>
  <div className="summary-table-wrap summary-operations-table-wrap" tabIndex={0} aria-label="Tabela operacional mensal rolável">
   <table className="summary-table summary-operations-table"><thead><tr><th>Mês</th><th>Cargas</th><th>Volume</th><th>ATR médio</th><th>Média por carga</th><th>Contratos</th><th>Fazendas</th><th>Talhões</th></tr></thead><tbody>{rows.map(row=><tr key={row.month} className={row.loadCount?'':'summary-empty-row'}><td><strong>{monthLabel(row.month)}</strong></td><td>{row.loadCount}</td><td>{decimalLabel(row.loadedVolume)} t</td><td>{decimalLabel(row.averageAtr)} <small>kg/t</small></td><td>{decimalLabel(row.averageLoadVolume)} t</td><td>{row.contractCount}</td><td>{row.farmCount}</td><td>{row.plotCount}</td></tr>)}</tbody><tfoot><tr><th>Geral do período</th><td>{totals.loadCount}</td><td>{decimalLabel(totals.loadedVolume)} t</td><td>{decimalLabel(totals.averageAtr)} <small>kg/t</small></td><td>{decimalLabel(totals.averageLoadVolume)} t</td><td>{totals.contractCount}</td><td>{totals.farmCount}</td><td>{totals.plotCount}</td></tr></tfoot></table>
  </div>
 </section>;
}

type RankMode='volume'|'intensity'|'atr';
const rankValue=(item:ExecutiveFarmPerformance|ExecutiveSummaryData['plotPerformance'][number],mode:RankMode)=>Number(mode==='volume'?item.loadedVolume:mode==='intensity'?item.tonsPerHa:item.averageAtr)||0;
const rankLabel=(item:ExecutiveFarmPerformance|ExecutiveSummaryData['plotPerformance'][number],mode:RankMode)=>mode==='volume'?`${decimalLabel(item.loadedVolume)} t`:mode==='intensity'?`${decimalLabel(item.tonsPerHa)} t/ha`:`${decimalLabel(item.averageAtr)} kg/t`;

export function PerformanceRankings({data}:{data:ExecutiveSummaryData}){
 const [mode,setMode]=useState<RankMode>('intensity');
 const farms=useMemo(()=>[...data.farmPerformance].sort((a,b)=>rankValue(b,mode)-rankValue(a,mode)||a.name.localeCompare(b.name,'pt-BR')).slice(0,6),[data.farmPerformance,mode]);
 const plots=useMemo(()=>[...data.plotPerformance].sort((a,b)=>rankValue(b,mode)-rankValue(a,mode)||a.name.localeCompare(b.name,'pt-BR')).slice(0,6),[data.plotPerformance,mode]);
 return <section className="summary-block summary-performance" aria-labelledby="summary-performance-title">
  <div className="summary-block-heading"><div><span className="summary-kicker"><Trophy size={14}/>DESTAQUES DA PRODUÇÃO</span><h3 id="summary-performance-title">Fazendas e talhões mais produtivos</h3><p>Compare volume, intensidade por área cadastrada e ATR ponderado no período.</p></div><div className="summary-segmented summary-ranking-mode" aria-label="Critério do ranking"><button type="button" aria-pressed={mode==='volume'} onClick={()=>setMode('volume')}>Volume</button><button type="button" aria-pressed={mode==='intensity'} onClick={()=>setMode('intensity')}>t/ha</button><button type="button" aria-pressed={mode==='atr'} onClick={()=>setMode('atr')}>ATR</button></div></div>
  <div className="summary-ranking-grid"><RankingCard title="Fazendas em destaque" icon="farm" rows={farms.map(item=>({id:item.id,name:item.name,detail:`${item.plotCount} talhões · ${item.loadCount} cargas`,metric:rankLabel(item,mode),value:rankValue(item,mode)}))}/><RankingCard title="Talhões em destaque" icon="plot" rows={plots.map(item=>({id:item.id,name:item.name,detail:`${item.farmName} · ${item.loadCount} cargas`,metric:rankLabel(item,mode),value:rankValue(item,mode)}))}/></div>
  <p className="summary-method-note"><Gauge size={13}/><span><strong>Leitura de t/ha:</strong> volume carregado no filtro dividido pela área atualmente cadastrada. É um indicador de intensidade do período, não uma estimativa agronômica de produtividade da safra.</span></p>
 </section>;
}

function RankingCard({title,icon,rows}:{title:string;icon:'farm'|'plot';rows:{id:string;name:string;detail:string;metric:string;value:number}[]}){
 const Icon=icon==='farm'?MapPinned:Activity,maximum=Math.max(...rows.map(row=>row.value),1);
 return <article className="summary-panel summary-ranking-card"><header><span><Icon size={17}/></span><div><small>{icon==='farm'?'ORIGEM CONSOLIDADA':'DESEMPENHO POR ÁREA'}</small><h4>{title}</h4></div></header>{rows.length?<ol>{rows.map((row,index)=><li key={row.id}><b>{index+1}</b><div><span><strong>{row.name}</strong><em>{row.detail}</em></span><div className="summary-rank-track"><i style={{width:`${Math.max(3,row.value/maximum*100)}%`}}/></div></div><mark>{row.metric}</mark></li>)}</ol>:<div className="summary-compact-empty">Nenhuma movimentação encontrada no período.</div>}</article>;
}

export function PlanningPerformanceTable({farms,plots}:{farms:ExecutivePlanningFarmPerformance[];plots:ExecutivePlanningPlotPerformance[]}){
 if(!farms.length&&!plots.length)return null;
 return <div className="summary-planning-performance"><div className="summary-planning-performance-heading"><span><Sprout size={15}/></span><div><strong>Metas por fazenda e talhão</strong><small>Plantio executado e colheita registrada na safra em foco.</small></div></div><div className="summary-table-wrap" tabIndex={0} aria-label="Metas agrícolas por fazenda e talhão"><table className="summary-table summary-planning-table"><thead><tr><th>Área produtiva</th><th>Plantio realizado / meta</th><th>Progresso</th><th>Colheita realizada / meta</th><th>Progresso</th><th>Restante</th><th>Cargas</th></tr></thead><tbody>{farms.map(farm=><Fragment key={farm.id}><PlanningRow kind="farm" name={farm.name} secondary={`${farm.plotCount} talhões`} planted={farm.plantedAreaHa} plantingTarget={farm.targetAreaHa} plantingPercent={farm.plantingPercent} harvested={farm.harvestedTons} harvestTarget={farm.targetTons} harvestPercent={farm.harvestPercent} remaining={farm.remainingTons} loads={farm.loadCount}/>{plots.filter(plot=>plot.farmId===farm.id).map(plot=><PlanningRow key={plot.id} kind="plot" name={plot.name} secondary={`${decimalLabel(plot.areaHa)} ha cadastrados`} planted={plot.plantedAreaHa} plantingTarget={plot.targetAreaHa} plantingPercent={plot.plantingPercent} harvested={plot.harvestedTons} harvestTarget={plot.targetTons} harvestPercent={plot.harvestPercent} remaining={plot.remainingTons} loads={plot.loadCount}/>)}</Fragment>)}</tbody></table></div></div>;
}

function PlanningRow({kind,name,secondary,planted,plantingTarget,plantingPercent,harvested,harvestTarget,harvestPercent,remaining,loads}:{kind:'farm'|'plot';name:string;secondary:string;planted:string;plantingTarget:string;plantingPercent:string;harvested:string;harvestTarget:string;harvestPercent:string;remaining:string;loads:number}){
 return <tr className={`summary-planning-${kind}`}><td><strong>{name}</strong><small>{secondary}</small></td><td>{decimalLabel(planted)} / {decimalLabel(plantingTarget)} ha</td><td><Progress value={plantingPercent}/></td><td>{decimalLabel(harvested)} / {decimalLabel(harvestTarget)} t</td><td><Progress value={harvestPercent}/></td><td>{decimalLabel(remaining)} t</td><td>{loads}</td></tr>;
}

export function Progress({value}:{value:string}){
 const width=Math.max(0,Math.min(100,Number(value)||0));
 return <span className="summary-mini-progress"><i><b style={{width:`${width}%`}}/></i><strong>{decimalLabel(value)}%</strong></span>;
}
