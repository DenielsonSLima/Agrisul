'use client';
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {BarChart3,ChevronLeft,ChevronRight} from 'lucide-react';
import {dateLabel,decimalLabel,moneyLabel,monthLabel} from '@/shared/utils/presentation';
import type {ExecutiveFinancialDay,ExecutiveFinancialPeriod,ExecutiveSummaryData} from '../types';
import {FINANCIAL_GROUPINGS,type FinancialGrouping} from '../financialGrouping';
import {DASHBOARD_MONEY_MASK,useDashboardValues} from '../dashboardValues';
import {financialChartCapacity,financialChartPage,financialChartRows,grossChangeLabel,type FinancialChartRow} from '../utils/financialChart';

type Props={data:ExecutiveSummaryData['months'];dailyData?:ExecutiveFinancialDay[];periodData?:ExecutiveFinancialPeriod[];grouping?:FinancialGrouping;compareVolume?:boolean;onSelectMonth?:(month:string)=>void;disabled?:boolean;presenting?:boolean;slideDurationMs?:number};
const compact=(value:number)=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(value);
const shortDay=(value:string)=>value.slice(8,10)+'/'+value.slice(5,7);
const periodLabel=(row:FinancialChartRow)=>row.granularity==='month'?monthLabel(row.key).slice(0,3)+'/'+row.key.slice(2,4):row.endDate?shortDay(row.key)+'–'+shortDay(row.endDate):shortDay(row.key);
const fullPeriod=(row:FinancialChartRow)=>row.granularity==='month'?monthLabel(row.key):row.endDate?dateLabel(row.key)+' a '+dateLabel(row.endDate):dateLabel(row.key);
type BarKey='grossAmount'|'netAmount'|'loadedVolume';
const rawQuote=(row:FinancialChartRow,key:BarKey)=>key==='loadedVolume'?row.loadedVolume===undefined?'A apurar':`${decimalLabel(row.loadedVolume)} t`:row.billingPending?'A apurar':moneyLabel(row[key]);
const coordinate=(value:string)=>Number.isFinite(Number(value))?Number(value):0;
type PlotBox={left:number;right:number;top:number;bottom:number};
/** Geometry only: keep percentage badges close to the line and off the amounts. */
function placeChangeBadge(x:number,lineY:number,width:number,height:number,frame:PlotBox,avoid:PlotBox[]){
 const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
 const positions=[0,12,-12].flatMap(dx=>[1,-1,2,-2,3,-3,4,-4].map(offset=>({x:clamp(x+dx,frame.left+width/2,frame.right-width/2),y:clamp(lineY+offset*(height/2+7),frame.top+height/2,frame.bottom-height/2)})));
 const box=(point:{x:number;y:number})=>({left:point.x-width/2,right:point.x+width/2,top:point.y-height/2,bottom:point.y+height/2});
 return positions.find(point=>{const a=box(point);return avoid.every(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)<=0||Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<=0);})??positions[0];
}

export function FinancialEvolution({data,dailyData,periodData,grouping='month',compareVolume=false,onSelectMonth,disabled,presenting=false,slideDurationMs=120000}:Props){
 const {visible,money}=useDashboardValues(),quote=(row:FinancialChartRow,key:BarKey)=>key==='loadedVolume'||visible?rawQuote(row,key):DASHBOARD_MONEY_MASK;
 const secondary:BarKey=compareVolume?'loadedVolume':'netAmount';
 const id=useId(),plot=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:0,height:0}),[navigation,setNavigation]=useState({signature:'',page:0}),[detailsOpen,setDetailsOpen]=useState(false);
 const rows=useMemo(()=>financialChartRows(data,dailyData,grouping,periodData),[data,dailyData,grouping,periodData]);
 const longest=Math.max(8,...rows.flatMap(row=>[rawQuote(row,'grossAmount').length,rawQuote(row,secondary).length]));
 const capacity=financialChartCapacity(size.width-(compareVolume&&size.height>=150?49:0),longest),pages=Math.max(1,Math.ceil(rows.length/capacity));
 const signature=grouping+':'+rows.map(row=>row.key).join('|'),page=navigation.signature===signature?Math.min(navigation.page,pages-1):0;
 const shown=financialChartPage(rows,capacity,page),navigate=(next:number)=>setNavigation({signature,page:next});
 useEffect(()=>{const node=plot.current;if(!node)return;const observer=new ResizeObserver(entries=>{const box=entries[0]?.contentRect;if(box){const next={width:Math.round(box.width),height:Math.round(box.height)};setSize(previous=>previous.width===next.width&&previous.height===next.height?previous:next);}});observer.observe(node);return()=>observer.disconnect();},[]);
 useEffect(()=>{if(!presenting||pages<2)return;const timer=window.setTimeout(()=>setNavigation({signature,page:(page+1)%pages}),Math.max(8000,slideDurationMs/pages));return()=>window.clearTimeout(timer);},[presenting,pages,page,signature,slideDurationMs]);
 const select=(row:FinancialChartRow)=>{if(!disabled)onSelectMonth?.(row.key.slice(0,7));};
 return <section className="summary-panel summary-evolution dashboard-financial" aria-labelledby={id} data-chart-mode={compareVolume?'gross-volume':'financial'} data-financial-grouping={grouping} data-visible-periods={shown.length} data-total-periods={rows.length}>
  <header className="summary-panel-heading"><div><span className="summary-kicker"><BarChart3 size={15}/>{compareVolume?'CARREGAMENTOS NO PERÍODO':'RESULTADOS FINANCEIROS'}</span><h3 id={id}>{compareVolume?'Bruto e volume carregado':'Entregas que viram receita'}</h3><p>{FINANCIAL_GROUPINGS.find(item=>item.id===grouping)?.label} · {compareVolume?'bruto (R$) e volume (t)':'bruto e líquido'} pela data do carregamento.</p></div></header>
  <div className="summary-chart-legend dashboard-financial-legend" aria-label="Legenda"><span><i className="gross"/>{compareVolume?'Bruto (R$)':'Bruto'}</span><span><i className="net"/>{compareVolume?'Volume (t)':'Líquido'}</span><span><i className="trend"/>Evolução do bruto · %{compareVolume?'':' entre períodos'}</span></div>
  <div ref={plot} className="summary-chart dashboard-financial-plot">
   {rows.length?size.width>0&&size.height>0&&<FinancialPlot compareVolume={compareVolume} rows={shown} width={size.width} height={size.height} onSelect={onSelectMonth&&!disabled?select:undefined}/>:<div className="summary-chart-empty"><span><BarChart3 size={25}/></span><strong>Nenhuma movimentação nesta seleção</strong><p>Ajuste os filtros para explorar outro recorte.</p></div>}
  </div>
  {shown.length>0&&<footer className="dashboard-financial-pagination"><span>{fullPeriod(shown[0])}{shown.length>1?' — '+fullPeriod(shown[shown.length-1]):''}</span>{pages>1&&<nav aria-label="Períodos do gráfico financeiro"><button type="button" aria-label="Períodos anteriores" disabled={page>=pages-1} onClick={()=>navigate(page+1)}><ChevronLeft size={13}/></button><span>{pages-page} / {pages}</span><button type="button" aria-label="Próximos períodos" disabled={page===0} onClick={()=>navigate(page-1)}><ChevronRight size={13}/></button></nav>}</footer>}
  {rows.some(row=>row.billingPending)&&<p className="summary-chart-note">ATR ou cotação incompletos: o valor financeiro do período fica A apurar.</p>}
  <details className="summary-data-details" onToggle={event=>setDetailsOpen(event.currentTarget.open)}><summary>Ver dados financeiros</summary>{detailsOpen&&<div className="summary-table-wrap" tabIndex={0} role="region" aria-label="Dados financeiros da seleção"><table className="summary-table"><thead><tr><th scope="col">Período</th><th scope="col">Bruto</th><th scope="col">{compareVolume?'Volume (t)':'Líquido'}</th><th scope="col">Variação do bruto</th><th scope="col">Entradas em caixa</th></tr></thead><tbody>{rows.map(row=><tr key={row.key}><th scope="row">{fullPeriod(row)}</th><td>{quote(row,'grossAmount')}</td><td>{quote(row,secondary)}</td><td>{visible?grossChangeLabel(row):DASHBOARD_MONEY_MASK}</td><td>{money(row.receivedAmount)}</td></tr>)}</tbody></table></div>}</details>
 </section>;
}

function FinancialPlot({rows,width,height,compareVolume,onSelect}:{rows:FinancialChartRow[];width:number;height:number;compareVolume:boolean;onSelect?: (row:FinancialChartRow)=>void}){
 const {visible}=useDashboardValues(),quote=(row:FinancialChartRow,key:BarKey)=>key==='loadedVolume'||visible?rawQuote(row,key):DASHBOARD_MONEY_MASK;
 const secondary:BarKey=compareVolume?'loadedVolume':'netAmount',keys:BarKey[]=['grossAmount',secondary],secondaryLabel=compareVolume?'volume':'líquido';
 const known=(row:FinancialChartRow,key:BarKey)=>key==='loadedVolume'?row.loadedVolume!==undefined&&row.loadedVolume!=='':!row.billingPending&&row[key]!=='';
 const compactHeight=height<150,left=compactHeight?10:59,right=compareVolume&&!compactHeight?59:10,bottom=compactHeight?20:29,slot=(width-left-right)/Math.max(1,rows.length);
 const longest=Math.max(8,...rows.flatMap(row=>[rawQuote(row,'grossAmount').length,rawQuote(row,secondary).length]));
 const stacked=compactHeight||slot<longest*14+24,top=stacked?(compactHeight?36:54):28,plotHeight=Math.max(1,height-top-bottom);
 const values=rows.flatMap(row=>[row.billingPending?0:coordinate(row.grossAmount),compareVolume?0:row.billingPending?0:coordinate(row.netAmount)]),low=Math.min(0,...values),high=Math.max(0,...values);
 const span=Math.max(1,high-low),rough=span/3,magnitude=10**Math.floor(Math.log10(rough)),step=[1,2,2.5,5,10].map(value=>value*magnitude).find(value=>value>=rough)??magnitude*10;
 const min=Math.floor(low/step)*step,max=Math.max(min+step,Math.ceil(high/step)*step),scale=(value:number)=>top+plotHeight-(value-min)/(max-min)*plotHeight,zero=scale(0);
 const ticks=Array.from({length:Math.round((max-min)/step)+1},(_,index)=>min+index*step),barWidth=Math.min(39,slot*.16),preferredFont=width>=700?14:width>=500?12:11,font=Math.max(8,Math.min(preferredFont,stacked?(slot-14)/(Math.max(longest+8,1)*.61):(slot*.48-12)/(longest*.61)));
 const volumeHigh=Math.max(1,...rows.map(row=>coordinate(row.loadedVolume??'0'))),volumeRough=volumeHigh/3,volumeMagnitude=10**Math.floor(Math.log10(volumeRough)),volumeStep=[1,2,2.5,5,10].map(value=>value*volumeMagnitude).find(value=>value>=volumeRough)??volumeMagnitude*10,volumeMax=Math.ceil(volumeHigh/volumeStep)*volumeStep;
 const volumeScale=(value:number)=>top+plotHeight-value/volumeMax*plotHeight,barScale=(key:BarKey)=>key==='loadedVolume'?volumeScale:scale;
 const centers=rows.map((_row,index)=>left+(index+.5)*slot),knownGross=(row:FinancialChartRow)=>!row.billingPending&&row.grossAmount!=='';
 const grossPath=rows.map((row,index)=>knownGross(row)?`${index>0&&knownGross(rows[index-1])?'L':'M'} ${centers[index]} ${scale(coordinate(row.grossAmount))}`:'').join(' ');
 const changeQuote=(row:FinancialChartRow)=>visible?grossChangeLabel(row):DASHBOARD_MONEY_MASK;
 const amountLabels=rows.flatMap((row,index)=>{const center=centers[index],pairTop=Math.min(zero,...keys.map(key=>barScale(key)(known(row,key)?coordinate(row[key]!):0))),spacing=compactHeight?14:18,firstLabel=Math.max(font+2,pairTop-spacing-9);return keys.map((key,series)=>({id:row.key+key,series,x:stacked?center:center+(series?1:-1)*slot*.24,y:stacked?firstLabel+series*spacing:Math.min(barScale(key)(known(row,key)?coordinate(row[key]!):0),zero)-9,text:(stacked?(series?compareVolume?'Volume ':'Líquido ':'Bruto '):'')+quote(row,key)}));});
 const labelBoxes:PlotBox[]=amountLabels.map(label=>({left:label.x-label.text.length*font*.66/2-3,right:label.x+label.text.length*font*.66/2+3,top:label.y-font-3,bottom:label.y+5}));
 return <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${compareVolume?'Faturamento bruto em reais e volume em toneladas, em escalas independentes':'Bruto e líquido'} por período em barras. Linha pontilhada do faturamento bruto, com variação percentual entre períodos. Valores visíveis acima das barras.`}>
  {!compactHeight&&<text x={left-9} y={12} textAnchor="end" className="dashboard-financial-axis">R$</text>}
  {(compactHeight?[0]:ticks).map(value=><g key={value}><line x1={left} x2={width-right} y1={scale(value)} y2={scale(value)} stroke="#e2ebe5" strokeDasharray="3 5"/>{!compactHeight&&<text x={left-9} y={scale(value)+4} textAnchor="end" className="dashboard-financial-axis">{visible?compact(value):'•••'}</text>}</g>)}
  {compareVolume&&!compactHeight&&<g className="dashboard-volume-axis"><text x={width-right+9} y={12} textAnchor="start" className="dashboard-financial-axis">t</text>{Array.from({length:Math.round(volumeMax/volumeStep)+1},(_,i)=>i*volumeStep).map(value=><text key={value} x={width-right+9} y={volumeScale(value)+4} textAnchor="start" className="dashboard-financial-axis">{compact(value)}</text>)}</g>}
  {rows.map((row,index)=>{
   const center=centers[index],start=center-slot*.24,end=center+slot*.24;
   return <g key={row.key} className="dashboard-financial-period" role={onSelect?'button':undefined} tabIndex={onSelect?0:undefined} onClick={()=>onSelect?.(row)} onKeyDown={event=>{if(onSelect&&(event.key==='Enter'||event.key===' ')){event.preventDefault();onSelect(row);}}} aria-label={`${fullPeriod(row)}: bruto ${quote(row,'grossAmount')}; ${secondaryLabel} ${quote(row,secondary)}; variação do bruto ${changeQuote(row)}.`}>
    <title>{fullPeriod(row)}: bruto {quote(row,'grossAmount')}; {secondaryLabel} {quote(row,secondary)}; variação do bruto {changeQuote(row)}.</title>
    {keys.map((key,series)=>{const value=known(row,key)?coordinate(row[key]!):0,tip=barScale(key)(value),baseline=barScale(key)(0),x=series?end:start;return known(row,key)&&<rect key={key} x={x-barWidth/2} y={Math.min(tip,baseline)} width={barWidth} height={Math.max(0,Math.abs(tip-baseline))} rx={4} fill={series?'#2d8a63':'#bbd3c4'} className={`dashboard-financial-bar is-${series?compareVolume?'volume':'net':'gross'}`}/>;})}
    <text x={center} y={height-7} textAnchor="middle" className="dashboard-financial-date">{periodLabel(row)}</text>
   </g>;
  })}
  <path d={grossPath} fill="none" stroke="#c18a39" strokeWidth={2.5} strokeDasharray="5 5" className="dashboard-financial-gross-line"/>
  {rows.map((row,index)=>knownGross(row)&&<circle key={row.key} className="dashboard-financial-gross-point" cx={centers[index]} cy={scale(coordinate(row.grossAmount))} r={3} fill="#fff" stroke="#c18a39" strokeWidth={2}/>)}
  {rows.map((row,index)=>{
   const single=rows.length===1&&!!row.grossChangeFrom;
   if(!knownGross(row)||index===0&&!single||index>0&&!knownGross(rows[index-1]))return null;
   const previous=single?(row.granularity==='month'?monthLabel(row.grossChangeFrom!).slice(0,3)+'/'+row.grossChangeFrom!.slice(2,4):shortDay(row.grossChangeFrom!)):fullPeriod(rows[index-1]);
   const text=changeQuote(row)+(single?` vs ${previous}`:''),labelFont=compactHeight?9:preferredFont,labelWidth=Math.max(66,Math.min(slot*.8,text.length*labelFont*.62+20)),labelHeight=compactHeight?20:28;
   const lineX=single?centers[index]:(centers[index-1]+centers[index])/2,lineY=single?scale(coordinate(row.grossAmount)):(scale(coordinate(rows[index-1].grossAmount))+scale(coordinate(row.grossAmount)))/2;
   const {x,y}=placeChangeBadge(lineX,lineY,labelWidth,labelHeight,{left,right:width-right,top,bottom:height-bottom-3},labelBoxes);
   labelBoxes.push({left:x-labelWidth/2,right:x+labelWidth/2,top:y-labelHeight/2,bottom:y+labelHeight/2});
   const direction=!visible||!row.grossChangePercent||/^0(?:\.0*)?$/.test(row.grossChangePercent)?'neutral':row.grossChangePercent.startsWith('-')?'down':'up';
   return <g key={row.key} className={`dashboard-financial-change is-${direction}`} aria-label={`Variação do bruto de ${previous} para ${fullPeriod(row)}: ${changeQuote(row)}`}>
    <title>Variação do faturamento bruto: {text}</title><line x1={lineX} y1={lineY} x2={x} y2={y} stroke="#c18a39" strokeWidth={1}/><rect x={x-labelWidth/2} y={y-labelHeight/2} width={labelWidth} height={labelHeight} rx={6}/><text x={x} y={y+labelFont*.34} textAnchor="middle" fontSize={Math.min(labelFont,(labelWidth-12)/Math.max(1,text.length*.62))}>{text}</text>
   </g>;
  })}
  <g aria-hidden="true" pointerEvents="none">{amountLabels.map(label=><text key={label.id} x={label.x} y={label.y} textAnchor="middle" fontSize={font} className={`dashboard-financial-value-label is-${label.series?compareVolume?'volume':'net':'gross'}`}>{label.text}</text>)}</g>
 </svg>;
}
