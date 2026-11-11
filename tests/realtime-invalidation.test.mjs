import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {QueryClient,QueryObserver} from '@tanstack/react-query';
import {billingKeys} from '../shared/query/keys.ts';

let source=ts.transpileModule(readFileSync(new URL('../shared/query/realtimeInvalidation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
source=source.replace("from './keys'",`from ${JSON.stringify(new URL('../shared/query/keys.ts',import.meta.url).href)}`);
const {invalidateRealtimeResources,createRealtimeInvalidator}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const until=async predicate=>{const end=Date.now()+2000;while(!predicate()){assert.ok(Date.now()<end,'Expected query transition');await new Promise(resolve=>setTimeout(resolve,2));}};

function setup(){
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity,staleTime:Infinity}}});
 const key=[...billingKeys.resource('owner-one','import-documents'),{id:'document',view:'table'}];
 const other=[...billingKeys.resource('owner-two','import-documents'),{id:'document',view:'table'}];
 client.setQueryData(key,{revision:0});client.setQueryData(other,{revision:0});
 const reads=[];let aborts=0,revision=1;
 const observer=new QueryObserver(client,{queryKey:key,queryFn:({signal})=>{
  const value=revision;
  signal.addEventListener('abort',()=>{aborts++;},{once:true});
  return new Promise(resolve=>reads.push(()=>resolve({revision:value})));
 }});
 const unsubscribe=observer.subscribe(()=>{});
 return {client,key,other,reads,get aborts(){return aborts;},set revision(value){revision=value;},dispose(){unsubscribe();client.clear();}};
}

test('Realtime row bursts reuse the awaited mutation refresh without cancelling or repeating its reads',async()=>{
 const state=setup();
 try{
  const savedRefresh=state.client.invalidateQueries({queryKey:billingKeys.resource('owner-one','import-documents')},{throwOnError:true});
  assert.equal(state.reads.length,1);
  const events=Array.from({length:30},()=>invalidateRealtimeResources(state.client,'owner-one',['import-documents']));
  assert.equal(state.reads.length,1);assert.equal(state.aborts,0);
  state.reads[0]();await Promise.all([savedRefresh,...events]);
  assert.deepEqual(state.client.getQueryData(state.key),{revision:1});
  assert.equal(state.client.getQueryState(state.other).isInvalidated,false);
 }finally{state.dispose();}
});

test('events received during a read trigger one final read with the newest committed revision',async()=>{
 const state=setup(),queue=createRealtimeInvalidator(state.client,'owner-one',2);
 try{
  queue.enqueue(['import-documents']);await until(()=>state.reads.length===1);
  state.revision=2;
  for(let i=0;i<30;i++)queue.enqueue(['import-documents']);
  assert.equal(state.reads.length,1);assert.equal(state.aborts,0);
  state.reads[0]();await until(()=>state.reads.length===2);
  state.reads[1]();await until(()=>state.client.getQueryData(state.key).revision===2);
  assert.equal(state.aborts,0);assert.equal(state.reads.length,2);
  assert.equal(state.client.getQueryState(state.other).isInvalidated,false);
 }finally{queue.dispose();state.dispose();}
});

test('account cleanup discards trailing events and does not restart queries for the previous account',async()=>{
 const state=setup(),queue=createRealtimeInvalidator(state.client,'owner-one',2);
 try{
  queue.refreshAll();await until(()=>state.reads.length===1);
  queue.enqueue(['import-documents']);queue.dispose();state.reads[0]();
  await until(()=>state.client.getQueryState(state.key).fetchStatus==='idle');
  queue.enqueue(['import-documents']);queue.refreshAll();
  await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(state.reads.length,1);
 }finally{queue.dispose();state.dispose();}
});
