'use client';
import {useState,useSyncExternalStore,type ReactNode} from 'react';
import {ArrowUpRight,ChevronLeft,ChevronRight,Layers3,Leaf,Target} from 'lucide-react';
import {Bar,CartesianGrid,Cell,ComposedChart,Pie,PieChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {decimalLabel,moneyLabel} from '@/shared/utils/presentation';
import type {ExecutiveDimension,ExecutiveSummaryData} from '../types';

const geometry={width:1,height:1};
const palette=['#187653','#b58a43','#91a39d'];
const compact=(value:number)=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(value);
const narrowQuery='(max-width: 760px)';
const subscribeNarrow=(change:()=>void)=>{const media=window.matchMedia(narrowQuery);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);};
const isNarrow=()=>window.matchMedia(narrowQuery).matches;

export function DashboardAnalysis({first,second,labels=['Gráfico','Detalhes']}:{first:ReactNode;second:ReactNode;labels?:[string,string]}){
 const narrow=useSyncExternalStore(subscribeNarrow,isNarrow,()=>false),[view,setView]=useState(0);
 return <div className="executive-analysis-shell">{narrow&&<div className="executive-mobile-views" role="group" aria-label="Conteúdo desta aba">{labels.map((label,index)=><button type="button" key={label} aria-pressed={view===index} onClick={()=>setView(index)}>{label}</button>)}</div>}<div className={`executive-analysis ${narrow?'executive-analysis-single':''}`}>{(!narrow||view===0)&&first}{(!narrow||view===1)&&second}</div></div>;
}

export function DashboardPanel({eyebrow,title,subtitle,children,actions,className=''}:{eyebrow:string;title:string;subtitle?:string;children:ReactNode;actions?:ReactNode;className?:string}){
 return <section className={`executive-panel ${className}`}><header className="executive-panel-header"><div><span className="executive-panel-eyebrow">{eyebrow}</span><h3>{title}</h3>{subtitle&&<p>{subtitle}</p>}</div>{actions}</header>{children}</section>;
}

export function DashboardBars({rows,title,eyebrow='VOLUME CARREGADO',subtitle}:{rows:{id:string;name:string;loadedVolume:string}[];title:string;eyebrow?:string;subtitle?:string}){
 const [page,setPage]=useState(0),size=4,pages=Math.max(1,Math.ceil(rows.length/size)),current=Math.min(page,pages-1),shown=rows.slice(current*size,(current+1)*size);
 return <DashboardPanel title={title} eyebrow={eyebrow} subtitle={subtitle} actions={pages>1?<PageControls page={current} pages={pages} onChange={setPage} label={title}/>:undefined}>
  {shown.some(row=>Number(row.loadedVolume)>0)?<div className="executive-bar-plot" role="img" aria-label={shown.map(row=>`${row.name}: ${decimalLabel(row.loadedVolume)} t`).join('. ')}><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={geometry}><ComposedChart data={shown.map(row=>({...row,volume:Number(row.loadedVolume),shortName:row.name.length>26?row.name.slice(0,24)+'…':row.name}))} layout="vertical" margin={{left:0,right:24,top:16,bottom:4}}><CartesianGrid horizontal={false} stroke="#e9eeeb" strokeDasharray="3 4"/><XAxis type="number" tickFormatter={compact} axisLine={false} tickLine={false} tick={{fill:'#819087',fontSize:11}}/><YAxis dataKey="shortName" type="category" width={145} axisLine={false} tickLine={false} tick={{fill:'#53665b',fontSize:11}}/><Tooltip cursor={{fill:'#f4f8f5'}} formatter={value=>[`${decimalLabel(String(value))} t`,'Volume']} labelFormatter={(_label,payload)=>payload?.[0]?.payload?.name??''} contentStyle={{borderRadius:10,border:'1px solid #e3eae5',fontSize:12}}/><Bar dataKey="volume" fill="#287e5a" radius={[0,5,5,0]} maxBarSize={28} isAnimationActive={false}/></ComposedChart></ResponsiveContainer></div>:<DashboardEmpty text="Nenhum carregamento neste recorte" detail="Os valores aparecem quando as cargas são vinculadas aos contratos."/>}
  <div className="executive-card-caption"><span>Toneladas líquidas · período selecionado</span><span>{rows.length} {rows.length===1?'registro':'registros'}</span></div>
 </DashboardPanel>;
}

export function DashboardDimensionList({rows,title}:{rows:ExecutiveDimension[];title:string}){
 const [page,setPage]=useState(0),size=3,pages=Math.max(1,Math.ceil(rows.length/size)),current=Math.min(page,pages-1),shown=rows.slice(current*size,(current+1)*size);
 return <DashboardPanel eyebrow="PARTICIPAÇÃO E RESULTADO" title={title} subtitle="Volumes, qualidade e valores do mesmo período." actions={pages>1?<PageControls page={current} pages={pages} onChange={setPage} label={title}/>:undefined}>
  <div className="executive-dimension-list">{shown.length?shown.map((row,index)=><article key={row.id}><div className="executive-dimension-title"><span className="executive-rank">{String(current*size+index+1).padStart(2,'0')}</span><strong title={row.name}>{row.name}</strong><b>{decimalLabel(row.sharePercent)}<small>%</small></b></div><div className="executive-track"><i style={{width:`${Math.min(100,Math.max(0,Number(row.sharePercent)))}%`}}/></div><dl><div><dt>Produção</dt><dd>{decimalLabel(row.loadedVolume)} <small>t</small></dd></div><div><dt>ATR médio</dt><dd>{decimalLabel(row.averageAtr)} <small>kg/t</small></dd></div><div><dt>Líquido</dt><dd>{moneyLabel(row.netAmount)}</dd></div></dl><footer><span>{row.contractCount} contrato(s) · {row.loadCount} carga(s)</span>{row.billingPending&&<span className="executive-pending-tag">ATR ou cotação pendente</span>}</footer></article>):<DashboardEmpty text="Nenhum registro nesta seleção" detail="Altere o período ou os filtros para consultar outros registros."/>}</div>
 </DashboardPanel>;
}

export function DashboardHarvest({data}:{data:ExecutiveSummaryData}){
 const methods=data.harvestMethods??[],hasVolume=methods.some(item=>Number(item.loadedVolume)>0);
 return <DashboardPanel eyebrow="MODALIDADE DA COLHEITA" title="Manual e mecanizada" subtitle="Classificação registrada nos carregamentos.">
  <div className="executive-harvest-plot"><div className="executive-donut"><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={geometry}><PieChart><Pie data={hasVolume?methods.map(row=>({...row,value:Number(row.loadedVolume)})):[{code:'empty',value:1}]} dataKey="value" nameKey="label" innerRadius="72%" outerRadius="94%" paddingAngle={hasVolume?3:0} stroke="none" isAnimationActive={false}>{(hasVolume?methods:[{code:'empty'}]).map((row,index)=><Cell key={row.code} fill={hasVolume?palette[index%palette.length]:'#edf1ef'}/>)}</Pie>{hasVolume&&<Tooltip formatter={value=>[`${decimalLabel(String(value))} t`,'Volume']} contentStyle={{borderRadius:10,fontSize:12}}/>}</PieChart></ResponsiveContainer><div className="executive-donut-center"><small>Volume no período</small><strong>{decimalLabel(data.totals.loadedVolume)}</strong><span>toneladas</span></div></div></div>
  <dl className="executive-harvest-legend">{methods.map((row,index)=><div key={row.code}><dt><i style={{background:palette[index%palette.length]}}/>{row.label}</dt><dd>{decimalLabel(row.loadedVolume)} <small>t</small><span>{row.loadCount} carga(s)</span></dd></div>)}</dl>
 </DashboardPanel>;
}

export function DashboardContractList({data}:{data:ExecutiveSummaryData}){
 const [page,setPage]=useState(0),size=3,pages=Math.max(1,Math.ceil(data.contracts.length/size)),current=Math.min(page,pages-1),rows=data.contracts.slice(current*size,(current+1)*size),performance=new Map(data.contractPerformance.map(row=>[row.id,row]));
 return <DashboardPanel eyebrow="ENTREGA DO CONTRATO" title="Andamento da carteira" subtitle="Entrega acumulada em todas as datas." actions={pages>1?<PageControls page={current} pages={pages} onChange={setPage} label="Contratos"/>:undefined}>
  <div className="executive-contract-list">{rows.length?rows.map(row=>{const detail=performance.get(row.id);return <article key={row.id}><div><span className="executive-contract-status">{row.status}</span><ModuleLink href={`/contratos?contrato=${row.id}`} aria-label={`Abrir contrato ${row.contractNumber||row.title}`} title="Abrir contrato"><ArrowUpRight size={17}/></ModuleLink></div><h4 title={row.clientName}>{row.clientName}</h4><p title={row.title}>{row.contractNumber||row.title}</p><div className="executive-contract-progress"><span>{detail?`${decimalLabel(detail.totalLoadedVolume)} / ${decimalLabel(detail.contractedVolume)} t`:'Sem meta informada'}</span><strong>{detail?`${decimalLabel(detail.deliveryPercent)}%`:'—'}</strong></div><div className="executive-track"><i style={{width:`${Math.min(100,Math.max(0,Number(detail?.deliveryPercent??0)))}%`}}/></div><footer><span>No período: <b>{decimalLabel(row.loadedVolume)} t</b></span><span>Líquido: <b>{moneyLabel(row.netAmount)}</b></span></footer></article>;}):<DashboardEmpty text="Nenhum contrato nesta seleção" detail="Consulte outra empresa ou ajuste os filtros."/>}</div>
 </DashboardPanel>;
}

export function DashboardSeason({data}:{data:ExecutiveSummaryData}){
 const p=data.planning;
 return <section className="executive-season" aria-label="Safra do grupo"><div className="executive-season-name"><span><Leaf size={19}/></span><div><small>SAFRA DO GRUPO</small><strong title={p.periodName}>{p.periodName||'Planejamento ainda não definido'}</strong></div></div><div><small>Meta de colheita</small><strong>{Number(p.harvestTargetTons)>0?`${decimalLabel(p.harvestTargetTons)} t`:'Sem meta'}</strong></div><div><small>Colheita acumulada</small><strong>{decimalLabel(p.harvestedTons)} t</strong></div><div className="executive-season-progress"><span><Target size={13}/>{Number(p.harvestTargetTons)>0?`${decimalLabel(p.harvestPercent)}% da meta`:'Aguardando meta'}</span><div className="executive-track"><i style={{width:`${Math.min(100,Math.max(0,Number(p.harvestPercent)))}%`}}/></div></div><p>Acumulado até a data final.<br/>Independe do filtro de contrato.</p></section>;
}

function PageControls({page,pages,onChange,label}:{page:number;pages:number;onChange:(page:number)=>void;label:string}){
 return <div className="executive-inline-pager"><button type="button" disabled={page===0} aria-label={`Página anterior · ${label}`} onClick={()=>onChange(page-1)}><ChevronLeft size={14}/></button><span>{page+1}/{pages}</span><button type="button" disabled={page+1>=pages} aria-label={`Próxima página · ${label}`} onClick={()=>onChange(page+1)}><ChevronRight size={14}/></button></div>;
}
export function DashboardEmpty({text,detail}:{text:string;detail:string}){return <div className="executive-empty"><span><Layers3 size={25}/></span><strong>{text}</strong><p>{detail}</p></div>;}
