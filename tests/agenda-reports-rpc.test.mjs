import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {QueryClient} from '@tanstack/react-query';
import {billingKeys} from '../shared/query/keys.ts';
import {realtimeResources} from '../shared/query/realtimeResources.ts';
import {mutationResources} from '../shared/query/derivedResources.ts';
const require=createRequire(import.meta.url);
const {build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const directory=await mkdtemp(join(tmpdir(),'agenda-reports-'));
const calls=[];
globalThis.__overviewRpc=async(...args)=>{calls.push(args);return {rows:[{netAmount:'123456789.123456'}],days:[],totals:{netAmount:'123456789.123456'}};};
const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
try {
 const paths=['modules/agenda/services/eventService.ts','modules/resumo/services/summaryService.ts','modules/relatorios/services/reportService.ts'];
 const modules=[];
 for(const [index,path] of paths.entries()){
  const outfile=join(directory,`api-${index}.mjs`);
  await build({entryPoints:[path],outfile,bundle:true,platform:'node',format:'esm',plugins:[{name:'rpc-fixture',setup(builder){
   builder.onResolve({filter:/shared\/supabase\/rpc$/},()=>({path:'rpc',namespace:'fixture'}));
   builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const rpcRequest=(...args)=>globalThis.__overviewRpc(...args);',loader:'js'}));
  }}]});
  modules.push(await import(pathToFileURL(outfile).href));
 }
 const controller=new AbortController();
 await modules[0].fetchAgenda('company-a','2026-09','load',controller.signal);
 await modules[1].fetchSummary('company-a','2026-09',controller.signal);
 const report=await modules[2].fetchReport('company-a','financial','2026-09',controller.signal);
 assert.deepEqual(calls.map(([resource,action,payload,signal])=>({resource,action,payload,signal})),[
  {resource:'agenda',action:'list',payload:{companyId:'company-a',month:'2026-09',kind:'load'},signal:controller.signal},
  {resource:'summary',action:'list',payload:{companyId:'company-a',month:'2026-09'},signal:controller.signal},
  {resource:'reports',action:'list',payload:{companyId:'company-a',kind:'financial',month:'2026-09'},signal:controller.signal},
 ]);
 assert.equal(report.totals.netAmount,'123456789.123456','RPC decimal text must not be recomputed');
 const failure=new Error('permission denied');globalThis.__overviewRpc=async()=>{throw failure;};
 await assert.rejects(modules[0].fetchAgenda('a','2026-09','',controller.signal),error=>error===failure);
 const key=(user,resource,company)=>[...billingKeys.resource(user,resource),{companyId:company,month:'2026-09'}];
 for(const resource of ['agenda','summary','reports'])for(const user of ['a','b'])for(const company of ['one','two'])client.setQueryData(key(user,resource,company),{persisted:true});
 for(const resource of mutationResources('contracts'))await client.invalidateQueries({queryKey:billingKeys.resource('a',resource),refetchType:'none'});
 for(const resource of ['agenda','summary','reports'])for(const company of ['one','two']){
  assert.equal(client.getQueryState(key('a',resource,company)).isInvalidated,true,'Local mutations invalidate derived views');
  assert.equal(client.getQueryState(key('b',resource,company)).isInvalidated,false,'Other account is isolated');
 }
 for(const table of ['billing_contracts','billing_contract_loads','billing_contract_payments','billing_clients','billing_companies'])for(const resource of ['agenda','summary','reports'])assert.ok(realtimeResources[table].includes(resource),`${table} refreshes ${resource}`);
 for(const resource of ['summary','reports'])assert.ok(realtimeResources.billing_atr_records.includes(resource));
 for(const table of ['billing_planning_periods','billing_planning_allocations','billing_planning_allocation_practices','billing_planning_history'])assert.ok(realtimeResources[table].includes('planning'));
 const shell=await readFile('shared/components/AppShell.tsx','utf8');
 const planning=await readFile('modules/planejamento/components/PlanejamentoPage.tsx','utf8');
 assert.doesNotMatch(shell,/AcompanhamentoPage|planejamentoSections/);
 assert.match(shell,/PlanejamentoPage/);
 assert.match(planning,/PlanningDistribution/);
 assert.match(planning,/PlanningHistoryList/);
 assert.match(shell,/RelatoriosPage/);
 // Every PDF row must survive pagination, including very long final rows.
 const pdfPath=join(directory,'pdf.mjs');
 await build({entryPoints:['modules/relatorios/reporting/reportPdf.ts'],outfile:pdfPath,bundle:true,platform:'node',format:'esm'});
 const {createReportPdf}=await import(pathToFileURL(pdfPath).href);
 const rows=Array.from({length:85},(_,index)=>({id:String(index),clientName:'Cliente '+index,contractNumber:'REPORT-'+index,grossAmount:'10.25',discountAmount:'1.25',netAmount:'9',receivedAmount:'2',pendingAmount:'7'}));
 rows[84].clientName='FINAL-ROW '+ 'Muito longo '.repeat(100);
 const totals={grossAmount:'871.25',discountAmount:'106.25',netAmount:'765',receivedAmount:'170',pendingAmount:'595',creditAmount:'0'};
 const {doc}=await createReportPdf({data:{kind:'financial',scope:'company',rows,totals,total:85},month:'2026-09',companyId:'a'},
  {company:null,header:{variant:'compact',logoAlignment:'left',showCnpj:true,showContact:true},watermark:{imageUrl:null,opacity:15,size:60},issuer:{id:'a',name:'Teste',email:''},issuedAt:new Date('2026-09-16T12:00:00Z')});
 assert.ok(doc.getNumberOfPages()>1);
 const pdf=doc.internal.pages.slice(1).flat().join('\n');assert.ok(pdf.includes('REPORT-84'));assert.ok(pdf.includes('FINAL-ROW'));assert.ok(pdf.includes('765,00'));
 console.log('PASS: RPC contracts, decimal transport, cancellation, error propagation, mutation/Realtime invalidation, account isolation, removed navigation and multipage PDF.');
} finally {
 client.clear();delete globalThis.__overviewRpc;
 if(!resolve(directory).startsWith(join(resolve(tmpdir()),'agenda-reports-')))throw Error('Unsafe test cleanup path');
 await rm(directory,{recursive:true,force:true});
}
