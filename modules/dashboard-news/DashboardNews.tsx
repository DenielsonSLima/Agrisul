'use client';
import {useEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import {ArrowUpRight,ChevronLeft,ChevronRight,Leaf,Loader2,Newspaper} from 'lucide-react';
import {Bar,CartesianGrid,ComposedChart,Line,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {atrMonths,formatAtrValue} from '@/modules/cadastro/atr/utils/atrGrouping';
import type {AtrRecord} from '@/modules/cadastro/atr/types';
import type {AgroNewsArticle} from './catalog';
import type {useAgroNews} from './useAgroNews';
import type {useDashboardAtr} from './useDashboardAtr';
import {DashboardWeather} from './DashboardWeather';
import {headlineIntervalMs,usableNewsImage} from './presentation';
import {DASHBOARD_MONEY_MASK,useDashboardValues} from '@/modules/resumo/dashboardValues';

type NewsQuery=ReturnType<typeof useAgroNews>;
type AtrQuery=ReturnType<typeof useDashboardAtr>;
const publicationFormat=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
const publication=(value:string)=>publicationFormat.format(new Date(value)).replace(/ de /g,' ').replace('.','');

export function DashboardNews({news,atr,presenting,slideDurationMs}:{news:NewsQuery;atr:AtrQuery;presenting:boolean;slideDurationMs:number}){
 const [scope,setScope]=useState<'cane'|'all'>('cane'),[selected,setSelected]=useState<string|null>(null),[latestPage,setLatestPage]=useState(0),[portraitSelected,setPortraitSelected]=useState<string|null>(null),[cardsPerPage,setCardsPerPage]=useState(4);
 const latestRef=useRef<HTMLDivElement>(null);
 const [failedImages,setFailedImages]=useState<string[]>([]);
 const articles=news.data?.articles;
 const stories=useMemo(()=>{
  const all=articles??[],focused=all.filter(article=>article.topic==='cane');
  const chosen=scope==='cane'&&focused.length?focused:all;
  const photographed=chosen.filter(article=>usableNewsImage(article.imageUrl)&&!failedImages.includes(article.imageUrl!));
  return photographed.length?photographed:chosen;
 },[articles,scope,failedImages]);
 const index=selected?Math.max(0,stories.findIndex(article=>article.id===selected)):Math.max(0,stories.findIndex(article=>!!article.imageUrl)),lead=stories[index];
 const secondary=useMemo(()=>(articles??[]).filter(article=>article.id!==lead?.id),[articles,lead?.id]);
 const portraitIndex=Math.max(0,secondary.findIndex(article=>article.id===portraitSelected)),portrait=secondary[portraitIndex];
 const latest=useMemo(()=>secondary.filter(article=>article.id!==portrait?.id),[secondary,portrait?.id]);
 const latestPages=Math.max(1,Math.ceil(latest.length/cardsPerPage)),page=Math.min(latestPage,latestPages-1);
 const interval=headlineIntervalMs(slideDurationMs,stories.length);
 useEffect(()=>{
  if(!presenting||stories.length<2||interval===null)return;
  const timer=window.setTimeout(()=>setSelected(stories[(index+1)%stories.length].id),interval);
  return()=>window.clearTimeout(timer);
 },[presenting,index,stories,interval]);
 useEffect(()=>{
  if(stories.length<2)return;const src=stories[(index+1)%stories.length].imageUrl;if(!usableNewsImage(src))return;
  const preview=new Image();preview.referrerPolicy='no-referrer';preview.src=src!;
  return()=>{preview.onload=null;preview.onerror=null;};
 },[index,stories]);
 useEffect(()=>{
  const node=latestRef.current;if(!node)return;
  const observer=new ResizeObserver(entries=>{
   const width=entries[0]?.contentRect.width??0;
   setCardsPerPage(width>=1080?4:width>=800?3:2);
  });
  observer.observe(node);return()=>observer.disconnect();
 },[]);
 const choose=(offset:number)=>{if(stories.length)setSelected(stories[(index+offset+stories.length)%stories.length].id);};
 return <div className="agro-news-dashboard" data-headline-interval={interval??undefined}>
  <div className="agro-news-layout">
   <aside className="agro-news-sidebar" aria-label="Últimas notícias e histórico de ATR">
    <NewsPortrait article={portrait} index={portraitIndex} count={secondary.length} onChange={offset=>{if(secondary.length)setPortraitSelected(secondary[(portraitIndex+offset+secondary.length)%secondary.length].id);}}/>
    <DashboardAtr atr={atr}/>
   </aside>
   <section className="agro-news-main" aria-label="Notícias do agronegócio">
    <div className="agro-news-top"><DashboardWeather presenting={presenting} slideDurationMs={slideDurationMs}/>
    {lead?<div className="agro-news-feature-wrap" data-dashboard-card>
     <a key={lead.id} href={lead.url} target="_blank" rel="noopener noreferrer" className="agro-news-feature" aria-label={`Ler ${lead.title} em ${lead.sourceName}`}>
      <NewsImage key={lead.imageUrl??lead.id} src={usableNewsImage(lead.imageUrl)?lead.imageUrl:null} featured onFailure={()=>{if(lead.imageUrl)setFailedImages(previous=>previous.includes(lead.imageUrl!)?previous:[...previous,lead.imageUrl!]);}}/>
      <div className="agro-news-feature-content"><span className="agro-news-story-label">{lead.topic==='cane'?'CANA · AÇÚCAR · ETANOL':'CENÁRIO DO AGRO'}</span><h4>{lead.title}</h4>{lead.description&&<p>{lead.description}</p>}<div className="agro-news-byline"><strong>{lead.sourceName}</strong><time dateTime={lead.publishedAt}>{publication(lead.publishedAt)}</time><ArrowUpRight size={16}/></div></div>
     </a>
     <div className="agro-news-focus" role="group" aria-label="Tema das manchetes"><button type="button" aria-pressed={scope==='cane'} onClick={()=>{setScope('cane');setSelected(null);}}>Cana em foco</button><button type="button" aria-pressed={scope==='all'} onClick={()=>{setScope('all');setSelected(null);}}>Todo o agro</button></div>
     <nav className="agro-news-feature-pager" aria-label="Manchetes em destaque"><span>{String(index+1).padStart(2,'0')}<small> / {String(stories.length).padStart(2,'0')}</small></span><button type="button" aria-label="Manchete anterior" disabled={stories.length<2} onClick={()=>choose(-1)}><ChevronLeft size={16}/></button><button type="button" aria-label="Próxima manchete" disabled={stories.length<2} onClick={()=>choose(1)}><ChevronRight size={16}/></button></nav>
    </div>:<div className="agro-news-empty" data-dashboard-card role="status">{news.isPending?<><Loader2 size={25} className="animate-spin"/><h4>Buscando as notícias do campo</h4><p>Reunindo as últimas publicações das fontes.</p></>:<><Newspaper size={28}/><h4>Notícias temporariamente indisponíveis</h4><p>Uma nova consulta será feita automaticamente.</p><button type="button" onClick={()=>void news.refetch()}>Tentar novamente</button></>}</div>}
    </div>
    <section className="agro-news-latest" aria-label="Mais notícias do agronegócio"><header><h4>Mais notícias <span>do agronegócio</span></h4><nav aria-label="Páginas das últimas notícias"><span>{page+1} / {latestPages}</span><button type="button" disabled={latestPages<2} aria-label="Notícias anteriores" onClick={()=>setLatestPage((page+latestPages-1)%latestPages)}><ChevronLeft size={14}/></button><button type="button" disabled={latestPages<2} aria-label="Próximas notícias" onClick={()=>setLatestPage((page+1)%latestPages)}><ChevronRight size={14}/></button></nav></header>
     <div ref={latestRef} className="agro-news-latest-grid" style={{'--news-card-count':cardsPerPage} as CSSProperties}>{latest.slice(page*cardsPerPage,page*cardsPerPage+cardsPerPage).map(article=><NewsBrief key={article.id} article={article}/>)}{!latest.length&&<p className="agro-news-latest-placeholder">As publicações mais recentes aparecerão aqui.</p>}</div>
    </section>
   </section>
  </div>
 </div>;
}

function NewsImage({src,featured=false,onFailure}:{src:string|null;featured?:boolean;onFailure?:()=>void}){
 const [failed,setFailed]=useState(false),[loaded,setLoaded]=useState(false);
 if(!src||failed)return <span className="agro-news-image-placeholder" aria-hidden="true"><Leaf size={featured?90:28}/></span>;
 // eslint-disable-next-line @next/next/no-img-element -- Publisher RSS thumbnails remain on their original CDNs.
 return <img className={`agro-news-image${loaded?' is-loaded':''}`} src={src} alt="" loading={featured?'eager':'lazy'} decoding="async" referrerPolicy="no-referrer" onLoad={()=>setLoaded(true)} onError={()=>{setFailed(true);onFailure?.();}}/>;
}
function NewsBrief({article}:{article:AgroNewsArticle}){
 return <a href={article.url} target="_blank" rel="noopener noreferrer" className="agro-news-brief" data-dashboard-card><span className="agro-news-brief-image"><NewsImage key={article.imageUrl??article.id} src={article.imageUrl}/></span><div><span className="agro-news-brief-topic">{article.topic==='cane'?'Cana & etanol':article.category}</span><h5>{article.title}</h5><footer><strong>{article.sourceName}</strong><time dateTime={article.publishedAt}>{publication(article.publishedAt)}</time></footer></div><ArrowUpRight size={14}/></a>;
}
function NewsPortrait({article,index,count,onChange}:{article:AgroNewsArticle|undefined;index:number;count:number;onChange:(offset:number)=>void}){
 return <section className="agro-news-portrait" data-dashboard-card aria-label="Últimas notícias com resumo"><header><h4><Newspaper size={13}/>Últimas notícias</h4><nav aria-label="Notícias do painel lateral"><span>{count?index+1:0}/{count}</span><button type="button" aria-label="Notícia lateral anterior" disabled={count<2} onClick={()=>onChange(-1)}><ChevronLeft size={13}/></button><button type="button" aria-label="Próxima notícia lateral" disabled={count<2} onClick={()=>onChange(1)}><ChevronRight size={13}/></button></nav></header>
  {article?<a key={article.id} href={article.url} target="_blank" rel="noopener noreferrer" title={article.title}>
   {article.imageUrl&&<span className="agro-news-portrait-image"><NewsImage key={article.imageUrl} src={article.imageUrl}/></span>}
   <div className="agro-news-portrait-copy"><span className="agro-news-brief-topic">{article.topic==='cane'?'Cana & etanol':article.category}</span><h5>{article.title}</h5>{article.description&&<p>{article.description}</p>}<footer><strong>{article.sourceName}</strong><time dateTime={article.publishedAt}>{publication(article.publishedAt)}</time></footer></div>
  </a>:<p className="agro-news-portrait-placeholder">Reunindo as últimas publicações.</p>}
 </section>;
}
const atrSeries=[
 {key:'monthlyGrossValue',label:'Mensal bruto',color:'#b5cdbb',kind:'bar'},
 {key:'monthlyNetValue',label:'Mensal líquido',color:'#4e8463',kind:'bar'},
 {key:'accumulatedGrossValue',label:'Acum. bruto',color:'#b48c45',kind:'line'},
 {key:'accumulatedNetValue',label:'Acum. líquido',color:'#4d7e9d',kind:'line'},
] as const;
const atrQuote=(value:string|null)=>value!==null&&value!==''?`R$ ${formatAtrValue(value)}`:'Não informado';
const chartQuote=(value:string|null)=>value!==null&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
function DashboardAtr({atr}:{atr:AtrQuery}){
 const {visible}=useDashboardValues(),quote=(value:string|null)=>visible?atrQuote(value):DASHBOARD_MONEY_MASK;
 const record=atr.record;
 // Number conversion is chart geometry only. Captions, legend and tooltip
 // retain the exact decimal strings returned by the authenticated ATR RPC.
 const chart=useMemo(()=>[...atr.records].reverse().map(item=>({
  month:`${atrMonths[item.month-1].slice(0,3)}/${String(item.year).slice(-2)}`,original:item,
  monthlyGrossValue:chartQuote(item.monthlyGrossValue),monthlyNetValue:chartQuote(item.monthlyNetValue),
  accumulatedGrossValue:chartQuote(item.accumulatedGrossValue),accumulatedNetValue:chartQuote(item.accumulatedNetValue),
 })),[atr.records]);
 return <aside className="dashboard-atr-card" data-dashboard-card aria-label="Cotações de ATR cadastradas pelo grupo">
  <header><div><span className="agro-news-eyebrow">REFERÊNCIA DO GRUPO</span><h3>ATR <small>R$/kg</small></h3></div><ModuleLink href="/cadastro?secao=atr" className="dashboard-atr-manage" aria-label="Abrir cadastro de ATR" title="Abrir cadastro de ATR"><ArrowUpRight size={15}/></ModuleLink></header>
  {record?<><p className="dashboard-atr-period">{chart.length===3?'Últimos 3 meses cadastrados':`${chart.length} ${chart.length===1?'mês cadastrado':'meses cadastrados'}`}<span>{atrMonths[record.month-1].slice(0,3)}/{record.year}</span></p>
   <div className="dashboard-atr-chart" data-dashboard-chart role="img" aria-label={`ATR mensal bruto e líquido em barras; acumulado bruto e líquido em linhas. ${chart.map(row=>`${row.month}: ${atrSeries.map(series=>`${series.label} ${quote(row.original[series.key])}`).join(', ')}`).join('. ')}`}>
    <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{width:1,height:1}}><ComposedChart data={chart} margin={{top:9,right:10,left:0,bottom:0}} barGap={3}>
     <CartesianGrid vertical={false} stroke="#edf1eb" strokeDasharray="3 4"/><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fontSize:9,fill:'#8c9c8d'}} height={21}/><YAxis width={31} axisLine={false} tickLine={false} tickCount={3} domain={[0,'auto']} tick={{fontSize:8,fill:'#9bab9b'}} tickFormatter={value=>visible?Number(value).toLocaleString('pt-BR',{maximumFractionDigits:2}):'•••'}/>
     <Tooltip formatter={(_value,name,item)=>{const series=atrSeries.find(series=>series.key===item.dataKey),original=item.payload?.original as AtrRecord|undefined;return [series&&original?quote(original[series.key]):'Não informado',String(name)];}} cursor={{fill:'#edf4ee77'}} contentStyle={{fontSize:10,border:'1px solid #dce6dc',borderRadius:8}}/>
     <Bar dataKey="monthlyGrossValue" name="Mensal bruto" fill="#b5cdbb" radius={[3,3,0,0]} maxBarSize={19} isAnimationActive={false}/><Bar dataKey="monthlyNetValue" name="Mensal líquido" fill="#4e8463" radius={[3,3,0,0]} maxBarSize={19} isAnimationActive={false}/>
     <Line type="monotone" dataKey="accumulatedGrossValue" name="Acumulado bruto" stroke="#b48c45" strokeWidth={2} strokeDasharray="4 3" dot={{r:2.5,fill:'#fff',strokeWidth:1.5}} connectNulls={false} isAnimationActive={false}/><Line type="monotone" dataKey="accumulatedNetValue" name="Acumulado líquido" stroke="#4d7e9d" strokeWidth={2} dot={{r:2.5,fill:'#fff',strokeWidth:1.5}} connectNulls={false} isAnimationActive={false}/>
    </ComposedChart></ResponsiveContainer>
   </div>
   <dl className="dashboard-atr-legend">{atrSeries.map(series=><div key={series.key}><dt><i className={`is-${series.kind}`} style={{'--atr-series-color':series.color} as CSSProperties}/>{series.label}</dt><dd title={quote(record[series.key])}>{quote(record[series.key])}</dd></div>)}</dl>
   {atr.error&&<p className="dashboard-atr-note">Atualização indisponível · última referência disponível</p>}
  </>:<div className="dashboard-atr-empty" role="status">{atr.loading?<><Loader2 size={20} className="animate-spin"/><p>Consultando o ATR cadastrado…</p></>:<><p>{atr.error?'Não foi possível consultar o ATR.':'Aguardando o cadastro das cotações.'}</p><small>Mensal e acumulado, bruto e líquido.</small></>}</div>}
 </aside>;
}
