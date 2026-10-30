import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const url=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const compile=async path=>ts.transpileModule(await readFile(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const catalog=url(await compile('modules/dashboard-news/weatherCatalog.ts')),{readWeatherCities,weatherPreferencesKey}=await import(catalog);
const mocks=url(`export const state={actor:'owner-a',calls:[],configured:false,fail:false,abort:null};
 export const assertSessionActor=async expected=>{if(expected!==state.actor)throw Error('actor changed');};
 export const rpcRequest=async(resource,action,payload,signal)=>{state.calls.push({resource,action,payload,signal});if(action==='get')return {configured:state.configured,revision:state.configured?'2':'0',cities:state.configured?[{id:'2803401',name:'Japoatã',state:'SE'}]:[]};if(state.fail)throw Error('save failed');return {configured:true,revision:'1',cities:payload.cityIds.map(id=>({id,name:'Canonical '+id,state:'SE'}))};};
 export const authenticatedFetch=async(path,options)=>{state.calls.push({path,options});if(state.abort)state.abort.abort();return Response.json({cities:JSON.parse(options.body).ids.map(id=>({id,name:'Canonical '+id,state:'SE'}))});};`);
const source=(await compile('modules/dashboard-news/weatherPreferences.ts')).replace(/from ['"]\.\/weatherCatalog['"]/g,`from ${JSON.stringify(catalog)}`).replace(/from ['"]@\/shared\/supabase\/[^'"]+['"]/g,`from ${JSON.stringify(mocks)}`);
const {fetchWeatherPreferences}=await import(url(source)),{state}=await import(mocks);
function setup(raw){const previous=globalThis.window,storage=new Map();if(raw!==undefined)storage.set(weatherPreferencesKey('owner-a'),raw);globalThis.window={localStorage:{getItem:key=>storage.get(key)??null,removeItem:key=>storage.delete(key)}};Object.assign(state,{actor:'owner-a',calls:[],configured:false,fail:false,abort:null});return {storage,restore:()=>{globalThis.window=previous;}};}

test('legacy selection imports once through canonical IBGE preparation and only removes local preferences after commit',async()=>{
 const {storage,restore}=setup(JSON.stringify({version:1,cities:[{id:'2803302',name:'Local label',state:'SP'}]}));
 try{const data=await fetchWeatherPreferences('owner-a',new AbortController().signal);assert.equal(data.cities[0].state,'SE');assert.equal(data.cities[0].name,'Canonical 2803302');assert.deepEqual(state.calls.map(x=>x.action??'prepare'),['get','prepare','initialize']);assert.deepEqual(state.calls[2].payload,{cityIds:['2803302']});assert.equal(storage.size,0);}
 finally{restore();}
});
test('cloud preferences win over another device and an explicit empty list remains empty',async()=>{
 let fixture=setup(JSON.stringify({version:1,cities:readWeatherCities('')}));
 try{state.configured=true;const data=await fetchWeatherPreferences('owner-a',new AbortController().signal);assert.equal(data.cities[0].id,'2803401');assert.equal(state.calls.length,1);}
 finally{fixture.restore();}
 fixture=setup(JSON.stringify({version:1,cities:[]}));
 try{assert.deepEqual((await fetchWeatherPreferences('owner-a',new AbortController().signal)).cities,[]);assert.deepEqual(state.calls.at(-1).payload.cityIds,[]);}
 finally{fixture.restore();}
});
test('failed initialization, logout and cancellation preserve the legacy selection and never initialize the next account',async()=>{
 const raw=JSON.stringify({version:1,cities:[{id:'2803302',name:'Japaratuba',state:'SE'}]}),{storage,restore}=setup(raw);
 try{
  state.fail=true;await assert.rejects(()=>fetchWeatherPreferences('owner-a',new AbortController().signal),/save failed/);assert.equal(storage.get(weatherPreferencesKey('owner-a')),raw);
  state.fail=false;state.calls=[];state.abort=new AbortController();await assert.rejects(()=>fetchWeatherPreferences('owner-a',state.abort.signal),{name:'AbortError'});assert.equal(state.calls.some(x=>x.action==='initialize'),false);assert.equal(storage.size,1);
  state.abort=null;state.actor='owner-b';state.calls=[];await assert.rejects(()=>fetchWeatherPreferences('owner-a',new AbortController().signal),/actor changed/);assert.equal(state.calls.length,0);
 }finally{restore();}
});
