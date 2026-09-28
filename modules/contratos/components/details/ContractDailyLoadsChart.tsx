'use client';

import {useId,useMemo} from 'react';
import {Bar,CartesianGrid,ComposedChart,LabelList,Line,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {BarChart3,CalendarRange,Gauge,Loader2,RefreshCw,Truck,Weight} from 'lucide-react';
import {useContractLoads} from '../../hooks/useContractLoads';
import type {ContractLoadFilters} from '../../types';
import {formatAtr,formatContractDate,formatContractVolume} from '../../utils/contractFormat';
import {contractDailyLoadPeriodError,contractDailyLoadsChartRows,contractDailyLoadsChartSlots,defaultContractDailyLoadPeriod,type ContractDailyLoadPeriod,type ContractDailyLoadsChartSlot,type ContractDailyLoadsData} from '../../utils/contractDailyLoadsPresentation';
import './contract-daily-loads-chart.css';

const compactVolume=(value:number)=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(value);
const barValue=(value:unknown)=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(Number(value));
const percentageLabel=(value:unknown)=>value===null||value===undefined?'':`${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1,signDisplay:'always'}).format(Number(value))}%`;
const shortDate=(date:string)=>{const [,month,day]=date.split('-');return `${day}/${month}`;};

export function ContractDailyLoadsChart({contractId,period,onPeriod}:{contractId:string;period:ContractDailyLoadPeriod;onPeriod:(period:ContractDailyLoadPeriod)=>void}){
 const titleId=useId(),descriptionId=useId();
 const {from,to}=period;
 const periodError=contractDailyLoadPeriodError({from,to});
 const filters:ContractLoadFilters={search:'',from,to,groupBy:'day'};
 const query=useContractLoads(contractId,filters,!periodError);
 const data=query.data as ContractDailyLoadsData|undefined;
 const rows=useMemo(()=>data?contractDailyLoadsChartRows(data):[],[data]);
 const slots=useMemo(()=>data?contractDailyLoadsChartSlots(data):[],[data]);
 const axisLabels=useMemo(()=>new Map(slots.filter((slot):slot is Extract<ContractDailyLoadsChartSlot,{kind:'day'}>=>slot.kind==='day').map(slot=>[slot.slotKey,shortDate(slot.date)])),[slots]);
 const resetPeriod=()=>onPeriod(defaultContractDailyLoadPeriod());

 return <section className="contract-daily-loads" aria-labelledby={titleId} aria-busy={query.loading}>
  <header className="contract-daily-loads-heading">
   <div><span><BarChart3 size={14}/>EVOLUÇÃO DOS CARREGAMENTOS</span><h4 id={titleId}>Quantidade carregada por dia</h4><p>Barras em toneladas; os marcadores entre os dias mostram a variação percentual com base na carga anterior.</p></div>
   <div className="contract-daily-loads-legend" aria-hidden="true"><i/><span>Quantidade diária</span><b/><span>Variação percentual</span></div>
  </header>
  <div className="contract-daily-loads-filters" aria-label="Período do gráfico diário">
   <label><span>Data inicial</span><input type="date" min="1900-01-01" max="9999-12-31" value={from} aria-invalid={!!periodError} onChange={event=>onPeriod({...period,from:event.target.value})}/></label>
   <label><span>Data final</span><input type="date" min="1900-01-01" max="9999-12-31" value={to} aria-invalid={!!periodError} onChange={event=>onPeriod({...period,to:event.target.value})}/></label>
   <button className="btn" type="button" onClick={resetPeriod}><CalendarRange size={15}/>Últimos 6 meses</button>
  </div>
  {periodError?<div className="contract-daily-loads-state is-error" role="alert"><CalendarRange/><strong>Confira o período</strong><p>{periodError}</p></div>:
   query.loading?<div className="contract-daily-loads-state" role="status"><Loader2 className="animate-spin"/><strong>Carregando evolução diária…</strong></div>:
   query.error?<div className="contract-daily-loads-state is-error" role="alert"><RefreshCw/><strong>Não foi possível carregar o gráfico</strong><p>{query.error}</p><button className="btn" type="button" onClick={()=>void query.reload()}>Tentar novamente</button></div>:
   !data||!rows.length?<div className="contract-daily-loads-state"><Truck/><strong>Nenhum carregamento no período</strong><p>Altere as datas ou registre um carregamento para visualizar a evolução diária.</p></div>:
   <>
    <div className="contract-daily-loads-chart-scroll" tabIndex={0} role="region" aria-label="Gráfico diário; deslize horizontalmente para consultar todos os dias">
      <div className="contract-daily-loads-chart" style={{minWidth:`${Math.max(640,slots.length*36)}px`}} role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
       <ResponsiveContainer width="100%" height="100%" minWidth={0}><ComposedChart data={slots} margin={{top:42,right:0,left:0,bottom:4}}>
       <CartesianGrid vertical={false} stroke="#e7eee9" strokeDasharray="4 5"/>
        <XAxis dataKey="slotKey" tickFormatter={value=>axisLabels.get(String(value))??''} interval={0} axisLine={false} tickLine={false} tick={{fontSize:11,fill:'#34443a',fontWeight:550}} tickMargin={10}/>
       <YAxis yAxisId="volume" tickFormatter={compactVolume} axisLine={false} tickLine={false} tick={{fontSize:11,fill:'#43534a',fontWeight:550}} width={48}/>
       <YAxis yAxisId="variation" orientation="right" domain={['auto','auto']} tickFormatter={percentageLabel} axisLine={false} tickLine={false} tick={{fontSize:11,fill:'#a65305',fontWeight:600}} width={58}/>
        <Tooltip content={({active,payload})=><DailyLoadsTooltip active={active} slot={payload?.[0]?.payload as ContractDailyLoadsChartSlot|undefined}/>}/>
       <Bar yAxisId="volume" dataKey="volume" name="Quantidade diária" fill="#54a873" radius={[6,6,0,0]} maxBarSize={38} isAnimationActive={false}><LabelList dataKey="volume" position="top" formatter={barValue} fill="#24352b" fontSize={11} fontWeight={600}/></Bar>
        <Line yAxisId="variation" type="linear" dataKey="linePercent" name="Variação percentual" connectNulls stroke="#d97706" strokeOpacity={.52} strokeWidth={2.5} dot={<VariationDot/>} activeDot={<VariationDot active/>} isAnimationActive={false}><LabelList dataKey="variationLabel" content={<VariationValueLabel/>}/></Line>
      </ComposedChart></ResponsiveContainer>
     </div>
    </div>
     <p className="sr-only" id={descriptionId}>{slots.map(slot=>slot.kind==='day'?`${formatContractDate(slot.date)}: ${formatContractVolume(slot.volumeText)}, ATR médio de ${formatAtr(slot.averageAtrText)} quilogramas por tonelada${slot.isVariationBase?', início da linha de variação em 0%':''}`:`Entre ${formatContractDate(slot.fromDate)} e ${formatContractDate(slot.toDate)}: variação de ${percentageLabel(slot.variationPercent)}, partindo de ${formatContractVolume(slot.baseVolumeText)} para ${formatContractVolume(slot.currentVolumeText)}`).join('. ')}</p>
    <DailyLoadsSummary data={data}/>
   </>}
 </section>;
}

function VariationDot({cx,cy,payload,active=false}:{cx?:number;cy?:number;payload?:ContractDailyLoadsChartSlot;active?:boolean}){
 if(payload?.kind!=='variation'||cx===undefined||cy===undefined)return null;
 return <circle cx={cx} cy={cy} r={active?5:3} fill="#d97706" fillOpacity={active?.7:.52} stroke="#fff" strokeWidth={2}/>;
}

function VariationValueLabel({x,y,value}:{x?:number|string;y?:number|string;value?:number|string}){
 const number=Number(value),cx=Number(x),cy=Number(y);
 if(value===null||value===undefined||!Number.isFinite(number)||!Number.isFinite(cx)||!Number.isFinite(cy))return null;
 const label=percentageLabel(number),width=Math.max(34,label.length*5.7+11);
 return <g transform={`translate(${cx-width/2} ${cy-23})`} pointerEvents="none"><rect width={width} height={17} rx={8.5} fill="#fff8ed" fillOpacity={.94} stroke="#d97706" strokeOpacity={.38}/><text x={width/2} y={8.8} dominantBaseline="middle" textAnchor="middle" fill="#914700" fontSize={11} fontWeight={700}>{label}</text></g>;
}

function DailyLoadsTooltip({active,slot}:{active?:boolean;slot?:ContractDailyLoadsChartSlot}){
 if(!active||!slot)return null;
 if(slot.kind==='variation')return <div className="contract-daily-loads-tooltip"><strong>{formatContractDate(slot.fromDate)} → {formatContractDate(slot.toDate)}</strong><span>Base <b>{formatContractVolume(slot.baseVolumeText)}</b></span><span>Dia seguinte <b>{formatContractVolume(slot.currentVolumeText)}</b></span><span>Variação <b className="is-variation">{percentageLabel(slot.variationPercent)}</b></span></div>;
 return <div className="contract-daily-loads-tooltip"><strong>{formatContractDate(slot.date)}</strong><span>Quantidade <b>{formatContractVolume(slot.volumeText)}</b></span><span>ATR médio do dia <b>{formatAtr(slot.averageAtrText)} kg/t</b></span>{slot.isVariationBase&&<span>Base da linha <b className="is-variation">0%</b></span>}</div>;
}

function DailyLoadsSummary({data}:{data:ContractDailyLoadsData}){
 const {summary}=data;
 const metrics=[
  {label:'Média diária geral',value:formatContractVolume(summary.averageDailyVolume),hint:`${summary.activeDayCount} ${summary.activeDayCount===1?'dia com carga':'dias com carga'}`,icon:<BarChart3/>},
  {label:'Volume total do período',value:formatContractVolume(summary.volume),hint:'Toneladas carregadas',icon:<Weight/>},
  {label:'ATR médio do período',value:`${formatAtr(summary.averageAtr)} kg/t`,hint:'Ponderado pela seleção atual',icon:<Gauge/>},
  {label:'Meses movimentados',value:String(summary.monthCount),hint:'No período selecionado',icon:<CalendarRange/>},
 ];
 return <div className="contract-daily-loads-summary"><dl className="contract-daily-loads-kpis">{metrics.map(metric=><div key={metric.label}><span aria-hidden="true">{metric.icon}</span><dt>{metric.label}</dt><dd>{metric.value}</dd><small>{metric.hint}</small></div>)}</dl></div>;
}
