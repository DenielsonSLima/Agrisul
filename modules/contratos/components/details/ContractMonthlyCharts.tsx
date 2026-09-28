import {Bar,CartesianGrid,ComposedChart,LabelList,Legend,Line,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {CalendarRange} from 'lucide-react';
import type {ContractSummaryMonth} from '../../utils/contractMonthlyPresentation';
import {defaultContractMonthlyPeriod,type ContractMonthlyPeriod} from '../../utils/contractMonthlyPeriod';
import {formatAtr,formatContractBilling,formatContractMonth,formatContractVolume} from '../../utils/contractFormat';
import './contract-monthly-overview.css';

type Props={months:ContractSummaryMonth[];period:ContractMonthlyPeriod;onPeriod:(period:ContractMonthlyPeriod)=>void;error?:string};
type MonthTickProps={x?:number;y?:number;payload?:{value:string}};

const number=(value:string|undefined)=>value===''||value===undefined?null:Number.isFinite(Number(value))?Number(value):null;
const compactMoney=(value:number)=>value>=1_000_000?`R$ ${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(value/1_000_000)} mi`:value>=1_000?`R$ ${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0}).format(value/1_000)} mil`:`R$ ${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0}).format(value)}`;
const compactValue=(value:number)=>value>=1_000_000?`${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(value/1_000_000)} mi`:value>=1_000?`${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(value/1_000)} mil`:new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0}).format(value);

function MonthTick({x=0,y=0,payload}:MonthTickProps){
 const [month,volume='',atr='']=String(payload?.value??'').split('|');
 return <g transform={`translate(${x},${y})`}><text textAnchor="middle" fill="#26372d" fontSize="11" fontWeight="600"><tspan x="0" dy="11" fill="#98570f" fontSize="10" fontWeight="650">{atr}</tspan><tspan x="0" dy="14">{month}</tspan><tspan x="0" dy="14" fill="#4e5e54" fontSize="11" fontWeight="500">{volume}</tspan></text></g>;
}

export function ContractMonthlyCharts({months,period,onPeriod,error=''}:Props){
 const data=months.map(item=>({
  month:item.month,label:formatContractMonth(item.month),axis:`${formatContractMonth(item.month)}|${formatContractVolume(item.loadedVolume)}|ATR ${formatAtr(item.finance?.averageAtr??item.averageLoadAtr)} kg/t`,
  volume:number(item.loadedVolume),gross:item.billingPending?null:number(item.finance?.grossAmount??item.billingAmount),
  net:item.finance?.billingPending?null:number(item.finance?.netAmount),atr:number(item.finance?.averageAtr??item.averageLoadAtr),
 }));
 return <>
  <div className="contract-monthly-filter" aria-label="Filtrar resumo mensal">
   <label><span>MÊS INICIAL</span><input type="month" min="1900-01" max="9999-12" value={period.from} aria-invalid={!!error} onChange={event=>onPeriod({...period,from:event.target.value})}/></label>
   <label><span>MÊS FINAL</span><input type="month" min="1900-01" max="9999-12" value={period.to} aria-invalid={!!error} onChange={event=>onPeriod({...period,to:event.target.value})}/></label>
   <button type="button" className="btn" onClick={()=>onPeriod(defaultContractMonthlyPeriod())}><CalendarRange size={15}/>Últimos 6 meses</button>
  </div>
  {error&&<p className="contract-monthly-filter-error" role="alert">{error}</p>}
  <section className="contract-monthly-combined" tabIndex={0} role="region" aria-label="Gráfico mensal; deslize horizontalmente para consultar todos os meses">
   <header><h4>Entregas e faturamento por mês</h4><span>Barras: faturamento bruto e valor líquido · Linha: ATR médio</span></header>
   {!data.length||error?<div className="contract-monthly-combined-empty">Nenhuma movimentação no período selecionado.</div>:<div className="contract-monthly-combined-chart" role="img" aria-label={'Resumo mensal: '+data.map(item=>`${item.label}, ${formatContractVolume(String(item.volume??0))}, faturado ${item.gross===null?'pendente':formatContractBilling(String(item.gross))}, líquido ${item.net===null?'pendente':formatContractBilling(String(item.net))}, ATR ${item.atr===null?'indisponível':formatAtr(String(item.atr))}`).join('; ')}>
    <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{top:28,right:18,left:8,bottom:22}}>
     <CartesianGrid vertical={false} stroke="#e7eee9" strokeDasharray="4 5"/>
     <XAxis dataKey="axis" axisLine={false} tickLine={false} height={58} interval={0} tick={<MonthTick/>}/>
     <YAxis yAxisId="money" tickFormatter={compactMoney} axisLine={false} tickLine={false} width={68} tick={{fontSize:11,fill:'#3f5046',fontWeight:550}}/>
     <YAxis yAxisId="atr" orientation="right" tickFormatter={value=>formatAtr(String(value))} axisLine={false} tickLine={false} width={56} tick={{fontSize:11,fill:'#98570f',fontWeight:600}}/>
     <YAxis yAxisId="volume" hide/>
     <Tooltip labelFormatter={(_,payload)=>payload?.[0]?.payload?.label??''} formatter={(value,name)=>name==='ATR médio'?[formatAtr(String(value)),'ATR médio (kg/t)']:name==='Quantidade entregue'?[formatContractVolume(String(value)),'Quantidade entregue']:[formatContractBilling(String(value)),String(name)]} contentStyle={{borderRadius:9,borderColor:'#d2ded6',fontSize:11,color:'#17251d'}} itemStyle={{color:'#26372d',fontWeight:550}} labelStyle={{color:'#17251d',fontWeight:700}}/>
     <Legend iconType="circle" formatter={value=><span style={{color:'#26372d',fontWeight:600}}>{value}</span>} wrapperStyle={{fontSize:11,paddingTop:8}}/>
     <Bar yAxisId="money" dataKey="gross" name="Faturado bruto" fill="#75b98c" radius={[5,5,0,0]} maxBarSize={30}><LabelList dataKey="gross" position="top" formatter={(value:unknown)=>compactValue(Number(value))} fill="#26372d" fontSize={11} fontWeight={600}/></Bar>
     <Bar yAxisId="money" dataKey="net" name="Valor líquido" fill="#26784c" radius={[5,5,0,0]} maxBarSize={30}><LabelList dataKey="net" position="top" formatter={(value:unknown)=>compactValue(Number(value))} fill="#17291f" fontSize={11} fontWeight={650}/></Bar>
     <Line yAxisId="atr" type="linear" dataKey="atr" name="ATR médio" stroke="#d97706" strokeOpacity={.52} strokeWidth={2.5} strokeDasharray="6 5" dot={{r:3,fill:'#fff',stroke:'#d97706',strokeWidth:2}} activeDot={{r:5,fill:'#fff',stroke:'#d97706',strokeWidth:2.5}} connectNulls={false}/>
     <Line yAxisId="volume" dataKey="volume" name="Quantidade entregue" stroke="transparent" dot={false} activeDot={false} legendType="none"/>
    </ComposedChart></ResponsiveContainer>
   </div>}
  </section>
 </>;
}
