import {TV_CHANNELS} from './catalog.ts';

export const MAX_TV_RANGE_BYTES=16*1024*1024;
export class TvPlaybackError extends Error{
 status:number;
 constructor(message:string,status=503){super(message);this.name='TvPlaybackError';this.status=status;}
}
export function playbackVideoId(value:string|null){
 if(!value||!/^[A-Za-z0-9_-]{11}$/.test(value))throw new TvPlaybackError('Vídeo inválido.',400);
 return value;
}
export function playbackItag(value:string|null){
 if(!value||!/^\d{1,4}$/.test(value)||Number(value)<1)throw new TvPlaybackError('Formato de vídeo inválido.',400);
 return Number(value);
}
export function assertTvUploader(channelId:string|undefined){
 if(!TV_CHANNELS.some(channel=>channel.channelId===channelId))throw new TvPlaybackError('Este vídeo não pertence aos canais da TV Agro.',403);
}
export function verifyTvVideo(expectedId:string,video:{id?:string;channelId?:string;status?:string;private?:boolean;live?:boolean;upcoming?:boolean;postLive?:boolean}){
 // Blocked player responses omit channel metadata. They must remain retryable,
 // while a confirmed foreign publisher must still stop the request immediately.
 if(video.status!=='OK'||video.id!==expectedId||!video.channelId)throw new TvPlaybackError('O YouTube não liberou este vídeo para reprodução no servidor. Tente outro vídeo.',503);
 assertTvUploader(video.channelId);
 if(video.private||video.live||video.upcoming||video.postLive)throw new TvPlaybackError('Este vídeo ainda não está disponível para reprodução. Abra o canal para acompanhar a transmissão.',422);
}
export function trustedMediaUrl(value:string|URL){
 let url:URL;try{url=new URL(value);}catch{throw new TvPlaybackError('Origem do vídeo indisponível.');}
 if(url.protocol!=='https:'||url.username||url.password||url.port&&!['443'].includes(url.port)||!/^([a-z0-9-]+\.)+googlevideo\.com$/i.test(url.hostname)||url.pathname!=='/videoplayback')throw new TvPlaybackError('Origem do vídeo indisponível.');
 return url;
}
export function playbackRange(value:string|null,total?:number){
 const match=value?.match(/^bytes=(\d+)-(\d+)$/);
 if(!match)throw new TvPlaybackError('Solicite um único intervalo de vídeo.',416);
 const start=Number(match[1]),requestedEnd=Number(match[2]);
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(requestedEnd)||start<0||requestedEnd<start||requestedEnd-start+1>MAX_TV_RANGE_BYTES||total!==undefined&&start>=total)throw new TvPlaybackError('Intervalo de vídeo inválido ou muito grande.',416);
 const end=total===undefined?requestedEnd:Math.min(requestedEnd,total-1);
 return {start,end,length:end-start+1,header:`bytes=${start}-${end}`};
}
export function validateMediaResponse(response:Response,range:ReturnType<typeof playbackRange>){
 const match=response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
 if(response.status!==206||!response.body||!match)throw new TvPlaybackError('O servidor de vídeo não aceitou o intervalo solicitado.');
 const start=Number(match[1]),end=Number(match[2]),total=Number(match[3]);
 const type=response.headers.get('content-type')?.split(';')[0]??'';
 const length=end-start+1,declared=response.headers.get('content-length');
 if(![start,end,total].every(Number.isSafeInteger)||start!==range.start||end!==Math.min(range.end,total-1)||end<start||total<=end||length>MAX_TV_RANGE_BYTES||declared!==null&&Number(declared)!==length||!['video/mp4','audio/mp4','video/webm','audio/webm','application/octet-stream'].includes(type))throw new TvPlaybackError('Resposta de vídeo inválida.');
 return {start,end,total,length,type};
}

export async function preflightMediaIndex(url:string,header:string,total:number|undefined,fetchImpl:typeof fetch=fetch){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
 let response:Response|undefined;
 try{
  const range=playbackRange(header,total);
  if(range.length>256*1024)return false;
  response=await fetchImpl(trustedMediaUrl(url),{headers:{Range:range.header},redirect:'error',signal:controller.signal});
  const media=validateMediaResponse(response,range),reader=response.body!.getReader();
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>media.length)throw Error('Oversized index');chunks.push(part.value);}}
  finally{await reader.cancel().catch(()=>{});}
  if(size!==media.length||size<8)return false;
  const prefix=new Uint8Array(8);let offset=0;
  for(const chunk of chunks){const bytes=chunk.subarray(0,8-offset);prefix.set(bytes,offset);offset+=bytes.length;if(offset===8)break;}
  // DASH SegmentBase needs the actual MP4 SIDX table, not a successful HTML/error response.
  return String.fromCharCode(...prefix.subarray(4,8))==='sidx';
 }catch{return false;}
 finally{clearTimeout(timer);controller.abort();await response?.body?.cancel().catch(()=>{});}
}
