import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const transpile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const timeoutUrl=url(transpile('../shared/supabase/requestTimeout.ts'));
const {withRequestTimeout,REQUEST_TIMEOUT_MS}=await import(timeoutUrl);
const fixtureUrl=url('export const state={client:null};export const getSupabaseBrowserClient=()=>state.client;');
const {state}=await import(fixtureUrl);
const require=createRequire(import.meta.url);
let rpcSource=transpile('../shared/supabase/rpc.ts');
rpcSource=rpcSource.replace("from './client'",`from ${JSON.stringify(fixtureUrl)}`)
 .replace("from './requestTimeout'",`from ${JSON.stringify(timeoutUrl)}`)
 .replace("from '@supabase/supabase-js'",`from ${JSON.stringify(pathToFileURL(require.resolve('@supabase/supabase-js')).href)}`);
const {rpcRequest,RpcError}=await import(url(rpcSource));

test('a nonresponsive request settles at the deadline even if it ignores abort',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let signal,late;
 const pending=withRequestTimeout(s=>{signal=s;return new Promise(resolve=>{late=resolve;});});
 const rejected=assert.rejects(pending,error=>error.name==='TimeoutError');
 t.mock.timers.tick(REQUEST_TIMEOUT_MS);await rejected;
 assert.equal(signal.aborted,true);late('late result');await Promise.resolve();
 await assert.rejects(pending,error=>error.name==='TimeoutError');
});

test('successful requests clean up deadlines and caller abort listeners',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let signal;
 const caller=new AbortController();
 assert.equal(await withRequestTimeout(s=>{signal=s;return Promise.resolve('saved');},{signal:caller.signal}),'saved');
 t.mock.timers.tick(REQUEST_TIMEOUT_MS);caller.abort();assert.equal(signal.aborted,false);
});

test('caller cancellation aborts the request and stays distinguishable from timeout',async()=>{
 const caller=new AbortController();let signal;
 const pending=withRequestTimeout(s=>{signal=s;return new Promise(()=>{});},{signal:caller.signal});
 const rejected=assert.rejects(pending,error=>error.name==='AbortError');caller.abort();await rejected;
 assert.equal(signal.aborted,true);
 let sent=false;
 await assert.rejects(withRequestTimeout(()=>{sent=true;return Promise.resolve();},{signal:caller.signal}),error=>error.name==='AbortError');
 assert.equal(sent,false);
});

test('synchronous failures preserve the original error and release the deadline',async()=>{
 const failure=new Error('failed before fetch');
 await assert.rejects(withRequestTimeout(()=>{throw failure;}),error=>error===failure);
});

test('RPC timeout aborts the transport and never automatically repeats a write',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0,signal,retries;
 state.client={rpc(){calls++;return {retry(value){retries=value;return this;},abortSignal(value){signal=value;return new Promise(()=>{});}};}};
 const pending=rpcRequest('import-documents','save-plot-area',{id:'document',value:'5'});
 const rejected=assert.rejects(pending,error=>error instanceof RpcError&&error.status===504&&error.code==='BILLING_REQUEST_TIMEOUT');
 t.mock.timers.tick(REQUEST_TIMEOUT_MS);await rejected;
 assert.equal(signal.aborted,true);assert.equal(calls,1);assert.equal(retries,false);
});

test('query cancellation is not reported as a server failure and conflict errors retain their status',async()=>{
 state.client={rpc:()=>({retry(){return this;},abortSignal:()=>new Promise(()=>{})})};
 const caller=new AbortController();const pending=rpcRequest('import-documents','table',{},caller.signal);
 const rejected=assert.rejects(pending,error=>error.name==='AbortError'&&!(error instanceof RpcError));caller.abort();await rejected;
 state.client={rpc:()=>({retry(){return this;},abortSignal:()=>Promise.resolve({error:{code:'40001',message:'Revisão alterada'},status:400})})};
 await assert.rejects(rpcRequest('import-documents','save-bulk'),error=>error.status===409&&error.code==='40001');
});
