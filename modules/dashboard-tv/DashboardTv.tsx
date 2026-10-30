'use client';
import {useEffect,useMemo,useState} from 'react';
import {ChevronLeft,ChevronRight,ExternalLink,Loader2,Play,Tv} from 'lucide-react';
import {TV_CHANNELS,type TvSettings,type TvVideo} from './catalog';
import {useDashboardTv} from './useDashboardTv';
import {NativeDashPlayer} from './NativeDashPlayer';
import './tv.css';

const publication=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'short'});
const publicationLabel=(value:string)=>publication.format(new Date(value)).replace(/ de /g,' ').replace('.','');
export function DashboardTv({settings,presenting,paused=false,onPlaybackActiveChange,onPlaybackEnded,onModeChange}:{settings:TvSettings;presenting:boolean;paused?:boolean;onPlaybackActiveChange?:(active:boolean)=>void;onPlaybackEnded?:()=>void;onModeChange?:(mode:'autoplay'|'preview')=>void}){
 const feed=useDashboardTv(),[selected,setSelected]=useState<string|null>(null),[requested,setRequested]=useState<string|null>(null);
 const [automaticFailures,setAutomaticFailures]=useState<{signature:string;ids:string[]}>({signature:'',ids:[]});
 const allowed=settings.channelIds.join('|');
 const enabledChannels=useMemo(()=>TV_CHANNELS.filter(item=>settings.channelIds.includes(item.id)),[allowed]); // eslint-disable-line react-hooks/exhaustive-deps
 const videos=useMemo(()=>feed.data?.videos.filter(video=>settings.channelIds.includes(video.channelId))??[],[feed.data,allowed]); // eslint-disable-line react-hooks/exhaustive-deps
 const index=Math.max(0,videos.findIndex(video=>video.id===selected)),lead=videos[index];
 const videoSignature=`${settings.mode}|${videos.map(video=>video.id).join('|')}`;
 const failedIds=automaticFailures.signature===videoSignature?automaticFailures.ids:[];
 const attemptLimit=Math.min(5,videos.length),exhausted=failedIds.length>=attemptLimit&&attemptLimit>0;
 const playing=!!lead&&(requested===lead.id||settings.mode==='autoplay');
 const resetFailures=()=>setAutomaticFailures({signature:'',ids:[]});
 const change=(offset:number)=>{if(videos.length){resetFailures();setSelected(videos[(index+offset+videos.length)%videos.length].id);setRequested(null);}};
 const playbackActive=(active:boolean)=>{if(active&&failedIds.length)resetFailures();onPlaybackActiveChange?.(active);};
 const unavailable=()=>{
  if(settings.mode!=='autoplay'||!lead)return;
  const nextFailures=failedIds.includes(lead.id)?failedIds:[...failedIds,lead.id];
  setAutomaticFailures({signature:videoSignature,ids:nextFailures});
  if(nextFailures.length>=attemptLimit)return;
  const next=Array.from({length:videos.length},(_,offset)=>videos[(index+offset+1)%videos.length]).find(video=>!nextFailures.includes(video.id));
  if(next){setSelected(next.id);setRequested(null);}
 };
 const ended=()=>{if(settings.mode==='autoplay'&&videos.length>1)change(1);onPlaybackEnded?.();};
 const toggleAutoplay=()=>{if(!onModeChange)return;resetFailures();setRequested(null);onModeChange(settings.mode==='autoplay'?'preview':'autoplay');};
 // Preview mode rotates cards during the presentation without loading any video or audio.
 useEffect(()=>{if(!presenting||paused||settings.mode!=='preview'||playing||videos.length<2)return;const timer=setTimeout(()=>setSelected(videos[(index+1)%videos.length].id),8000);return()=>clearTimeout(timer);},[presenting,paused,settings.mode,playing,videos,index]);
 const unavailableSources=feed.data?.sources.filter(source=>settings.channelIds.includes(source.id)&&source.status!=='current')??[];
 return <div className="dashboard-tv" aria-label="TV Agro">
  {!enabledChannels.length?<TvEmpty title="Nenhum canal selecionado" detail="Ative pelo menos um canal nas configurações da TV Agro."/>:!lead?<TvEmpty loading={feed.isPending} title={feed.isPending?'Selecionando vídeos do agro':'Nenhum vídeo do agro disponível'} detail={feed.error?.message??'Os canais selecionados ainda não retornaram vídeos compatíveis com os temas do dashboard.'}/>:<div className="dashboard-tv-layout">
   <section className="dashboard-tv-feature" aria-label="Vídeo em destaque">
    <div className="dashboard-tv-screen">{playing?<NativeDashPlayer key={lead.id} videoId={lead.id} title={lead.title} autoplay paused={paused} onActiveChange={playbackActive} onEnded={ended} onUnavailable={unavailable}/>:<button type="button" className="dashboard-tv-preview" aria-label={`Reproduzir ${lead.title}`} onClick={()=>setRequested(lead.id)}><TvImage key={lead.id} video={lead}/><span className="dashboard-tv-preview-shade"/><span className="dashboard-tv-play"><Play size={26} fill="currentColor"/></span><span className="dashboard-tv-preview-caption">Clique para assistir</span></button>}</div>
    <div className="dashboard-tv-feature-copy"><span className="dashboard-tv-source"><strong>{lead.channelName}</strong><time dateTime={lead.publishedAt}>{publicationLabel(lead.publishedAt)}</time></span><h4>{lead.title}</h4><footer><a href={lead.url} target="_blank" rel="noopener noreferrer">Ver publicação <ExternalLink size={13}/></a><nav aria-label="Selecionar vídeo"><button type="button" aria-label="Vídeo anterior" disabled={videos.length<2} onClick={()=>change(-1)}><ChevronLeft size={18}/></button><span>{String(index+1).padStart(2,'0')} <i>/ {String(videos.length).padStart(2,'0')}</i></span><button type="button" aria-label="Próximo vídeo" disabled={videos.length<2} onClick={()=>change(1)}><ChevronRight size={18}/></button></nav></footer></div>
   </section>
   <aside className="dashboard-tv-queue" aria-label="Vídeos selecionados"><header><div className="dashboard-tv-queue-heading"><h4>A seguir</h4><span>{videos.length} vídeos <i>·</i> Últimas 36 horas</span></div><button type="button" className="dashboard-tv-autoplay" aria-label="Reprodução automática" aria-pressed={settings.mode==='autoplay'} disabled={!onModeChange} onClick={toggleAutoplay}><span>Reprodução automática</span><i aria-hidden="true"><b/></i></button></header><div>{videos.map(video=><button key={video.id} type="button" className={`dashboard-tv-video${video.id===lead.id?' is-selected':''}`} aria-pressed={video.id===lead.id} onClick={()=>{resetFailures();setSelected(video.id);setRequested(null);}}><span className="dashboard-tv-video-image"><TvImage video={video}/><Play size={16} fill="currentColor"/></span><span className="dashboard-tv-video-copy"><small>{video.channelName}{video.id===lead.id&&<i aria-hidden="true"/>}</small><strong>{video.title}</strong><time dateTime={video.publishedAt}>{publicationLabel(video.publishedAt)}</time></span></button>)}</div></aside>
  </div>}
  {exhausted&&<p className="dashboard-tv-playback-note" role="status">Não foi possível reproduzir os {attemptLimit} vídeos tentados. Escolha outro vídeo ou tente novamente mais tarde.</p>}
  <footer className="dashboard-tv-note"><span>{settings.mode==='autoplay'?'Reprodução automática':settings.mode==='preview'?'Prévia · reproduza ao clicar':'Aba pulada durante a apresentação'}</span>{unavailableSources.length>0&&<span role="status">{unavailableSources.map(source=>`${source.name}: ${source.status==='cached'?'última lista disponível':'indisponível'}`).join(' · ')}</span>}</footer>
 </div>;
}

function TvEmpty({title,detail,loading=false}:{title:string;detail:string;loading?:boolean}){return <div className="dashboard-tv-empty" role="status">{loading?<Loader2 size={30} className="animate-spin"/>:<Tv size={36}/>}<h4>{title}</h4><p>{detail}</p></div>;}
function TvImage({video}:{video:TvVideo}){
 const [failed,setFailed]=useState(false);
 if(failed)return <span className="dashboard-tv-image-placeholder"><Tv size={40}/></span>;
 // eslint-disable-next-line @next/next/no-img-element -- Official YouTube thumbnails are external public media.
 return <img src={video.thumbnailUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>;
}
