import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const directory=await mkdtemp(join(tmpdir(),'contracts-rpc-'));
const calls=[];
const snapshot={id:'contract-id',contractNumber:'CTR-123/2026',clientId:'client-id',typeId:'type-id',clientName:'Cliente atualizado',typeName:'Tipo original',stages:[{id:'stage-id',name:'Etapa preservada'}],value:'1200.30'};
let failure;
globalThis.contractsRpcFixture=async(resource,action,payload,signal)=>{
  calls.push({resource,action,payload,signal});
  if(failure)throw failure;
  if(action==='list')return {contracts:[snapshot],counts:{open:1,finished:0},total:1};
  if(action==='save-load')return {load:{...payload,id:'load-id'}};
  if(action==='delete-load')return {id:payload.id,deleted:true};
  return {contract:snapshot};
};
try{
  const out=join(directory,'api.mjs');
  await build({entryPoints:['modules/contratos/services/contractApi.ts'],outfile:out,bundle:true,platform:'node',format:'esm',plugins:[{name:'rpc-fixture',setup(b){
    b.onResolve({filter:/shared\/supabase\/rpc$/},()=>({path:'rpc',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export class RpcError extends Error {constructor(message,status){super(message);this.status=status;}} export const rpcRequest=(...args)=>globalThis.contractsRpcFixture(...args);'}));
  }}]});
  const api=await import(pathToFileURL(out));
  const controller=new AbortController();
  const filters={companyId:'company-id',bucket:'open',search:'Usina',from:'2026-09-01',to:'2026-09-30'};
  assert.deepEqual(await api.fetchContracts(filters,controller.signal),{contracts:[snapshot],counts:{open:1,finished:0},total:1});
  assert.equal(calls.at(-1).resource,'contracts');
  assert.deepEqual(calls.at(-1).payload,filters);
  assert.equal(calls.at(-1).signal,controller.signal);
  const loadFilters={search:'Fazenda',from:'2026-09-01',to:'2026-09-30',groupBy:'farm'};
  await api.fetchContractLoads('contract-id','company-id',loadFilters,controller.signal);
  assert.deepEqual(calls.at(-1).payload,{view:'loads',contractId:'contract-id',companyId:'company-id',...loadFilters});
  assert.equal(calls.at(-1).signal,controller.signal);
  assert.deepEqual(await api.fetchContract('contract-id','company-id',controller.signal),snapshot);
  assert.deepEqual(calls.at(-1).payload,{id:'contract-id',companyId:'company-id'});
  const input={title:'Safra',contractNumber:'CTR-123/2026',companyId:'company-id',clientId:'client-id',typeId:'type-id',status:'Ativo',startDate:'2026-09-01',endDate:'2026-10-01',contractedVolume:'25000,125',atrPriceType:'net',atrPeriodType:'accumulated',value:'1200,30',notes:''};
  assert.deepEqual(await api.persistContract(input,'contract-id'),snapshot);
  assert.deepEqual(calls.at(-1).payload,{...input,id:'contract-id'});
  assert.equal(Object.hasOwn(calls.at(-1).payload,'stages'),false);
  const load={loadedAt:'2026-09-15',farmId:'farm-id',plotId:'plot-id',volume:'120,125',atr:'121,500000',document:'ROM-1',notes:''};
  assert.equal((await api.persistContractLoad('contract-id','company-id',load)).id,'load-id');
  assert.deepEqual(calls.at(-1).payload,{...load,contractId:'contract-id',companyId:'company-id'});
  assert.deepEqual(await api.deleteContractLoad('contract-id','company-id','load-id'),{id:'load-id',deleted:true});
  assert.deepEqual(calls.at(-1).payload,{contractId:'contract-id',companyId:'company-id',id:'load-id'});
  failure=new api.ContractApiError('Cliente não encontrado.',404);
  await assert.rejects(api.persistContract(input),error=>error===failure);
  console.log('Passed: contracts RPC filters/get/save/load/delete, cancellation, exact decimal input, server snapshot and errors.');
}finally{
  delete globalThis.contractsRpcFixture;
  await rm(directory,{recursive:true,force:true});
}
