import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const compile=async path=>ts.transpileModule(await readFile(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const fixtures=url(`export const state={user:{id:'news-owner'},ready:true,calls:[],body:null,status:200,authorized:false,providerCalls:0,hang:null,records:[{id:'sep',month:9,year:2026,monthlyGrossValue:'1.234567',monthlyNetValue:'1.123456',accumulatedGrossValue:'1.111111',accumulatedNetValue:'1.000001'},{id:'aug',month:8,year:2026},{id:'jul',month:7,year:2026},{id:'jun',month:6,year:2026}]};export const useAuth=()=>({user:state.user,ready:state.ready});export const useQuery=options=>options;export const billingKeys={resource:(id,resource)=>['billing',id,resource]};export async function authenticatedFetch(path,options){state.calls.push({path,options});if(state.hang==='session')return new Promise(()=>{});if(state.hang==='body')return {ok:true,json:()=>new Promise(()=>{})};return Response.json(state.body,{status:state.status});}export const ATR_PAGE_SIZE=12;export const fetchAtr=(page,signal)=>{state.calls.push({page,signal});return {records:state.records};};export function useCadastroQuery(resource,params,fetcher){state.calls.push({resource,params});return {data:fetcher('abort-signal')};}export const getRequestSupabase=()=>({functions:{invoke:async(name,{body})=>{state.providerCalls++;return {data:{ids:body.ids},error:null};}}});export const getRequestUser=async()=>state.authorized?{id:'news-owner'}:null;export const getNewsFeed=async()=>{state.providerCalls++;return {articles:[]};};export const getWeatherFeed=async ids=>{state.providerCalls++;return {ids};};export const searchWeatherCities=async q=>{state.providerCalls++;return [{name:q}];};`);
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

test('weather polling follows turns and mutations await scoped server invalidation',async()=>{
 const weatherCatalog=url(await compile('modules/dashboard-news/weatherCatalog.ts'));
 const {readWeatherCities}=await import(weatherCatalog),cities=readWeatherCities('');
 const mocks=url(`import {state} from ${JSON.stringify(fixtures)};import {isWeatherFeed} from ${JSON.stringify(weatherCatalog)};export {useAuth,authenticatedFetch,billingKeys} from ${JSON.stringify(fixtures)};
  export const fetchCachedWeather=async(ids,signal)=>{state.calls.push({ids,options:{signal}});if(!isWeatherFeed(state.body))throw Error('Previsão inválida.');return state.body;};
  export const operations=[];export const useEffect=()=>{};export const useRef=value=>({current:value});
  export const fetchWeatherPreferences=async()=>({configured:true,revision:'1',cities:${JSON.stringify(cities)}});
  export const useQuery=options=>options.queryKey[2]==='weather-preferences'?{...options,data:{configured:true,revision:'1',cities:${JSON.stringify(cities)}},isPending:false}:options;
  export const useQueryClient=()=>({cancelQueries:async options=>operations.push({kind:'cancel',...options}),invalidateQueries:async options=>operations.push({kind:'invalidate',...options})});
  export const useMutation=options=>({isPending:false,mutateAsync:async input=>{await options.onMutate();const result=await options.mutationFn(input);await options.onSuccess(result);return result;}});
  export const assertSessionActor=async expected=>{if(state.user?.id!==expected)throw Error('actor changed');};
  export const rpcRequest=async(resource,action,payload,signal)=>{operations.push({kind:'rpc',resource,action,payload,signal});return {configured:true,revision:'2',cities:[]};};`);
 const weatherTime=new URL('../modules/dashboard-news/weatherTime.mjs',import.meta.url).href;
 const source=(await compile('modules/dashboard-news/useDashboardWeather.ts')).replace(/from ['"][^'"]+['"]/g,match=>match.includes('./weatherCatalog')?`from ${JSON.stringify(weatherCatalog)}`:match.includes('./weatherTime.mjs')?`from ${JSON.stringify(weatherTime)}`:`from ${JSON.stringify(mocks)}`);
 const {useDashboardWeather}=await import(url(source)),{operations}=await import(mocks);
 state.user={id:'weather-owner'};state.ready=true;state.status=200;state.hang=null;
 const options=useDashboardWeather();assert.equal(options.queryKey[1],'weather-owner');assert.equal(options.enabled,true);
 assert.equal(options.refetchOnWindowFocus,'always');assert.equal(options.refetchOnReconnect,'always');assert.equal(typeof options.refetchInterval,'function');
 const delay=options.refetchInterval({state:{data:{cities:[]}}});assert.ok(delay>0&&delay<=1800000);
 state.body={source:'INMET',checkedAt:'2026-10-30T12:00:00Z',refreshSeconds:1800,cities:cities.map(city=>({city,date:'2026-10-30',period:'manha',daylight:true,sunrise:null,sunset:null,iconCode:'34',condition:'Muitas nuvens',minimum:22,maximum:33,status:'current',updatedAt:'2026-10-30T12:00:00Z'}))};
 const signal=new AbortController().signal;assert.equal((await options.queryFn({signal})).cities.length,5);assert.equal(state.calls.at(-1).options.signal,signal);
 delete state.body.cities[0].period;await assert.rejects(()=>options.queryFn({signal}),/inv.lida/);
 await options.changeCities('remove',cities[0].id);assert.deepEqual(operations.map(x=>x.kind),['cancel','rpc','invalidate','invalidate']);
 assert.deepEqual(operations[1].payload,{cityId:cities[0].id});assert.equal(operations[1].resource,'weather-preferences');assert.equal(operations[2].queryKey[1],'weather-owner');
 state.user={id:'another-weather-owner'};await assert.rejects(()=>options.changeCities('reset'),/actor changed/);assert.equal(useDashboardWeather().queryKey[1],'another-weather-owner');state.user=null;assert.equal(useDashboardWeather().enabled,false);
});
