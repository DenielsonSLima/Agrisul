import {useMemo} from 'react';
import {Bar,CartesianGrid,ComposedChart,Legend,ResponsiveContainer,Tooltip,XAxis,YAxis,type BarShapeProps} from 'recharts';
import type {ContractLoadsData} from '../../types';
import {contractDailyLoadGranularityCopy,contractLoadFinancialChartRows,type ContractDailyLoadPeriod,type ContractLoadFinancialChartRow} from '../../utils/contractDailyLoadsPresentation';
import {formatContractBilling,formatContractVolume} from '../../utils/contractFormat';
import './contract-monthly-overview.css';

type Props={data?:ContractLoadsData;period:ContractDailyLoadPeriod;loading?:boolean;error?:string};
type MonthTickProps={x?:number;y?:number;payload?:{value:string}};
type FinancialChartRow=ContractLoadFinancialChartRow&{axis:string;grossPlot:number};
type FinancialTooltipProps={active?:boolean;payload?:Array<{payload?:FinancialChartRow}>};

const fullMoney=(value:number)=>formatContractBilling(String(value));

function MonthTick({x=0,y=0,payload}:MonthTickProps){
 const [periodLabel,volume='']=String(payload?.value??'').split('|');
 return <g transform={`translate(${x},${y})`}><text textAnchor="middle" fill="#26372d" fontSize="11" fontWeight="600"><tspan x="0" dy="14">{periodLabel}</tspan><tspan x="0" dy="14" fill="#4e5e54" fontSize="11" fontWeight="500">{volume}</tspan></text></g>;
}

function CompositeMoneyBar({x,y,width,height,payload}:BarShapeProps){
 const row=payload as FinancialChartRow,gross=row.gross??0,hasNet=row.net!==null,net=row.net??0;
 if(width<=0||height<=0)return <g/>;
 if(row.gross===null||gross<=0){
  const pending=row.gross===null,label=pending?'Pendente':fullMoney(gross),baseline=y+height;
  return <g className={`contract-monthly-empty-bar${pending?' is-pending':''}`}>
   <rect x={x} y={baseline-Math.min(7,height)} width={width} height={Math.min(7,height)} rx={3}/>
   <text x={x+width/2} y={baseline-10} textAnchor="middle">{label}</text>
  </g>;
 }
 const safeNet=Math.max(0,Math.min(net,gross)),inset=Math.min(6,width*.08),availableHeight=Math.max(0,height-inset*2),proportionalNetHeight=availableHeight*(safeNet/gross),netHeight=safeNet>0?Math.max(5,proportionalNetHeight):0,netY=y+height-inset-netHeight;
 const labelInsideNet=netHeight>=34&&width>=74,labelY=labelInsideNet?netY+netHeight/2+3:Math.max(y+14,netY-7);
 return <g className="contract-monthly-composite-bar">
  <rect className="contract-monthly-gross-bar" x={x} y={y} width={width} height={height} rx={7}/>
  {safeNet>0&&<rect className="contract-monthly-net-bar" x={x+inset} y={netY} width={Math.max(0,width-inset*2)} height={netHeight} rx={4}/>}
  <text className="contract-monthly-gross-label" x={x+width/2} y={y-10} textAnchor="middle">{fullMoney(gross)}</text>
  {hasNet&&<text className={`contract-monthly-net-label${labelInsideNet?' is-inside':''}`} x={x+width/2} y={labelY} textAnchor="middle">{fullMoney(net)}</text>}
 </g>;
}

function FinancialLegend(){
 return <div className="contract-monthly-legend" aria-hidden="true">
  <span><i className="contract-monthly-legend-gross"/>Faturado bruto (barra total)</span>
  <span><i className="contract-monthly-legend-net"/>Líquido (preenchimento interno)</span>
 </div>;
}

function FinancialTooltip({active,payload}:FinancialTooltipProps){
 const row=payload?.[0]?.payload;
 if(!active||!row)return null;
 return <div className="contract-monthly-tooltip">
  <strong>{row.label}</strong>
  <span><em>Faturado bruto</em><b>{row.gross===null?'Pendente':formatContractBilling(String(row.gross))}</b></span>
  <span><em>Valor líquido</em><b>{row.net===null?'Pendente':formatContractBilling(String(row.net))}</b></span>
  <span><em>Quantidade entregue</em><b>{formatContractVolume(row.volumeText)}</b></span>
  {row.billingPending&&<small>Aguardando ATR ou cotação para concluir o faturamento.</small>}
 </div>;
}

export function ContractMonthlyCharts({data,period,loading=false,error=''}:Props){
 const granularity=period.granularity??'day',copy=contractDailyLoadGranularityCopy[granularity];
 const rows=useMemo<FinancialChartRow[]>(()=>{
  if(!data)return [];
  const financialRows=contractLoadFinancialChartRows(data,granularity),maxGross=Math.max(0,...financialRows.map(row=>row.gross??0)),emptyPlot=maxGross>0?maxGross*.045:.02;
  return financialRows.map(row=>({...row,axis:`${row.label}|${formatContractVolume(row.volumeText)}`,grossPlot:row.gross!==null&&row.gross>0?row.gross:emptyPlot}));
 },[data,granularity]);
 const chartMinWidth=Math.max(680,rows.length*180+150),hasPositiveGross=rows.some(row=>row.gross!==null&&row.gross>0);
 return <section className="contract-monthly-combined" role="region" aria-label={`Gráfico financeiro ${copy.option.toLocaleLowerCase('pt-BR')}; deslize horizontalmente para consultar todos os períodos`}>
   <header><h4>Entregas e faturamento por {copy.noun}</h4><span>Bruto na barra total e líquido preenchido dentro dela</span></header>
   {loading?<div className="contract-monthly-combined-empty" role="status">Carregando faturamento do período…</div>:error?<div className="contract-monthly-combined-empty" role="alert">{error}</div>:!rows.length?<div className="contract-monthly-combined-empty">Nenhuma movimentação no período selecionado.</div>:<div className="contract-monthly-combined-scroll" tabIndex={0}><div className="contract-monthly-combined-chart" style={{minWidth:chartMinWidth}} role="img" aria-label={`Resumo ${copy.option.toLocaleLowerCase('pt-BR')}: `+rows.map(item=>`${item.label}, ${formatContractVolume(item.volumeText)}, faturado ${item.gross===null?'pendente':formatContractBilling(String(item.gross))}, líquido ${item.net===null?'pendente':formatContractBilling(String(item.net))}`).join('; ')}>
    <ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} margin={{top:42,right:24,left:8,bottom:22}}>
     <CartesianGrid vertical={false} stroke="#e7eee9" strokeDasharray="4 5"/>
     <XAxis dataKey="axis" axisLine={false} tickLine={false} height={46} interval={0} tick={<MonthTick/>} padding={{left:24,right:24}}/>
     <YAxis yAxisId="money" domain={hasPositiveGross?[0,'auto']:[0,1]} ticks={hasPositiveGross?undefined:[0]} tickCount={5} tickFormatter={value=>fullMoney(Number(value))} axisLine={false} tickLine={false} width={124} tick={{fontSize:10,fill:'#26372d',fontWeight:600}}/>
     <Tooltip filterNull={false} cursor={{fill:'#edf6f0',fillOpacity:.65}} content={<FinancialTooltip/>}/>
     <Legend content={<FinancialLegend/>} wrapperStyle={{paddingTop:8}}/>
     <Bar yAxisId="money" dataKey="grossPlot" name="Faturado bruto" shape={CompositeMoneyBar} maxBarSize={112}/>
    </ComposedChart></ResponsiveContainer>
   </div></div>}
  </section>;
}
