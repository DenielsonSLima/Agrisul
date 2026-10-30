import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const compile=async path=>ts.transpileModule(await readFile(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const mocks=url(`export const state={value:null,hang:false,signal:null,calls:[]};export async function rpcRequest(resource,action,payload,signal){state.signal=signal;state.calls.push({resource,action,payload});if(state.hang)return new Promise(()=>{});return state.value;}`);
const catalog=url(await compile('modules/dashboard-news/weatherCatalog.ts'));
const providers=new URL('../modules/dashboard-news/weatherProviders.mjs',import.meta.url).href;
const source=(await compile('modules/dashboard-news/weatherFeed.ts')).replace(/from ['"]@\/shared\/supabase\/rpc['"]/g,`from ${JSON.stringify(mocks)}`).replace(/from ['"]\.\/weatherCatalog['"]/g,`from ${JSON.stringify(catalog)}`).replace(/from ['"]\.\/weatherProviders.mjs['"]/g,`from ${JSON.stringify(providers)}`);
const {projectWeatherFeed,fetchCachedWeather}=await import(url(source)),{state}=await import(mocks);
const city={id:'2803302',name:'Japaratuba',state:'SE'},at=Date.parse('2026-10-30T14:59:00Z');
const snapshot=()=>({cities:[{city,fetchedAt:new Date(at).toISOString(),payload:{[city.id]:{'30/10/2026':{manha:{resumo:'Muitas nuvens',temp_min:22,temp_max:33},tarde:{resumo:'Chuva à tarde',temp_min:23,temp_max:34}}}}}],checkedAt:new Date(at).toISOString()});
test('stored INMET reference renders without fetching IBGE/INMET, switches turn and preserves stale reference time',()=>{
 const value=snapshot();assert.equal(projectWeatherFeed(value,at).cities[0].minimum,22);
 assert.equal(projectWeatherFeed(value,at+120000).cities[0].period,'tarde');
 const stale=projectWeatherFeed(value,at+3600000).cities[0];assert.equal(stale.status,'cached');assert.equal(stale.updatedAt,value.cities[0].fetchedAt);
 assert.equal(projectWeatherFeed(value,at+86400001).cities[0].status,'unavailable');
 value.cities[0].payload=null;value.cities[0].fetchedAt=null;assert.equal(projectWeatherFeed(value,at).cities[0].minimum,null);
 assert.throws(()=>projectWeatherFeed({cities:[],checkedAt:'bad'}),/inválida/);
});
test('weather read bounds a hung RPC, cancels on logout, validates city identities and recovers',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});state.hang=true;
 try{
  const controller=new AbortController(),pending=fetchCachedWeather([city.id],controller.signal),rejected=assert.rejects(pending,/demorou demais/);
  await Promise.resolve();t.mock.timers.tick(12000);await rejected;assert.equal(state.signal.aborted,true);assert.equal(controller.signal.aborted,false);
  const logout=new AbortController(),cancelled=fetchCachedWeather([city.id],logout.signal),aborted=assert.rejects(cancelled,{name:'AbortError'});logout.abort();await aborted;
  state.hang=false;state.value=snapshot();assert.equal((await fetchCachedWeather([city.id],new AbortController().signal)).cities[0].city.id,city.id);
  assert.deepEqual(state.calls.at(-1),{resource:'dashboard-weather',action:'get',payload:{cityIds:[city.id]}});
  await assert.rejects(()=>fetchCachedWeather(['2803401'],new AbortController().signal),/inválida/);
 }finally{state.hang=false;t.mock.timers.reset();}
});
