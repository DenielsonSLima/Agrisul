import type {TvVideo} from './catalog.ts';

export function isHorizontalVideo(width:number|undefined,height:number|undefined){
 return typeof width==='number'&&typeof height==='number'&&Number.isFinite(width)&&Number.isFinite(height)&&height>0&&width>height;
}

// YouTube's Shorts endpoint redirects regular videos to /watch, while Shorts
// remain on /shorts. Thumbnail dimensions cannot identify video orientation.
export function createHorizontalVideoFilter({fetchImpl=fetch,now=Date.now,budgetMs=8000,timeoutMs=2000}:{fetchImpl?:typeof fetch;now?:()=>number;budgetMs?:number;timeoutMs?:number}={}){
 const cache=new Map<string,{horizontal:boolean;expires:number}>();
 return async(videos:TvVideo[]):Promise<TvVideo[]>=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),budgetMs);
  const accepted=new Set<string>(),candidates=videos.slice(0,80);let next=0;
  try{
   await Promise.all(Array.from({length:Math.min(8,candidates.length)},async()=>{
    while(next<candidates.length&&!controller.signal.aborted){
     const video=candidates[next++];if(!/^[A-Za-z0-9_-]{11}$/.test(video.id))continue;
     const cached=cache.get(video.id);
     if(cached&&cached.expires>now()){if(cached.horizontal)accepted.add(video.id);continue;}
     try{
      const response=await fetchImpl(`https://www.youtube.com/shorts/${video.id}`,{method:'HEAD',redirect:'manual',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs)])});
      let horizontal=false,known=response.status===200;
      if([301,302,303,307,308].includes(response.status)){
       const target=new URL(response.headers.get('location')??'',`https://www.youtube.com/shorts/${video.id}`);
       horizontal=target.protocol==='https:'&&target.hostname==='www.youtube.com'&&!target.username&&!target.password&&!target.port&&target.pathname==='/watch'&&target.searchParams.get('v')===video.id;
       known=horizontal;
      }
      await response.body?.cancel();
      if(horizontal)accepted.add(video.id);
      if(known){
       while(cache.size>=512){const key=cache.keys().next().value;if(key===undefined)break;cache.delete(key);}
       cache.set(video.id,{horizontal,expires:now()+6*3600000});
      }
     }catch{/* Unknown formats stay out; transient failures are retried on the next acquisition. */}
    }
   }));
  }finally{clearTimeout(timer);controller.abort();}
  return videos.filter(video=>accepted.has(video.id));
 };
}
