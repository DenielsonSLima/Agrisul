import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaybackResolver} from './playback.ts';
import {MAX_TV_RANGE_BYTES,playbackVideoId,playbackItag,playbackRange,preflightMediaIndex,preflightMediaRepresentation,trustedMediaUrl,assertTvUploader,validateMediaResponse,verifyTvVideo} from './playbackSafety.ts';
import {TV_CHANNELS} from './catalog.ts';
test('media endpoints accept only video IDs, numeric formats and the five actual uploader IDs',()=>{
 assert.equal(playbackVideoId('wkNChZCvJKY'),'wkNChZCvJKY');assert.equal(playbackItag('140'),140);
 assertTvUploader(TV_CHANNELS[0].channelId);
 for(const id of [null,'https://youtube.com/watch?v=wkNChZCvJKY','../wkNChZCvJKY','wkNChZCvJKY?x'])assert.throws(()=>playbackVideoId(id),{status:400});
 for(const itag of [null,'-1','0','140&url=evil','1.5','12345'])assert.throws(()=>playbackItag(itag),{status:400});
 assert.throws(()=>assertTvUploader('UCforeign'),{status:403});
});

test('deciphered destinations are exclusively HTTPS Google video playback, never an arbitrary proxy',()=>{
 assert.equal(trustedMediaUrl('https://rr1---sn-abcd.googlevideo.com/videoplayback?itag=140').hostname,'rr1---sn-abcd.googlevideo.com');
 for(const url of ['http://rr1.googlevideo.com/videoplayback','https://evil.com/videoplayback','https://googlevideo.com.evil.com/videoplayback','https://googlevideo.com/videoplayback','https://127.0.0.1/videoplayback','https://rr1.googlevideo.com:444/videoplayback','https://user:pass@rr1.googlevideo.com/videoplayback','https://rr1.googlevideo.com/other'])assert.throws(()=>trustedMediaUrl(url));
});

test('blocked upstream responses remain distinct from confirmed foreign publisher access',()=>{
 const id='wkNChZCvJKY',channelId=TV_CHANNELS[0].channelId;
 assert.throws(()=>verifyTvVideo(id,{status:'LOGIN_REQUIRED'}),{status:503});
 assert.throws(()=>verifyTvVideo(id,{status:'OK',id}),{status:503});
 assert.throws(()=>verifyTvVideo(id,{status:'OK',id:'b7VD7J75j_M',channelId}),{status:503});
 assert.throws(()=>verifyTvVideo(id,{status:'OK',id,channelId:'UCforeign'}),{status:403});
 assert.throws(()=>verifyTvVideo(id,{status:'OK',id,channelId,live:true}),{status:422});
 assert.doesNotThrow(()=>verifyTvVideo(id,{status:'OK',id,channelId}));
});

test('DASH ranges must be explicit, unique, bounded and stay within the selected representation',()=>{
 assert.deepEqual(playbackRange('bytes=0-1023'),{start:0,end:1023,length:1024,header:'bytes=0-1023'});
 assert.equal(playbackRange('bytes=900-1999',1000).end,999);
 for(const range of [null,'bytes=0-','bytes=-200','bytes=1-0','bytes=0-1,4-5','bytes=0-'+MAX_TV_RANGE_BYTES,'bytes=0-9007199254740992'])assert.throws(()=>playbackRange(range),{status:416});
 assert.throws(()=>playbackRange('bytes=1000-1999',1000),{status:416});
});

test('upstream must honor the exact range with a valid media type and consistent lengths',()=>{
 const range=playbackRange('bytes=0-1023');
 const good=()=>new Response(new Uint8Array(1024),{status:206,headers:{'Content-Range':'bytes 0-1023/5000','Content-Length':'1024','Content-Type':'video/mp4'}});
 assert.equal(validateMediaResponse(good(),range).length,1024);
 for(const mutate of [response=>new Response(response.body,{status:200,headers:response.headers}),response=>{response.headers.set('Content-Type','text/html');return response;},response=>{response.headers.set('Content-Range','bytes 2-1025/5000');return response;},response=>{response.headers.set('Content-Length','1000');return response;},response=>{response.headers.set('Content-Range','bytes 0-1023/500');return response;}])assert.throws(()=>validateMediaResponse(mutate(good()),range));
});

test('resolving the same video is deduplicated and bounded cache entries expire without storing credentials',async()=>{
 let now=10000,calls=0;
 const resolve=async id=>{calls++;await Promise.resolve();return {manifest:`<MPD>${id}</MPD>`,formats:new Map(),expiresAt:now+300000};};
 const get=createPlaybackResolver({now:()=>now,resolve,maxEntries:1});
 const [first,second]=await Promise.all([get('wkNChZCvJKY'),get('wkNChZCvJKY')]);assert.equal(calls,1);assert.equal(first,second);
 await get('wkNChZCvJKY');assert.equal(calls,1);await get('wkNChZCvJKY',{refresh:true});assert.equal(calls,2);
 await get('b7VD7J75j_M');await get('wkNChZCvJKY');assert.equal(calls,4);
 now+=300001;await get('wkNChZCvJKY');assert.equal(calls,5);
});

test('representation preflight requires the exact complete SIDX range and discards failed CDN variants',async()=>{
 const url='https://rr1.googlevideo.com/videoplayback?itag=134';
 const bytes=new Uint8Array([0,0,0,12,115,105,100,120,0,0,0,0]);
 const valid=()=>new Response(bytes,{status:206,headers:{'Content-Range':'bytes 100-111/5000','Content-Length':'12','Content-Type':'video/mp4'}});
 let request;
 assert.equal(await preflightMediaIndex(url,'bytes=100-111',5000,async(input,init)=>{request={url:String(input),...init};return valid();}),true);
 assert.equal(request.headers.Range,'bytes=100-111');assert.equal(request.redirect,'error');
 assert.equal(await preflightMediaIndex(url,'bytes=100-111',5000,async()=>new Response('denied',{status:403})),false);
 assert.equal(await preflightMediaIndex(url,'bytes=100-111',5000,async()=>{throw Error('offline');}),false);
 assert.equal(await preflightMediaIndex(url,'bytes=100-111',5000,async()=>new Response(new Uint8Array(12),{status:206,headers:valid().headers})),false);
 assert.equal(await preflightMediaIndex(url,'bytes=100-111',5000,async()=>new Response(bytes.slice(0,8),{status:206,headers:valid().headers})),false);
 let fetched=false;assert.equal(await preflightMediaIndex(url,'bytes=0-262144',500000,async()=>{fetched=true;return valid();}),false);assert.equal(fetched,false);
});

test('stalled extraction times out, rejects excess concurrent work, and releases its slot for retry',async()=>{
 let stalled=true;
 const get=createPlaybackResolver({timeoutMs:15,maxPending:1,resolve:async()=>stalled?new Promise(()=>{}):{manifest:'<MPD/>',formats:new Map(),expiresAt:Date.now()+300000}});
 const blocked=get('wkNChZCvJKY');await assert.rejects(get('b7VD7J75j_M'),{status:429});await assert.rejects(blocked,{status:503});
 stalled=false;assert.equal((await get('wkNChZCvJKY')).manifest,'<MPD/>');
});

test('preflight verifies SIDX and distant/final audio bytes instead of accepting the first playable megabyte',async()=>{
 const total=8*1024*1024,url='https://rr1.googlevideo.com/videoplayback?itag=140',ranges=[];
 const fetchImpl=async(_input,{headers})=>{
  const match=/^bytes=(\d+)-(\d+)$/.exec(headers.Range),start=Number(match[1]),end=Number(match[2]);ranges.push(headers.Range);
  const bytes=new Uint8Array(end-start+1);if(start===100)bytes.set([0,0,0,12,115,105,100,120]);
  return new Response(bytes,{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${total}`,'Content-Length':String(bytes.length),'Content-Type':'audio/mp4'}});
 };
 assert.equal(await preflightMediaRepresentation(url,'bytes=100-111',total,fetchImpl),true);
 assert.deepEqual(new Set(ranges),new Set(['bytes=100-111','bytes=1500000-1501023',`bytes=${total-1024}-${total-1}`]));
 const restricted=async(input,init)=>Number(init.headers.Range.match(/\d+/)[0])>=1048576?new Response('limited',{status:403}):fetchImpl(input,init);
 assert.equal(await preflightMediaRepresentation(url,'bytes=100-111',total,restricted),false,'The previous false startup followed by a 12-second stop is rejected');
 assert.equal(await preflightMediaRepresentation(url,'bytes=100-111',undefined,fetchImpl),false);
});
