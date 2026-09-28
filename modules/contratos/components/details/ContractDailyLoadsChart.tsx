'use client';

import {useId,useMemo} from 'react';
import {Bar,CartesianGrid,ComposedChart,LabelList,Line,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {BarChart3,CalendarRange,Gauge,Loader2,RefreshCw,Truck,Weight} from 'lucide-react';
import {formatAtr,formatContractDate,formatContractVolume} from '../../utils/contractFormat';
import {contractDailyLoadGranularities,contractDailyLoadGranularityCopy,contractDailyLoadPeriodError,contractDailyLoadsChartRows,defaultContractDailyLoadPeriod,type ContractDailyLoadGranularity,type ContractDailyLoadPeriod,type ContractDailyLoadsChartRow,type ContractDailyLoadsData} from '../../utils/contractDailyLoadsPresentation';
import './contract-daily-loads-chart.css';

const compactVolume=(value:number)=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(value);
const barValue=(value:unknown)=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(Number(value));
const atrAxisLabel=(value:unknown)=>`${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(Number(value))} kg/t`;
const atrPointLabel=(value:unknown)=>`ATR ${formatAtr(String(value??''))} kg/t`;
const periodRange=(row:ContractDailyLoadsChartRow)=>row.date===row.endDate?formatContractDate(row.date):`${formatContractDate(row.date)} a ${formatContractDate(row.endDate)}`;
const slotWidth:Record<ContractDailyLoadGranularity,number>={day:102,week:116,fortnight:138,month:112};

type ContractDailyLoadsQuery={data?:ContractDailyLoadsData;loading:boolean;error:string;reload:()=>Promise<void>};

export function ContractDailyLoadsChart({period,onPeriod,query}:{period:ContractDailyLoadPeriod;onPeriod:(period:ContractDailyLoadPeriod)=>void;query:ContractDailyLoadsQuery}){
 const titleId=useId(),descriptionId=useId();
 const {from,to}=period,granularity=period.granularity??'day',copy=contractDailyLoadGranularityCopy[granularity];
 const periodError=contractDailyLoadPeriodError({from,to});
 const data=query.data as ContractDailyLoadsData|undefined;
 const rows=useMemo(()=>data?contractDailyLoadsChartRows(data,granularity):[],[data,granularity]);
 const resetPeriod=()=>onPeriod({...defaultContractDailyLoadPeriod(),granularity});

 return <section className="contract-daily-loads" aria-labelledby={titleId} aria-busy={query.loading}>
  <header className="contract-daily-loads-heading">
   <div><span><BarChart3 size={14}/>EVOLUÇÃO DOS CARREGAMENTOS</span><h4 id={titleId}>{copy.title}</h4><p>Barras em toneladas e linha pontilhada do ATR médio ponderado por {copy.noun}.</p></div>
   <div className="contract-daily-loads-legend" aria-hidden="true"><i/><span>{copy.quantity}</span><b/><span>{copy.atr}</span></div>
  </header>
  <div className="contract-daily-loads-filters" aria-label={`Período e visualização ${copy.option.toLocaleLowerCase('pt-BR')} do gráfico`}>
   <label><span>Data inicial</span><input type="date" min="1900-01-01" max="9999-12-31" value={from} aria-invalid={!!periodError} onChange={event=>onPeriod({...period,from:event.target.value})}/></label>
   <label><span>Data final</span><input type="date" min="1900-01-01" max="9999-12-31" value={to} aria-invalid={!!periodError} onChange={event=>onPeriod({...period,to:event.target.value})}/></label>
   <div className="contract-daily-loads-filter-actions">
    <button className="btn" type="button" onClick={resetPeriod}><CalendarRange size={15}/>Últimos 6 meses</button>
    <div className="contract-daily-loads-granularity" role="group" aria-label="Forma de visualizar">
     {contractDailyLoadGranularities.map(value=><button key={value} type="button" aria-pressed={granularity===value} onClick={()=>onPeriod({...period,granularity:value})}>{contractDailyLoadGranularityCopy[value].option}</button>)}
    </div>
   </div>
  </div>
  {periodError?<div className="contract-daily-loads-state is-error" role="alert"><CalendarRange/><strong>Confira o período</strong><p>{periodError}</p></div>:
   query.loading?<div className="contract-daily-loads-state" role="status"><Loader2 className="animate-spin"/><strong>Carregando evolução {copy.option.toLocaleLowerCase('pt-BR')}…</strong></div>:
   query.error?<div className="contract-daily-loads-state is-error" role="alert"><RefreshCw/><strong>Não foi possível carregar o gráfico</strong><p>{query.error}</p><button className="btn" type="button" onClick={()=>void query.reload()}>Tentar novamente</button></div>:
   !data||!rows.length?<div className="contract-daily-loads-state"><Truck/><strong>Nenhum carregamento no período</strong><p>Altere as datas ou registre um carregamento para visualizar a evolução {copy.option.toLocaleLowerCase('pt-BR')}.</p></div>:
   <>
    <div className="contract-daily-loads-chart-scroll" tabIndex={0} role="region" aria-label={`Gráfico ${copy.option.toLocaleLowerCase('pt-BR')}; deslize horizontalmente para consultar todos os períodos`}>
      <div className="contract-daily-loads-chart" style={{minWidth:`${Math.max(640,rows.length*slotWidth[granularity]+204)}px`}} role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
       <ResponsiveContainer width="100%" height="100%" minWidth={0}><ComposedChart data={rows} margin={{top:50,right:0,left:0,bottom:2}}>
       <CartesianGrid vertical={false} stroke="#e7eee9" strokeDasharray="4 5"/>
        <XAxis dataKey="key" interval={0} axisLine={false} tickLine={false} tick={<PeriodAxisTick rows={rows}/>} tickMargin={10} height={30} padding={{left:8,right:72}}/>
       <YAxis yAxisId="volume" tickFormatter={compactVolume} axisLine={false} tickLine={false} tick={{fontSize:11,fill:'#43534a',fontWeight:550}} width={48}/>
       <YAxis yAxisId="atr" orientation="right" domain={['auto','auto']} tickFormatter={atrAxisLabel} axisLine={false} tickLine={false} tick={{fontSize:10,fill:'#a65305',fontWeight:600}} width={76}/>
        <Tooltip content={({active,payload})=><DailyLoadsTooltip active={active} row={payload?.[0]?.payload as ContractDailyLoadsChartRow|undefined} granularity={granularity}/>}/>
       <Bar yAxisId="volume" dataKey="volume" name={copy.quantity} fill="#54a873" radius={[6,6,0,0]} maxBarSize={38} isAnimationActive={false}><LabelList dataKey="volume" position="top" formatter={barValue} fill="#24352b" fontSize={11} fontWeight={600}/></Bar>
        <Line yAxisId="atr" type="linear" dataKey="averageAtr" name={copy.atr} connectNulls={false} stroke="#d97706" strokeOpacity={.52} strokeWidth={2.5} strokeDasharray="6 5" dot={{r:3.5,fill:'#fff',stroke:'#d97706',strokeWidth:2}} activeDot={{r:5,fill:'#fff',stroke:'#d97706',strokeWidth:2.5}} isAnimationActive={false}>
         <LabelList dataKey="averageAtr" position="top" offset={10} dx={8} textAnchor="start" formatter={atrPointLabel} className="contract-daily-loads-line-atr" aria-hidden="true"/>
        </Line>
      </ComposedChart></ResponsiveContainer>
     </div>
    </div>
     <p className="sr-only" id={descriptionId}>{rows.map(row=>`${periodRange(row)}: ${formatContractVolume(row.volumeText)}, ATR médio de ${formatAtr(row.averageAtrText)} quilogramas por tonelada`).join('. ')}</p>
    <DailyLoadsSummary data={data} rows={rows} granularity={granularity}/>
   </>}
 </section>;
}

function PeriodAxisTick({x=0,y=0,payload,rows}:{x?:number;y?:number;payload?:{value?:string};rows:ContractDailyLoadsChartRow[]}){
 const row=rows.find(item=>item.key===payload?.value);
 if(!row)return <g/>;
 return <g transform={`translate(${x},${y})`}><text className="contract-daily-loads-axis-period" x="0" y="0" textAnchor="middle">{row.label}</text></g>;
}

function DailyLoadsTooltip({active,row,granularity}:{active?:boolean;row?:ContractDailyLoadsChartRow;granularity:ContractDailyLoadGranularity}){
 if(!active||!row)return null;
 const copy=contractDailyLoadGranularityCopy[granularity];
 return <div className="contract-daily-loads-tooltip"><strong>{periodRange(row)}</strong><span>Quantidade <b>{formatContractVolume(row.volumeText)}</b></span><span>Carregamentos <b>{row.loadCount}</b></span><span>{copy.atr} <b className="is-atr">{formatAtr(row.averageAtrText)} kg/t</b></span></div>;
}

function DailyLoadsSummary({data,rows,granularity}:{data:ContractDailyLoadsData;rows:ContractDailyLoadsChartRow[];granularity:ContractDailyLoadGranularity}){
 const {summary}=data,copy=contractDailyLoadGranularityCopy[granularity],averageVolume=rows.length?String(rows.reduce((total,row)=>total+row.volume,0)/rows.length):'0';
 const metrics=[
  {label:`Média ${copy.average} geral`,value:formatContractVolume(granularity==='day'?summary.averageDailyVolume:averageVolume),hint:`${rows.length} ${rows.length===1?copy.noun:copy.plural} com carga`,icon:<BarChart3/>},
  {label:'Volume total do período',value:formatContractVolume(summary.volume),hint:'Toneladas carregadas',icon:<Weight/>},
  {label:'ATR médio do período',value:`${formatAtr(summary.averageAtr)} kg/t`,hint:'Ponderado pela seleção atual',icon:<Gauge/>},
  {label:'Meses movimentados',value:String(summary.monthCount),hint:'No período selecionado',icon:<CalendarRange/>},
 ];
 return <div className="contract-daily-loads-summary"><dl className="contract-daily-loads-kpis">{metrics.map(metric=><div key={metric.label}><span aria-hidden="true">{metric.icon}</span><dt>{metric.label}</dt><dd>{metric.value}</dd><small>{metric.hint}</small></div>)}</dl></div>;
}
