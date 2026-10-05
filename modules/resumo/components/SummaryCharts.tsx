'use client';
import {useId,useState} from 'react';
import {BarChart3,ChartPie,Leaf} from 'lucide-react';
import {Bar,CartesianGrid,Cell,ComposedChart,Line,Pie,PieChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {decimalLabel,moneyLabel,monthLabel} from '@/shared/utils/presentation';
import type {ExecutiveSummaryData} from '../types';

// Positive initial geometry until ResizeObserver measures the container.
const INITIAL_CHART_SIZE={width:1,height:1};
const compact=(value:number)=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(value);
const compactMoney=(value:number)=>`R$ ${compact(value)}`;
const shortMonth=(value:string)=>`${monthLabel(value).slice(0,3)}/${value.slice(2,4)}`;
type Exploration={onSelectMonth?:(month:string)=>void;disabled?:boolean};
type ChartRow={month:string;gross:number|null;discount:number|null;net:number|null;received:number;volume:number;loads:number;atr:number|null;pending:boolean};

export function FinancialEvolution({data,onSelectMonth,disabled}: {data:ExecutiveSummaryData['months']} & Exploration){
 const rows:ChartRow[]=data.map(item=>({month:item.month,gross:item.billingPending?null:Number(item.grossAmount),discount:Number(item.discountAmount),net:item.billingPending?null:Number(item.netAmount),received:Number(item.receivedAmount),volume:Number(item.loadedVolume),loads:item.loadCount,atr:null,pending:item.billingPending}));
 return <EvolutionChart rows={rows} mode="money" onSelectMonth={onSelectMonth} disabled={disabled}/>;
}
export function OperationalEvolution({data,onSelectMonth,disabled}:{data:ExecutiveSummaryData['monthlyOperations']} & Exploration){
 const rows:ChartRow[]=data.map(item=>({month:item.month,gross:null,discount:null,net:null,received:0,volume:Number(item.loadedVolume),loads:item.loadCount,atr:item.averageAtr===''?null:Number(item.averageAtr),pending:false}));
 return <EvolutionChart rows={rows} mode="production" onSelectMonth={onSelectMonth} disabled={disabled}/>;
}

function EvolutionChart({rows,mode,onSelectMonth,disabled}:{rows:ChartRow[];mode:'money'|'production'} & Exploration){
 const id=useId(),money=mode==='money';
 const [showAtr,setShowAtr]=useState(true);
 const hasData=rows.some(row=>row.loads||row.received||row.pending);
 return <section className="summary-panel summary-evolution" aria-labelledby={id}>
  <header className="summary-panel-heading"><div><span className="summary-kicker"><BarChart3 size={15}/>{money?'RESULTADOS FINANCEIROS':'EVOLUÇÃO DA OPERAÇÃO'}</span><h3 id={id}>{money?'Entregas que viram receita':'Volume e qualidade das entregas'}</h3><p>{money?'Cargas pela data de carregamento · caixa pela data de entrada.':'Volume em toneladas · ATR ponderado pelas toneladas carregadas.'}</p></div>{!money&&<div className="summary-segmented" aria-label="Linha do gráfico operacional"><button type="button" aria-pressed={showAtr} onClick={()=>setShowAtr(true)}>ATR</button><button type="button" aria-pressed={!showAtr} onClick={()=>setShowAtr(false)}>Cargas</button></div>}</header>
  <div className="summary-chart-legend" aria-label="Legenda">{money?<><span><i className="gross"/>Bruto</span><span><i className="net"/>Líquido</span><span><i className="cash"/>Entradas em caixa</span></>:<><span><i className="net"/>Volume (t)</span><span><i className="atr"/>{showAtr?'ATR (kg/t)':'Cargas'}</span></>}</div>
  {hasData?<div className="summary-chart" aria-label={money?'Gráfico financeiro mensal. Ver dados abaixo para valores e seleção por teclado.':'Gráfico operacional mensal. Ver dados abaixo para valores e seleção por teclado.'}><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={INITIAL_CHART_SIZE}><ComposedChart data={rows} margin={{top:14,right:8,left:0,bottom:0}} onClick={state=>{if(!disabled&&typeof state.activeLabel==='string')onSelectMonth?.(state.activeLabel);}}>
   <CartesianGrid vertical={false} stroke="#e3ebe6" strokeDasharray="3 5"/>
   <XAxis dataKey="month" tickFormatter={shortMonth} tick={{fontSize:12,fill:'#5e6f64'}} axisLine={false} tickLine={false} minTickGap={18} tickMargin={12}/>
   <YAxis yAxisId="main" tickFormatter={money?compactMoney:compact} tick={{fontSize:11,fill:'#5e6f64'}} axisLine={false} tickLine={false} width={76}/>
   {!money&&<YAxis yAxisId="quality" orientation="right" tickFormatter={compact} allowDecimals={showAtr} tick={{fontSize:11,fill:'#93672a'}} axisLine={false} tickLine={false} width={42}/>}
   <Tooltip content={({active,payload})=><SummaryTooltip active={active} row={payload?.[0]?.payload as ChartRow|undefined} mode={mode} showAtr={showAtr}/>} cursor={{fill:'#edf4ef',opacity:.65}}/>
   {money?<><Bar yAxisId="main" dataKey="gross" name="Bruto" fill="#c1d6c9" maxBarSize={30} radius={[5,5,0,0]} isAnimationActive={false}/><Bar yAxisId="main" dataKey="net" name="Líquido" fill="#2d8a63" maxBarSize={30} radius={[5,5,0,0]} isAnimationActive={false}/><Line yAxisId="main" type="linear" dataKey="received" name="Entradas" stroke="#30637d" strokeWidth={2.5} dot={{r:3,fill:'#30637d',stroke:'#fff',strokeWidth:2}} isAnimationActive={false}/></>:<><Bar yAxisId="main" dataKey="volume" name="Volume (t)" fill="#4c9c74" maxBarSize={38} radius={[6,6,0,0]} isAnimationActive={false}/><Line yAxisId="quality" type="linear" dataKey={showAtr?'atr':'loads'} name={showAtr?'ATR (kg/t)':'Cargas'} stroke="#a4732d" strokeDasharray={showAtr?'5 4':undefined} strokeWidth={2.5} dot={{r:3,fill:'#fff',stroke:'#a4732d',strokeWidth:2}} connectNulls={false} isAnimationActive={false}/></>}
  </ComposedChart></ResponsiveContainer></div>:<ChartEmpty title="Nenhuma movimentação nesta seleção"/>}
  {money&&rows.some(row=>row.pending)&&<p className="summary-chart-note">ATR ou cotação incompletos: o valor financeiro do mês fica A apurar.</p>}
  {onSelectMonth&&<div className="summary-month-explorer"><span>Explore um mês</span><div>{rows.map(row=><button key={row.month} type="button" disabled={disabled} aria-label={`Analisar ${monthLabel(row.month)}`} onClick={()=>onSelectMonth(row.month)}>{shortMonth(row.month)}</button>)}</div></div>}
  <details className="summary-data-details"><summary>Ver dados {money?'financeiros':'operacionais'}</summary><div className="summary-table-wrap" tabIndex={0} role="region" aria-label={money?'Dados financeiros mensais':'Dados operacionais mensais'}><table className="summary-table"><caption className="sr-only">Valores oficiais da seleção atual, por mês</caption><thead><tr><th scope="col">Mês</th>{money?<><th scope="col">Bruto</th><th scope="col">Descontos</th><th scope="col">Líquido</th><th scope="col">Entradas em caixa</th></>:<><th scope="col">Volume (t)</th><th scope="col">Cargas</th><th scope="col">ATR (kg/t)</th></>}</tr></thead><tbody>{rows.map(row=><tr key={row.month}><th scope="row">{onSelectMonth?<button className="summary-table-action" type="button" disabled={disabled} onClick={()=>onSelectMonth(row.month)}>{monthLabel(row.month)}</button>:monthLabel(row.month)}</th>{money?<><td>{moneyLabel(row.gross)}</td><td>{moneyLabel(row.discount)}</td><td>{moneyLabel(row.net)}</td><td>{moneyLabel(row.received)}</td></>:<><td>{decimalLabel(row.volume)}</td><td>{row.loads}</td><td>{decimalLabel(row.atr)}</td></>}</tr>)}</tbody></table></div></details>
 </section>;
}

function SummaryTooltip({active,row,mode,showAtr}:{active?:boolean;row?:ChartRow;mode:'money'|'production';showAtr:boolean}){
 if(!active||!row)return null;
 return <div className="summary-tooltip"><strong>{monthLabel(row.month)}</strong>{mode==='money'?<><span>Bruto <b>{moneyLabel(row.gross)}</b></span><span>Líquido <b>{moneyLabel(row.net)}</b></span><span>Entradas <b>{moneyLabel(row.received)}</b></span></>:<><span>Volume <b>{decimalLabel(row.volume)} t</b></span><span>{showAtr?'ATR médio':'Carregamentos'} <b>{showAtr?`${decimalLabel(row.atr)} kg/t`:row.loads}</b></span></>}</div>;
}

export function FinancialComposition({totals}:{totals:ExecutiveSummaryData['totals']}){
 const id=useId();
 const data=totals.billingPending?[]:[{name:'Líquido',value:Number(totals.netAmount),color:'#2d8a63'},{name:'Descontos',value:Number(totals.discountAmount),color:'#bd8f46'}];
 const visible=data.every(item=>item.value>=0)&&data.some(item=>item.value>0);
 return <section className="summary-panel summary-composition" aria-labelledby={id}>
  <header className="summary-panel-heading"><div><span className="summary-kicker"><ChartPie size={15}/>COMPOSIÇÃO NO PERÍODO</span><h3 id={id}>Do bruto ao líquido</h3><p>Descontos aplicados às entregas da seleção.</p></div></header>
  <div className="summary-donut" role="img" aria-label={`Bruto ${moneyLabel(totals.grossAmount)}; líquido ${moneyLabel(totals.netAmount)}; descontos ${moneyLabel(totals.discountAmount)}.`}>{visible?<ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={INITIAL_CHART_SIZE}><PieChart><Pie data={data} dataKey="value" innerRadius="73%" outerRadius="93%" paddingAngle={2} cornerRadius={5} stroke="none" startAngle={90} endAngle={-270} isAnimationActive={false}>{data.map(item=><Cell key={item.name} fill={item.color}/>)}</Pie><Tooltip formatter={value=>moneyLabel(String(value))} contentStyle={{border:'1px solid #dce6df',borderRadius:12,fontSize:13}}/></PieChart></ResponsiveContainer>:<svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="80" fill="none" stroke="#edf2ee" strokeWidth="19"/></svg>}<div><span>Faturamento bruto</span><strong>{moneyLabel(totals.grossAmount)}</strong><small>{totals.billingPending?'Valores a apurar':visible?'No período':'Sem composição proporcional'}</small></div></div>
  <dl className="summary-donut-legend"><div><dt><i className="net"/>Líquido</dt><dd>{moneyLabel(totals.netAmount)}</dd></div><div><dt><i className="discount"/>Descontos</dt><dd>{moneyLabel(totals.discountAmount)}</dd></div></dl>
 </section>;
}

export function FarmVolumeChart({farms}:{farms:ExecutiveSummaryData['farms']}){
 const id=useId(),[all,setAll]=useState(false);
 const rows=(all?farms:farms.slice(0,7)).map(item=>({...item,value:Number(item.loadedVolume)}));
 return <section className="summary-panel summary-farms-chart" aria-labelledby={id}><header className="summary-panel-heading"><div><span className="summary-kicker"><Leaf size={15}/>ORIGEM NO PERÍODO</span><h3 id={id}>Volume por fazenda</h3><p>{all?'Todas as fazendas':`Top ${Math.min(7,farms.length)} por volume`} · empresa ativa.</p></div></header>{rows.length?<div className="summary-farm-bars" style={{height:Math.max(265,rows.length*38)}} role="img" aria-label={rows.map(row=>`${row.name}: ${decimalLabel(row.loadedVolume)} toneladas`).join('. ')}><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={INITIAL_CHART_SIZE}><ComposedChart data={rows} layout="vertical" margin={{top:4,right:12,left:0,bottom:4}}><CartesianGrid horizontal={false} stroke="#edf1ee"/><XAxis type="number" tickFormatter={compact} axisLine={false} tickLine={false} tick={{fontSize:11,fill:'#5e6f64'}}/><YAxis dataKey="name" type="category" width={110} axisLine={false} tickLine={false} tick={{fontSize:12,fill:'#425b4b'}}/><Tooltip formatter={value=>[`${decimalLabel(String(value))} t`,'Volume']} contentStyle={{border:'1px solid #dce6df',borderRadius:12,fontSize:13}}/><Bar dataKey="value" fill="#67a786" radius={[0,5,5,0]} maxBarSize={23} isAnimationActive={false}/></ComposedChart></ResponsiveContainer></div>:<ChartEmpty title="Nenhuma fazenda movimentada"/>}{farms.length>7&&<button className="summary-text-button" type="button" aria-expanded={all} onClick={()=>setAll(!all)}>{all?'Mostrar top 7':`Ver todas as ${farms.length} fazendas`}</button>}
  <details className="summary-data-details"><summary>Ver dados por fazenda</summary><div className="summary-table-wrap" tabIndex={0} role="region" aria-label="Volume das fazendas"><table className="summary-table"><thead><tr><th scope="col">Fazenda</th><th scope="col">Cargas</th><th scope="col">Volume (t)</th></tr></thead><tbody>{farms.map(row=><tr key={row.id}><th scope="row">{row.name}</th><td>{row.loadCount}</td><td>{decimalLabel(row.loadedVolume)}</td></tr>)}</tbody></table></div></details>
 </section>;
}
function ChartEmpty({title}:{title:string}){return <div className="summary-chart-empty"><span><BarChart3 size={25}/></span><strong>{title}</strong><p>Ajuste os filtros para explorar outro recorte.</p></div>;}
