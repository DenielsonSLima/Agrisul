'use client';
import {useId,type CSSProperties} from 'react';
import {ChartPie} from 'lucide-react';
import {Cell,Pie,PieChart,ResponsiveContainer} from 'recharts';
import {moneyLabel} from '@/shared/utils/presentation';
import type {ExecutiveSummaryData} from '../types';

const INITIAL_CHART_SIZE={width:1,height:1};
const amountStyle=(label:string)=>({'--composition-value-length':Math.max(label.length,1)} as CSSProperties);

export function FinancialComposition({totals}:{totals:ExecutiveSummaryData['totals']}){
 const id=useId();
 // Only chart geometry uses numbers. All displayed totals come from the RPC.
 const parts=totals.billingPending?[]:[
  {name:'Líquido',value:Number(totals.netAmount),color:'#2d8a63'},
  {name:'Descontos',value:Number(totals.discountAmount),color:'#bd8f46'},
 ];
 const visible=parts.every(part=>Number.isFinite(part.value)&&part.value>=0)&&parts.some(part=>part.value>0);
 const gross=moneyLabel(totals.grossAmount),net=moneyLabel(totals.netAmount),discount=moneyLabel(totals.discountAmount);
 const status=totals.billingPending?'Valores a apurar':visible?'':'Sem composição proporcional';
 return <section className="summary-panel financial-composition" aria-labelledby={id}>
  <header className="summary-panel-heading"><div><span className="summary-kicker"><ChartPie size={15}/>COMPOSIÇÃO NO PERÍODO</span><h3 id={id}>Do bruto ao líquido</h3><p>Descontos aplicados às entregas da seleção.</p></div></header>
  <div className="financial-composition-gross" style={amountStyle(gross)}><span>Faturamento bruto</span><strong>{gross}</strong>{status&&<small>{status}</small>}</div>
  <div className="financial-composition-body">
   <div className="financial-composition-chart" role="img" aria-label={`Bruto ${gross}; líquido ${net}; descontos ${discount}.`}>
    {visible?<ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={INITIAL_CHART_SIZE}><PieChart><Pie data={parts} dataKey="value" nameKey="name" innerRadius="69%" outerRadius="93%" paddingAngle={2} cornerRadius={5} stroke="none" startAngle={90} endAngle={-270} isAnimationActive={false}>{parts.map(part=><Cell key={part.name} fill={part.color}/>)}</Pie></PieChart></ResponsiveContainer>:<svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="80" fill="none" stroke="#edf2ee" strokeWidth="21"/></svg>}
   </div>
   <dl className="financial-composition-values">
    <div><dt><i className="is-net"/>Líquido</dt><dd style={amountStyle(net)}><strong>{net}</strong></dd></div>
    <div><dt><i className="is-discount"/>Descontos</dt><dd style={amountStyle(discount)}><strong>{discount}</strong></dd></div>
   </dl>
  </div>
 </section>;
}
