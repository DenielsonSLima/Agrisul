'use client';
import {useEffect,useId,useState,type CSSProperties} from 'react';
import {CalendarDays,Gauge,Truck,Wallet} from 'lucide-react';
import {decimalLabel} from '@/shared/utils/presentation';
import {useDashboardValues} from '../dashboardValues';
import {usePlotSize} from '../hooks/usePlotSize';
import type {WeeklySummaryData} from '../types';
import {weeklyDate} from '../weekly';
import {DashboardAnalysis,DashboardPanel} from './DashboardVisuals';
import {DashboardDataDialog} from './DashboardDataDialog';

const compact=(value:number)=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(value);
type Day=WeeklySummaryData['days'][number];
type WeeklyCard={id:string;name:string;value:string;unit?:string;hint:string;icon:typeof Truck;previous?:string;change?:string;atr?:string};
const atrText=(day:Pick<Day,'loadCount'|'averageAtr'>)=>day.loadCount?decimalLabel(day.averageAtr):'—';
const delta=(value:string,unit='%')=>value===''?'Sem base':`${Number(value)>0?'+':''}${decimalLabel(value)}${unit}`;

export function WeeklyContext({from,to}:{from:string;to:string}){
 return <div className="dashboard-weekly-controls"><div><strong>Últimos 7 dias <span>· {weeklyDate(from)} a {weeklyDate(to)}</span></strong><small>Hoje em andamento · comparação com os 7 dias anteriores</small></div></div>;
}

export function DashboardWeekly({data,presenting=false,slideDurationMs=120000}:{data:WeeklySummaryData;presenting?:boolean;slideDurationMs?:number}){
 const {money,visible}=useDashboardValues(),t=data.totals,p=data.comparison;
 const methodCard=(code:'1'|'2',name:string):WeeklyCard=>{
  const method=data.contractMethods.find(row=>row.code===code);
  return {id:code==='1'?'weekly-manual':'weekly-mechanized',name,value:decimalLabel(method?.loadedVolume),unit:'t',hint:`${method?.loadCount??0} carregamento(s)`,icon:Truck,atr:method?atrText(method):'A apurar'};
 };
 const cards:WeeklyCard[]=[
  {id:'weekly-volume',name:'Volume carregado',value:decimalLabel(t.loadedVolume),unit:'t',hint:'Toneladas líquidas nos últimos 7 dias',icon:Truck,previous:`${decimalLabel(p.loadedVolume)} t`,change:delta(p.volumeChangePercent)},
  {id:'weekly-loads',name:'Carregamentos',value:String(t.loadCount),hint:'Quantidade de cargas no período',icon:CalendarDays,previous:String(p.loadCount),change:delta(p.loadChangePercent)},
  {id:'weekly-atr',name:'ATR médio ponderado',value:atrText(t),unit:t.averageAtr?'kg/t':undefined,hint:'Qualidade ponderada pelas toneladas',icon:Gauge,previous:atrText(p)+(p.averageAtr?' kg/t':''),change:p.atrChange===''?'Sem comparação':delta(p.atrChange,' kg/t')},
  {id:'weekly-gross',name:'Faturamento bruto',value:money(t.grossAmount),hint:t.billingPending?'ATR ou cotação pendentes':`Líquido: ${money(t.netAmount)}`,icon:Wallet,previous:money(p.grossAmount),change:visible?(t.billingPending||p.billingPending?'A apurar':delta(p.grossChangePercent)):'••••••'},
  methodCard('2','Mecanizada'),methodCard('1','Manual'),
 ];
 return <>
  <dl className="executive-metrics dashboard-weekly-metrics" data-metric-count={6} aria-label="Indicadores dos últimos sete dias">{cards.map((card,index)=><div key={card.id} className={`executive-metric ${card.atr!==undefined?'is-modality ':''}${index===0?'is-featured':index===2||index===5?'tone-gold':'tone-blue'}`} data-dashboard-metric={card.id}><dt><span>{card.name}</span><i><card.icon size={15}/></i></dt><dd title={card.value} style={{'--metric-value-width':Math.max(1,card.value.length)*.64,'--metric-unit-space':`${card.unit?card.unit.length*7+6:0}px`} as CSSProperties}><span>{card.value}</span>{card.unit&&<small>{card.unit}</small>}</dd><div className="dashboard-weekly-card-hint"><span>{card.hint}</span></div>{card.atr!==undefined&&<div className="dashboard-weekly-card-atr"><span>ATR médio</span><strong>{card.atr}{card.atr!=='—'&&card.atr!=='A apurar'&&<small> kg/t</small>}</strong></div>}{card.change!==undefined&&<div className="dashboard-weekly-card-comparison" title={`${weeklyDate(p.from)} a ${weeklyDate(p.to)} · Anterior: ${card.previous}`}><span>vs. 7 dias anteriores</span><strong>{card.change}</strong></div>}</div>)}</dl>
  <DashboardAnalysis labels={['Volume e ATR','Faturamento','Contratos']} first={<WeeklyChart data={data}/>} second={<WeeklyChart data={data} financial/>} third={<WeeklyContracts data={data} presenting={presenting} slideDurationMs={slideDurationMs}/>}/>
 </>;
}

function WeeklyContracts({data,presenting,slideDurationMs}:{data:WeeklySummaryData;presenting:boolean;slideDurationMs:number}){
 const {ref,size}=usePlotSize(),[page,setPage]=useState(0),rows=data.contractProgress??[];
 const capacity=Math.max(1,Math.min(4,Math.floor(size.height/84))),pages=Math.max(1,Math.ceil(rows.length/capacity)),current=Math.min(page,pages-1);
 useEffect(()=>{if(!presenting||pages<2)return;const timer=window.setTimeout(()=>setPage((current+1)%pages),Math.max(1000,slideDurationMs/pages));return()=>window.clearTimeout(timer);},[presenting,pages,current,slideDurationMs]);
 const volume=(value:string)=>value===''?'Não informado':decimalLabel(value);
 return <DashboardPanel title="" eyebrow="ACOMPANHAMENTO DOS CONTRATOS" className="dashboard-weekly-contract-panel">
  <div className="weekly-contract-legend"><span><i/>Entregue</span><span><i/>Na semana</span><span><i/>A entregar</span></div>
  <div ref={ref} className="dashboard-weekly-contracts" role="list" aria-label="Entregas por contrato">{rows.length?rows.slice(current*capacity,(current+1)*capacity).map(row=>{const label=row.contractNumber||row.title,description=`${label}: ${volume(row.contractedVolume)} t contratado; ${volume(row.deliveredVolume)} t entregue, incluindo ${volume(row.weeklyVolume)} t na semana; ${volume(row.remainingVolume??'')} t a entregar.`;return <article key={row.id} role="listitem"><header><strong title={`${label} · ${row.clientName}`}>{label}</strong>{!label.toLocaleLowerCase('pt-BR').includes(row.clientName.toLocaleLowerCase('pt-BR'))&&<small title={row.clientName}>{row.clientName}</small>}</header><dl><div><dt>Contratado</dt><dd>{volume(row.contractedVolume)}{row.contractedVolume!==''&&<small> t</small>}</dd></div><div><dt>Entregue no contrato</dt><dd>{volume(row.deliveredVolume)}<small> t</small></dd></div><div><dt>Na semana</dt><dd>{volume(row.weeklyVolume)}<small> t</small></dd></div></dl><div className="weekly-contract-track" role="img" aria-label={description} title={description}><span style={{width:`${Math.min(100,Math.max(0,Number(row.previousDeliveryPercent)||0))}%`}}/><span style={{width:`${Math.min(100,Math.max(0,Number(row.weeklyDeliveryPercent)||0))}%`}}/></div></article>;}):<div className="executive-empty"><strong>Nenhum contrato nesta seleção</strong><p>Ajuste os filtros para consultar outra seleção.</p></div>}</div>
  <footer className="dashboard-weekly-contract-footer"><span>Acumulado até {weeklyDate(data.range.to)}</span>{pages>1&&<nav aria-label="Páginas de contratos"><button type="button" aria-label="Contratos anteriores" disabled={current===0} onClick={()=>setPage(current-1)}>‹</button><span>{current+1}/{pages}</span><button type="button" aria-label="Próximos contratos" disabled={current===pages-1} onClick={()=>setPage(current+1)}>›</button></nav>}
   <DashboardDataDialog title="Entregas por contrato" description="Volume contratado e entregas acumuladas do contrato até a data final da semana. Entregue na semana respeita os filtros de cliente, contrato, modalidade e origem."><table><thead><tr><th scope="col">Contrato</th><th scope="col">Cliente</th><th scope="col">Contratado (t)</th><th scope="col">Entregue no contrato (t)</th><th scope="col">Na semana (t)</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><th scope="row">{row.contractNumber||row.title}</th><td>{row.clientName}</td><td>{volume(row.contractedVolume)}</td><td>{volume(row.deliveredVolume)}</td><td>{volume(row.weeklyVolume)}</td></tr>)}</tbody></table></DashboardDataDialog>
  </footer>
 </DashboardPanel>;
}

function WeeklyChart({data,financial=false}:{data:WeeklySummaryData;financial?:boolean}){
 const {ref,size}=usePlotSize(),id=useId(),{money,visible}=useDashboardValues();
 const title=financial?'Faturamento por dia':'Volume e ATR por dia',days=data.days;
 return <DashboardPanel title={title} eyebrow={financial?'RESULTADO DAS ENTREGAS':'RITMO DA OPERAÇÃO'} subtitle={financial?'Bruto e líquido pela data do carregamento.':'Toneladas em barras · ATR ponderado em linha.'} className="dashboard-weekly-panel">
  <div className="dashboard-weekly-legend" aria-label={`Legenda: ${title}`}><span><i style={{background:financial?'#aecfbc':'#23805b'}}/>{financial?'Bruto':'Volume (t)'}</span><span><i style={{background:financial?'#23805b':'#b87a28'}}/>{financial?'Líquido':'ATR (kg/t)'}</span><span><i style={{background:'#5377ac'}}/>Variação do {financial?'bruto':'volume'} · % vs. dia anterior com produção</span></div>
  <div ref={ref} className="dashboard-weekly-plot" aria-labelledby={id}><span className="sr-only" id={id}>{title}</span>{days.length?size.width>0&&size.height>0&&<WeeklyPlot days={days} today={data.range.to} width={size.width} height={size.height} financial={financial}/>:<div className="executive-empty"><strong>Nenhum carregamento nos últimos 7 dias</strong><p>Ajuste os filtros para consultar outra seleção.</p></div>}</div>
  <footer className="dashboard-weekly-chart-footer"><span>{days.length?financial&&data.totals.billingPending?`${data.totals.pendingLoadCount} carga(s) com valor a apurar`:`${days.length} dia(s) com produção · últimos 7 dias`:'Nenhum carregamento nesta seleção'}</span>
   <DashboardDataDialog title={title+' · últimos 7 dias'} description="Somente dias com produção dentro dos últimos sete dias corridos. Variações comparadas com o dia anterior com produção desta seleção. ATR ponderado pelas toneladas. Faturamento pela data da carga; hoje ainda está em andamento."><table><caption className="sr-only">Dados diários da semana</caption><thead><tr><th scope="col">Data</th><th scope="col">Cargas</th><th scope="col">Volume (t)</th><th scope="col">Variação do volume</th><th scope="col">ATR (kg/t)</th><th scope="col">Bruto</th><th scope="col">Variação do bruto</th><th scope="col">Líquido</th></tr></thead><tbody>{days.map(day=><tr key={day.date}><th scope="row">{weeklyDate(day.date)}{day.date===data.range.to?' · hoje parcial':''}</th><td>{day.loadCount}</td><td>{decimalLabel(day.loadedVolume)}</td><td>{delta(day.volumeChangePercent??'')}</td><td>{atrText(day)}</td><td>{money(day.grossAmount)}</td><td>{visible?delta(day.grossChangePercent??''):'••••••'}</td><td>{money(day.netAmount)}</td></tr>)}</tbody></table></DashboardDataDialog>
  </footer>
 </DashboardPanel>;
}

/** Only axis/shape geometry uses numbers; all metrics and comparisons come from Postgres. */
export function WeeklyPlot({days,today,width,height,financial}:{days:Day[];today:string;width:number;height:number;financial:boolean}){
 const {visible,money}=useDashboardValues(),small=height<180,left=small?30:46,right=financial?10:38,top=financial?40:28,bottom=small?33:45;
 const plotHeight=Math.max(1,height-top-bottom),slot=Math.max(1,(width-left-right)/Math.max(1,days.length)),barWidth=Math.min(44,slot*(financial?.23:.44));
 const values=financial?days.flatMap(day=>day.billingPending?[]:[Number(day.grossAmount),Number(day.netAmount)]):days.map(day=>Number(day.loadedVolume));
 const low=Math.min(0,...values),high=Math.max(1,...values),scale=(value:number)=>top+plotHeight-(value-low)/(high-low)*plotHeight,zero=scale(0);
 const qualityHigh=Math.max(1,...days.map(day=>Number(day.averageAtr)||0)),qualityScale=(value:number)=>top+plotHeight-value/qualityHigh*plotHeight;
 const x=(index:number)=>left+slot*(index+.5),font=Math.max(8,Math.min(12,slot/6));
 const atrKnown=(day:Day)=>day.loadCount>0&&day.averageAtr!=='';
 const path=days.map((day,index)=>atrKnown(day)?`${index>0&&atrKnown(days[index-1])?'L':'M'} ${x(index)} ${qualityScale(Number(day.averageAtr))}`:'').join(' ');
 const financialLabel=(day:Day,key:'grossAmount'|'netAmount')=>!visible?'•••':day.billingPending?'A apurar':compact(Number(day[key]));
 return <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={financial?'Bruto e líquido por dia, em reais':'Volume diário em toneladas e ATR em kg/t, com escalas independentes'} data-weekly-days={days.length}>
  <text x={left-6} y={12} textAnchor="end" className="dashboard-weekly-axis">{financial?'R$':'t'}</text>{!financial&&<text x={width-right+7} y={12} className="dashboard-weekly-axis">kg/t</text>}
  {[0,.5,1].map(fraction=>{const value=low+(high-low)*fraction;return <g key={fraction}><line x1={left} x2={width-right} y1={scale(value)} y2={scale(value)} stroke="#e2ebe5" strokeDasharray="3 5"/><text x={left-6} y={scale(value)+3} textAnchor="end" className="dashboard-weekly-axis">{financial&&!visible?'•••':compact(value)}</text>{!financial&&<text x={width-right+7} y={top+plotHeight-plotHeight*fraction+3} className="dashboard-weekly-axis">{compact(qualityHigh*fraction)}</text>}</g>;})}
  {days.map((day,index)=>{const isToday=day.date===today,center=x(index),label=`${day.date}${isToday?', hoje parcial':''}: ${day.loadCount} cargas, ${decimalLabel(day.loadedVolume)} t; ATR ${atrText(day)}${financial?`; bruto ${money(day.grossAmount)}; líquido ${money(day.netAmount)}`:''}`;
   return <g key={day.date}><title>{label}</title>{isToday&&<rect x={center-slot/2+2} y={top-12} width={Math.max(0,slot-4)} height={plotHeight+15} rx={5} fill="#eef5f0"/>}
    {financial?day.billingPending?<text x={center} y={top-9} textAnchor="middle" fontSize={font-1} fill="#946321">{visible?'A apurar':'•••'}</text>:(['grossAmount','netAmount'] as const).map((key,series)=>{const value=Number(day[key]),y=scale(value);return <g key={key}><rect x={center+(series?1:-1)*barWidth*.6-barWidth/2} y={Math.min(y,zero)} width={barWidth} height={Math.abs(zero-y)} rx={3} fill={series?'#23805b':'#aecfbc'}/><text x={center} y={top-22+series*13} textAnchor="middle" fontSize={font} fill={series?'#176344':'#536e5d'}>{series?'L ':'B '}{financialLabel(day,key)}</text></g>;}):<><rect x={center-barWidth/2} y={scale(Number(day.loadedVolume))} width={barWidth} height={Math.max(0,zero-scale(Number(day.loadedVolume)))} rx={4} fill="#23805b"/><text x={center} y={Math.max(17,scale(Number(day.loadedVolume))-7)} textAnchor="middle" fontSize={font} fill="#176344">{compact(Number(day.loadedVolume))}</text></>}
    <text x={center} y={height-(small?17:27)} textAnchor="middle" fontSize={font} fill="#425f4e">{weeklyDate(day.date)}</text><text x={center} y={height-4} textAnchor="middle" fontSize={Math.min(10,font)} fill={isToday?'#176344':'#6d7f73'}>{isToday?'Hoje':financial?'':`ATR ${width<450?decimalLabel(day.averageAtr,0):atrText(day)}`}</text>
   </g>;
  })}
  {!financial&&<><path d={path} fill="none" stroke="#b87a28" strokeWidth={2.5} strokeDasharray="5 4"/>{days.map((day,index)=>atrKnown(day)&&<circle key={day.date} cx={x(index)} cy={qualityScale(Number(day.averageAtr))} r={3.5} fill="#fff" stroke="#b87a28" strokeWidth={2}/>)}</>}
  {(!financial||visible)&&days.map((day,index)=>{
   const previous=days[index-1],change=financial?day.grossChangePercent:day.volumeChangePercent;
   if(!previous||!day.previousProductionDate||change===undefined||change===''||financial&&(day.billingPending||previous.billingPending))return null;
   const currentY=scale(Number(financial?day.grossAmount:day.loadedVolume)),previousY=scale(Number(financial?previous.grossAmount:previous.loadedVolume));
   const center=(x(index-1)+x(index))/2,label=slot<65?`${Number(change)>0?'+':''}${decimalLabel(change,0)}%`:delta(change),labelWidth=Math.max(40,label.length*(font-1)*.62+12);
   const labelY=Math.min(zero-12,Math.max(top+14,(currentY+previousY)/2+(slot<65?(index%2?14:-14):0)));
   const description=`Variação do ${financial?'bruto':'volume'} de ${weeklyDate(day.previousProductionDate)} para ${weeklyDate(day.date)}: ${delta(change)}`;
   return <g key={day.date} data-weekly-change={financial?'gross':'volume'} role="img" aria-label={description}><title>{description}</title><line x1={x(index-1)+barWidth*.6+3} y1={previousY} x2={x(index)-barWidth*.6-3} y2={currentY} stroke="#5377ac" strokeWidth={1.8} strokeDasharray="3 4"/><rect x={center-labelWidth/2} y={labelY-font/2-5} width={labelWidth} height={font+10} rx={4} fill="#fff" stroke="#dce7e0"/><text x={center} y={labelY+3} textAnchor="middle" fontSize={font-1} fontWeight={650} fill={Number(change)<0?'#b43b36':Number(change)>0?'#176344':'#546b5c'}>{label}</text></g>;
  })}
 </svg>;
}
