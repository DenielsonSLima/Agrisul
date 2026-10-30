import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const dataUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const fixtureUrl=dataUrl(`
 export const state={authorized:false,calls:[]};
 export async function getRequestUser(){state.calls.push({kind:'auth'});return state.authorized?{id:'viewer'}:null;}
 export async function getTvPlayback(videoId,options){state.calls.push({kind:'playback',videoId,options});return {manifest:'<MPD>public-stream-paths-only</MPD>',formats:new Map([[140,{url:'https://rr1.googlevideo.com/videoplayback?itag=140',mimeType:'audio/mp4',contentLength:4096}]])};}
`);
const {state}=await import(fixtureUrl);
async function load(relative){
 let source=ts.transpileModule(await readFile(new URL(relative,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
 source=source.replace(/from ['"](?:@\/shared\/supabase\/server|@\/modules\/dashboard-tv\/playback)['"]/g,`from ${JSON.stringify(fixtureUrl)}`).replace(/from ['"]@\/modules\/dashboard-tv\/playbackSafety['"]/g,`from ${JSON.stringify(new URL('./playbackSafety.ts',import.meta.url).href)}`);
 return import(dataUrl(source));
}
const playbackRoute=await load('../../app/api/dashboard-tv/playback/route.ts'),streamRoute=await load('../../app/api/dashboard-tv/stream/route.ts');
const headers=extra=>({Authorization:'Bearer app_session_not_forwarded',...extra});
const base='https://dashboard.example/api/dashboard-tv';

test('playback authenticates first and accepts only the selected video ID without URL-supplied destinations',async()=>{
 state.authorized=false;state.calls=[];
 assert.equal((await playbackRoute.GET(new Request(`${base}/playback?videoId=wkNChZCvJKY`))).status,401);assert.deepEqual(state.calls,[{kind:'auth'}]);
 state.authorized=true;state.calls=[];
 assert.equal((await playbackRoute.GET(new Request(`${base}/playback?videoId=wkNChZCvJKY&url=https://foreign.example`,{headers:headers()}))).status,400);assert.equal(state.calls.some(call=>call.kind==='playback'),false);
 const response=await playbackRoute.GET(new Request(`${base}/playback?videoId=wkNChZCvJKY`,{headers:headers()}));
 assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(state.calls.at(-1).options,undefined);
 assert.deepEqual(await response.json(),{manifest:'<MPD>public-stream-paths-only</MPD>'});
});

test('stream validates session and ranges before CDN access and retries an expired CDN URL without forwarding app credentials',async()=>{
 state.authorized=false;state.calls=[];const originalFetch=globalThis.fetch;let upstreamCalls=0;
 globalThis.fetch=async(input,options)=>{
  upstreamCalls++;assert.match(String(input),/^https:\/\/rr1\.googlevideo\.com\/videoplayback/);assert.equal(options.headers.Range,'bytes=0-1023');assert.equal(new Headers(options.headers).has('Authorization'),false);assert.equal(options.redirect,'error');
  if(upstreamCalls===1)return new Response('expired',{status:403});
  return new Response(new Uint8Array(1024),{status:206,headers:{'Content-Type':'audio/mp4','Content-Range':'bytes 0-1023/4096','Content-Length':'1024'}});
 };
 try{
  const path=`${base}/stream?videoId=wkNChZCvJKY&itag=140`;
  assert.equal((await streamRoute.GET(new Request(path,{headers:{Range:'bytes=0-1023'}}))).status,401);assert.equal(upstreamCalls,0);
  state.authorized=true;
  assert.equal((await streamRoute.GET(new Request(path,{headers:headers({Range:'bytes=0-'})}))).status,416);assert.equal(upstreamCalls,0);
  const response=await streamRoute.GET(new Request(path,{headers:headers({Range:'bytes=0-1023'})}));
  assert.equal(response.status,206);assert.equal(response.headers.get('Content-Range'),'bytes 0-1023/4096');assert.equal((await response.arrayBuffer()).byteLength,1024);assert.equal(upstreamCalls,2);
  const resolutions=state.calls.filter(call=>call.kind==='playback');assert.equal(resolutions.length,2);assert.equal(resolutions[0].options,undefined);assert.deepEqual(resolutions[1].options,{refresh:true});
 }finally{globalThis.fetch=originalFetch;}
});
