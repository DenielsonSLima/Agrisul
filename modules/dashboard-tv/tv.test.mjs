import test from 'node:test';
import assert from 'node:assert/strict';
import {TV_CHANNELS,isTvFeed} from './catalog.ts';
import {parseTvRss,createTvFeed,parseChannelSearchVideos,searchPublicationDate} from './providers.ts';

const at=Date.parse('2026-10-30T13:00:00Z');
function fixture(channel,index=0){return `<feed><yt:channelId>${channel.channelId}</yt:channelId><entry><yt:videoId>video${String(index).padStart(6,'0')}</yt:videoId><yt:channelId>${channel.channelId}</yt:channelId><title><![CDATA[Cana &amp; etanol ${index}]]></title><published>${new Date(at-index*1000).toISOString()}</published></entry></feed>`;}

test('five distinct verified publishers expose only their own recent video IDs and safe generated links',()=>{
 assert.equal(TV_CHANNELS.length,5);assert.equal(new Set(TV_CHANNELS.map(channel=>channel.channelId)).size,5);
 assert.ok(TV_CHANNELS.some(channel=>channel.id==='tv-senado'));
 const [video]=parseTvRss(fixture(TV_CHANNELS[0]),TV_CHANNELS[0],at);
 assert.equal(video.title,'Cana & etanol 0');assert.equal(video.url,'https://www.youtube.com/watch?v=video000000');
 assert.equal(video.thumbnailUrl,'https://i.ytimg.com/vi/video000000/hqdefault.jpg');
 assert.equal(parseTvRss(fixture(TV_CHANNELS[0]).replace(`<yt:channelId>${TV_CHANNELS[0].channelId}`,`<yt:channelId>${TV_CHANNELS[0].channelId.slice(2)}`),TV_CHANNELS[0],at).length,1);
 assert.deepEqual(parseTvRss(fixture(TV_CHANNELS[0]),TV_CHANNELS[1],at),[]);
 assert.deepEqual(parseTvRss(fixture(TV_CHANNELS[0]).replaceAll(TV_CHANNELS[0].channelId,'untrusted'),TV_CHANNELS[0],at),[]);
});

test('malformed, external entity, foreign entry, duplicate, old and future records never become playable URLs',()=>{
 const channel=TV_CHANNELS[0],xml=fixture(channel),entry=xml.match(/<entry>[\s\S]*<\/entry>/)[0];
 for(const invalid of ['<html>offline</html>','<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+xml,xml.replace('video000000','javascript:bad'),xml.replace(new Date(at).toISOString(),'invalid'),xml.replace(new Date(at).toISOString(),new Date(at+3600000).toISOString()),xml.replace(new Date(at).toISOString(),new Date(at-31*86400000).toISOString()),xml.replace(/(<entry>[\s\S]*?<yt:channelId>)[^<]+/,'$1foreign')])assert.deepEqual(parseTvRss(invalid,channel,at),[]);
 assert.equal(parseTvRss(xml.replace('</feed>',entry+'</feed>'),channel,at).length,1);
});

test('concurrent requests share bounded per-source fetching; partial failures retain attribution and expire stale data',async()=>{
 let now=at,calls=0,failed=false;
 const feed=createTvFeed({now:()=>now,searchImpl:async()=>[],fetchImpl:async url=>{calls++;const channel=TV_CHANNELS.find(channel=>url.endsWith(channel.channelId));if(failed&&channel.id==='tv-senado')throw Error('offline');return new Response(fixture(channel,TV_CHANNELS.indexOf(channel)));}});
 const [first,shared]=await Promise.all([feed(),feed()]);assert.deepEqual(first,shared);assert.equal(calls,5);assert.equal(first.videos.length,5);assert.ok(isTvFeed(first));
 await feed();assert.equal(calls,5);now+=300001;failed=true;const cached=await feed();
 assert.equal(cached.sources.find(source=>source.id==='tv-senado').status,'cached');assert.equal(cached.videos.find(video=>video.channelId==='tv-senado').publishedAt,first.videos.find(video=>video.channelId==='tv-senado').publishedAt);
 now=at+25*3600000;const expired=await feed();assert.equal(expired.sources.find(source=>source.id==='tv-senado').status,'unavailable');assert.equal(expired.videos.some(video=>video.channelId==='tv-senado'),false);
 assert.equal(isTvFeed({...first,videos:[{...first.videos[0],url:'https://evil.example/video'}]}),false);
});

test('a source ignoring cancellation cannot stall the shared feed and healthy channels still work',async()=>{
 let blockedSignal;
 const feed=createTvFeed({now:()=>at,timeoutMs:15,searchImpl:async()=>[],fetchImpl:async(url,{signal})=>{const channel=TV_CHANNELS.find(channel=>url.endsWith(channel.channelId));if(channel.id==='canal-rural'){blockedSignal=signal;return new Promise(()=>{});}return new Response(fixture(channel,TV_CHANNELS.indexOf(channel)));}});
 const result=await feed();assert.equal(result.sources[0].status,'unavailable');assert.equal(result.videos.length,4);assert.equal(blockedSignal.aborted,true);
});

test('only the latest 36 hours are eligible, including stale cache; ambiguous one-day search dates are rejected',async()=>{
 const channel=TV_CHANNELS[0];
 assert.equal(parseTvRss(fixture(channel).replace(new Date(at).toISOString(),new Date(at-36*3600000).toISOString()),channel,at).length,1);
 assert.equal(parseTvRss(fixture(channel).replace(new Date(at).toISOString(),new Date(at-36*3600000-1).toISOString()),channel,at).length,0);
 assert.equal(searchPublicationDate('há 1 dia',at),null);assert.equal(searchPublicationDate('1 day ago',at),null);
 assert.equal(searchPublicationDate('há 35 horas',at),new Date(at-36*3600000).toISOString());assert.equal(searchPublicationDate('há 36 horas',at),null);
 assert.equal(searchPublicationDate('Streamed 3 hours ago',at),new Date(at-4*3600000).toISOString());assert.equal(searchPublicationDate('yesterday',at),null);
 let now=at,failed=false;
 const feed=createTvFeed({now:()=>now,searchImpl:async()=>[],fetchImpl:async url=>{if(failed)throw Error('offline');return new Response(fixture(TV_CHANNELS.find(channel=>url.endsWith(channel.channelId)),TV_CHANNELS.findIndex(channel=>url.endsWith(channel.channelId))));}});
 assert.equal((await feed()).videos.length,5);now+=37*3600000;failed=true;assert.equal((await feed()).videos.length,0);
 let warmNow=at;
 const edge=createTvFeed({now:()=>warmNow,searchImpl:async()=>[],fetchImpl:async url=>{const channel=TV_CHANNELS.find(channel=>url.endsWith(channel.channelId));return new Response(fixture(channel,TV_CHANNELS.indexOf(channel)).replace(/<published>[^<]+/,`<published>${new Date(at-36*3600000).toISOString()}`));}});
 assert.equal((await edge()).videos.length,5);warmNow+=1000;assert.equal((await edge()).videos.length,0);
});

test('channel search rejects foreign uploaders, unknown dates, live streams and unrelated titles',()=>{
 const channel=TV_CHANNELS[0],base={video_id:'canavideo01',title:{toString:()=> 'Moagem de cana cresce e preço do açúcar reage'},author:{id:channel.channelId},published:{toString:()=> 'há 2 horas'},description:'Mercado de açúcar e etanol.'};
 assert.equal(parseChannelSearchVideos([base],channel,at).length,1);
 for(const change of [{author:{id:TV_CHANNELS[1].channelId}},{published:{toString:()=> 'há 1 dia'}},{is_live:true},{is_upcoming:true},{title:{toString:()=> 'Senado vota indicação ao tribunal'},description:'Inscreva-se no canal e acompanhe as notícias do agro.'}])assert.equal(parseChannelSearchVideos([{...base,...change}],channel,at).length,0);
 const ambiguous={...base,published:{toString:()=> 'há 1 dia'}};
 assert.equal(parseChannelSearchVideos([ambiguous],channel,at,new Map([[base.video_id,new Date(at-35*3600000).toISOString()]])).length,1);
 assert.equal(parseChannelSearchVideos([ambiguous],channel,at,new Map([[base.video_id,new Date(at-36*3600000-1).toISOString()]])).length,0);
 assert.equal(parseChannelSearchVideos([{...ambiguous,author:{id:TV_CHANNELS[1].channelId}}],channel,at,new Map([[base.video_id,new Date(at-35*3600000).toISOString()]])).length,0);
});

test('supplemental search is bounded, curated with a four-per-channel cap, and cannot stall the RSS result',async()=>{
 let searches=0,active=0,maxActive=0;
 const feed=createTvFeed({now:()=>at,fetchImpl:async url=>new Response(fixture(TV_CHANNELS.find(channel=>url.endsWith(channel.channelId)),TV_CHANNELS.findIndex(channel=>url.endsWith(channel.channelId)))),searchImpl:async channel=>{searches++;active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;return Array.from({length:8},(_,index)=>({id:`s${TV_CHANNELS.indexOf(channel)}${String(index).padStart(9,'0')}`,title:index%3===0?'Preço da soja e do milho':index%3===1?'Moagem de cana e etanol':'Pecuária cresce no agronegócio',channelId:channel.id,channelName:channel.name,publishedAt:new Date(at-index*60000).toISOString(),thumbnailUrl:`https://i.ytimg.com/vi/s${TV_CHANNELS.indexOf(channel)}${String(index).padStart(9,'0')}/hqdefault.jpg`,url:`https://www.youtube.com/watch?v=s${TV_CHANNELS.indexOf(channel)}${String(index).padStart(9,'0')}`}));}});
 const result=await feed();assert.equal(searches,5);assert.ok(maxActive<=3);assert.equal(result.videos.length,20);assert.ok(TV_CHANNELS.every(channel=>result.videos.filter(video=>video.channelId===channel.id).length===4));assert.ok(isTvFeed(result));
 const stalled=createTvFeed({now:()=>at,searchBudgetMs:15,fetchImpl:async url=>new Response(fixture(TV_CHANNELS.find(channel=>url.endsWith(channel.channelId)),TV_CHANNELS.findIndex(channel=>url.endsWith(channel.channelId)))),searchImpl:async()=>new Promise(()=>{})});
 assert.equal((await stalled()).videos.length,5);
});
