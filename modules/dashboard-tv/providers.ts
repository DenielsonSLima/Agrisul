import {TV_CHANNELS,type TvChannel,type TvFeed,type TvSource,type TvVideo} from './catalog.ts';
import {classifyTvVideo,curateTvVideos} from './curation.ts';

const REFRESH_MS=300_000,STALE_MS=24*60*60*1000,MAX_BYTES=500_000,MAX_VIDEO_AGE=36*60*60*1000;
const field=(xml:string,name:string)=>new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i').exec(xml)?.[1]??'';
function text(value:string,maxLength=240){
 return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(whole,key:string)=>{
  const entities:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
  if(key[0]!=='#')return entities[key]??whole;
  const point=Number.parseInt(key.slice(key[1]?.toLowerCase()==='x'?2:1),key[1]?.toLowerCase()==='x'?16:10);
  return point>0&&point<=0x10ffff&&!(point>=0xd800&&point<=0xdfff)?String.fromCodePoint(point):'';
 }).replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,maxLength);
}

export function parseTvRss(xml:string,channel:TvChannel,now=Date.now()):TvVideo[]{
 if(xml.length>MAX_BYTES||/<!DOCTYPE|<!ENTITY/i.test(xml)||!/<feed\b/.test(xml))return [];
 // Validate the feed-level channel, then each individual entry. Never accept IDs from another publisher.
 const feedChannel=field(xml.slice(0,xml.indexOf('<entry>')),'yt:channelId');
 // YouTube's feed-level ID may omit UC; entry IDs always include it.
 if(feedChannel!==channel.channelId&&feedChannel!==channel.channelId.slice(2))return [];
 const seen=new Set<string>(),videos:TvVideo[]=[];
 for(const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)){
  const entry=match[1],id=field(entry,'yt:videoId'),title=text(field(entry,'title')),published=Date.parse(field(entry,'published'));
  if(!/^[A-Za-z0-9_-]{11}$/.test(id)||seen.has(id)||!title||field(entry,'yt:channelId')!==channel.channelId||!Number.isFinite(published)||published>now||now-published>MAX_VIDEO_AGE)continue;
  seen.add(id);videos.push({id,title,description:text(field(entry,'media:description'),1200),channelId:channel.id,channelName:channel.name,publishedAt:new Date(published).toISOString(),thumbnailUrl:`https://i.ytimg.com/vi/${id}/hqdefault.jpg`,url:`https://www.youtube.com/watch?v=${id}`});
 }
 return videos.sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,15);
}

// Relative labels describe rounded age intervals. Use their oldest possible timestamp so search cannot admit a video older than 36 hours.
export function searchPublicationDate(label:string,now=Date.now()){
 const normalized=label.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const match=normalized.match(/(?:ha\s+)?(\d+)\s+(minuto|minute|hora|hour|dia|day|semana|week|mes|month|ano|year)/);
 if(!match)return null;
 const amount=Number(match[1]),unit=match[2];
 const multipliers:Record<string,number>={minuto:60000,minute:60000,hora:3600000,hour:3600000,dia:86400000,day:86400000,semana:7*86400000,week:7*86400000,mes:30*86400000,month:30*86400000,ano:365*86400000,year:365*86400000};
 const oldestAge=(amount+1)*multipliers[unit];if(!Number.isFinite(oldestAge)||oldestAge>MAX_VIDEO_AGE)return null;
 return new Date(now-oldestAge).toISOString();
}

type SearchResultVideo={id?:string;video_id?:string;title?:{toString:()=>string};author?:{id?:string};published?:{toString:()=>string};description?:string;is_live?:boolean;is_upcoming?:boolean;upcoming?:Date};
export function parseChannelSearchVideos(items:readonly unknown[],channel:TvChannel,now=Date.now(),exactDates:ReadonlyMap<string,string>=new Map()):TvVideo[]{
 const videos:TvVideo[]=[],seen=new Set<string>();
 for(const item of items.slice(0,40)){
  if(!item||typeof item!=='object')continue;
  const video=item as SearchResultVideo,id=video.video_id??video.id,title=text(video.title?.toString()??''),publishedAt=(id?exactDates.get(id):undefined)??searchPublicationDate(video.published?.toString()??'',now);
  if(!id||!/^[A-Za-z0-9_-]{11}$/.test(id)||seen.has(id)||video.author?.id!==channel.channelId||!title||!publishedAt||Date.parse(publishedAt)>now||now-Date.parse(publishedAt)>MAX_VIDEO_AGE||!Number.isFinite(Date.parse(publishedAt))||video.is_live||video.is_upcoming||video.upcoming instanceof Date&&video.upcoming.getTime()>now)continue;
  const description=text(video.description??'',1200);
  if(classifyTvVideo(title,description)===null)continue;
  seen.add(id);videos.push({id,title,description,channelId:channel.id,channelName:channel.name,publishedAt,thumbnailUrl:`https://i.ytimg.com/vi/${id}/hqdefault.jpg`,url:`https://www.youtube.com/watch?v=${id}`});
 }
 return videos;
}

type SupplementSearch=(channel:TvChannel,queries:string[],now:number,signal:AbortSignal)=>Promise<TvVideo[]>;
function createChannelSearch():SupplementSearch{
 let client:Promise<Awaited<ReturnType<typeof import('youtubei.js')['Innertube']['create']>>>|null=null;
 let exactDateBudget=4;
 const checkedDates=new Set<string>();
 return async(channel,queries,now,signal)=>{
  if(!client)client=(async()=>{
   const {Innertube,Log}=await import('youtubei.js');Log.setLevel(Log.Level.NONE);
   const fetchImpl:typeof fetch=async(input,init={})=>{
    signal.throwIfAborted();
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.toString():input.url);
    if(url.protocol!=='https:'||url.username||url.password||url.port||!['www.youtube.com','youtube.com','youtubei.googleapis.com'].includes(url.hostname))throw Error('Unexpected search destination');
   const response=await fetch(input,{...init,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(8000)])});
    const body=await readFeed(response,4*1024*1024);
    return new Response(body,{status:response.status,headers:response.headers});
   };
   return Innertube.create({retrieve_player:false,generate_session_locally:true,enable_session_cache:false,lang:'pt',location:'BR',fetch:fetchImpl});
  })();
  const youtube=await client;signal.throwIfAborted();const source=await youtube.getChannel(channel.channelId);
  if(source.metadata.external_id!==channel.channelId||!source.has_search)return [];
  const videos:TvVideo[]=[];
  for(const query of queries.slice(0,3)){
   signal.throwIfAborted();
   try{
    const result=await source.search(query),exactDates=new Map<string,string>();
    // A one-day label may mean 24–48 hours. Refine at most four sugarcane candidates across the entire acquisition.
    // Metadata is optional: blocked/absent dates retain conservative rejection without failing the channel.
    if(query==='cana'||query==='etanol')for(const entry of result.videos.slice(0,40)){
     if(!exactDateBudget||signal.aborted)break;
     const video=entry as SearchResultVideo,id=video.video_id??video.id;
     if(!id||!/^[A-Za-z0-9_-]{11}$/.test(id)||checkedDates.has(id)||video.author?.id!==channel.channelId||video.is_live||video.is_upcoming||!/\b1\s+(?:dia|day)\b/.test(video.published?.toString().toLowerCase()??'')||classifyTvVideo(video.title?.toString()??'',video.description??'')!=='sugarcane')continue;
     checkedDates.add(id);exactDateBudget--;
     try{
      const info=await youtube.getBasicInfo(id);
      const date=Date.parse(info.basic_info.publish_date??info.basic_info.upload_date??'');
      if(info.basic_info.id===id&&info.basic_info.channel_id===channel.channelId&&Number.isFinite(date)&&date<=now&&now-date<=MAX_VIDEO_AGE)exactDates.set(id,new Date(date).toISOString());
     }catch{/* Search remains usable even when optional metadata is blocked by the hosting provider. */}
    }
    videos.push(...parseChannelSearchVideos(result.videos,channel,now,exactDates));
   }catch{if(signal.aborted)break;}
  }
  return videos;
 };
}

async function mapLimit<T,R>(items:T[],limit:number,run:(item:T)=>Promise<R>){
 const results:R[]=new Array(items.length);let next=0;
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{for(;;){const index=next++;if(index>=items.length)return;results[index]=await run(items[index]);}}));
 return results;
}

async function readFeed(response:Response,maxBytes=MAX_BYTES){
 if(!response.ok||Number(response.headers.get('content-length'))>maxBytes)throw Error('Feed indisponível');
 if(!response.body)throw Error('Feed vazio');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[],decoder=new TextDecoder();let bytes=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>maxBytes)throw Error('Feed muito grande');chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 return chunks.map(chunk=>decoder.decode(chunk,{stream:true})).join('')+decoder.decode();
}

export function createTvFeed({fetchImpl=fetch,now=Date.now,timeoutMs=6500,searchImpl,searchBudgetMs=30000}:{fetchImpl?:typeof fetch;now?:()=>number;timeoutMs?:number;searchImpl?:SupplementSearch;searchBudgetMs?:number}={}){
 const cache=new Map<string,{videos:TvVideo[];updatedAt:number}>();
 let complete:TvFeed|null=null,checked=0,pending:Promise<TvFeed>|null=null;
 async function load():Promise<TvFeed>{
  const at=now(),started=Date.now();
  const results=await Promise.all(TV_CHANNELS.map(async channel=>{
   const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
   try{
    const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Tempo esgotado'));},timeoutMs);});
    const xml=await Promise.race([timeout,(async()=>readFeed(await fetchImpl(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`,{signal:controller.signal,redirect:'error',headers:{Accept:'application/atom+xml, application/xml'}})))()]);
    const videos=parseTvRss(xml,channel,at);if(!videos.length)throw Error('Sem vídeos recentes');
    cache.set(channel.id,{videos,updatedAt:at});
    return {videos,source:{id:channel.id,name:channel.name,status:'current',updatedAt:new Date(at).toISOString()} as TvSource};
   }catch{
    const previous=cache.get(channel.id),available=previous&&at-previous.updatedAt<=STALE_MS;
    return {videos:available?previous.videos:[],source:{id:channel.id,name:channel.name,status:available?'cached':'unavailable',updatedAt:available?new Date(previous.updatedAt).toISOString():null} as TvSource};
   }finally{if(timer)clearTimeout(timer);}
  }));
  const all=results.flatMap(result=>result.videos),topics=all.map(video=>classifyTvVideo(video.title,video.description??''));
  const needCane=topics.filter(topic=>topic==='sugarcane').length<10,needGrains=topics.filter(topic=>topic==='grains').length<4;
  const search=searchImpl??createChannelSearch(),controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.max(1,searchBudgetMs-(Date.now()-started)));
  try{
   await mapLimit(results,3,async result=>{
    const channel=TV_CHANNELS.find(channel=>channel.id===result.source.id)!;
    const relevant=result.videos.filter(video=>classifyTvVideo(video.title,video.description??'')!==null);
    if(relevant.length>=4&&!needCane&&!needGrains)return;
    const queries=relevant.length<4?['cana','soja','agronegócio']:needCane?['cana','etanol',...(needGrains?['soja']:[])]:['soja'];
    let onAbort:()=>void=()=>{};
    try{
     const aborted=new Promise<never>((_,reject)=>{onAbort=()=>reject(Error('Search budget exceeded'));controller.signal.addEventListener('abort',onAbort,{once:true});if(controller.signal.aborted)onAbort();});
     const extra=await Promise.race([search(channel,queries,at,controller.signal),aborted]);
     const ids=new Set(result.videos.map(video=>video.id));
     for(const video of extra.slice(0,60))if(video.channelId===channel.id&&!ids.has(video.id)&&classifyTvVideo(video.title,video.description??'')!==null){ids.add(video.id);result.videos.push(video);}
     if(extra.length){result.source={id:channel.id,name:channel.name,status:'current',updatedAt:new Date(at).toISOString()};cache.set(channel.id,{videos:result.videos,updatedAt:at});}
    }catch{/* Preserve RSS and the last valid channel candidates if its scoped search is unavailable. */}
    finally{controller.signal.removeEventListener('abort',onAbort);}
   });
  }finally{clearTimeout(timer);controller.abort();}
  const videos=curateTvVideos(results.flatMap(result=>result.videos).filter(video=>{const date=Date.parse(video.publishedAt);return date<=at&&at-date<=MAX_VIDEO_AGE;}),TV_CHANNELS.map(channel=>channel.id));
  checked=at;complete={videos,sources:results.map(result=>result.source),checkedAt:new Date(at).toISOString(),refreshSeconds:300};return complete;
 }
 return function getFeed(){
  if(complete&&now()-checked<REFRESH_MS){const at=now();return Promise.resolve({...complete,videos:complete.videos.filter(video=>{const date=Date.parse(video.publishedAt);return date<=at&&at-date<=MAX_VIDEO_AGE;})});}
  if(!pending)pending=load().finally(()=>{pending=null;});
  return pending;
 };
}
export const getTvFeed=createTvFeed();
