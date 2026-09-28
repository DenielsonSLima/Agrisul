import {useMemo} from 'react';
import {Bar,CartesianGrid,ComposedChart,LabelList,Legend,Line,ResponsiveContainer,Tooltip,XAxis,YAxis,type BarShapeProps} from 'recharts';
import type {ContractLoadsData} from '../../types';
import {contractDailyLoadGranularityCopy,contractLoadFinancialChartRows,type ContractDailyLoadPeriod,type ContractLoadFinancialChartRow} from '../../utils/contractDailyLoadsPresentation';
import {formatAtr,formatContractBilling,formatContractVolume} from '../../utils/contractFormat';
import './contract-monthly-overview.css';

type Props={data?:ContractLoadsData;period:ContractDailyLoadPeriod;loading?:boolean;error?:string};
type MonthTickProps={x?:number;y?:number;payload?:{value:string}};
type FinancialChartRow=ContractLoadFinancialChartRow&{axis:string;atr:number|null};

const fullMoney=(value:number)=>formatContractBilling(String(value));

function MonthTick({x=0,y=0,payload}:MonthTickProps){
 const [month,volume='',atr='']=String(payload?.value??'').split('|');
 return <g transform={`translate(${x},${y})`}><text textAnchor="middle" fill="#26372d" fontSize="11" fontWeight="600"><tspan x="0" dy="11" fill="#98570f" fontSize="10" fontWeight="650">{atr}</tspan><tspan x="0" dy="14">{month}</tspan><tspan x="0" dy="14" fill="#4e5e54" fontSize="11" fontWeight="500">{volume}</tspan></text></g>;
}

function CompositeMoneyBar({x,y,width,height,payload}:BarShapeProps){
 const row=payload as FinancialChartRow,gross=row.gross??0,hasNet=row.net!==null,net=row.net??0;
 if(!gross||width<=0||height<=0)return <g/>;
 const safeNet=Math.max(0,Math.min(net,gross)),inset=Math.min(5,width*.08),availableHeight=Math.max(0,height-inset*2),netHeight=availableHeight*(safeNet/gross),netY=y+height-inset-netHeight;
 const labelInsideNet=netHeight>=25&&width>=64,labelY=labelInsideNet?netY+netHeight/2+3:Math.max(y+11,netY-5);
 return <g className="contract-monthly-composite-bar">
  <rect className="contract-monthly-gross-bar" x={x} y={y} width={width} height={height} rx={7}/>
  {safeNet>0&&<rect className="contract-monthly-net-bar" x={x+inset} y={netY} width={Math.max(0,width-inset*2)} height={netHeight} rx={4}/>}
  {hasNet&&<text className={`contract-monthly-net-label${labelInsideNet?' is-inside':''}`} x={x+width/2} y={labelY} textAnchor="middle">{fullMoney(safeNet)}</text>}
 </g>;
}

function FinancialLegend(){
 return <div className="contract-monthly-legend" aria-hidden="true">
  <span><i className="contract-monthly-legend-gross"/>Faturado bruto</span>
  <span><i className="contract-monthly-legend-net"/>Líquido</span>
  <span><i className="contract-monthly-legend-atr"/>ATR médio</span>
 </div>;
}

export function ContractMonthlyCharts({data,period,loading=false,error=''}:Props){
 const granularity=period.granularity??'day',copy=contractDailyLoadGranularityCopy[granularity];
 const rows=useMemo<FinancialChartRow[]>(()=>data?contractLoadFinancialChartRows(data,granularity).map(row=>({...row,axis:`${row.label}|${formatContractVolume(row.volumeText)}|ATR ${formatAtr(row.averageAtrText)} kg/t`,atr:row.averageAtr})):[],[data,granularity]);
 const chartMinWidth=Math.max(720,rows.length*140);
 return <section className="contract-monthly-combined" tabIndex={0} role="region" aria-label={`Gráfico financeiro ${copy.option.toLocaleLowerCase('pt-BR')}; deslize horizontalmente para consultar todos os períodos`}>
   <header><h4>Entregas e faturamento por {copy.noun}</h4><span>Barra composta: bruto total e líquido preenchido · Linha: ATR médio ponderado</span></header>
   {loading?<div className="contract-monthly-combined-empty" role="status">Carregando faturamento do período…</div>:error?<div className="contract-monthly-combined-empty" role="alert">{error}</div>:!rows.length?<div className="contract-monthly-combined-empty">Nenhuma movimentação no período selecionado.</div>:<div className="contract-monthly-combined-scroll" tabIndex={0}><div className="contract-monthly-combined-chart" style={{minWidth:chartMinWidth}} role="img" aria-label={`Resumo ${copy.option.toLocaleLowerCase('pt-BR')}: `+rows.map(item=>`${item.label}, ${formatContractVolume(item.volumeText)}, faturado ${item.gross===null?'pendente':formatContractBilling(String(item.gross))}, líquido ${item.net===null?'pendente':formatContractBilling(String(item.net))}, ATR ${item.atr===null?'indisponível':formatAtr(String(item.atr))}`).join('; ')}>
    <ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} margin={{top:34,right:18,left:8,bottom:22}}>
     <CartesianGrid vertical={false} stroke="#e7eee9" strokeDasharray="4 5"/>
     <XAxis dataKey="axis" axisLine={false} tickLine={false} height={58} interval={0} tick={<MonthTick/>}/>
     <YAxis yAxisId="money" tickFormatter={value=>fullMoney(Number(value))} axisLine={false} tickLine={false} width={108} tick={{fontSize:10,fill:'#26372d',fontWeight:600}}/>
     <YAxis yAxisId="atr" orientation="right" tickFormatter={value=>formatAtr(String(value))} axisLine={false} tickLine={false} width={56} tick={{fontSize:11,fill:'#98570f',fontWeight:600}}/>
     <YAxis yAxisId="volume" hide/>
     <Tooltip labelFormatter={(_,payload)=>payload?.[0]?.payload?.label??''} formatter={(value,name)=>name==='ATR médio'?[formatAtr(String(value)),'ATR médio (kg/t)']:name==='Quantidade entregue'?[formatContractVolume(String(value)),'Quantidade entregue']:[formatContractBilling(String(value)),String(name)]} contentStyle={{borderRadius:9,borderColor:'#d2ded6',fontSize:11,color:'#17251d'}} itemStyle={{color:'#26372d',fontWeight:550}} labelStyle={{color:'#17251d',fontWeight:700}}/>
     <Legend content={<FinancialLegend/>} wrapperStyle={{paddingTop:8}}/>
     <Bar yAxisId="money" dataKey="gross" name="Faturado bruto" shape={CompositeMoneyBar} maxBarSize={104}><LabelList dataKey="gross" position="top" formatter={(value:unknown)=>fullMoney(Number(value))} fill="#17291f" fontSize={10} fontWeight={700}/></Bar>
     <Line yAxisId="money" dataKey="net" name="Líquido" stroke="transparent" dot={false} activeDot={false} legendType="none" connectNulls={false}/>
     <Line yAxisId="atr" type="linear" dataKey="atr" name="ATR médio" stroke="#d97706" strokeOpacity={.52} strokeWidth={2.5} strokeDasharray="6 5" dot={{r:3,fill:'#fff',stroke:'#d97706',strokeWidth:2}} activeDot={{r:5,fill:'#fff',stroke:'#d97706',strokeWidth:2.5}} connectNulls={false}/>
     <Line yAxisId="volume" dataKey="volume" name="Quantidade entregue" stroke="transparent" dot={false} activeDot={false} legendType="none"/>
    </ComposedChart></ResponsiveContainer>
   </div></div>}
  </section>;
}
