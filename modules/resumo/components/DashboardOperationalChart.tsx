'use client';
import {useEffect,useId,useMemo,useState} from 'react';
import {BarChart3,ChevronLeft,ChevronRight} from 'lucide-react';
import {decimalLabel} from '@/shared/utils/presentation';
import type {ExecutiveOperationalPeriod,ExecutiveSummaryData} from '../types';
import {FINANCIAL_GROUPINGS,type FinancialGrouping} from '../financialGrouping';
import {usePlotSize} from '../hooks/usePlotSize';
import {financialChartPage} from '../utils/financialChart';
import {operationalChartRows,type OperationalChartRow} from '../utils/operationalChart';
import {chartPeriodLabel,fullChartPeriod} from '../utils/chartPeriod';
import {DashboardDataDialog} from './DashboardDataDialog';

type Props={data:ExecutiveSummaryData['monthlyOperations'];dailyData?:ExecutiveOperationalPeriod[];periodData?:ExecutiveOperationalPeriod[];grouping?:FinancialGrouping;onSelectMonth?:(month:string)=>void;disabled?:boolean;presenting?:boolean;slideDurationMs?:number};
const compact=(value:number)=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(value);
const volumeText=(row:OperationalChartRow)=>`${decimalLabel(row.loadedVolume)} t`;
/** Axis geometry only; the values and weighted ATR already come from Postgres. */
function axis(values:number[],top:number,height:number){
 const high=Math.max(1,...values),rough=high/3,magnitude=10**Math.floor(Math.log10(rough));
 const step=[1,2,2.5,5,10].map(value=>value*magnitude).find(value=>value>=rough)??magnitude*10,max=Math.ceil(high/step)*step;
 return {scale:(value:number)=>top+height-value/max*height,ticks:Array.from({length:Math.round(max/step)+1},(_,i)=>i*step)};
}

export function OperationalEvolution({data,dailyData,periodData,grouping='month',onSelectMonth,disabled,presenting=false,slideDurationMs=120000}:Props){
 const id=useId(),{ref,size}=usePlotSize(),[navigation,setNavigation]=useState({signature:'',page:0});
 const rows=useMemo(()=>operationalChartRows(data,dailyData,grouping,periodData),[data,dailyData,grouping,periodData]),longest=Math.max(8,...rows.map(row=>volumeText(row).length));
 const capacity=Math.max(1,Math.min(18,Math.floor(Math.max(0,size.width-112)/Math.max(140,Math.min(280,longest*7+24))))),pages=Math.max(1,Math.ceil(rows.length/capacity));
 const signature=grouping+':'+rows.map(row=>row.key).join('|'),page=navigation.signature===signature?Math.min(navigation.page,pages-1):0,shown=financialChartPage(rows,capacity,page);
 const available=grouping==='month'||(grouping==='day'?dailyData:periodData)!==undefined;
 const select=onSelectMonth&&!disabled?(key:string)=>onSelectMonth(key.slice(0,7)):undefined;
 useEffect(()=>{if(!presenting||pages<2)return;const timer=window.setTimeout(()=>setNavigation({signature,page:(page+1)%pages}),Math.max(8000,slideDurationMs/pages));return()=>window.clearTimeout(timer);},[presenting,pages,page,signature,slideDurationMs]);
 return <section className="summary-panel summary-evolution dashboard-operational" aria-labelledby={id} data-chart-grouping={grouping} data-total-periods={rows.length} data-visible-periods={shown.length}>
  <header className="summary-panel-heading"><div><span className="summary-kicker"><BarChart3 size={15}/>EVOLUÇÃO DA OPERAÇÃO</span><h3 id={id}>Volume e qualidade das entregas</h3><p>{FINANCIAL_GROUPINGS.find(item=>item.id===grouping)?.label} · Volume em toneladas · ATR ponderado pelas toneladas carregadas.</p></div></header>
  <div className="summary-chart-legend"><span><i className="net"/>Volume (t)</span><span><i className="atr"/>ATR (kg/t)</span></div>
  <div ref={ref} className="summary-chart dashboard-operational-plot">{rows.length?size.width>0&&size.height>0&&<OperationPlot rows={shown} width={size.width} height={size.height} onSelect={select}/>:<div className="summary-chart-empty"><span><BarChart3 size={25}/></span><strong>{available?'Nenhuma movimentação nesta seleção':'Atualizando agrupamento operacional'}</strong><p>{available?'Ajuste os filtros para explorar outro recorte.':'Aguarde a atualização dos dados.'}</p></div>}</div>
  {shown.length>0&&<footer className="dashboard-financial-pagination"><span>{fullChartPeriod(shown[0])}{shown.length>1?' — '+fullChartPeriod(shown.at(-1)!):''}</span>{pages>1&&<nav aria-label="Períodos do gráfico operacional"><button type="button" aria-label="Períodos anteriores" disabled={page>=pages-1} onClick={()=>setNavigation({signature,page:page+1})}><ChevronLeft size={13}/></button><span>{pages-page} / {pages}</span><button type="button" aria-label="Próximos períodos" disabled={page===0} onClick={()=>setNavigation({signature,page:page-1})}><ChevronRight size={13}/></button></nav>}</footer>}
  <DashboardDataDialog title="Dados operacionais por período" description="Todos os períodos com movimento da seleção aplicada. Volume em toneladas e ATR ponderado pelas toneladas carregadas."><table><caption className="sr-only">Dados operacionais por período</caption><thead><tr><th scope="col">Período</th><th scope="col">Volume (t)</th><th scope="col">Cargas</th><th scope="col">ATR (kg/t)</th></tr></thead><tbody>{rows.map(row=><tr key={row.key}><th scope="row">{fullChartPeriod(row)}</th><td>{decimalLabel(row.loadedVolume)}</td><td>{row.loadCount}</td><td>{decimalLabel(row.averageAtr)}</td></tr>)}</tbody></table></DashboardDataDialog>
 </section>;
}

function OperationPlot({rows,width,height,onSelect}:{rows:OperationalChartRow[];width:number;height:number;onSelect?:(key:string)=>void}){
 const compactHeight=height<150,left=compactHeight?8:52,right=compactHeight?8:48,bottom=compactHeight?35:48,top=26,plotHeight=Math.max(1,height-top-bottom),slot=(width-left-right)/Math.max(1,rows.length);
 const volumes=axis(rows.map(row=>Number(row.loadedVolume)),top,plotHeight),qualityValue=(row:OperationalChartRow)=>row.averageAtr===''?null:Number(row.averageAtr);
 const quality=axis(rows.flatMap(row=>qualityValue(row)===null?[]:[qualityValue(row)!]),top,plotHeight),centers=rows.map((_row,i)=>left+(i+.5)*slot),barWidth=Math.min(44,slot*.34);
 const longest=Math.max(8,...rows.map(row=>volumeText(row).length)),font=Math.max(8,Math.min(width>=700?14:11,(slot-12)/(longest*.64)));
 const path=rows.map((row,i)=>qualityValue(row)===null?'':`${i>0&&qualityValue(rows[i-1])!==null?'L':'M'} ${centers[i]} ${quality.scale(qualityValue(row)!)}`).join(' ');
 return <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Volume por período em toneladas e ATR médio ponderado em kg/t em linha pontilhada. Valores de volume acima das barras e qualidade abaixo dos períodos.">
  {!compactHeight&&<><text x={left-8} y={12} textAnchor="end" className="dashboard-operational-axis">t</text><text x={width-right+8} y={12} className="dashboard-operational-axis is-quality">kg/t</text></>}
  {(compactHeight?[0]:volumes.ticks).map(tick=><g key={tick}><line x1={left} x2={width-right} y1={volumes.scale(tick)} y2={volumes.scale(tick)} stroke="#e2ebe5" strokeDasharray="3 5"/>{!compactHeight&&<text x={left-8} y={volumes.scale(tick)+4} textAnchor="end" className="dashboard-operational-axis">{compact(tick)}</text>}</g>)}
  {!compactHeight&&rows.some(row=>qualityValue(row)!==null)&&quality.ticks.map(tick=><text key={tick} x={width-right+8} y={quality.scale(tick)+4} className="dashboard-operational-axis is-quality">{compact(tick)}</text>)}
  {rows.map((row,i)=>{const y=volumes.scale(Number(row.loadedVolume)),qualityText=`ATR ${row.averageAtr===''?'A apurar':decimalLabel(row.averageAtr)}`,labelFont=Math.min(compactHeight?9:11,(slot-10)/(Math.max(1,qualityText.length)*.62));return <g key={row.key} className="dashboard-operational-period" role={onSelect?'button':undefined} tabIndex={onSelect?0:undefined} onClick={()=>onSelect?.(row.key)} onKeyDown={event=>{if(onSelect&&(event.key==='Enter'||event.key===' ')){event.preventDefault();onSelect(row.key);}}} aria-label={`${fullChartPeriod(row)}: ${volumeText(row)}; ${row.loadCount} cargas; ATR ${decimalLabel(row.averageAtr)} kg/t.`}>
   <title>{fullChartPeriod(row)}: {volumeText(row)} · {row.loadCount} cargas · ATR {decimalLabel(row.averageAtr)} kg/t</title>
   <rect className="dashboard-operational-bar" x={centers[i]-barWidth/2} y={y} width={barWidth} height={Math.max(0,volumes.scale(0)-y)} rx={5} fill="#4c9c74"/>
   <text className="dashboard-financial-date" x={centers[i]} y={height-(compactHeight?20:28)} textAnchor="middle">{chartPeriodLabel(row)}</text>
   {!compactHeight&&<rect x={centers[i]-Math.min(slot-10,120)/2} y={height-22} width={Math.min(slot-10,120)} height={20} rx={6} fill="#fff3e4"/>}<text className="dashboard-operational-quality" x={centers[i]} y={height-(compactHeight?5:8)} textAnchor="middle" fontSize={labelFont}>{qualityText}</text>
  </g>;})}
  <path className="dashboard-operational-line" d={path} fill="none" stroke="#b87a28" strokeWidth={2.5} strokeDasharray="5 5"/>
  {rows.map((row,i)=>qualityValue(row)!==null&&<circle key={row.key} cx={centers[i]} cy={quality.scale(qualityValue(row)!)} r={3.5} fill="#fff" stroke="#b87a28" strokeWidth={2}/>)}
  {rows.map((row,i)=><text key={row.key} className="dashboard-operational-volume" x={centers[i]} y={Math.max(font+2,volumes.scale(Number(row.loadedVolume))-8)} textAnchor="middle" fontSize={font}>{volumeText(row)}</text>)}
 </svg>;
}
