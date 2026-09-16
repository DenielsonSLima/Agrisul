import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const {build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const directory=await mkdtemp(join(tmpdir(),'cadastro-rpc-'));
const calls=[];
const controller=new AbortController();
let failure;
const results={
  clients:{list:{clients:[{id:'client-id'}]},get:{client:{id:'client-id'}},save:{client:{id:'client-id'}}},
  atr:{list:{records:[{id:'atr-id',monthlyGrossValue:'1.25',monthlyNetValue:'1.23',accumulatedGrossValue:'1.21',accumulatedNetValue:'1.19'}],pagination:{page:2,pageSize:12,total:13,totalPages:2,hasPrevious:true,hasNext:false}},save:{record:{id:'atr-id',monthlyGrossValue:'1.26',monthlyNetValue:'1.24',accumulatedGrossValue:'1.22',accumulatedNetValue:'1.20'}}},
  farms:{list:{farms:[{id:'farm-id',plotCount:2}],summary:{farmCount:1,plotCount:2,totalHa:'10',usedHa:'6',preservedHa:'4',usedPercent:60}},save:{farm:{id:'farm-id'}}},
  'contract-types':{list:{types:[{id:'type-id'}]},get:{type:{id:'type-id'}},save:{type:{id:'type-id'}}},
  cultures:{list:{cultures:[{id:'culture-id'}]},save:{id:'subtype-id'}},
  'cultural-practices':{
    list:{practices:[{id:'practice-id'}],catalog:[{category:'soil-preparation',categoryLabel:'Preparar solo',name:'Plantio',position:7}]},
    save:{practice:{id:'practice-id'}},
    delete:{id:'practice-id',deleted:true},
    'bootstrap-sugarcane':{
      culture:{id:'culture-id',name:'Cana-de-açúcar'},
      subtypes:[{id:'plant-id',name:'Cana planta'},{id:'ratoon-id',name:'Cana soca'}],
      focus:{cultureId:'culture-id',cultureSubtypeId:'plant-id'},
      created:{cultures:1,subtypes:2,practices:20},
      totalPractices:20,
    },
  },
  plots:{list:{data:{availableHa:'2.67',usedPercent:73.3,canAddPlot:true,plots:[{id:'plot-id',maxAreaHa:'6.67'}]}},save:{data:{availableHa:'0',usedPercent:100,canAddPlot:false,plots:[]}}},
};
globalThis.cadastroRpcFixture=async(resource,action,payload,signal)=>{
  calls.push({resource,action,payload,signal});
  if(failure)throw failure;
  return results[resource][action];
};
globalThis.cadastroFetchFixture=async(input,init)=>{
  calls.push({input,init,authenticated:true});
  return Response.json({details:{cnpj:'12345678000195'}});
};
const plugin={name:'rpc-fixture',setup(b){
  b.onResolve({filter:/shared\/supabase\/rpc$/},()=>({path:'rpc',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export class RpcError extends Error { constructor(message,status){super(message);this.status=status;} } export const rpcRequest=(...args)=>globalThis.cadastroRpcFixture(...args); export const authenticatedFetch=(...args)=>globalThis.cadastroFetchFixture(...args);`}));
}};
async function load(folder,name){
  const out=join(directory,name+'.mjs');
  await build({entryPoints:[`modules/cadastro/${folder}/services/${name}.ts`],outfile:out,bundle:true,platform:'node',format:'esm',plugins:[plugin]});
  return import(pathToFileURL(out));
}
try{
  const clients=await load('clientes','clientApi');
  assert.deepEqual(await clients.fetchClients(controller.signal),[{id:'client-id'}]);
  assert.equal(calls.at(-1).signal,controller.signal);
  assert.deepEqual(await clients.fetchClient('client-id'),{id:'client-id'});
  const input={legalName:'Parceiro',cnpj:'entrada para validação no servidor'};
  assert.deepEqual(await clients.persistClient(input,'client-id'),{id:'client-id'});
  assert.deepEqual(calls.at(-1).payload,{...input,id:'client-id'});
  await clients.fetchClientCnpj('12345678000195',controller.signal);
  assert.equal(calls.at(-1).authenticated,true);
  assert.equal(calls.at(-1).init.signal,controller.signal);
  const farms=await load('fazenda','farmApi');
  const farmList=await farms.fetchFarms(controller.signal);
  assert.equal(calls.at(-1).signal,controller.signal);
  assert.equal(farmList.farms[0].plotCount,2);
  assert.equal(farmList.summary.preservedHa,'4');
  assert.deepEqual(await farms.persistFarm({name:'Teste',areaHa:'3,330001'},'id-edit'),{id:'farm-id'});
  const modules=[['contratos','typeApi','fetchTypes','persistType','types','type']];
  for(const [folder,file,list,save,plural,single] of modules){
    const api=await load(folder,file);
    const listed=await api[list](controller.signal);
    assert.equal(calls.at(-1).signal,controller.signal);
    assert.deepEqual(listed,results[calls.at(-1).resource].list[plural]);
    const saved=await api[save]({name:'Teste',areaHa:'3,330001'},'id-edit');
    assert.deepEqual(saved,results[calls.at(-1).resource].save[single]);
    assert.equal(calls.at(-1).payload.areaHa,'3,330001');
    assert.equal(calls.at(-1).payload.id,'id-edit');
  }
  const atr=await load('atr','atrApi');
  assert.deepEqual(await atr.fetchAtr(2,controller.signal),results.atr.list);
  assert.deepEqual(calls.at(-1).payload,{page:2,pageSize:12});
  assert.equal(calls.at(-1).signal,controller.signal);
  await atr.persistAtr({year:2026,month:9,monthlyGrossValue:'1,253367',monthlyNetValue:'1,234567',accumulatedGrossValue:'1,217020',accumulatedNetValue:'1,198765'},'atr-edit');
  assert.deepEqual(calls.at(-1).payload,{year:2026,month:9,monthlyGrossValue:'1,253367',monthlyNetValue:'1,234567',accumulatedGrossValue:'1,217020',accumulatedNetValue:'1,198765',id:'atr-edit'});
  const cultures=await load('culturas','cultureApi');
  assert.deepEqual(await cultures.fetchCultures(),[{id:'culture-id'}]);
  assert.equal(await cultures.persistCulture({kind:'subtype',name:'Cana soca',cultureId:'culture-id'}),'subtype-id');
  assert.equal(calls.at(-1).payload.cultureId,'culture-id');
  const management=await load('tratos-culturais','practiceApi');
  assert.deepEqual(await management.fetchPractices({cultureId:'culture-id',cultureSubtypeId:'subtype-id'},controller.signal),results['cultural-practices'].list);
  assert.deepEqual(calls.at(-1).payload,{cultureId:'culture-id',cultureSubtypeId:'subtype-id'});
  assert.equal(calls.at(-1).signal,controller.signal);
  const managementInput={cultureId:'culture-id',cultureSubtypeId:'subtype-id',category:'soil-preparation',name:'Plantio',description:'Operação de teste'};
  assert.deepEqual(await management.persistPractice(managementInput,'practice-id'),{id:'practice-id'});
  assert.deepEqual(calls.at(-1).payload,{...managementInput,id:'practice-id'});
  assert.deepEqual(await management.deletePractice('practice-id'),results['cultural-practices'].delete);
  assert.equal(calls.at(-1).resource,'cultural-practices');
  assert.equal(calls.at(-1).action,'delete');
  assert.deepEqual(calls.at(-1).payload,{id:'practice-id'});
  const bootstrap=await management.bootstrapSugarcaneManagement();
  assert.deepEqual(bootstrap,results['cultural-practices']['bootstrap-sugarcane']);
  assert.equal(calls.at(-1).resource,'cultural-practices');
  assert.equal(calls.at(-1).action,'bootstrap-sugarcane');
  assert.deepEqual(calls.at(-1).payload,{});
  const plots=await load('talhoes','plotApi');
  const summary=await plots.fetchPlots('farm-id',controller.signal);
  assert.equal(summary.usedPercent,73.3);
  assert.equal(summary.plots[0].maxAreaHa,'6.67');
  assert.equal(calls.at(-1).signal,controller.signal);
  assert.equal((await plots.persistPlot('farm-id',{name:'Talhão',areaHa:'2,67'},'plot-id')).canAddPlot,false);
  assert.deepEqual(calls.at(-1).payload,{name:'Talhão',areaHa:'2,67',farmId:'farm-id',id:'plot-id'});
  failure=new plots.PlotApiError('Capacidade excedida',409);
  await assert.rejects(plots.persistPlot('farm-id',{name:'Excesso',areaHa:'999'}),error=>error===failure&&error.status===409);
  console.log('Passed: seven cadastro RPC envelopes, cancellation, authenticated lookup, server decimals/capacity and conflict propagation.');
}finally{
  delete globalThis.cadastroRpcFixture;delete globalThis.cadastroFetchFixture;
  await rm(directory,{recursive:true,force:true});
}
