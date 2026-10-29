'use client';

import {useEffect,useId,useState,type CSSProperties} from 'react';
import {ArrowUpRight,ChevronLeft,ChevronRight} from 'lucide-react';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {decimalLabel} from '@/shared/utils/presentation';
import type {ExecutiveSummaryData} from '../types';
import {usePlotSize} from '../hooks/usePlotSize';
import {DashboardBars,DashboardEmpty,DashboardPanel} from './DashboardVisuals';

type Props={data:ExecutiveSummaryData;presenting?:boolean;slideDurationMs?:number};
type Comparison=NonNullable<ExecutiveSummaryData['contractComparison']>;
type Client=Comparison['clients'][number];
type View='general'|'clients'|'contracts';
const views=[{id:'general',label:'Geral'},{id:'clients',label:'Por cliente'},{id:'contracts',label:'Contratos'}] as const;

export function DashboardContractAnalysis({data,presenting=false,slideDurationMs=120000}:Props){
 const [view,setView]=useState<View>('general'),id=useId(),comparison=data.contractComparison;
 const viewDurationMs=slideDurationMs/views.length;
 useEffect(()=>{
  if(!presenting)return;
  const timer=window.setTimeout(()=>setView(current=>views[(views.findIndex(item=>item.id===current)+1)%views.length].id),viewDurationMs);
  return()=>window.clearTimeout(timer);
 },[presenting,view,viewDurationMs]);
 return <div className="dashboard-contract-analysis">
  <div className="dashboard-contract-views" role="group" aria-label="Visões dos contratos">{views.map((item,index)=><button type="button" key={item.id} id={`${id}-${item.id}-tab`} aria-controls={`${id}-${view}-panel`} aria-pressed={view===item.id} onClick={()=>setView(item.id)} onKeyDown={event=>{
   let next:number|undefined;
   if(event.key==='ArrowRight')next=(index+1)%views.length;if(event.key==='ArrowLeft')next=(index+views.length-1)%views.length;
   if(event.key==='Home')next=0;if(event.key==='End')next=views.length-1;
   if(next!==undefined){event.preventDefault();setView(views[next].id);document.getElementById(`${id}-${views[next].id}-tab`)?.focus();}
  }}>{item.label}</button>)}</div>
  <div className="dashboard-contract-view" data-view={view} role="region" id={`${id}-${view}-panel`} aria-labelledby={`${id}-${view}-tab`} tabIndex={0}>
   {!comparison?<DashboardEmpty text="Comparativo dos contratos indisponível" detail="Atualize o Dashboard para consultar as modalidades dos contratos."/>:view==='general'?<GeneralComparison comparison={comparison} presenting={presenting} slideDurationMs={viewDurationMs}/>:view==='clients'?<ClientComparison rows={comparison.clients} presenting={presenting} slideDurationMs={viewDurationMs}/>:<ContractCards data={data} comparison={comparison} presenting={presenting} slideDurationMs={viewDurationMs}/>}
  </div>
 </div>;
}

function GeneralComparison({comparison,presenting=false,slideDurationMs=120000}:{comparison:Comparison;presenting?:boolean;slideDurationMs?:number}){
 const unknown=comparison.types.find(row=>row.code==='unknown');
 const note=unknown&&(unknown.contractCount>0||unknown.loadCount>0)?`Não classificado: ${decimalLabel(unknown.loadedVolume)} t · ${unknown.contractCount} contrato(s).`:'Todos os contratos da seleção têm modalidade identificada.';
 return <div className="dashboard-contract-general">
  <DashboardBars showValues showAtr minRowHeight={64} presenting={presenting} slideDurationMs={slideDurationMs} rows={comparison.types.map(row=>({id:row.code,name:row.label,loadedVolume:row.loadedVolume,averageAtr:row.averageAtr}))} title="Entregas por modalidade do contrato" eyebrow="COMPARATIVO GERAL" subtitle="Toneladas e ATR ponderado no período selecionado."/>
  <p className="dashboard-contract-source">{note} A modalidade vem do cadastro do contrato, independente da modalidade informada na carga.</p>
 </div>;
}

function usePages<T extends{id:string}>(rows:readonly T[],threshold:number,presenting:boolean,slideDurationMs:number,allowColumns=false){
 const {ref,size}=usePlotSize(),columns=allowColumns&&size.width>=1000&&size.height>=260?2:1;
 const pageSize=columns===2||size.height>=threshold?2:1,pages=Math.max(1,Math.ceil(rows.length/pageSize));
 const signature=pageSize+':'+rows.map(row=>row.id).join('|'),[navigation,setNavigation]=useState({signature:'',page:0});
 const page=navigation.signature===signature?Math.min(navigation.page,pages-1):0;
 useEffect(()=>{
  if(!presenting||pages<2)return;
  const timer=window.setTimeout(()=>setNavigation({signature,page:(page+1)%pages}),Math.max(1000,slideDurationMs/pages));
  return()=>window.clearTimeout(timer);
 },[presenting,pages,page,signature,slideDurationMs]);
 return {ref,page,pageSize,pages,columns,shown:rows.slice(page*pageSize,(page+1)*pageSize),navigate:(next:number)=>setNavigation({signature,page:next})};
}

function Pager({page,pages,navigate,label}:{page:number;pages:number;navigate:(page:number)=>void;label:string}){
 return pages>1?<nav className="executive-inline-pager dashboard-comparison-pager" aria-label={`Paginação · ${label}`}><button type="button" disabled={page===0} aria-label={`Página anterior · ${label}`} onClick={()=>navigate(page-1)}><ChevronLeft size={14}/></button><span aria-live="polite">{page+1}/{pages}</span><button type="button" disabled={page+1>=pages} aria-label={`Próxima página · ${label}`} onClick={()=>navigate(page+1)}><ChevronRight size={14}/></button></nav>:undefined;
}

function ClientComparison({rows,presenting,slideDurationMs}:{rows:Client[];presenting:boolean;slideDurationMs:number}){
 const {ref:listRef,page,pageSize,pages,columns,shown,navigate}=usePages(rows,460,presenting,slideDurationMs,true);
 return <DashboardPanel className="dashboard-contract-client-panel" title="Modalidades por cliente" eyebrow="COMPARATIVO DOS CLIENTES" subtitle="Toneladas e ATR de todos os contratos do cliente no período." actions={<Pager page={page} pages={pages} navigate={navigate} label="Modalidades por cliente"/>}>
  <div ref={listRef} className="dashboard-contract-card-list" data-comparison-page-size={pageSize} data-comparison-layout={columns===2?'columns':'rows'} style={{gridTemplateColumns:`repeat(${columns},minmax(0,1fr))`,gridTemplateRows:`repeat(${columns===2?1:Math.max(1,shown.length)},minmax(0,1fr))`}}>
   {shown.length?shown.map(client=>{
    const methodRows=client.types.filter(row=>row.code!=='unknown'||row.contractCount>0||row.loadCount>0);
    return <article className="dashboard-contract-client-card" key={client.id} data-comparison-client-id={client.id}>
     <h4>{client.name}</h4>
     <table className="dashboard-contract-matrix"><caption className="sr-only">Toneladas e ATR de {client.name}</caption><thead><tr><th scope="col">Modalidade</th><th scope="col">Toneladas</th><th scope="col">ATR (kg/t)</th></tr></thead><tbody>
      <ComparisonRow label="Geral" code="overall" volume={client.overall.loadedVolume} atr={client.overall.averageAtr}/>
      {methodRows.map(row=><ComparisonRow key={row.code} label={row.label} code={row.code} volume={row.loadedVolume} atr={row.averageAtr}/>)}
     </tbody></table>
     <footer>{client.overall.contractCount} contrato(s) · {client.overall.loadCount} carregamento(s)</footer>
    </article>;
   }):<DashboardEmpty text="Nenhum cliente nesta seleção" detail="Ajuste os filtros para comparar as modalidades dos contratos."/>}
  </div>
 </DashboardPanel>;
}

function ComparisonRow({label,code,volume,atr}:{label:string;code:string;volume:string;atr:string}){
 return <tr data-comparison-type={code}><th scope="row">{label}</th><ComparisonCell value={decimalLabel(volume)} marker="volume"/><ComparisonCell value={decimalLabel(atr)} marker="atr"/></tr>;
}

function ComparisonCell({value,marker}:{value:string;marker:string}){
 return <td data-comparison-value={marker} title={value}><span className="dashboard-contract-cell-value" style={{'--contract-cell-length':Math.max(1,value.length)} as CSSProperties}>{value}</span></td>;
}

function ContractCards({data,comparison,presenting,slideDurationMs}:{data:ExecutiveSummaryData;comparison:Comparison;presenting:boolean;slideDurationMs:number}){
 const {ref:listRef,page,pageSize,pages,shown,navigate}=usePages(data.contracts,540,presenting,slideDurationMs),performance=new Map(data.contractPerformance.map(row=>[row.id,row])),metadata=new Map(comparison.contracts.map(row=>[row.id,row]));
 return <DashboardPanel className="dashboard-contract-detail-panel" eyebrow="ANDAMENTO DOS CONTRATOS" title="Entregas e metas" subtitle="Entregas e ATR no período; andamento acumulado em todas as datas." actions={<Pager page={page} pages={pages} navigate={navigate} label="Contratos"/>}>
  <div ref={listRef} className="dashboard-contract-card-list" data-contract-page-size={pageSize} style={{gridTemplateRows:`repeat(${Math.max(1,shown.length)},minmax(0,1fr))`}}>
   {shown.length?shown.map(contract=>{
    const detail=performance.get(contract.id),meta=metadata.get(contract.id),type=comparison.types.find(row=>row.code===meta?.typeCode),progress=detail?.deliveryPercent??'';
    return <article className="dashboard-contract-detail-card" key={contract.id} data-comparison-contract-id={contract.id}>
     <div className="dashboard-contract-detail-heading"><span className={`dashboard-contract-type code-${meta?.typeCode??'unknown'}`} title={meta?.typeName}>{type?.label??'Não classificado'}</span><span>{contract.status}</span><ModuleLink href={`/contratos?contrato=${contract.id}`} aria-label={`Abrir contrato ${contract.contractNumber||contract.title}`} title="Abrir contrato"><ArrowUpRight size={16}/></ModuleLink></div>
     <h4>{contract.clientName}</h4><p className="dashboard-contract-name">{[contract.contractNumber,contract.title].filter(Boolean).join(' · ')}</p>
     <dl className="dashboard-contract-period"><ContractValue label="Entregue no período" value={decimalLabel(detail?.periodLoadedVolume??contract.loadedVolume)} unit="t" marker="volume"/><ContractValue label="ATR no período" value={decimalLabel(detail?.averageAtr)} unit={detail?.averageAtr?'kg/t':undefined} marker="atr"/></dl>
     <div className="dashboard-contract-accumulated"><span>Acumulado / contratado</span><strong>{detail?`${decimalLabel(detail.totalLoadedVolume)} / ${decimalLabel(detail.contractedVolume)} t`:'Meta a apurar'}</strong>{progress!==''&&<span>{decimalLabel(progress)}%</span>}</div>
     {progress!==''&&<div className="executive-track" aria-hidden="true"><i style={{width:`${Math.min(100,Math.max(0,Number(progress)))}%`}}/></div>}
     <footer>{detail?.periodLoadCount??contract.loadCount} carregamento(s) no período</footer>
    </article>;
   }):<DashboardEmpty text="Nenhum contrato nesta seleção" detail="Altere o período ou os filtros para consultar os contratos."/>}
  </div>
 </DashboardPanel>;
}

function ContractValue({label,value,unit,marker}:{label:string;value:string;unit?:string;marker:string}){
 return <div data-contract-period={marker}><dt>{label}</dt><dd title={value} style={{'--contract-value-length':Math.max(1,value.length),'--contract-unit-space':unit?`${unit.length*6+5}px`:'0px'} as CSSProperties}><span>{value}</span>{unit&&<small>{unit}</small>}</dd></div>;
}
