import {verifyTvVideo,playbackItag,playbackVideoId,preflightMediaIndex,trustedMediaUrl,TvPlaybackError} from './playbackSafety.ts';

type ResolvedFormat={url:string;mimeType:string;contentLength:number|undefined};
export type TvPlayback={manifest:string;formats:Map<number,ResolvedFormat>;expiresAt:number};
type Youtube=Awaited<ReturnType<typeof import('youtubei.js')['Innertube']['create']>>;
let client:Promise<Youtube>|null=null,clientCreated=0;
const SESSION_MS=60*60*1000;

async function getYoutube(){
 if(client&&Date.now()-clientCreated<SESSION_MS)return client;
 clientCreated=Date.now();
 client=(async()=>{
  const [{Innertube,Log,Platform},{getQuickJS,shouldInterruptAfterDeadline}]=await Promise.all([import('youtubei.js'),import('quickjs-emscripten')]);
  Log.setLevel(Log.Level.NONE);
  const quickjs=await getQuickJS();
  // Remote player algorithms run inside a memory/time-limited VM with no Node, network or filesystem access.
  Platform.shim.eval=async data=>quickjs.evalCode(`(function(){${data.output}\n})()`,{shouldInterrupt:shouldInterruptAfterDeadline(Date.now()+3000),memoryLimitBytes:32*1024*1024,maxStackSizeBytes:1024*1024});
  const fetchImpl:typeof fetch=async(input,init={})=>{
   const target=new URL(typeof input==='string'?input:input instanceof URL?input.toString():input.url);
   if(target.protocol!=='https:'||!['www.youtube.com','youtube.com','youtubei.googleapis.com','www.google.com','jnn-pa.googleapis.com'].includes(target.hostname)||target.username||target.password||target.port)throw new TvPlaybackError('Serviço de vídeo indisponível.');
   const sourceSignal=init.signal??(input instanceof Request?input.signal:undefined);
   return fetch(input,{...init,redirect:'error',signal:sourceSignal?AbortSignal.any([sourceSignal,AbortSignal.timeout(18000)]):AbortSignal.timeout(18000)});
  };
  return Innertube.create({fetch:fetchImpl,retrieve_player:true,generate_session_locally:true,enable_session_cache:false,lang:'pt',location:'BR'});
 })().catch(()=>{client=null;throw new TvPlaybackError('Não foi possível iniciar o serviço de vídeo.');});
 return client;
}

async function resolveVideo(videoId:string):Promise<TvPlayback>{
 const youtube=await getYoutube();
 const clients=['WEB','MWEB','IOS','ANDROID_VR'] as const;
 for(const clientName of clients){
  try{
   const info=await youtube.getBasicInfo(videoId,{client:clientName});
   console.info('dashboard-tv player response',{client:clientName,status:info.playability_status?.status??'unknown',hasPublisher:!!info.basic_info.channel_id});
   verifyTvVideo(videoId,{id:info.basic_info.id,channelId:info.basic_info.channel_id,status:info.playability_status?.status,private:info.basic_info.is_private,live:info.basic_info.is_live,upcoming:info.basic_info.is_upcoming,postLive:info.basic_info.is_post_live_dvr});
   const available=info.streaming_data?.adaptive_formats??[];
   const compatible=available.filter(format=>!format.drm_families?.length&&!format.is_type_otf&&!!format.init_range&&!!format.index_range&&(
    format.has_video&&!format.has_audio&&format.mime_type.startsWith('video/mp4')&&format.mime_type.includes('avc1')&&(format.height??9999)<=720
    ||format.has_audio&&!format.has_video&&format.mime_type.startsWith('audio/mp4')&&format.mime_type.includes('mp4a')&&!format.is_drc&&!format.is_secondary&&(!format.audio_track||format.audio_track.audio_is_default)
   ));
   // Two video qualities and one default audio track keep startup bounded and avoid fetching unused variants.
   const videoFormats=compatible.filter(format=>format.has_video).sort((a,b)=>(b.height??0)-(a.height??0));
   const highest=videoFormats[0],lower=videoFormats.find(format=>(format.height??0)===360&&format.itag!==highest?.itag);
   const audio=compatible.filter(format=>format.has_audio).sort((a,b)=>b.bitrate-a.bitrate)[0];
   const candidates=[highest,lower,audio].filter((format):format is NonNullable<typeof format>=>!!format);
   const playable=await Promise.all(candidates.map(async format=>{
    try{
     const url=trustedMediaUrl(await format.decipher(youtube.session.player));
     const range=format.index_range!;
     return await preflightMediaIndex(url.toString(),`bytes=${range.start}-${range.end}`,format.content_length)?format:null;
    }catch{return null;}
   }));
   const supported=playable.filter((format):format is NonNullable<typeof format>=>!!format);
   if(!supported.some(format=>format.has_video)||!supported.some(format=>format.has_audio))throw new TvPlaybackError('Não há um formato compatível disponível para este vídeo.',422);
   const formats=new Map<number,ResolvedFormat>();
   const manifest=await info.toDash({format_filter:format=>!supported.includes(format),url_transformer:source=>{
    const url=trustedMediaUrl(source),itag=playbackItag(url.searchParams.get('itag')),format=supported.find(format=>format.itag===itag);
    if(!format)throw new TvPlaybackError('Formato de vídeo indisponível.');
    formats.set(itag,{url:url.toString(),mimeType:format.mime_type.split(';')[0],contentLength:format.content_length});
    return new URL(`/api/dashboard-tv/stream?videoId=${videoId}&itag=${itag}`,'https://dashboard.invalid');
   }});
   if(!formats.size||manifest.length>100000)throw new TvPlaybackError('Não foi possível preparar o vídeo.');
   const safeManifest=manifest.replaceAll('https://dashboard.invalid','');
   // MPD may contain schema URLs; every actual media URL must point to our authenticated endpoint.
   const urls=[...safeManifest.matchAll(/<BaseURL>([^<]+)<\/BaseURL>/g)].map(match=>match[1]);
   if(!urls.length||urls.some(url=>!url.startsWith(`/api/dashboard-tv/stream?videoId=${videoId}&amp;itag=`)))throw new TvPlaybackError('Não foi possível preparar o vídeo.');
   const expires=Math.min(...[...formats.values()].map(format=>Number(new URL(format.url).searchParams.get('expire'))*1000).filter(expiry=>Number.isFinite(expiry)&&expiry>Date.now()));
   return {manifest:safeManifest,formats,expiresAt:Math.min(Date.now()+300000,expires-60000)};
  }catch(error){
   if(error instanceof TvPlaybackError&&error.status===403)throw error;
   if(clientName===clients.at(-1))throw error instanceof TvPlaybackError?error:new TvPlaybackError('Não foi possível preparar este vídeo. Tente outro vídeo ou abra o canal.');
  }
 }
 throw new TvPlaybackError('Vídeo temporariamente indisponível.');
}

export function createPlaybackResolver({resolve=resolveVideo,now=Date.now,maxEntries=64,maxPending=8,timeoutMs=40000}:{resolve?:(id:string)=>Promise<TvPlayback>;now?:()=>number;maxEntries?:number;maxPending?:number;timeoutMs?:number}={}){
 const cache=new Map<string,TvPlayback>(),pending=new Map<string,Promise<TvPlayback>>();
 return async function getPlayback(raw:string,{refresh=false}:{refresh?:boolean}={}){
  const videoId=playbackVideoId(raw);
  for(const [key,value]of cache)if(value.expiresAt<=now())cache.delete(key);
  const current=cache.get(videoId);if(current&&!refresh)return current;
  if(pending.has(videoId))return pending.get(videoId)!;
  if(pending.size>=maxPending)throw new TvPlaybackError('Há muitos vídeos sendo preparados. Aguarde e tente novamente.',429);
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new TvPlaybackError('O vídeo demorou para ficar disponível. Tente novamente.')),timeoutMs);});
  const task=Promise.race([resolve(videoId),timeout]).then(value=>{
   while(cache.size>=maxEntries){const oldest=cache.keys().next().value;if(oldest===undefined)break;cache.delete(oldest);}
   cache.set(videoId,value);return value;
  }).finally(()=>{clearTimeout(timer);pending.delete(videoId);});
  pending.set(videoId,task);return task;
 };
}
export const getTvPlayback=createPlaybackResolver();
