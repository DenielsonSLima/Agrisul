'use client';

import {useId,useMemo} from 'react';
import {Bar,CartesianGrid,ComposedChart,LabelList,Line,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {BarChart3,CalendarRange,Gauge,Loader2,RefreshCw,Truck,Weight} from 'lucide-react';
import {useContractLoads} from '../../hooks/useContractLoads';
import type {ContractLoadFilters} from '../../types';
import {formatAtr,formatContractDate,formatContractVolume} from '../../utils/contractFormat';
import {contractDailyLoadPeriodError,contractDailyLoadsChartRows,defaultContractDailyLoadPeriod,type ContractDailyLoadPeriod,type ContractDailyLoadsChartRow,type ContractDailyLoadsData} from '../../utils/contractDailyLoadsPresentation';
import './contract-daily-loads-chart.css';

const compactVolume=(value:number)=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(value);
const barValue=(value:unknown)=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(Number(value));
const atrAxisLabel=(value:unknown)=>`${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(Number(value))} kg/t`;
const atrPointLabel=(value:unknown)=>value===null||value===undefined?'':new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:2}).format(Number(value));
const shortDate=(date:string)=>{const [,month,day]=date.split('-');return `${day}/${month}`;};

export function ContractDailyLoadsChart({contractId,period,onPeriod}:{contractId:string;period:ContractDailyLoadPeriod;onPeriod:(period:ContractDailyLoadPeriod)=>void}){
 const titleId=useId(),descriptionId=useId();
 const {from,to}=period;
 const periodError=contractDailyLoadPeriodError({from,to});
 const filters:ContractLoadFilters={search:'',from,to,groupBy:'day'};
 const query=useContractLoads(contractId,filters,!periodError);
 const data=query.data as ContractDailyLoadsData|undefined;
 const rows=useMemo(()=>data?contractDailyLoadsChartRows(data):[],[data]);
 const resetPeriod=()=>onPeriod(defaultContractDailyLoadPeriod());

 return <section className="contract-daily-loads" aria-labelledby={titleId} aria-busy={query.loading}>
  <header className="contract-daily-loads-heading">
   <div><span><BarChart3 size={14}/>EVOLUÇÃO DOS CARREGAMENTOS</span><h4 id={titleId}>Quantidade carregada por dia</h4><p>Barras em toneladas e linha do ATR médio medido em cada dia com carregamento.</p></div>
   <div className="contract-daily-loads-legend" aria-hidden="true"><i/><span>Quantidade diária</span><b/><span>ATR médio diário</span></div>
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
      <div className="contract-daily-loads-chart" style={{minWidth:`${Math.max(640,rows.length*72)}px`}} role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
       <ResponsiveContainer width="100%" height="100%" minWidth={0}><ComposedChart data={rows} margin={{top:42,right:0,left:0,bottom:4}}>
       <CartesianGrid vertical={false} stroke="#e7eee9" strokeDasharray="4 5"/>
        <XAxis dataKey="date" tickFormatter={shortDate} interval={0} axisLine={false} tickLine={false} tick={{fontSize:11,fill:'#34443a',fontWeight:550}} tickMargin={10}/>
       <YAxis yAxisId="volume" tickFormatter={compactVolume} axisLine={false} tickLine={false} tick={{fontSize:11,fill:'#43534a',fontWeight:550}} width={48}/>
       <YAxis yAxisId="atr" orientation="right" domain={['auto','auto']} tickFormatter={atrAxisLabel} axisLine={false} tickLine={false} tick={{fontSize:10,fill:'#a65305',fontWeight:600}} width={76}/>
        <Tooltip content={({active,payload})=><DailyLoadsTooltip active={active} row={payload?.[0]?.payload as ContractDailyLoadsChartRow|undefined}/>}/>
       <Bar yAxisId="volume" dataKey="volume" name="Quantidade diária" fill="#54a873" radius={[6,6,0,0]} maxBarSize={38} isAnimationActive={false}><LabelList dataKey="volume" position="top" formatter={barValue} fill="#24352b" fontSize={11} fontWeight={600}/></Bar>
        <Line yAxisId="atr" type="linear" dataKey="averageAtr" name="ATR médio diário" connectNulls={false} stroke="#d97706" strokeOpacity={.52} strokeWidth={2.5} strokeDasharray="6 5" dot={{r:3.5,fill:'#fff',stroke:'#d97706',strokeWidth:2}} activeDot={{r:5,fill:'#fff',stroke:'#d97706',strokeWidth:2.5}} isAnimationActive={false}><LabelList dataKey="averageAtr" position="top" formatter={atrPointLabel} fill="#914700" fontSize={10} fontWeight={700}/></Line>
      </ComposedChart></ResponsiveContainer>
     </div>
    </div>
     <p className="sr-only" id={descriptionId}>{rows.map(row=>`${formatContractDate(row.date)}: ${formatContractVolume(row.volumeText)}, ATR médio de ${formatAtr(row.averageAtrText)} quilogramas por tonelada`).join('. ')}</p>
    <DailyLoadsSummary data={data}/>
   </>}
 </section>;
}

function DailyLoadsTooltip({active,row}:{active?:boolean;row?:ContractDailyLoadsChartRow}){
 if(!active||!row)return null;
 return <div className="contract-daily-loads-tooltip"><strong>{formatContractDate(row.date)}</strong><span>Quantidade <b>{formatContractVolume(row.volumeText)}</b></span><span>ATR médio do dia <b className="is-atr">{formatAtr(row.averageAtrText)} kg/t</b></span></div>;
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
