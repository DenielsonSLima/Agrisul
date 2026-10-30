import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const dataUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const compile=async relative=>ts.transpileModule(await readFile(new URL(relative,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const fixtures=dataUrl(`
 export const state={user:{id:'tv-owner'},ready:true,status:200,body:null,calls:[],pending:false,authorized:false,events:[]};
 export const useAuth=()=>({user:state.user,ready:state.ready});
 export const useQuery=options=>options;
 export const billingKeys={resource:(id,resource)=>['billing',id,resource]};
 export async function authenticatedFetch(path,options){
  state.calls.push({path,options});options.signal.throwIfAborted();
  if(state.pending)return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  return Response.json(state.body,{status:state.status});
 }
 export async function getRequestUser(){state.events.push('verify-user');return state.authorized?{id:'tv-owner'}:null;}
 export async function getTvFeed(){state.events.push('fetch-provider');return state.body;}
`);
const {state}=await import(fixtures);
const catalog=dataUrl(await compile('./catalog.ts'));
const {TV_CHANNELS}=await import(catalog);
const hook=(await compile('./useDashboardTv.ts')).replace(/from ['"](?:@tanstack\/react-query|@\/shared\/supabase\/AuthProvider|@\/shared\/supabase\/rpc|@\/shared\/query\/keys)['"]/g,`from ${JSON.stringify(fixtures)}`).replace(/from ['"]\.\/catalog['"]/g,`from ${JSON.stringify(catalog)}`);
const {useDashboardTv}=await import(dataUrl(hook));
const route=(await compile('../../app/api/dashboard-tv/route.ts')).replace(/from ['"][^'"]+['"]/g,`from ${JSON.stringify(fixtures)}`);
const {GET}=await import(dataUrl(route));
const validFeed=()=>({checkedAt:'2026-10-30T13:00:00Z',refreshSeconds:300,sources:TV_CHANNELS.map(channel=>({id:channel.id,name:channel.name,status:'current',updatedAt:'2026-10-30T13:00:00Z'})),videos:[{id:'video000000',title:'Mercado do agro',channelId:TV_CHANNELS[0].id,channelName:TV_CHANNELS[0].name,publishedAt:'2026-10-30T12:00:00Z',url:'https://www.youtube.com/watch?v=video000000',thumbnailUrl:'https://i.ytimg.com/vi/video000000/hqdefault.jpg'}]});

test('TV query isolates accounts, waits for session readiness and refreshes on reconnect',()=>{
 state.user={id:'tv-owner'};state.ready=true;
 const query=useDashboardTv();
 assert.deepEqual(query.queryKey,['billing','tv-owner','dashboard-tv',{version:3}]);assert.equal(query.enabled,true);
 assert.equal(query.staleTime,300000);assert.equal(query.refetchInterval,300000);assert.equal(query.refetchOnReconnect,true);assert.equal(query.retry,1);
 state.ready=false;assert.equal(useDashboardTv().enabled,false);
 state.ready=true;state.user={id:'other-owner'};assert.equal(useDashboardTv().queryKey[1],'other-owner');
 state.user=null;assert.equal(useDashboardTv().enabled,false);assert.equal(useDashboardTv().queryKey[1],'');
});

test('account cancellation reaches the TV transport and aborted requests reject immediately',async()=>{
 state.user={id:'tv-owner'};state.ready=true;state.pending=true;
 try{
  const controller=new AbortController(),query=useDashboardTv();
  const request=query.queryFn({signal:controller.signal}),rejected=assert.rejects(request,{name:'AbortError'});
  assert.equal(state.calls.at(-1).path,'/api/dashboard-tv');
  assert.equal(state.calls.at(-1).options.signal.aborted,false);
  controller.abort();await rejected;
  assert.equal(state.calls.at(-1).options.signal.aborted,true);
  await assert.rejects(query.queryFn({signal:controller.signal}),{name:'AbortError'});
 }finally{state.pending=false;}
});

test('TV transport rejects unavailable or malformed responses and accepts a healthy retry',async()=>{
 state.user={id:'tv-owner'};state.ready=true;state.pending=false;
 const query=useDashboardTv(),signal=new AbortController().signal;
 state.status=503;state.body={error:'offline'};
 await assert.rejects(()=>query.queryFn({signal}),/atualizar os vídeos/);
 state.status=200;
 for(const invalid of [null,{...validFeed(),checkedAt:'invalid'}, {...validFeed(),videos:[{...validFeed().videos[0],channelId:'external-publisher'}]}, {...validFeed(),videos:[{...validFeed().videos[0],url:'https://external.example/video'}]}]){
  state.body=invalid;await assert.rejects(()=>query.queryFn({signal}),/lista de vídeos inválida/);
 }
 state.body=validFeed();assert.deepEqual(await query.queryFn({signal}),state.body);assert.equal(signal.aborted,false);
 state.body={...validFeed(),videos:[],sources:validFeed().sources.map(source=>({...source,status:'unavailable',updatedAt:null}))};
 assert.deepEqual((await query.queryFn({signal})).videos,[]);
});

test('TV route verifies the session before any provider call and keeps responses out of shared caches',async()=>{
 state.authorized=false;state.events=[];state.body=validFeed();
 const request=new Request('https://app.example/api/dashboard-tv?ownerId=another-owner');
 const denied=await GET(request);
 assert.equal(denied.status,401);assert.equal(denied.headers.get('Cache-Control'),'no-store');assert.deepEqual(state.events,['verify-user']);
 state.authorized=true;state.events=[];
 const response=await GET(request);
 assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 assert.deepEqual(state.events,['verify-user','fetch-provider']);assert.deepEqual(await response.json(),state.body);
});
