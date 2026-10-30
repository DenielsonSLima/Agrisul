import {getRequestUser} from '@/shared/supabase/server';
import {getTvPlayback} from '@/modules/dashboard-tv/playback';
import {playbackVideoId,playbackItag,playbackRange,trustedMediaUrl,validateMediaResponse,TvPlaybackError} from '@/modules/dashboard-tv/playbackSafety';

export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:Request){
 const privateHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 let diagnostic:{itag?:number;range?:string;upstreamStatus?:number;phase:string}={phase:'validation'};
 if(!await getRequestUser(request))return Response.json({error:'Entre para assistir à TV Agro.'},{status:401,headers:privateHeaders});
 try{
  const params=new URL(request.url).searchParams;
  if([...params.keys()].some(key=>!['videoId','itag'].includes(key))||params.getAll('videoId').length!==1||params.getAll('itag').length!==1)throw new TvPlaybackError('Solicitação de vídeo inválida.',400);
  const videoId=playbackVideoId(params.get('videoId')),itag=playbackItag(params.get('itag'));
  playbackRange(request.headers.get('range'));
  diagnostic={itag,range:request.headers.get('range')!,phase:'resolution'};
  let playback=await getTvPlayback(videoId),format=playback.formats.get(itag);
  if(!format)throw new TvPlaybackError('Formato de vídeo indisponível.',404);
  let range=playbackRange(request.headers.get('range'),format.contentLength);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  const signal=AbortSignal.any([controller.signal,request.signal]);
  const fetchMedia=()=>fetch(trustedMediaUrl(format!.url),{headers:{Range:range.header},redirect:'error',signal});
  let upstream:Response;
  try{
   diagnostic.phase='upstream';upstream=await fetchMedia();diagnostic.upstreamStatus=upstream.status;
   if([400,403,404,410,416].includes(upstream.status)||upstream.status>=500){
    await upstream.body?.cancel();playback=await getTvPlayback(videoId,{refresh:true});format=playback.formats.get(itag);
    if(!format)throw new TvPlaybackError('Formato de vídeo indisponível.',404);
    range=playbackRange(request.headers.get('range'),format.contentLength);upstream=await fetchMedia();diagnostic.upstreamStatus=upstream.status;
   }
   diagnostic.phase='response-validation';
   const media=validateMediaResponse(upstream,range),reader=upstream.body!.getReader();
   let received=0,finished=false;
   const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);controller.abort();};
   const body=new ReadableStream<Uint8Array>({
    async pull(target){
     try{const part=await reader.read();if(part.done){if(received!==media.length)throw Error('Incomplete media');target.close();finish();return;}received+=part.value.byteLength;if(received>media.length)throw Error('Oversized media');target.enqueue(part.value);}
     catch{target.error(new Error('O carregamento deste trecho de vídeo foi interrompido.'));finish();await reader.cancel().catch(()=>{});}
    },
    async cancel(){finish();await reader.cancel().catch(()=>{});},
   });
   return new Response(body,{status:206,headers:{...privateHeaders,'Content-Type':format.mimeType,'Content-Length':String(media.length),'Content-Range':`bytes ${media.start}-${media.end}/${media.total}`,'Accept-Ranges':'bytes'}});
  }catch(error){clearTimeout(timer);controller.abort();throw error;}
 }catch(error){
  const known=error instanceof TvPlaybackError;
  console.error('dashboard-tv stream unavailable',{...diagnostic,status:known?error.status:503,reason:known?error.message:error instanceof Error?error.name:'unknown',requestAborted:request.signal.aborted});
  return Response.json({error:known?error.message:'Este trecho do vídeo está temporariamente indisponível.'},{status:known?error.status:503,headers:privateHeaders});
 }
}
