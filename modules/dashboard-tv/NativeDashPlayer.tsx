'use client';
import {useEffect,useRef,useState,type RefObject} from 'react';
import type {MediaPlayerClass} from 'dashjs';
import {ExternalLink,Loader2,Play,Pause,RefreshCw,Volume2,VolumeX,Maximize} from 'lucide-react';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {getSupabaseBrowserClient} from '@/shared/supabase/client';
import {authenticatedFetch} from '@/shared/supabase/rpc';
import {nativeManifest} from './nativeManifest';
import './nativePlayer.css';

type Props={videoId:string;title:string;autoplay:boolean;paused:boolean;onActiveChange?:(active:boolean)=>void;onEnded?:()=>void;onUnavailable?:()=>void};
type Status='idle'|'loading'|'ready'|'blocked'|'error';

export function NativeDashPlayer({videoId,title,autoplay,paused,onActiveChange,onEnded,onUnavailable}:Props){
 const {user}=useAuth(),ownerId=user?.id;
 const videoRef=useRef<HTMLVideoElement>(null),playerRef=useRef<MediaPlayerClass|null>(null);
 const callbacks=useRef({onActiveChange,onEnded,onUnavailable}),pausedRef=useRef(paused),resume=useRef(false),hasPlayed=useRef(false);
 const [requested,setRequested]=useState(false),[attempt,setAttempt]=useState(0);
 const [status,setStatus]=useState<Status>(autoplay?'loading':'idle'),[error,setError]=useState('');
 const shouldLoad=autoplay||requested;
 useEffect(()=>{callbacks.current={onActiveChange,onEnded,onUnavailable};},[onActiveChange,onEnded,onUnavailable]);
 useEffect(()=>{
  pausedRef.current=paused;
  const video=videoRef.current;if(!video)return;
  playerRef.current?.updateSettings({streaming:{scheduling:{scheduleWhilePaused:!paused}}});
  if(paused){resume.current=resume.current||!video.paused;video.pause();callbacks.current.onActiveChange?.(false);}
  else if(resume.current){resume.current=false;void video.play().catch(()=>{setStatus('blocked');callbacks.current.onActiveChange?.(false);});}
 },[paused]);
 useEffect(()=>{
  const video=videoRef.current;
  if(!shouldLoad||!video)return;
  let disposed=false,failed=false,manifestUrl:string|null=null;
  let startupTimer:ReturnType<typeof setTimeout>|undefined;
  const controller=new AbortController();
  const fail=(message:string)=>{
   if(disposed||failed)return;failed=true;
   clearTimeout(startupTimer);setError(message);setStatus('error');callbacks.current.onActiveChange?.(false);
   controller.abort();video.pause();
   playerRef.current?.updateSettings({streaming:{scheduling:{scheduleWhilePaused:false}}});
   callbacks.current.onUnavailable?.();
   // Dash can still have track creation promises in flight after an error.
   // Leave its models intact until ordinary unmount/retry cleanup resets them.
  };
  const playing=()=>{
   if(disposed||failed)return;
   if(pausedRef.current){video.pause();return;}
   hasPlayed.current=true;clearTimeout(startupTimer);setStatus('ready');callbacks.current.onActiveChange?.(true);
  };
  const waiting=()=>{if(!disposed&&!failed&&hasPlayed.current&&!video.paused&&!pausedRef.current)callbacks.current.onActiveChange?.(true);};
  const playRequested=()=>{if(!disposed&&!failed){if(pausedRef.current)video.pause();else playerRef.current?.updateSettings({streaming:{scheduling:{scheduleWhilePaused:true}}});}};
  const stopped=()=>{if(!disposed){if(hasPlayed.current)playerRef.current?.updateSettings({streaming:{scheduling:{scheduleWhilePaused:false}}});callbacks.current.onActiveChange?.(false);}};
  const ended=()=>{if(!disposed&&!failed){callbacks.current.onActiveChange?.(false);callbacks.current.onEnded?.();}};
  const loaded=()=>{if(!disposed&&!failed)setStatus(current=>current==='loading'?'ready':current);};
  const mediaError=()=>fail('Não foi possível reproduzir este vídeo. Tente novamente ou abra no YouTube.');
  video.addEventListener('playing',playing);video.addEventListener('waiting',waiting);video.addEventListener('stalled',waiting);
  video.addEventListener('play',playRequested);video.addEventListener('pause',stopped);video.addEventListener('ended',ended);video.addEventListener('loadeddata',loaded);video.addEventListener('error',mediaError);
  hasPlayed.current=false;
  const initialize=async()=>{
   if(!ownerId)throw new Error('Entre novamente para assistir aos vídeos.');
   if(!('MediaSource' in window)&&!('ManagedMediaSource' in window))throw new Error('Este navegador não oferece suporte ao player. Abra o vídeo no YouTube.');
   const responsePromise=authenticatedFetch(`/api/dashboard-tv/playback?videoId=${encodeURIComponent(videoId)}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)]),cache:'no-store'});
   const [dash,response]=await Promise.all([import('dashjs'),responsePromise]);
   if(disposed)return;
   if(!response.ok){
    const payload:unknown=await response.json().catch(()=>null);
    const message=payload&&typeof payload==='object'&&'error' in payload&&typeof payload.error==='string'?payload.error:'O vídeo está temporariamente indisponível.';
    throw new Error(message);
   }
   const payload:unknown=await response.json();
   if(disposed)return;
   if(!payload||typeof payload!=='object'||!('manifest' in payload)||typeof payload.manifest!=='string'||payload.manifest.length>500000||!payload.manifest.includes('<MPD'))throw new Error('O servidor não retornou um vídeo válido.');
   const manifest=nativeManifest(payload.manifest,window.location.origin,videoId);
   const engine=dash.MediaPlayer().create();playerRef.current=engine;
   // Initialize without a source, then register settings/interceptors before requests start.
   engine.initialize(video,undefined,shouldLoad&&!pausedRef.current);
   // Bootstrap must buffer while HTMLVideoElement is initially paused. Native
   // play/pause events disable scheduling after an explicit pause instead.
   engine.updateSettings({debug:{logLevel:0},streaming:{manifestRequestTimeout:15000,fragmentRequestTimeout:20000,fragmentRequestProgressTimeout:12000,buffer:{bufferTimeDefault:10,bufferTimeAtTopQuality:20},utcSynchronization:{enabled:false},scheduling:{scheduleWhilePaused:!pausedRef.current}}});
   engine.addRequestInterceptor(async request=>{
    // The manifest is a local Blob. Media must stay on our authenticated endpoint.
    if(request.url===manifestUrl)return request;
    try{
     const target=new URL(request.url,window.location.origin);
     if(disposed||failed||target.origin!==window.location.origin||target.pathname!=='/api/dashboard-tv/stream'||target.searchParams.get('videoId')!==videoId)throw new Error('Destino de mídia inválido.');
     const {data:{session},error:sessionError}=await getSupabaseBrowserClient().auth.getSession();
     if(disposed||failed||sessionError||!session||session.user.id!==ownerId)throw new Error('Sessão indisponível.');
     request.headers={...request.headers,Authorization:`Bearer ${session.access_token}`};
     return request;
    }catch{
     // dash.js 5.2 does not catch rejected interceptor promises. Resolve a local,
     // empty request after stopping playback, never send credentials elsewhere.
     if(!disposed)fail('Sua sessão ou a conexão de vídeo foi interrompida. Tente novamente.');
     request.url='data:application/octet-stream;base64,';request.headers={};
     return request;
    }
   });
   engine.on(dash.MediaPlayer.events.ERROR,event=>{const detail=event.error,code=detail&&typeof detail==='object'&&'code' in detail?detail.code:undefined;console.error('dashboard-tv playback error',JSON.stringify({code,time:video.currentTime,mediaError:video.error?.code}));mediaError();});
   engine.on(dash.MediaPlayer.events.PLAYBACK_NOT_ALLOWED,()=>{if(!disposed&&!failed){clearTimeout(startupTimer);engine.updateSettings({streaming:{scheduling:{scheduleWhilePaused:false}}});setStatus('blocked');callbacks.current.onActiveChange?.(false);}});
   manifestUrl=URL.createObjectURL(new Blob([manifest],{type:'application/dash+xml'}));
   resume.current=shouldLoad&&pausedRef.current;
   engine.attachSource(manifestUrl);
   startupTimer=setTimeout(()=>{if(!hasPlayed.current&&!pausedRef.current&&shouldLoad)fail('O vídeo demorou para iniciar. Tente novamente.');},35000);
  };
  void initialize().catch(caught=>{
   if(disposed)return;
   const timeout=caught instanceof DOMException&&(caught.name==='TimeoutError'||caught.name==='AbortError');
   fail(timeout?'O vídeo demorou para carregar. Tente novamente.':caught instanceof Error?caught.message:'Não foi possível carregar o vídeo.');
  });
  return()=>{
   disposed=true;controller.abort();clearTimeout(startupTimer);
   video.removeEventListener('playing',playing);video.removeEventListener('waiting',waiting);video.removeEventListener('stalled',waiting);
   video.removeEventListener('play',playRequested);video.removeEventListener('pause',stopped);video.removeEventListener('ended',ended);video.removeEventListener('loadeddata',loaded);video.removeEventListener('error',mediaError);
   callbacks.current.onActiveChange?.(false);video.pause();playerRef.current?.reset();playerRef.current=null;
   video.removeAttribute('src');video.load();if(manifestUrl)URL.revokeObjectURL(manifestUrl);
  };
 },[videoId,ownerId,autoplay,shouldLoad,attempt]);
 const requestPlay=()=>{
  if(!shouldLoad){setStatus('loading');setRequested(true);return;}
  if(pausedRef.current)return;
  void videoRef.current?.play().then(()=>setStatus('ready')).catch(()=>{setStatus('blocked');callbacks.current.onActiveChange?.(false);});
 };
 const retry=()=>{setError('');setStatus('loading');setRequested(true);setAttempt(value=>value+1);};
 return <div className="dashboard-tv-player dashboard-tv-native-player" data-player="native-dash">
  <video ref={videoRef} title={title} aria-label={title} playsInline preload="none"/>
  <NativePlayerControls videoRef={videoRef} playerRef={playerRef} ready={status==='ready'} disabled={paused||status==='error'||status==='loading'} onPlay={requestPlay}/>
  {status==='loading'&&<div className="dashboard-tv-player-message" role="status"><Loader2 className="animate-spin" size={26}/><span>Carregando vídeo…</span></div>}
  {(status==='idle'||status==='blocked')&&<div className="dashboard-tv-player-blocked" role="status"><span>{status==='blocked'?'Clique para iniciar o vídeo.':'Vídeo pronto para assistir.'}</span><button type="button" disabled={paused} onClick={requestPlay}><Play size={16}/> Reproduzir</button></div>}
  {status==='error'&&<div className="dashboard-tv-player-message dashboard-tv-native-error" role="alert"><p>{error}</p><button type="button" onClick={retry}><RefreshCw size={16}/> Tentar novamente</button><a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/> Abrir no YouTube</a></div>}
 </div>;
}

const mediaClock=(value:number)=>{const seconds=Math.max(0,Math.floor(Number.isFinite(value)?value:0)),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60);return `${hours?`${hours}:`:''}${String(minutes).padStart(hours?2:1,'0')}:${String(seconds%60).padStart(2,'0')}`;};
function NativePlayerControls({videoRef,playerRef,ready,disabled,onPlay}:{videoRef:RefObject<HTMLVideoElement|null>;playerRef:RefObject<MediaPlayerClass|null>;ready:boolean;disabled:boolean;onPlay:()=>void}){
 const [media,setMedia]=useState({playing:false,current:0,duration:0,volume:1,muted:false});
 const [qualities,setQualities]=useState<{id:string;height:number}[]>([]),[quality,setQuality]=useState('auto'),[resolution,setResolution]=useState(0);
 const [fullscreen,setFullscreen]=useState(false),[controlError,setControlError]=useState('');
 useEffect(()=>{
  const video=videoRef.current,engine=playerRef.current;if(!video)return;
  let disposed=false;
  const sync=()=>{if(!disposed){setMedia({playing:!video.paused&&!video.ended,current:Number.isFinite(video.currentTime)?video.currentTime:0,duration:Number.isFinite(video.duration)?video.duration:0,volume:video.volume,muted:video.muted});setResolution(video.videoHeight);}};
  const syncQualities=()=>{if(disposed||!engine)return;try{const items=engine.getRepresentationsByType('video').filter(item=>item.height>0).sort((a,b)=>b.height-a.height);setQualities(items.filter((item,index)=>items.findIndex(other=>other.height===item.height)===index).map(item=>({id:item.id,height:item.height})));}catch{/* Tracks can still be initializing. */}};
  const syncFullscreen=()=>setFullscreen(document.fullscreenElement===video.parentElement);
  const events=['timeupdate','durationchange','loadedmetadata','volumechange','play','pause','ended','resize'];
  events.forEach(event=>video.addEventListener(event,sync));document.addEventListener('fullscreenchange',syncFullscreen);
  engine?.on('streamInitialized',syncQualities);engine?.on('representationSwitch',syncQualities);
  const initial=setTimeout(()=>{sync();syncQualities();},0);
  return()=>{disposed=true;clearTimeout(initial);events.forEach(event=>video.removeEventListener(event,sync));document.removeEventListener('fullscreenchange',syncFullscreen);engine?.off('streamInitialized',syncQualities);engine?.off('representationSwitch',syncQualities);};
 },[videoRef,playerRef,ready]);
 const toggle=()=>{const video=videoRef.current;if(!video||disabled)return;if(video.paused)onPlay();else video.pause();};
 const mute=()=>{const video=videoRef.current;if(video)video.muted=!video.muted;};
 const enterFullscreen=()=>{
  const video=videoRef.current,container=video?.parentElement;if(!container)return;
  setControlError('');
  if(document.fullscreenElement===container){void document.exitFullscreen().catch(()=>setControlError('Use Esc para sair da tela cheia.'));return;}
  if(container.requestFullscreen){void container.requestFullscreen().catch(()=>setControlError('Não foi possível abrir o vídeo em tela cheia.'));return;}
  const native=video as HTMLVideoElement&{webkitEnterFullscreen?:()=>void};
  if(native.webkitEnterFullscreen)native.webkitEnterFullscreen();else setControlError('Este navegador não oferece tela cheia para o vídeo.');
 };
 const selectQuality=(id:string)=>{
  const engine=playerRef.current;if(!engine)return;
  try{engine.updateSettings({streaming:{abr:{autoSwitchBitrate:{video:id==='auto'}}}});if(id!=='auto')engine.setRepresentationForTypeById('video',id,true);setQuality(id);setControlError('');}
  catch{engine.updateSettings({streaming:{abr:{autoSwitchBitrate:{video:true}}}});setQuality('auto');setControlError('Não foi possível trocar a resolução. Seleção automática mantida.');}
 };
 return <div className="dashboard-tv-native-controls" aria-label="Controles do vídeo">
  <input className="dashboard-tv-seek" type="range" min="0" max={media.duration||1} step="0.1" value={Math.min(media.current,media.duration||0)} disabled={!ready||disabled||!media.duration} aria-label="Posição do vídeo" aria-valuetext={`${mediaClock(media.current)} de ${mediaClock(media.duration)}`} onChange={event=>{const video=videoRef.current;if(video)video.currentTime=Number(event.target.value);}}/>
  <div className="dashboard-tv-native-toolbar">
   <button type="button" className="dashboard-tv-transport" aria-label={media.playing?'Pausar vídeo':'Reproduzir vídeo'} disabled={disabled} onClick={toggle}>{media.playing?<Pause size={19} fill="currentColor"/>:<Play size={19} fill="currentColor"/>}</button>
   <span className="dashboard-tv-native-time">{mediaClock(media.current)} <span>/ {mediaClock(media.duration)}</span></span>
   <div className="dashboard-tv-native-volume"><button type="button" aria-label={media.muted?'Ativar som':'Silenciar vídeo'} onClick={mute}>{media.muted||media.volume===0?<VolumeX size={19}/>:<Volume2 size={19}/>}</button><input type="range" min="0" max="1" step="0.05" value={media.muted?0:media.volume} aria-label="Volume do vídeo" onChange={event=>{const video=videoRef.current;if(video){video.volume=Number(event.target.value);video.muted=false;}}}/></div>
   <label className="dashboard-tv-native-quality"><span>Resolução</span><select aria-label="Resolução do vídeo" value={quality} disabled={!ready||!qualities.length} onChange={event=>selectQuality(event.target.value)}><option value="auto">Auto{resolution?` · ${resolution}p`:''}</option>{qualities.map(item=><option key={item.id} value={item.id}>{item.height}p</option>)}</select></label>
   <button type="button" aria-label={fullscreen?'Sair da tela cheia do vídeo':'Tela cheia do vídeo'} onClick={enterFullscreen}><Maximize size={19}/></button>
  </div>
  {controlError&&<span className="dashboard-tv-control-error" role="status">{controlError}</span>}
 </div>;
}
