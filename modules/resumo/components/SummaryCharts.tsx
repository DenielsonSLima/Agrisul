'use client';
import {useId,useState} from 'react';
import {BarChart3,ChartPie,Leaf} from 'lucide-react';
import {Bar,CartesianGrid,Cell,ComposedChart,Line,Pie,PieChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {decimalLabel,moneyLabel,monthLabel} from '@/shared/utils/presentation';
import type {ExecutiveSummaryData} from '../types';

const compact=(value:number)=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(value);
const compactMoney=(value:number)=>`R$ ${compact(value)}`;
const shortMonth=(value:string)=>monthLabel(value).replace(' de ','/').slice(0,3)+value.slice(2,4);

export function FinancialEvolution({data}:{data:ExecutiveSummaryData['months']}){
 const [mode,setMode]=useState<'money'|'production'>('money');
 const rows=data.map(item=>({month:item.month,gross:item.billingPending?null:Number(item.grossAmount),net:item.billingPending?null:Number(item.netAmount),received:Number(item.receivedAmount),volume:Number(item.loadedVolume),loads:item.loadCount,pending:item.billingPending}));
 const hasData=rows.some(item=>item.volume||item.received||item.pending);
 return <section className="summary-panel summary-evolution" aria-labelledby="summary-evolution-title">
  <header className="summary-panel-heading"><div><span className="summary-kicker"><BarChart3 size={14}/>EVOLUÇÃO MÊS A MÊS</span><h3 id="summary-evolution-title">{mode==='money'?'Faturamento e entradas':'Carregamentos e volume'}</h3><p>{mode==='money'?'Bruto, líquido e valores recebidos por mês.':'Toneladas e quantidade de cargas por mês.'}</p></div><div className="summary-segmented" aria-label="Indicador do gráfico"><button type="button" aria-pressed={mode==='money'} onClick={()=>setMode('money')}>Financeiro</button><button type="button" aria-pressed={mode==='production'} onClick={()=>setMode('production')}>Produção</button></div></header>
  {hasData?<div className="summary-chart" role="img" aria-label={`Evolução mensal de ${rows.length} meses. Os valores exatos estão disponíveis ao passar pelo gráfico.`}><ResponsiveContainer width="100%" height="100%" minWidth={0}><ComposedChart data={rows} margin={{top:18,right:8,left:0,bottom:0}}><CartesianGrid vertical={false} stroke="#e8eee9" strokeDasharray="3 5"/><XAxis dataKey="month" tickFormatter={shortMonth} tick={{fontSize:11,fill:'#728178'}} axisLine={false} tickLine={false} minTickGap={18} tickMargin={11}/><YAxis yAxisId="main" tickFormatter={mode==='money'?compactMoney:compact} tick={{fontSize:10,fill:'#728178'}} axisLine={false} tickLine={false} width={67}/>{mode==='production'&&<YAxis yAxisId="loads" orientation="right" tick={{fontSize:10,fill:'#91764c'}} axisLine={false} tickLine={false} width={30}/>}<Tooltip content={({active,payload})=><SummaryTooltip active={active} row={payload?.[0]?.payload as typeof rows[number]|undefined} mode={mode}/>} cursor={{fill:'#edf4ef',opacity:.65}}/>{mode==='money'?<><Bar yAxisId="main" dataKey="gross" name="Bruto" fill="#c5d5ca" maxBarSize={34} radius={[6,6,0,0]} isAnimationActive={false}/><Bar yAxisId="main" dataKey="net" name="Líquido" fill="#2f8b68" maxBarSize={34} radius={[6,6,0,0]} isAnimationActive={false}/><Line yAxisId="main" type="linear" dataKey="received" name="Recebido" stroke="#24557b" strokeWidth={2.5} dot={{r:3,fill:'#24557b',stroke:'#fff',strokeWidth:2}} isAnimationActive={false}/></>:<><Bar yAxisId="main" dataKey="volume" name="Toneladas" fill="#2f8b68" maxBarSize={38} radius={[6,6,0,0]} isAnimationActive={false}/><Line yAxisId="loads" type="linear" dataKey="loads" name="Cargas" stroke="#b18649" strokeWidth={2.5} dot={{r:3,fill:'#b18649',stroke:'#fff',strokeWidth:2}} isAnimationActive={false}/></>}</ComposedChart></ResponsiveContainer></div>:<ChartEmpty title="A evolução começa com a primeira movimentação"/>}
  {rows.some(item=>item.pending)&&<p className="summary-chart-note">Meses com ATR ou cotação pendente permanecem sem valor financeiro; nenhuma pendência é convertida em zero.</p>}
 </section>;
}

function SummaryTooltip({active,row,mode}:{active?:boolean;row?:{month:string;gross:number|null;net:number|null;received:number;volume:number;loads:number;pending:boolean};mode:'money'|'production'}){
 if(!active||!row)return null;
 return <div className="summary-tooltip"><strong>{monthLabel(row.month)}</strong>{mode==='money'?<><span>Bruto <b>{row.pending?'A apurar':moneyLabel(row.gross)}</b></span><span>Líquido <b>{row.pending?'A apurar':moneyLabel(row.net)}</b></span><span>Recebido <b>{moneyLabel(row.received)}</b></span></>:<><span>Quantidade <b>{decimalLabel(row.volume)} t</b></span><span>Carregamentos <b>{row.loads}</b></span></>}</div>;
}

export function FinancialComposition({totals}:{totals:ExecutiveSummaryData['totals']}){
 const chartId=useId();
 const data=totals.billingPending?[]:[{name:'Líquido',value:Number(totals.netAmount),color:'#2f8b68'},{name:'Descontos',value:Number(totals.discountAmount),color:'#d9a84e'}];
 const visible=data.some(item=>item.value>0);
 return <section className="summary-panel summary-composition" aria-labelledby={chartId}>
  <header className="summary-panel-heading"><div><span className="summary-kicker"><ChartPie size={14}/>COMPOSIÇÃO FINANCEIRA</span><h3 id={chartId}>Do bruto ao líquido</h3><p>Participação do valor líquido e dos descontos.</p></div></header>
  <div className="summary-donut" role="img" aria-label={totals.billingPending?'Composição financeira pendente de ATR ou cotação.':`Faturamento bruto ${moneyLabel(totals.grossAmount)}, líquido ${moneyLabel(totals.netAmount)} e descontos ${moneyLabel(totals.discountAmount)}.`}>{visible?<ResponsiveContainer width="100%" height="100%" minWidth={0}><PieChart><Pie data={data} dataKey="value" innerRadius="72%" outerRadius="92%" paddingAngle={3} cornerRadius={7} stroke="none" startAngle={90} endAngle={-270} isAnimationActive={false}>{data.map(item=><Cell key={item.name} fill={item.color}/>)}</Pie><Tooltip formatter={value=>moneyLabel(String(value))} contentStyle={{border:'1px solid #e3ebe5',borderRadius:12,fontSize:12}}/></PieChart></ResponsiveContainer>:<svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="80" fill="none" stroke="#edf2ee" strokeWidth="19"/></svg>}<div><span>Faturamento bruto</span><strong>{moneyLabel(totals.grossAmount)}</strong><small>{totals.billingPending?'Valores a apurar':'100% do período'}</small></div></div>
  <dl className="summary-donut-legend"><div><dt><i className="net"/>Líquido</dt><dd>{moneyLabel(totals.netAmount)}</dd></div><div><dt><i className="discount"/>Descontos</dt><dd>{moneyLabel(totals.discountAmount)}</dd></div></dl>
 </section>;
}

export function FarmVolumeChart({farms}:{farms:ExecutiveSummaryData['farms']}){
 const rows=farms.slice(0,7).map(item=>({...item,value:Number(item.loadedVolume)}));
 return <section className="summary-panel summary-farms-chart" aria-labelledby="summary-farms-title"><header className="summary-panel-heading"><div><span className="summary-kicker"><Leaf size={14}/>ORIGEM DA PRODUÇÃO</span><h3 id="summary-farms-title">Volume por fazenda</h3><p>Fazendas movimentadas pela empresa ativa no período.</p></div></header>{rows.length?<div className="summary-farm-bars" role="img" aria-label={rows.map(row=>`${row.name}: ${decimalLabel(row.loadedVolume)} toneladas`).join('. ')}><ResponsiveContainer width="100%" height="100%" minWidth={0}><ComposedChart data={rows} layout="vertical" margin={{top:4,right:28,left:6,bottom:4}}><CartesianGrid horizontal={false} stroke="#edf1ee"/><XAxis type="number" tickFormatter={compact} axisLine={false} tickLine={false} tick={{fontSize:10,fill:'#728178'}}/><YAxis dataKey="name" type="category" width={112} axisLine={false} tickLine={false} tick={{fontSize:11,fill:'#52665a'}}/><Tooltip formatter={value=>[`${decimalLabel(String(value))} t`,'Volume']} contentStyle={{border:'1px solid #e3ebe5',borderRadius:12,fontSize:12}}/><Bar dataKey="value" fill="#5ba17f" radius={[0,6,6,0]} maxBarSize={24} isAnimationActive={false}/></ComposedChart></ResponsiveContainer></div>:<ChartEmpty title="Nenhuma fazenda movimentada no período"/>}</section>;
}

function ChartEmpty({title}:{title:string}){return <div className="summary-chart-empty"><span><BarChart3 size={25}/></span><strong>{title}</strong><p>Ajuste o período ou registre movimentações para visualizar este gráfico.</p></div>}
