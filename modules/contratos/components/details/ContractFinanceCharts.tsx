import {useId,useState} from 'react';
import {ArrowUpRight,BarChart3,ChartNoAxesCombined,ChartPie,ChevronDown,MoveUpRight} from 'lucide-react';
import {Area,Bar,CartesianGrid,Cell,ComposedChart,Line,Pie,PieChart,ReferenceLine,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import type {ContractFinancialMetrics,ContractFinancialSummary} from '../../types';
import {formatAtr,formatContractBilling as money,formatContractMonth,formatContractVolume} from '../../utils/contractFormat';

const compactNumber=(value:number)=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(value);
const compactMoney=(value:number)=>'R$ '+compactNumber(value);
type ChartRow={month:string;volume:number;atr:number|null;gross:number|null;net:number|null;received:number;pendingQuote:boolean};

export function ContractFinanceCharts({summary,month,onMonth}:{summary:ContractFinancialSummary;month:string;onMonth:(month:string)=>void}){
 const [mode,setMode]=useState<'money'|'production'>('money');
 const [year,setYear]=useState('all');
 const gradientId='finance-area-'+useId().replace(/:/g,'');
 // Decimal conversion and slicing serve the chart geometry only. All values
 // and aggregates, including the empty-month state, come from the contract RPC.
 const allRows:ChartRow[]=summary.months.map(item=>({month:item.month,volume:Number(item.loadedVolume),atr:item.averageAtr===''?null:Number(item.averageAtr),gross:item.billingPending?null:Number(item.grossAmount),net:item.billingPending?null:Number(item.netAmount),received:Number(item.receivedAmount),pendingQuote:item.billingPending}));
 const years=[...new Set(allRows.map(item=>item.month.slice(0,4)))].sort().reverse();
 const data=year==='all'?allRows:allRows.filter(item=>item.month.startsWith(year+'-'));
 const hasMovement=data.some(item=>item.volume!==0||item.received!==0||item.pendingQuote);
 const selected=summary.months.find(item=>item.month===month)??summary.emptyMonth;

 return <div className="finance-analytics">
  <section className="finance-chart-panel" aria-label="Evolução mensal do contrato">
   <header className="finance-panel-heading"><div><span className="finance-eyebrow"><ChartNoAxesCombined size={13}/>EVOLUÇÃO DO CONTRATO</span><h3>{mode==='money'?'Entregas que viram receita':'Volume e qualidade das entregas'}</h3></div><label className="finance-chart-window"><span className="sr-only">Período do gráfico</span><select value={year} onChange={event=>setYear(event.target.value)}><option value="all">Todo o período</option>{years.map(value=><option key={value} value={value}>{value}</option>)}</select><ChevronDown size={13}/></label></header>
   <div className="finance-chart-toolbar"><div className="finance-segmented" aria-label="Indicadores do gráfico"><button type="button" aria-pressed={mode==='money'} onClick={()=>setMode('money')}>Financeiro</button><button type="button" aria-pressed={mode==='production'} onClick={()=>setMode('production')}>Volume e ATR</button></div><div className="finance-chart-legend">{mode==='money'?<><span><i className="gross"/>Entregue</span><span><i className="net"/>Após descontos</span><span><i className="received"/>Recebido</span></>:<><span><i className="net"/>Volume (t)</span><span><i className="atr"/>ATR (kg/t)</span></>}</div></div>
   {hasMovement?<div className="finance-evolution-chart" role="group" aria-label={mode==='money'?'Gráfico de valores mensais; consulte os valores exatos no histórico mensal.':'Gráfico de toneladas e ATR médio mensais; consulte os valores exatos no histórico mensal.'}>
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
     <ComposedChart data={data} margin={{top:22,right:mode==='money'?10:8,left:0,bottom:3}} onClick={state=>{if(typeof state.activeLabel==='string'&&data.some(item=>item.month===state.activeLabel))onMonth(state.activeLabel);}}>
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34a783" stopOpacity={.23}/><stop offset="100%" stopColor="#34a783" stopOpacity={.015}/></linearGradient></defs>
      <CartesianGrid vertical={false} stroke="#eaf0ec" strokeDasharray="3 5"/>
      <XAxis dataKey="month" tickFormatter={formatContractMonth} tick={{fontSize:11,fill:'#667e6e'}} tickLine={false} axisLine={false} minTickGap={22} tickMargin={12}/>
      <YAxis yAxisId="main" tickFormatter={mode==='money'?compactMoney:compactNumber} tick={{fontSize:11,fill:'#667e6e'}} tickLine={false} axisLine={false} width={66}/>
      {mode==='production'&&<YAxis yAxisId="atr" orientation="right" tickFormatter={compactNumber} tick={{fontSize:11,fill:'#8b703f'}} tickLine={false} axisLine={false} width={38}/>}
      <Tooltip content={({active,payload})=><EvolutionTooltip active={active} row={payload?.[0]?.payload as ChartRow|undefined} mode={mode}/>} cursor={{stroke:'#a9bdb2',strokeDasharray:'3 4'}}/>
      {data.some(item=>item.month===month)&&<ReferenceLine yAxisId="main" x={month} stroke="#c6dcd1" strokeDasharray="3 4"/>}
      {mode==='money'?<>
       <Area yAxisId="main" type="linear" dataKey="net" name="Após descontos" stroke="#38a985" strokeWidth={2.5} fill={`url(#${gradientId})`} connectNulls={false} isAnimationActive={false} dot={{r:3,fill:'#fff',strokeWidth:2}} activeDot={{r:5,stroke:'#fff',strokeWidth:3}}/>
       <Bar yAxisId="main" dataKey="received" name="Recebido" fill="#214f3d" maxBarSize={22} radius={[5,5,0,0]} isAnimationActive={false}/>
       <Line yAxisId="main" type="linear" dataKey="gross" name="Entregue" stroke="#aabdb2" strokeWidth={1.7} strokeDasharray="5 5" connectNulls={false} dot={{r:2.5,fill:'#aabdb2',strokeWidth:0}} isAnimationActive={false}/>
      </>:<>
       <Bar yAxisId="main" dataKey="volume" name="Volume (t)" fill="#3aa983" maxBarSize={30} radius={[5,5,0,0]} isAnimationActive={false}/>
       <Line yAxisId="atr" type="linear" dataKey="atr" name="ATR (kg/t)" stroke="#b58e53" strokeWidth={2.5} connectNulls={false} dot={{r:4,stroke:'#fff',strokeWidth:2}} isAnimationActive={false}/>
      </>}
     </ComposedChart>
    </ResponsiveContainer>
   </div>:<div className="finance-chart-empty"><span><BarChart3 size={27}/></span><h4>Seu histórico começa na primeira entrega</h4><p>Os carregamentos e recebimentos vão compor a evolução deste contrato.</p></div>}
   {data.some(item=>item.pendingQuote)&&<p className="finance-chart-caveat">Meses sem ATR medido ou cotação têm o faturamento em aberto e aparecem sem valor financeiro no gráfico.</p>}
   <footer className="finance-chart-footer"><span><MoveUpRight size={13}/>Explore um mês</span><div aria-label="Selecionar mês pelo gráfico">{data.map(item=><button key={item.month} type="button" aria-pressed={item.month===month} onClick={()=>onMonth(item.month)}>{formatContractMonth(item.month)}</button>)}</div></footer>
  </section>
  <ReceiptComposition selected={selected} total={summary.totals} month={month}/>
 </div>;
}

function EvolutionTooltip({active,row,mode}:{active?:boolean;row?:ChartRow;mode:'money'|'production'}){
 if(!active||!row)return null;
 return <div className="finance-chart-tooltip"><strong>{formatContractMonth(row.month)}</strong>{mode==='money'?<>
  <p><span><i className="gross"/>Valor entregue</span><b>{row.pendingQuote?'Aguardando ATR ou cotação':money(String(row.gross))}</b></p>
  <p><span><i className="net"/>Após descontos</span><b>{row.pendingQuote?'Aguardando ATR ou cotação':money(String(row.net))}</b></p>
  <p><span><i className="received"/>Recebido</span><b>{money(String(row.received))}</b></p>
 </>:<><p><span>Quantidade</span><b>{formatContractVolume(String(row.volume))}</b></p><p><span>ATR médio</span><b>{formatAtr(row.atr===null?'':String(row.atr))} kg/t</b></p></>}</div>;
}

function ReceiptComposition({selected,total,month}:{selected:ContractFinancialMetrics;total:ContractFinancialMetrics;month:string}){
 const [scope,setScope]=useState<'month'|'total'>('month');
 const metrics=scope==='month'?selected:total;
 const data=[{name:'Adiantamentos',value:Number(metrics.advanceAmount),color:'#8ab3c4'},{name:'Recebimentos',value:Number(metrics.receiptAmount),color:'#36a680'}];
 const hasReceipts=data.some(item=>item.value>0);
 return <section className="finance-chart-panel finance-composition" aria-label="Composição dos recebimentos">
  <header className="finance-panel-heading"><div><span className="finance-eyebrow"><ChartPie size={13}/>ENTRADAS DO CONTRATO</span><h3>Origem dos recebimentos</h3></div></header>
  <div className="finance-composition-filter"><div className="finance-segmented" aria-label="Período da composição"><button type="button" aria-pressed={scope==='month'} onClick={()=>setScope('month')}>{formatContractMonth(month)}</button><button type="button" aria-pressed={scope==='total'} onClick={()=>setScope('total')}>Geral do contrato</button></div></div>
  <div className="finance-donut" role="img" aria-label={`Total recebido: ${money(metrics.receivedAmount)}. Adiantamentos: ${money(metrics.advanceAmount)}. Recebimentos: ${money(metrics.receiptAmount)}.`}>
   {hasReceipts?<ResponsiveContainer width="100%" height="100%" minWidth={0}><PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius="76%" outerRadius="94%" startAngle={90} endAngle={-270} paddingAngle={data.every(item=>item.value>0)?4:0} cornerRadius={5} stroke="none" isAnimationActive={false}>{data.map(item=><Cell key={item.name} fill={item.color}/>)}</Pie><Tooltip formatter={value=>money(String(value))} contentStyle={{border:'1px solid #e4ece7',borderRadius:12,fontSize:12,boxShadow:'0 8px 30px #193d2810'}}/></PieChart></ResponsiveContainer>:<svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="84" fill="none" stroke="#eef3ef" strokeWidth="17"/></svg>}
   <div className="finance-donut-center"><span>Total recebido</span><strong>{money(metrics.receivedAmount)}</strong><small>{hasReceipts?scope==='month'?formatContractMonth(month):'Todo o contrato':'Sem recebimentos'}</small></div>
  </div>
  <dl className="finance-composition-legend"><div><dt><i className="advance"/>Adiantamentos</dt><dd>{money(metrics.advanceAmount)}</dd></div><div><dt><i className="receipt"/>Recebimentos</dt><dd>{money(metrics.receiptAmount)}</dd></div></dl>
  <div className="finance-composition-pending"><span><ArrowUpRight size={15}/>Pendente de receber</span><strong>{money(metrics.pendingAmount,metrics.billingPending)}</strong></div>
 </section>;
}
