'use client';
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {BarChart3,ChevronLeft,ChevronRight} from 'lucide-react';
import {dateLabel,moneyLabel,monthLabel} from '@/shared/utils/presentation';
import type {ExecutiveFinancialDay,ExecutiveFinancialPeriod,ExecutiveSummaryData} from '../types';
import {FINANCIAL_GROUPINGS,type FinancialGrouping} from '../financialGrouping';
import {DASHBOARD_MONEY_MASK,useDashboardValues} from '../dashboardValues';
import {financialChartCapacity,financialChartPage,financialChartRows,type FinancialChartRow} from '../utils/financialChart';

type Props={data:ExecutiveSummaryData['months'];dailyData?:ExecutiveFinancialDay[];periodData?:ExecutiveFinancialPeriod[];grouping?:FinancialGrouping;onSelectMonth?:(month:string)=>void;disabled?:boolean;presenting?:boolean;slideDurationMs?:number};
const compact=(value:number)=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(value);
const shortDay=(value:string)=>value.slice(8,10)+'/'+value.slice(5,7);
const periodLabel=(row:FinancialChartRow)=>row.granularity==='month'?monthLabel(row.key).slice(0,3)+'/'+row.key.slice(2,4):row.endDate?shortDay(row.key)+'–'+shortDay(row.endDate):shortDay(row.key);
const fullPeriod=(row:FinancialChartRow)=>row.granularity==='month'?monthLabel(row.key):row.endDate?dateLabel(row.key)+' a '+dateLabel(row.endDate):dateLabel(row.key);
const rawQuote=(row:FinancialChartRow,key:'grossAmount'|'netAmount')=>row.billingPending?'A apurar':moneyLabel(row[key]);
const coordinate=(value:string)=>Number.isFinite(Number(value))?Number(value):0;

export function FinancialEvolution({data,dailyData,periodData,grouping='month',onSelectMonth,disabled,presenting=false,slideDurationMs=120000}:Props){
 const {visible,money}=useDashboardValues(),quote=(row:FinancialChartRow,key:'grossAmount'|'netAmount')=>visible?rawQuote(row,key):DASHBOARD_MONEY_MASK;
 const id=useId(),plot=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:0,height:0}),[navigation,setNavigation]=useState({signature:'',page:0}),[detailsOpen,setDetailsOpen]=useState(false);
 const rows=useMemo(()=>financialChartRows(data,dailyData,grouping,periodData),[data,dailyData,grouping,periodData]);
 const longest=Math.max(8,...rows.flatMap(row=>[rawQuote(row,'grossAmount').length,rawQuote(row,'netAmount').length]));
 const capacity=financialChartCapacity(size.width,longest),pages=Math.max(1,Math.ceil(rows.length/capacity));
 const signature=grouping+':'+rows.map(row=>row.key).join('|'),page=navigation.signature===signature?Math.min(navigation.page,pages-1):0;
 const shown=financialChartPage(rows,capacity,page),navigate=(next:number)=>setNavigation({signature,page:next});
 useEffect(()=>{const node=plot.current;if(!node)return;const observer=new ResizeObserver(entries=>{const box=entries[0]?.contentRect;if(box){const next={width:Math.round(box.width),height:Math.round(box.height)};setSize(previous=>previous.width===next.width&&previous.height===next.height?previous:next);}});observer.observe(node);return()=>observer.disconnect();},[]);
 useEffect(()=>{if(!presenting||pages<2)return;const timer=window.setTimeout(()=>setNavigation({signature,page:(page+1)%pages}),Math.max(8000,slideDurationMs/pages));return()=>window.clearTimeout(timer);},[presenting,pages,page,signature,slideDurationMs]);
 const select=(row:FinancialChartRow)=>{if(!disabled)onSelectMonth?.(row.key.slice(0,7));};
 return <section className="summary-panel summary-evolution dashboard-financial" aria-labelledby={id} data-financial-grouping={grouping} data-visible-periods={shown.length} data-total-periods={rows.length}>
  <header className="summary-panel-heading"><div><span className="summary-kicker"><BarChart3 size={15}/>RESULTADOS FINANCEIROS</span><h3 id={id}>Entregas que viram receita</h3><p>{FINANCIAL_GROUPINGS.find(item=>item.id===grouping)?.label} · cargas pelo carregamento e caixa pela entrada.</p></div></header>
  <div className="summary-chart-legend dashboard-financial-legend" aria-label="Legenda"><span><i className="gross"/>Bruto</span><span><i className="net"/>Líquido</span><span><i className="cash"/>Entradas em caixa</span></div>
  <div ref={plot} className="summary-chart dashboard-financial-plot">
   {rows.length?size.width>0&&size.height>0&&<FinancialPlot rows={shown} width={size.width} height={size.height} onSelect={onSelectMonth&&!disabled?select:undefined}/>:<div className="summary-chart-empty"><span><BarChart3 size={25}/></span><strong>Nenhuma movimentação nesta seleção</strong><p>Ajuste os filtros para explorar outro recorte.</p></div>}
  </div>
  {shown.length>0&&<footer className="dashboard-financial-pagination"><span>{fullPeriod(shown[0])}{shown.length>1?' — '+fullPeriod(shown[shown.length-1]):''}</span>{pages>1&&<nav aria-label="Períodos do gráfico financeiro"><button type="button" aria-label="Períodos anteriores" disabled={page>=pages-1} onClick={()=>navigate(page+1)}><ChevronLeft size={13}/></button><span>{pages-page} / {pages}</span><button type="button" aria-label="Próximos períodos" disabled={page===0} onClick={()=>navigate(page-1)}><ChevronRight size={13}/></button></nav>}</footer>}
  {rows.some(row=>row.billingPending)&&<p className="summary-chart-note">ATR ou cotação incompletos: o valor financeiro do dia fica A apurar.</p>}
  <details className="summary-data-details" onToggle={event=>setDetailsOpen(event.currentTarget.open)}><summary>Ver dados financeiros</summary>{detailsOpen&&<div className="summary-table-wrap" tabIndex={0} role="region" aria-label="Dados financeiros da seleção"><table className="summary-table"><thead><tr><th scope="col">Período</th><th scope="col">Bruto</th><th scope="col">Líquido</th><th scope="col">Entradas em caixa</th></tr></thead><tbody>{rows.map(row=><tr key={row.key}><th scope="row">{fullPeriod(row)}</th><td>{quote(row,'grossAmount')}</td><td>{quote(row,'netAmount')}</td><td>{money(row.receivedAmount)}</td></tr>)}</tbody></table></div>}</details>
 </section>;
}

function FinancialPlot({rows,width,height,onSelect}:{rows:FinancialChartRow[];width:number;height:number;onSelect?: (row:FinancialChartRow)=>void}){
 const {visible,money}=useDashboardValues(),quote=(row:FinancialChartRow,key:'grossAmount'|'netAmount')=>visible?rawQuote(row,key):DASHBOARD_MONEY_MASK;
 const compactHeight=height<150,left=compactHeight?10:59,right=10,bottom=compactHeight?20:29,slot=(width-left-right)/Math.max(1,rows.length);
 const longest=Math.max(8,...rows.flatMap(row=>[rawQuote(row,'grossAmount').length,rawQuote(row,'netAmount').length]));
 const stacked=compactHeight||slot<longest*14+24,top=stacked?(compactHeight?36:54):28,plotHeight=Math.max(1,height-top-bottom);
 const values=rows.flatMap(row=>[row.billingPending?0:coordinate(row.grossAmount),row.billingPending?0:coordinate(row.netAmount),coordinate(row.receivedAmount)]),low=Math.min(0,...values),high=Math.max(0,...values);
 const span=Math.max(1,high-low),rough=span/3,magnitude=10**Math.floor(Math.log10(rough)),step=[1,2,2.5,5,10].map(value=>value*magnitude).find(value=>value>=rough)??magnitude*10;
 const min=Math.floor(low/step)*step,max=Math.max(min+step,Math.ceil(high/step)*step),scale=(value:number)=>top+plotHeight-(value-min)/(max-min)*plotHeight,zero=scale(0);
 const ticks=Array.from({length:Math.round((max-min)/step)+1},(_,index)=>min+index*step),barWidth=Math.min(39,slot*.16),preferredFont=width>=700?14:width>=500?12:11,font=Math.max(8,Math.min(preferredFont,stacked?(slot-14)/(Math.max(longest+8,1)*.61):(slot*.48-12)/(longest*.61)));
 const centers=rows.map((_row,index)=>left+(index+.5)*slot),cashPath=rows.map((row,index)=>`${index?'L':'M'} ${centers[index]} ${scale(coordinate(row.receivedAmount))}`).join(' ');
 return <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Bruto e líquido por período em barras, entradas em caixa em linha pontilhada. Valores visíveis acima das barras.">
  {!compactHeight&&<text x={left-9} y={12} textAnchor="end" className="dashboard-financial-axis">R$</text>}
  {(compactHeight?[0]:ticks).map(value=><g key={value}><line x1={left} x2={width-right} y1={scale(value)} y2={scale(value)} stroke="#e2ebe5" strokeDasharray="3 5"/>{!compactHeight&&<text x={left-9} y={scale(value)+4} textAnchor="end" className="dashboard-financial-axis">{visible?compact(value):'•••'}</text>}</g>)}
  {rows.map((row,index)=>{
   const center=centers[index],start=center-slot*.24,end=center+slot*.24;
   return <g key={row.key} className="dashboard-financial-period" role={onSelect?'button':undefined} tabIndex={onSelect?0:undefined} onClick={()=>onSelect?.(row)} onKeyDown={event=>{if(onSelect&&(event.key==='Enter'||event.key===' ')){event.preventDefault();onSelect(row);}}} aria-label={`${fullPeriod(row)}: bruto ${quote(row,'grossAmount')}; líquido ${quote(row,'netAmount')}; entradas ${money(row.receivedAmount)}.`}>
    <title>{fullPeriod(row)}: bruto {quote(row,'grossAmount')}; líquido {quote(row,'netAmount')}; entradas {money(row.receivedAmount)}.</title>
    {(['grossAmount','netAmount'] as const).map((key,series)=>{const value=row.billingPending?0:coordinate(row[key]),tip=scale(value),x=series?end:start;return !row.billingPending&&<rect key={key} x={x-barWidth/2} y={Math.min(tip,zero)} width={barWidth} height={Math.max(0,Math.abs(tip-zero))} rx={4} fill={series?'#2d8a63':'#bbd3c4'} className={`dashboard-financial-bar is-${series?'net':'gross'}`}/>;})}
    <text x={center} y={height-7} textAnchor="middle" className="dashboard-financial-date">{periodLabel(row)}</text>
   </g>;
  })}
  <path d={cashPath} fill="none" stroke="#c18a39" strokeWidth={2.5} strokeDasharray="5 5" className="dashboard-financial-cash-line"/>
  {rows.map((row,index)=><circle key={row.key} cx={centers[index]} cy={scale(coordinate(row.receivedAmount))} r={3} fill="#fff" stroke="#c18a39" strokeWidth={2}/>)}
  {rows.map((row,index)=>{const center=centers[index],pairTop=Math.min(zero,scale(row.billingPending?0:coordinate(row.grossAmount)),scale(row.billingPending?0:coordinate(row.netAmount))),spacing=compactHeight?14:18,firstLabel=Math.max(font+2,pairTop-spacing-9);return <g key={row.key} aria-hidden="true" pointerEvents="none">{(['grossAmount','netAmount'] as const).map((key,series)=>{const value=row.billingPending?0:coordinate(row[key]),labelX=stacked?center:center+(series?1:-1)*slot*.24,labelY=stacked?firstLabel+series*spacing:Math.min(scale(value),zero)-9;return <text key={key} x={labelX} y={labelY} textAnchor="middle" fontSize={font} className={`dashboard-financial-value-label is-${series?'net':'gross'}`}>{stacked?(series?'Líquido ':'Bruto '):''}{quote(row,key)}</text>;})}</g>;})}
 </svg>;
}
