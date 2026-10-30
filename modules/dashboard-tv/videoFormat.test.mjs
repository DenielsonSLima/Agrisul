import test from 'node:test';
import assert from 'node:assert/strict';
import {createHorizontalVideoFilter,isHorizontalVideo} from './videoFormat.ts';

const videos=['BdBCIDD1eUg','wkNChZCvJKY','another0001'].map(id=>({id,title:'Agro',channelId:'canal-rural',publishedAt:new Date().toISOString()}));
test('the player accepts landscape dimensions and rejects portrait, square and unknown dimensions',()=>{
 assert.equal(isHorizontalVideo(1280,720),true);assert.equal(isHorizontalVideo(640,360),true);
 for(const [width,height] of [[360,640],[720,1280],[640,640],[0,0],[undefined,720],[1280,undefined],[NaN,720],[Infinity,720]])assert.equal(isHorizontalVideo(width,height),false);
});
test('Shorts stay out even when their thumbnail is horizontal; regular watch redirects are accepted and cached',async()=>{
 let calls=0;
 const filter=createHorizontalVideoFilter({fetchImpl:async(url,options)=>{
  calls++;assert.equal(options.method,'HEAD');assert.equal(options.redirect,'manual');assert.match(url,/^https:\/\/www.youtube.com\/shorts\/[A-Za-z0-9_-]{11}$/);
  return url.endsWith('BdBCIDD1eUg')?new Response(null,{status:200}):new Response(null,{status:303,headers:{location:`https://www.youtube.com/watch?v=${url.split('/').at(-1)}&pp=example`}});
 }});
 assert.deepEqual((await filter(videos)).map(video=>video.id),['wkNChZCvJKY','another0001']);
 await filter(videos);assert.equal(calls,3);
});
test('blocked, ambiguous and foreign redirects are rejected without being followed or cached',async()=>{
 for(const response of [new Response(null,{status:403}),new Response(null,{status:303,headers:{location:'https://foreign.example/watch?v=wkNChZCvJKY'}}),new Response(null,{status:303,headers:{location:'https://www.youtube.com/watch?v=another0001'}})]){
  let calls=0;const filter=createHorizontalVideoFilter({fetchImpl:async()=>{calls++;return response.clone();}});
  assert.deepEqual(await filter([videos[1]]),[]);assert.deepEqual(await filter([videos[1]]),[]);assert.equal(calls,2);
 }
});
test('orientation checks stop on their overall deadline and never start more than eight requests concurrently',async()=>{
 let active=0,maxActive=0;
 const filter=createHorizontalVideoFilter({budgetMs:20,fetchImpl:async(_url,{signal})=>{active++;maxActive=Math.max(maxActive,active);return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{active--;reject(signal.reason);},{once:true}));}});
 const many=Array.from({length:40},(_,index)=>({...videos[0],id:`v${String(index).padStart(10,'0')}`}));
 assert.deepEqual(await filter(many),[]);assert.equal(maxActive,8);assert.equal(active,0);
});
