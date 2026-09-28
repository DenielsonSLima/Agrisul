'use client';

import {useId,useMemo,useState} from 'react';
import {Bar,CartesianGrid,ComposedChart,LabelList,Line,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {BarChart3,CalendarRange,Loader2,RefreshCw,Truck,Weight} from 'lucide-react';
import {useContractLoads} from '../../hooks/useContractLoads';
import type {ContractLoadFilters} from '../../types';
import {formatContractDate,formatContractMonth,formatContractVolume} from '../../utils/contractFormat';
import {contractDailyLoadPeriodError,contractDailyLoadsChartRows,defaultContractDailyLoadPeriod,type ContractDailyLoadsData} from '../../utils/contractDailyLoadsPresentation';
import './contract-daily-loads-chart.css';

const compactVolume=(value:number)=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(value);
const barValue=(value:unknown)=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(Number(value));
const shortDate=(date:string)=>{const [,month,day]=date.split('-');return `${day}/${month}`;};

export function ContractDailyLoadsChart({contractId}:{contractId:string}){
 const titleId=useId(),descriptionId=useId();
 const initialPeriod=useMemo(()=>defaultContractDailyLoadPeriod(),[]);
 const [from,setFrom]=useState(initialPeriod.from),[to,setTo]=useState(initialPeriod.to);
 const periodError=contractDailyLoadPeriodError({from,to});
 // The RPC contract accepts the dedicated daily grouping. The double assertion
 // keeps this component deployable while the shared union rolls out with it.
 const filters={search:'',from,to,groupBy:'day'} as unknown as ContractLoadFilters;
 const query=useContractLoads(contractId,filters,!periodError);
 const data=query.data as ContractDailyLoadsData|undefined;
 const rows=data?contractDailyLoadsChartRows(data):[];
 const resetPeriod=()=>{const period=defaultContractDailyLoadPeriod();setFrom(period.from);setTo(period.to);};

 return <section className="contract-daily-loads" aria-labelledby={titleId} aria-busy={query.loading}>
  <header className="contract-daily-loads-heading">
   <div><span><BarChart3 size={14}/>EVOLUÇÃO DOS CARREGAMENTOS</span><h4 id={titleId}>Quantidade carregada por dia</h4><p>Barras em toneladas e linha de variação nos dias em que houve carregamento.</p></div>
   <div className="contract-daily-loads-legend" aria-hidden="true"><i/><span>Quantidade diária</span><b/><span>Variação</span></div>
  </header>
  <div className="contract-daily-loads-filters" aria-label="Período do gráfico diário">
   <label><span>Data inicial</span><input type="date" min="1900-01-01" max="9999-12-31" value={from} aria-invalid={!!periodError} onChange={event=>setFrom(event.target.value)}/></label>
   <label><span>Data final</span><input type="date" min="1900-01-01" max="9999-12-31" value={to} aria-invalid={!!periodError} onChange={event=>setTo(event.target.value)}/></label>
   <button className="btn" type="button" onClick={resetPeriod}><CalendarRange size={15}/>Últimos 30 dias</button>
  </div>
  {periodError?<div className="contract-daily-loads-state is-error" role="alert"><CalendarRange/><strong>Confira o período</strong><p>{periodError}</p></div>:
   query.loading?<div className="contract-daily-loads-state" role="status"><Loader2 className="animate-spin"/><strong>Carregando evolução diária…</strong></div>:
   query.error?<div className="contract-daily-loads-state is-error" role="alert"><RefreshCw/><strong>Não foi possível carregar o gráfico</strong><p>{query.error}</p><button className="btn" type="button" onClick={()=>void query.reload()}>Tentar novamente</button></div>:
   !data||!rows.length?<div className="contract-daily-loads-state"><Truck/><strong>Nenhum carregamento no período</strong><p>Altere as datas ou registre um carregamento para visualizar a evolução diária.</p></div>:
   <>
    <div className="contract-daily-loads-chart-scroll" tabIndex={0} role="region" aria-label="Gráfico diário; deslize horizontalmente para consultar todos os dias">
     <div className="contract-daily-loads-chart" style={{minWidth:`${Math.max(640,rows.length*72)}px`}} role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}><ComposedChart data={rows} margin={{top:32,right:16,left:0,bottom:4}}>
       <CartesianGrid vertical={false} stroke="#e7eee9" strokeDasharray="4 5"/>
       <XAxis dataKey="date" tickFormatter={shortDate} axisLine={false} tickLine={false} tick={{fontSize:10,fill:'#788b7e'}} tickMargin={10}/>
       <YAxis tickFormatter={compactVolume} axisLine={false} tickLine={false} tick={{fontSize:10,fill:'#8a9990'}} width={48}/>
       <Tooltip content={({active,payload})=><DailyLoadsTooltip active={active} row={payload?.[0]?.payload as DailyChartRow|undefined}/>}/>
       <Bar dataKey="volume" name="Quantidade diária" fill="#54a873" radius={[6,6,0,0]} maxBarSize={38} isAnimationActive={false}><LabelList dataKey="volume" position="top" formatter={barValue} fill="#526b5a" fontSize={9}/></Bar>
       <Line type="linear" dataKey="volume" name="Variação" stroke="#285f7b" strokeWidth={2.5} dot={{r:3,fill:'#285f7b',stroke:'#fff',strokeWidth:2}} activeDot={{r:5}} isAnimationActive={false}/>
      </ComposedChart></ResponsiveContainer>
     </div>
    </div>
    <p className="sr-only" id={descriptionId}>{rows.map(row=>`${formatContractDate(row.date)}: ${formatContractVolume(row.volumeText)}, ${row.loadCount} ${row.loadCount===1?'carregamento':'carregamentos'}`).join('. ')}</p>
    <DailyLoadsSummary data={data}/>
   </>}
 </section>;
}

type DailyChartRow=ReturnType<typeof contractDailyLoadsChartRows>[number];
function DailyLoadsTooltip({active,row}:{active?:boolean;row?:DailyChartRow}){
 if(!active||!row)return null;
 return <div className="contract-daily-loads-tooltip"><strong>{formatContractDate(row.date)}</strong><span>Quantidade <b>{formatContractVolume(row.volumeText)}</b></span><span>Carregamentos <b>{row.loadCount}</b></span></div>;
}

function DailyLoadsSummary({data}:{data:ContractDailyLoadsData}){
 const {summary}=data;
 const metrics=[
  {label:'Média diária geral',value:formatContractVolume(summary.averageDailyVolume),hint:`${summary.activeDayCount} ${summary.activeDayCount===1?'dia com carga':'dias com carga'}`,icon:<BarChart3/>},
  {label:'Volume total do período',value:formatContractVolume(summary.volume),hint:'Toneladas carregadas',icon:<Weight/>},
  {label:'Carregamentos',value:String(summary.loadCount),hint:'Registros no período',icon:<Truck/>},
  {label:'Meses movimentados',value:String(summary.monthCount),hint:'No período selecionado',icon:<CalendarRange/>},
 ];
 return <div className="contract-daily-loads-summary">
  <dl className="contract-daily-loads-kpis">{metrics.map(metric=><div key={metric.label}><span aria-hidden="true">{metric.icon}</span><dt>{metric.label}</dt><dd>{metric.value}</dd><small>{metric.hint}</small></div>)}</dl>
  {!!data.monthlyVolumes.length&&<section className="contract-daily-loads-months" aria-label="Volume mensal dentro do período selecionado"><header><div><h5>Volume total por mês</h5><p>Distribuição dos carregamentos do período selecionado.</p></div></header><div tabIndex={0} role="region" aria-label="Totais mensais; deslize horizontalmente para consultar todos os meses"><dl>{[...data.monthlyVolumes].sort((a,b)=>a.month.localeCompare(b.month)).map(month=><div key={month.month}><dt>{formatContractMonth(month.month)}</dt><dd>{formatContractVolume(month.volume)}</dd><small>{month.loadCount} {month.loadCount===1?'carregamento':'carregamentos'}</small></div>)}</dl></div></section>}
 </div>;
}
