import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const compile=async path=>ts.transpileModule(await readFile(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const fixtures=url(`export const state={user:{id:'news-owner'},ready:true,calls:[],body:null,status:200,authorized:false,providerCalls:0,hang:null,records:[{id:'sep',month:9,year:2026,monthlyGrossValue:'1.234567',monthlyNetValue:'1.123456',accumulatedGrossValue:'1.111111',accumulatedNetValue:'1.000001'},{id:'aug',month:8,year:2026},{id:'jul',month:7,year:2026},{id:'jun',month:6,year:2026}]};export const useAuth=()=>({user:state.user,ready:state.ready});export const useQuery=options=>options;export const billingKeys={resource:(id,resource)=>['billing',id,resource]};export async function authenticatedFetch(path,options){state.calls.push({path,options});if(state.hang==='session')return new Promise(()=>{});if(state.hang==='body')return {ok:true,json:()=>new Promise(()=>{})};return Response.json(state.body,{status:state.status});}export const ATR_PAGE_SIZE=12;export const fetchAtr=(page,signal)=>{state.calls.push({page,signal});return {records:state.records};};export function useCadastroQuery(resource,params,fetcher){state.calls.push({resource,params});return {data:fetcher('abort-signal')};}export const getRequestUser=async()=>state.authorized?{id:'news-owner'}:null;export const getNewsFeed=async()=>{state.providerCalls++;return {articles:[]};};export const getWeatherFeed=async ids=>{state.providerCalls++;return {ids};};export const searchWeatherCities=async q=>{state.providerCalls++;return [{name:q}];};`);
const {state}=await import(fixtures);
const catalog=url(await compile('modules/dashboard-news/catalog.ts'));
const hookSource=(await compile('modules/dashboard-news/useAgroNews.ts')).replace(/from ['"](?:@tanstack\/react-query|@\/shared\/supabase\/AuthProvider|@\/shared\/supabase\/rpc|@\/shared\/query\/keys)['"]/g,`from ${JSON.stringify(fixtures)}`).replace(/from ['"]\.\/catalog['"]/g,`from ${JSON.stringify(catalog)}`);
const {useAgroNews}=await import(url(hookSource));
test('news query is account scoped, cancels fetches, refreshes automatically and validates the response',async()=>{
 state.user={id:'news-owner'};const options=useAgroNews();assert.deepEqual(options.queryKey,['billing','news-owner','dashboard-news',{version:4}]);assert.equal(options.enabled,true);assert.equal(options.refetchInterval,300000);
 state.body={articles:[],sources:[],checkedAt:'2026-10-29T12:00:00Z',refreshSeconds:300};state.status=200;const controller=new AbortController();await options.queryFn({signal:controller.signal});assert.equal(state.calls.at(-1).options.signal.aborted,false);assert.equal(options.retry,1);
 state.body={articles:[],sources:[],refreshSeconds:300};await assert.rejects(()=>options.queryFn({signal:controller.signal}),/inválidas/);state.status=503;await assert.rejects(()=>options.queryFn({signal:controller.signal}),/atualizar/);
 state.user={id:'other-owner'};assert.equal(useAgroNews().queryKey[1],'other-owner');state.user=null;assert.equal(useAgroNews().enabled,false);
});
test('news requests release a stalled session or body and can recover on the next attempt',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 state.user={id:'news-owner'};state.status=200;
 const options=useAgroNews();
 try{
  for(const stage of ['session','body']){
   state.hang=stage;const controller=new AbortController();
   const request=options.queryFn({signal:controller.signal});
   const rejected=assert.rejects(request,/demorou demais/);
   await Promise.resolve();t.mock.timers.tick(15000);await rejected;
   assert.equal(state.calls.at(-1).options.signal.aborted,true);
   assert.equal(controller.signal.aborted,false);
  }
  state.hang=null;state.body={articles:[],sources:[],checkedAt:'2026-10-29T12:00:00Z',refreshSeconds:300};
  assert.equal((await options.queryFn({signal:new AbortController().signal})).refreshSeconds,300);
 }finally{state.hang=null;t.mock.timers.reset();}
});
test('news cancellation releases a stalled session immediately',async()=>{
 state.user={id:'news-owner'};state.hang='session';const controller=new AbortController();
 try{
  const request=useAgroNews().queryFn({signal:controller.signal});
  const rejected=assert.rejects(request,{name:'AbortError'});
  controller.abort();await rejected;
  assert.equal(state.calls.at(-1).options.signal.aborted,true);
 }finally{state.hang=null;}
});

test('ATR card shares the authorized registration cache and displays only the three newest server-ordered references',async()=>{
 const source=(await compile('modules/dashboard-news/useDashboardAtr.ts')).replace(/from ['"][^'"]+['"]/g,`from ${JSON.stringify(fixtures)}`),{useDashboardAtr}=await import(url(source));
 state.calls=[];const result=useDashboardAtr();assert.deepEqual(state.calls[0],{resource:'atr',params:{page:1,pageSize:12}});assert.deepEqual(state.calls[1],{page:1,signal:'abort-signal'});assert.equal(result.records.length,3);assert.equal(result.record.id,'sep');assert.equal(result.record.monthlyGrossValue,'1.234567');assert.deepEqual(result.records.map(row=>row.id),['sep','aug','jul']);assert.equal(state.records.length,4);
});
test('public news and weather routes require a verified user before touching their providers',async()=>{
 for(const path of ['app/api/dashboard-news/route.ts','app/api/dashboard-weather/route.ts']){
  const source=(await compile(path)).replace(/from ['"][^'"]+['"]/g,`from ${JSON.stringify(fixtures)}`),{GET}=await import(url(source));
  state.authorized=false;state.providerCalls=0;const denied=await GET(new Request('https://app.example/api?ids=2803302'));assert.equal(denied.status,401);assert.equal(state.providerCalls,0);
  state.authorized=true;const response=await GET(new Request('https://app.example/api?ids=2803302'));assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(state.providerCalls,1);
  if(path.includes('weather')){const bad=await GET(new Request('https://app.example/api?ids=../../internal'));assert.equal(bad.status,400);assert.equal(state.providerCalls,1);assert.equal((await GET(new Request('https://app.example/api?q=a'))).status,400);assert.equal((await GET(new Request('https://app.example/api?ids=2803302,2803302'))).status,400);}
 }
});
