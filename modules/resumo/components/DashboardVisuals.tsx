'use client';
import {Fragment,useEffect,useState,useSyncExternalStore,type CSSProperties,type ReactNode} from 'react';
import {ArrowUpRight,ChevronLeft,ChevronRight,Layers3,Leaf,Target} from 'lucide-react';
import {Bar,CartesianGrid,ComposedChart,LabelList,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {decimalLabel} from '@/shared/utils/presentation';
import {useDashboardValues} from '../dashboardValues';
import type {ExecutiveDimension,ExecutiveSummaryData} from '../types';
import {usePlotSize} from '../hooks/usePlotSize';

const geometry={width:1,height:1};
const palette=['#187653','#b58a43','#91a39d'];
const compact=(value:number)=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(value);
const narrowQuery='(max-width: 760px)';
const subscribeNarrow=(change:()=>void)=>{const media=window.matchMedia(narrowQuery);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);};
const isNarrow=()=>window.matchMedia(narrowQuery).matches;
const threePanelQuery='(max-width: 1100px)';
const subscribeThreePanels=(change:()=>void)=>{const media=window.matchMedia(threePanelQuery);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);};
const isThreePanelsNarrow=()=>window.matchMedia(threePanelQuery).matches;

export function DashboardAnalysis({first,second,third,labels=['Gráfico','Detalhes']}:{first:ReactNode;second:ReactNode;third?:ReactNode;labels?:[string,string,string?]}){
 const narrow=useSyncExternalStore(third===undefined?subscribeNarrow:subscribeThreePanels,third===undefined?isNarrow:isThreePanelsNarrow,()=>false),[view,setView]=useState(0);
 const panels=third===undefined?[first,second]:[first,second,third],current=Math.min(view,panels.length-1);
 return <div className="executive-analysis-shell">{narrow&&<div className="executive-mobile-views" role="group" aria-label="Conteúdo desta aba">{panels.map((_,index)=><button type="button" key={index} aria-pressed={current===index} onClick={()=>setView(index)}>{labels[index]}</button>)}</div>}<div className={`executive-analysis ${narrow?'executive-analysis-single':''} ${third!==undefined?'has-third':''}`}>{panels.map((panel,index)=>(!narrow||current===index)?<Fragment key={index}>{panel}</Fragment>:null)}</div></div>;
}

export function DashboardPanel({eyebrow,title,subtitle,children,actions,className=''}:{eyebrow:string;title:string;subtitle?:string;children:ReactNode;actions?:ReactNode;className?:string}){
 return <section className={`executive-panel ${className}`}><header className="executive-panel-header"><div><span className="executive-panel-eyebrow">{eyebrow}</span>{title&&<h3>{title}</h3>}{subtitle&&<p>{subtitle}</p>}</div>{actions}</header>{children}</section>;
}

export function DashboardBars({rows,title,eyebrow='VOLUME CARREGADO',subtitle,showValues=false,showAtr=false,minRowHeight=0,presenting=false,slideDurationMs=120000}:{rows:{id:string;name:string;loadedVolume:string;averageAtr?:string}[];title:string;eyebrow?:string;subtitle?:string;showValues?:boolean;showAtr?:boolean;minRowHeight?:number;presenting?:boolean;slideDurationMs?:number}){
 const measured=showValues||showAtr||minRowHeight>0;
 const {ref,size:plotSize}=usePlotSize(),nameWidth=measured?Math.max(80,Math.min(145,plotSize.width*.25)):145,atrWidth=showAtr?Math.min(115,plotSize.width*.3):0;
 const [page,setPage]=useState(0),size=minRowHeight>0&&plotSize.height>0?Math.max(1,Math.min(4,Math.floor((plotSize.height-48)/minRowHeight))):4,pages=Math.max(1,Math.ceil(rows.length/size)),current=Math.min(page,pages-1),shown=rows.slice(current*size,(current+1)*size);
 useEffect(()=>{
  if(!presenting||pages<2)return;
  const timer=window.setTimeout(()=>setPage((current+1)%pages),Math.max(1000,slideDurationMs/pages));
  return()=>window.clearTimeout(timer);
 },[presenting,pages,current,slideDurationMs]);
 return <DashboardPanel title={title} eyebrow={eyebrow} subtitle={subtitle} actions={pages>1?<PageControls page={current} pages={pages} onChange={setPage} label={title}/>:undefined}>
  {shown.some(row=>Number(row.loadedVolume)>0)?<div ref={measured?ref:undefined} className="executive-bar-plot" role="img" aria-label={shown.map(row=>`${row.name}: ${decimalLabel(row.loadedVolume)} t${showAtr?`; ${farmAtrLabel(row.averageAtr)}`:''}`).join('. ')}>
   <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={geometry}>
    <ComposedChart data={shown.map(row=>({...row,volume:Number(row.loadedVolume),shortName:row.name.length>26?row.name.slice(0,24)+'…':row.name}))} layout="vertical" margin={{left:0,right:24+atrWidth,top:16,bottom:4}}>
     <CartesianGrid horizontal={false} stroke="#e9eeeb" strokeDasharray="3 4"/>
     <XAxis type="number" tickFormatter={compact} axisLine={false} tickLine={false} tick={{fill:'#819087',fontSize:11}}/>
     <YAxis dataKey="shortName" type="category" width={nameWidth} axisLine={false} tickLine={false} tick={{fill:'#53665b',fontSize:11}}/>
     <Tooltip cursor={{fill:'#f4f8f5'}} formatter={(value,_name,item)=>[`${decimalLabel(String(value))} t${showAtr?` · ${farmAtrLabel(item.payload?.averageAtr)}`:''}`,'Volume']} labelFormatter={(_label,payload)=>payload?.[0]?.payload?.name??''} contentStyle={{borderRadius:10,border:'1px solid #e3eae5',fontSize:12}}/>
     <Bar dataKey="volume" fill="#287e5a" radius={[0,5,5,0]} maxBarSize={28} isAnimationActive={false}>
      {showValues&&<LabelList dataKey="loadedVolume" content={props=><VolumeBarLabel {...props} chartWidth={plotSize.width-atrWidth}/>}/>}
      {showAtr&&<LabelList dataKey="averageAtr" content={props=><FarmAtrLabel {...props} chartWidth={plotSize.width} columnWidth={atrWidth}/>}/>}
     </Bar>
    </ComposedChart>
   </ResponsiveContainer>
  </div>:<DashboardEmpty text={pages>1&&rows.some(row=>Number(row.loadedVolume)>0)?'Sem carregamentos nesta página':'Nenhum carregamento neste recorte'} detail={pages>1?'Navegue pelas páginas para consultar os outros registros.':'Os valores aparecem quando as cargas são vinculadas aos contratos.'}/>}
  <div className="executive-card-caption"><span>{showAtr?'Toneladas líquidas · ATR ponderado (kg/t)':'Toneladas líquidas · período selecionado'}</span><span>{rows.length} {rows.length===1?'registro':'registros'}</span></div>
 </DashboardPanel>;
}

const farmAtrLabel=(value:unknown)=>value===undefined||value===null||value===''?'ATR a apurar':`ATR ${decimalLabel(String(value))} kg/t`;
function FarmAtrLabel({y,height,value,chartWidth,columnWidth}:{y?:number|string;height?:number|string;value?:unknown;chartWidth:number;columnWidth:number}){
 if(chartWidth<=0||columnWidth<=0)return null;
 const text=farmAtrLabel(value),left=chartWidth-columnWidth+6,top=Number(y??0)+Number(height??0)/2,width=Math.max(1,columnWidth-8);
 const font=Math.min(chartWidth>=450?11:10,(width-10)/(text.length*.59));
 return <g data-farm-atr="true"><title>{text}</title><rect x={left} y={top-12} width={width} height={24} rx={5} fill="#fff4e4"/><text x={left+width/2} y={top} dy=".35em" textAnchor="middle" fill="#99611b" fontSize={font} fontWeight={600}>{text}</text></g>;
}

function VolumeBarLabel({x,y,width,height,value,chartWidth}:{x?:number|string;y?:number|string;width?:number|string;height?:number|string;value?:unknown;chartWidth:number}){
 if(chartWidth<=0||value===undefined||value===null)return null;
 const left=Number(x??0),top=Number(y??0),barWidth=Number(width??0),barHeight=Number(height??0),text=`${decimalLabel(String(value))} t`,preferred=chartWidth>=450?13:11;
 const outsideSpace=Math.max(0,chartWidth-left-barWidth-13),textWidth=text.length*preferred*.62;
 const inside=barWidth>=textWidth+16||barWidth-14>=outsideSpace;
 const room=Math.max(1,inside?barWidth-14:outsideSpace),font=Math.min(preferred,room/(Math.max(1,text.length)*.62));
 return <text className={`executive-volume-label ${inside?'is-inside':'is-outside'}`} x={inside?left+barWidth-8:left+barWidth+7} y={top+barHeight/2} dy=".35em" textAnchor={inside?'end':'start'} fontSize={font} fontWeight={650} fill={inside?'#fff':'#203e2e'}>{text}</text>;
}

export function DashboardDimensionList({rows,title}:{rows:ExecutiveDimension[];title:string}){
 const {money}=useDashboardValues();
 const [page,setPage]=useState(0),size=3,pages=Math.max(1,Math.ceil(rows.length/size)),current=Math.min(page,pages-1),shown=rows.slice(current*size,(current+1)*size);
 return <DashboardPanel eyebrow="PARTICIPAÇÃO E RESULTADO" title={title} subtitle="Volumes, qualidade e valores do mesmo período." actions={pages>1?<PageControls page={current} pages={pages} onChange={setPage} label={title}/>:undefined}>
  <div className="executive-dimension-list">{shown.length?shown.map((row,index)=><article key={row.id}><div className="executive-dimension-title"><span className="executive-rank">{String(current*size+index+1).padStart(2,'0')}</span><strong title={row.name}>{row.name}</strong><b>{decimalLabel(row.sharePercent)}<small>%</small></b></div><div className="executive-track"><i style={{width:`${Math.min(100,Math.max(0,Number(row.sharePercent)))}%`}}/></div><dl><div><dt>Produção</dt><dd>{decimalLabel(row.loadedVolume)} <small>t</small></dd></div><div><dt>ATR médio</dt><dd>{decimalLabel(row.averageAtr)} <small>kg/t</small></dd></div><div><dt>Líquido</dt><dd>{money(row.netAmount)}</dd></div></dl><footer><span>{row.contractCount} contrato(s) · {row.loadCount} carga(s)</span>{row.billingPending&&<span className="executive-pending-tag">ATR ou cotação pendente</span>}</footer></article>):<DashboardEmpty text="Nenhum registro nesta seleção" detail="Altere o período ou os filtros para consultar outros registros."/>}</div>
 </DashboardPanel>;
}

export function DashboardHarvest({data}:{data:ExecutiveSummaryData}){
 const methods=data.harvestMethods??[];
 const columns=[{code:'1',label:'Manual'},{code:'2',label:'Mecanizada'},{code:'unknown',label:'Não classificado'}].filter(column=>column.code!=='unknown'||methods.some(method=>method.code==='unknown'&&method.loadCount>0));
 return <DashboardPanel eyebrow="MODALIDADE DA COLHEITA" title="Manual e mecanizada" subtitle="Classificação pelo tipo dos contratos vinculados.">
  <dl className="executive-harvest-columns" style={{'--harvest-columns':columns.length} as CSSProperties}>{columns.map((column,index)=>{
   const row=methods.find(method=>method.code===column.code),volume=row?decimalLabel(row.loadedVolume):'—';
   return <div key={column.code} style={{'--harvest-color':palette[index],'--harvest-value-width':Math.max(1,volume.length*.62)} as CSSProperties}><dt><i/>{column.label}</dt><dd><strong>{volume}</strong><small>toneladas</small><span>{row?`${row.loadCount} carga(s)`:'Sem classificação disponível'}</span></dd></div>;
  })}</dl>
  <p className="executive-harvest-total"><span>Volume no período</span><strong>{decimalLabel(data.totals.loadedVolume)} <small>t</small></strong></p>
 </DashboardPanel>;
}

export function DashboardContractList({data}:{data:ExecutiveSummaryData}){
 const {money}=useDashboardValues();
 const [page,setPage]=useState(0),size=3,pages=Math.max(1,Math.ceil(data.contracts.length/size)),current=Math.min(page,pages-1),rows=data.contracts.slice(current*size,(current+1)*size),performance=new Map(data.contractPerformance.map(row=>[row.id,row]));
 return <DashboardPanel eyebrow="ENTREGA DO CONTRATO" title="Andamento da carteira" subtitle="Entrega acumulada em todas as datas." actions={pages>1?<PageControls page={current} pages={pages} onChange={setPage} label="Contratos"/>:undefined}>
  <div className="executive-contract-list">{rows.length?rows.map(row=>{const detail=performance.get(row.id);return <article key={row.id}><div><span className="executive-contract-status">{row.status}</span><ModuleLink href={`/contratos?contrato=${row.id}`} aria-label={`Abrir contrato ${row.contractNumber||row.title}`} title="Abrir contrato"><ArrowUpRight size={17}/></ModuleLink></div><h4 title={row.clientName}>{row.clientName}</h4><p title={row.title}>{row.contractNumber||row.title}</p><div className="executive-contract-progress"><span>{detail?`${decimalLabel(detail.totalLoadedVolume)} / ${decimalLabel(detail.contractedVolume)} t`:'Sem meta informada'}</span><strong>{detail?`${decimalLabel(detail.deliveryPercent)}%`:'—'}</strong></div><div className="executive-track"><i style={{width:`${Math.min(100,Math.max(0,Number(detail?.deliveryPercent??0)))}%`}}/></div><footer><span>No período: <b>{decimalLabel(row.loadedVolume)} t</b></span><span>Líquido: <b>{money(row.netAmount)}</b></span></footer></article>;}):<DashboardEmpty text="Nenhum contrato nesta seleção" detail="Consulte outra empresa ou ajuste os filtros."/>}</div>
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
