import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {marketSnapshotKey,saveMarketSnapshot} from './marketSnapshot.mjs';

const dataUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const fixtures=dataUrl(`export const state={results:null,options:[],cache:new Map(),fetch:async()=>{throw new Error('Missing mock')}};
 export function useQueryClient(){return {getQueryData:key=>state.cache.get(JSON.stringify(key))};}
 export function useQueries({queries}){state.options=queries;return state.results??queries.map(()=>({data:undefined,isPending:true,isFetching:true,isError:false,refetch:async()=>{}}));}
 export const billingKeys={resource:(userId,resource)=>['billing',userId,resource]};
 export async function rpcRequest(resource,action,payload,signal){if(resource!=='dashboard-market'||action!=='get')throw Error('Unexpected RPC');return (await state.fetch(payload.group,{signal})).json();}`);
const {state}=await import(fixtures);
const source=ts.transpileModule(await readFile(new URL('./useMarketFeed.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
 .replace(/from ['"](@tanstack\/react-query|@\/shared\/supabase\/rpc|@\/shared\/query\/keys)['"]/g,`from ${JSON.stringify(fixtures)}`)
 .replace(/from ['"]\.\/marketSnapshot\.mjs['"]/g,`from ${JSON.stringify(new URL('./marketSnapshot.mjs',import.meta.url).href)}`);
const {useMarketFeed}=await import(dataUrl(source));
const checkedAt='2026-10-29T12:00:00.000Z';
const quote=id=>({id,value:'5.1234',date:'2026-10-29',observedAt:checkedAt,source:'Fonte',sourceUrl:'https://example.org',note:'Referência',status:'available'});
const feed=id=>({quotes:[quote(id)],checkedAt,refreshSeconds:id==='usd'?60:600});
function memoryStorage(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),values};}
const result=(data,pending=false,error=false)=>({data,isPending:pending,isFetching:pending,isError:error,refetch:async()=>data});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

test('currency renders independently while agriculture and cane are still pending, with group-scoped query keys and TTLs',async()=>{
 const previousWindow=globalThis.window;globalThis.window={localStorage:memoryStorage()};state.results=null;state.cache.clear();
 const agriculture=deferred(),cane=deferred(),requested=[];
 state.fetch=async url=>{requested.push(url);return url.endsWith('currency')?Response.json(feed('usd')):url.endsWith('agriculture')?agriculture.promise:cane.promise;};
 try{
  const loading=useMarketFeed('owner-a');assert.equal(loading.isPending,true);assert.equal(loading.isQuotePending('usd'),true);
  const options=state.options;
  assert.deepEqual(options.map(option=>option.queryKey),['currency','agriculture','cane'].map(group=>['billing','owner-a','dashboard-market',{group}]));
  assert.deepEqual(options.map(option=>option.staleTime),[60000,600000,600000]);assert.deepEqual(options.map(option=>option.refetchInterval),[60000,600000,600000]);
  assert.equal(options.every(option=>option.refetchOnReconnect&&option.refetchOnWindowFocus),true);
  const jobs=options.map(option=>option.queryFn({signal:new AbortController().signal}));
  const currency=await jobs[0];assert.equal(currency.quotes[0].value,'5.1234');assert.equal(requested.length,3);
  state.results=[result(currency),result(undefined,true),result(undefined,true)];const partial=useMarketFeed('owner-a');
  assert.equal(partial.isPending,false);assert.equal(partial.isFetching,true);assert.equal(partial.isError,false);assert.equal(partial.data.quotes[0].id,'usd');
  assert.equal(partial.isQuotePending('usd'),false);assert.equal(partial.isQuotePending('soy'),true);assert.equal(partial.isQuotePending('cane'),true);
  agriculture.resolve(Response.json(feed('soy')));cane.resolve(Response.json(feed('cane')));await Promise.all(jobs);
 }finally{globalThis.window=previousWindow;state.results=null;}
});
test('saved publications seed as stale immediately, refetch from zero updatedAt, and never seed another account',()=>{
 const previousWindow=globalThis.window,storage=memoryStorage();globalThis.window={localStorage:storage};state.results=null;state.cache.clear();
 try{
  saveMarketSnapshot(storage,'owner-a','currency',feed('usd'));useMarketFeed('owner-a');const options=state.options;
  assert.equal(options[0].initialDataUpdatedAt,0);const cached=options[0].initialData();assert.equal(cached.quotes[0].status,'stale');assert.equal(cached.quotes[0].observedAt,checkedAt);assert.equal(cached.checkedAt,checkedAt);
  assert.equal(options[1].initialData(),undefined);state.results=[result(cached),result(undefined,true),result(undefined,true)];
  const model=useMarketFeed('owner-a');assert.equal(model.data.quotes[0].value,'5.1234');assert.equal(model.isPending,false);assert.equal(model.isQuotePending('usd'),false);
  state.results=null;useMarketFeed('owner-b');assert.equal(state.options[0].initialData(),undefined);assert.equal(state.options[0].queryKey[1],'owner-b');
 }finally{globalThis.window=previousWindow;state.results=null;}
});
test('a group network failure keeps its cached publication stale without hiding successful groups',()=>{
 const previousWindow=globalThis.window;globalThis.window={localStorage:memoryStorage()};state.cache.clear();
 try{
  state.results=[result(feed('usd'),false,true),result(feed('soy')),result(undefined,false,true)];const model=useMarketFeed('owner');
  assert.equal(model.isPending,false);assert.equal(model.isError,true);assert.equal(model.data.quotes.find(quote=>quote.id==='usd').status,'stale');assert.equal(model.data.quotes.find(quote=>quote.id==='soy').status,'available');assert.equal(model.isQuotePending('cane'),false);
  assert.equal(state.results[0].data.quotes[0].status,'available','Presentation never mutates TanStack cached publications');
 }finally{globalThis.window=previousWindow;state.results=null;}
});
test('cancelled and malformed responses cannot persist a snapshot',async()=>{
 const previousWindow=globalThis.window,storage=memoryStorage();globalThis.window={localStorage:storage};state.results=null;state.cache.clear();
 try{
  useMarketFeed('owner');const option=state.options[0],controller=new AbortController();controller.abort();state.fetch=async()=>Response.json(feed('usd'));
  await assert.rejects(()=>option.queryFn({signal:controller.signal}),error=>error.name==='AbortError');assert.equal(storage.getItem(marketSnapshotKey('owner','currency')),null);
  state.fetch=async()=>Response.json({...feed('usd'),quotes:[{...quote('usd'),sourceUrl:'javascript:alert(1)'}]});
  await assert.rejects(()=>option.queryFn({signal:new AbortController().signal}),/inválidas/);assert.equal(storage.getItem(marketSnapshotKey('owner','currency')),null);
 }finally{globalThis.window=previousWindow;state.results=null;}
});
