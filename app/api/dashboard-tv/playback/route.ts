import {getRequestUser} from '@/shared/supabase/server';
import {getTvPlayback} from '@/modules/dashboard-tv/playback';
import {playbackVideoId,TvPlaybackError} from '@/modules/dashboard-tv/playbackSafety';

export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:Request){
 const headers={'Cache-Control':'private, no-store'};
 if(!await getRequestUser(request))return Response.json({error:'Entre para assistir à TV Agro.'},{status:401,headers});
 try{
  const params=new URL(request.url).searchParams;
  if([...params.keys()].some(key=>key!=='videoId')||params.getAll('videoId').length!==1)throw new TvPlaybackError('Solicitação de vídeo inválida.',400);
  const videoId=playbackVideoId(params.get('videoId'));
  const playback=await getTvPlayback(videoId);
  return Response.json({manifest:playback.manifest},{headers});
 }catch(error){
  const known=error instanceof TvPlaybackError;
  console.error('dashboard-tv playback unavailable',{status:known?error.status:503});
  return Response.json({error:known?error.message:'Vídeo temporariamente indisponível.'},{status:known?error.status:503,headers});
 }
}
