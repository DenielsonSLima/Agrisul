'use client';

import {useEffect,useId,useState,type CSSProperties} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {decimalLabel} from '@/shared/utils/presentation';
import {useDashboardValues} from '../dashboardValues';
import {usePlotSize} from '../hooks/usePlotSize';
import type {ExecutiveDimension} from '../types';
import {DashboardEmpty,DashboardPanel} from './DashboardVisuals';

type Props={rows:ExecutiveDimension[];presenting?:boolean;slideDurationMs?:number};

export function DashboardClientList({rows,presenting=false,slideDurationMs=120000}:Props){
 const {money}=useDashboardValues(),id=useId(),{ref,size}=usePlotSize();
 const pageSize=size.height>=390?2:1,pages=Math.max(1,Math.ceil(rows.length/pageSize));
 const signature=pageSize+':'+rows.map(row=>row.id).join('|');
 const [navigation,setNavigation]=useState({signature:'',page:0});
 const page=navigation.signature===signature?Math.min(navigation.page,pages-1):0;
 const shown=rows.slice(page*pageSize,(page+1)*pageSize);
 const navigate=(next:number)=>setNavigation({signature,page:next});
 useEffect(()=>{
  if(!presenting||pages<2)return;
  const timer=window.setTimeout(()=>setNavigation({signature,page:(page+1)%pages}),Math.max(4000,slideDurationMs/pages));
  return()=>window.clearTimeout(timer);
 },[presenting,pages,page,signature,slideDurationMs]);
 const actions=pages>1?<nav className="executive-inline-pager dashboard-client-pager" aria-label="Paginação dos clientes">
  <button type="button" disabled={page===0} aria-label="Clientes anteriores" onClick={()=>navigate(page-1)}><ChevronLeft size={14}/></button>
  <span aria-live="polite">{page+1}/{pages}</span>
  <button type="button" disabled={page+1>=pages} aria-label="Próximos clientes" onClick={()=>navigate(page+1)}><ChevronRight size={14}/></button>
 </nav>:undefined;
 return <DashboardPanel className="dashboard-client-panel" eyebrow="RELACIONAMENTO COM CLIENTES" title="Resumo por cliente" subtitle="Entregas pela data da carga; recebimentos pela data do pagamento." actions={actions}>
  <div ref={ref} className="dashboard-client-list" data-client-page-size={pageSize} style={{gridTemplateRows:`repeat(${Math.max(1,shown.length)},minmax(0,1fr))`}}>
   {shown.length?shown.map(row=>{
    const volume=decimalLabel(row.loadedVolume),atr=decimalLabel(row.averageAtr),received=money(row.receivedAmount),pending=money(row.pendingAmount);
    return <article className="dashboard-client-card" key={row.id} data-dashboard-client-id={row.id} aria-labelledby={`${id}-${row.id}`}>
     <h4 id={`${id}-${row.id}`} title={row.name} style={{'--client-name-length':Math.max(1,row.name.length)} as CSSProperties}>{row.name}</h4>
     <dl className="dashboard-client-stats">
      <ClientStat label="Entregue" value={volume} unit="t" marker="loaded-volume"/>
      <ClientStat label="ATR médio" value={atr} unit={row.averageAtr?'kg/t':undefined} marker="average-atr"/>
      <ClientStat label="Recebido" value={received} marker="received-amount"/>
      <ClientStat label="A receber" value={pending} marker="pending-amount"/>
     </dl>
     <footer><span>{row.contractCount} {row.contractCount===1?'contrato':'contratos'} · {row.loadCount} {row.loadCount===1?'carga':'cargas'}</span><span className="dashboard-client-share">{decimalLabel(row.sharePercent)}% das entregas</span></footer>
     {(row.loadCount===0||row.billingPending)&&<p className={`dashboard-client-note ${row.billingPending?'is-pending':''}`}>{row.loadCount===0?'Sem entregas no período. ':''}{row.billingPending?'ATR ou cotação a apurar.':''}</p>}
    </article>;
   }):<DashboardEmpty text="Nenhum cliente nesta seleção" detail="Ajuste os filtros para consultar os clientes dos contratos da empresa ativa."/>}
  </div>
  {rows.length>0&&<p className="dashboard-client-scope">A receber: saldo das entregas da seleção, por contrato.</p>}
 </DashboardPanel>;
}

function ClientStat({label,value,unit,marker}:{label:string;value:string;unit?:string;marker:string}){
 return <div data-client-stat={marker}><dt>{label}</dt><dd title={value} style={{'--client-stat-length':Math.max(1,value.length),'--client-stat-unit':unit?`${unit.length*6+5}px`:'0px'} as CSSProperties}><span>{value}</span>{unit&&<small>{unit}</small>}</dd></div>;
}
