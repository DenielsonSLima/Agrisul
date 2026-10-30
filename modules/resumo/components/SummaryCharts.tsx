'use client';
import {useId,useState} from 'react';
import {BarChart3,ChartPie,Leaf} from 'lucide-react';
import {Bar,CartesianGrid,Cell,ComposedChart,Pie,PieChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {decimalLabel} from '@/shared/utils/presentation';
import type {ExecutiveSummaryData} from '../types';

// Positive initial geometry until ResizeObserver measures the container.
const INITIAL_CHART_SIZE={width:1,height:1};
const compact=(value:number)=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(value);

export {FinancialEvolution} from './DashboardFinancialChart';
export {OperationalEvolution} from './DashboardOperationalChart';

export {FinancialComposition} from './FinancialComposition';

export function FarmVolumeChart({farms}:{farms:ExecutiveSummaryData['farms']}){
 const id=useId(),[all,setAll]=useState(false);
 const rows=(all?farms:farms.slice(0,7)).map(item=>({...item,value:Number(item.loadedVolume)}));
 return <section className="summary-panel summary-farms-chart" aria-labelledby={id}><header className="summary-panel-heading"><div><span className="summary-kicker"><Leaf size={15}/>ORIGEM NO PERÍODO</span><h3 id={id}>Volume por fazenda</h3><p>{all?'Todas as fazendas':`Top ${Math.min(7,farms.length)} por volume`} · empresa ativa.</p></div></header>{rows.length?<div className="summary-farm-bars" style={{height:Math.max(265,rows.length*38)}} role="img" aria-label={rows.map(row=>`${row.name}: ${decimalLabel(row.loadedVolume)} toneladas`).join('. ')}><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={INITIAL_CHART_SIZE}><ComposedChart data={rows} layout="vertical" margin={{top:4,right:12,left:0,bottom:4}}><CartesianGrid horizontal={false} stroke="#edf1ee"/><XAxis type="number" tickFormatter={compact} axisLine={false} tickLine={false} tick={{fontSize:11,fill:'#5e6f64'}}/><YAxis dataKey="name" type="category" width={110} axisLine={false} tickLine={false} tick={{fontSize:12,fill:'#425b4b'}}/><Tooltip formatter={value=>[`${decimalLabel(String(value))} t`,'Volume']} contentStyle={{border:'1px solid #dce6df',borderRadius:12,fontSize:13}}/><Bar dataKey="value" fill="#67a786" radius={[0,5,5,0]} maxBarSize={23} isAnimationActive={false}/></ComposedChart></ResponsiveContainer></div>:<ChartEmpty title="Nenhuma fazenda movimentada"/>}{farms.length>7&&<button className="summary-text-button" type="button" aria-expanded={all} onClick={()=>setAll(!all)}>{all?'Mostrar top 7':`Ver todas as ${farms.length} fazendas`}</button>}
  <details className="summary-data-details"><summary>Ver dados por fazenda</summary><div className="summary-table-wrap" tabIndex={0} role="region" aria-label="Volume das fazendas"><table className="summary-table"><thead><tr><th scope="col">Fazenda</th><th scope="col">Cargas</th><th scope="col">Volume (t)</th></tr></thead><tbody>{farms.map(row=><tr key={row.id}><th scope="row">{row.name}</th><td>{row.loadCount}</td><td>{decimalLabel(row.loadedVolume)}</td></tr>)}</tbody></table></div></details>
 </section>;
}
function ChartEmpty({title}:{title:string}){return <div className="summary-chart-empty"><span><BarChart3 size={25}/></span><strong>{title}</strong><p>Ajuste os filtros para explorar outro recorte.</p></div>;}

export function HarvestMethodChart({methods}:{methods:NonNullable<ExecutiveSummaryData['harvestMethods']>}){
 const id=useId(),colors:Record<string,string>={'1':'#ba934c','2':'#2d8a63',unknown:'#9aa8a0'};
 const rows=methods.filter(item=>item.code!=='unknown'||item.loadCount>0).map(item=>({...item,value:Number(item.loadedVolume),color:colors[item.code]??colors.unknown}));
 const visible=rows.some(item=>item.value>0);
 return <section className="summary-panel dashboard-harvest-methods" aria-labelledby={id}>
  <header className="summary-panel-heading"><div><span className="summary-kicker"><ChartPie size={15}/>PERFIL DA COLHEITA</span><h3 id={id}>Manual ou mecanizada</h3><p>Carregamentos do período classificados pelo tipo dos contratos vinculados.</p></div></header>
  <div className="dashboard-harvest-content">{visible?<div className="dashboard-harvest-donut" role="img" aria-label={rows.map(row=>`${row.label}: ${decimalLabel(row.loadedVolume)} toneladas, ${row.loadCount} cargas`).join('. ')}><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={INITIAL_CHART_SIZE}><PieChart><Pie data={rows} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="90%" paddingAngle={3} stroke="none" isAnimationActive={false}>{rows.map(row=><Cell key={row.code} fill={row.color}/>)}</Pie><Tooltip formatter={value=>[`${decimalLabel(String(value))} t`,'Volume']} contentStyle={{borderRadius:12,fontSize:13}}/></PieChart></ResponsiveContainer></div>:<p className="summary-compact-empty">Sem carregamentos classificados nesta seleção.</p>}<dl>{rows.map(row=><div key={row.code}><dt><i style={{background:row.color}}/>{row.label}</dt><dd>{decimalLabel(row.loadedVolume)} <small>t</small></dd><span>{row.loadCount} carregamentos</span></div>)}</dl></div>
 </section>;
}
