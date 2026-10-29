import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {realtimeResources} from '../shared/query/realtimeResources.ts';
const require=createRequire(import.meta.url),{build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const directory=await mkdtemp(join(tmpdir(),'summary-dashboard-'));
try{
 const calls=[];globalThis.__summaryRpc=async(...args)=>{calls.push(args);return {range:{from:'2025-09-18',to:'2026-09-17'}};};
 const servicePath=join(directory,'service.mjs');
 await build({entryPoints:['modules/resumo/services/summaryService.ts'],outfile:servicePath,bundle:true,platform:'node',format:'esm',plugins:[{name:'rpc-fixture',setup(builder){builder.onResolve({filter:/shared\/supabase\/rpc$/},()=>({path:'rpc',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const rpcRequest=(...args)=>globalThis.__summaryRpc(...args);',loader:'js'}));}}]});
 const {fetchExecutiveSummary,normalizeSummarySelection}=await import(pathToFileURL(servicePath).href),controller=new AbortController();
 await fetchExecutiveSummary('company-a','2025-09-18','2026-09-17',controller.signal);
 assert.deepEqual(calls,[['summary','dashboard',{companyId:'company-a',from:'2025-09-18',to:'2026-09-17'},controller.signal]]);
 globalThis.__summaryRpc=async(...args)=>{calls.push(args);return {filters:{companyId:'company-a',contractId:'contract-a',status:'Ativo'}};};
 await fetchExecutiveSummary('company-a','2025-09-18','2026-09-17',controller.signal,{contractId:'contract-a',status:'Ativo'});
 assert.deepEqual(calls[1],['summary','dashboard',{companyId:'company-a',from:'2025-09-18',to:'2026-09-17',contractId:'contract-a',status:'Ativo'},controller.signal]);
 globalThis.__summaryRpc=async()=>({filters:{companyId:'company-other',contractId:'contract-a',status:'Ativo'}});
 await assert.rejects(fetchExecutiveSummary('company-a','2025-09-18','2026-09-17',controller.signal,{contractId:'contract-a',status:'Ativo'}),/Não foi possível aplicar/);
 globalThis.__summaryRpc=async()=>({});
 await assert.rejects(fetchExecutiveSummary('company-a','2025-09-18','2026-09-17',controller.signal,{contractId:'contract-a',status:''}),/Não foi possível aplicar/);
 const combinedSelection={contractId:'contract-a',status:'Ativo',partnerId:'partner-a',farmId:'farm-a',plotId:'plot-a'};
 globalThis.__summaryRpc=async(...args)=>{calls.push(args);return {filters:{companyId:'company-a',...combinedSelection}};};
 await fetchExecutiveSummary('company-a','2025-09-18','2026-09-17',controller.signal,combinedSelection);
 assert.deepEqual(calls.at(-1),['summary','dashboard',{companyId:'company-a',from:'2025-09-18',to:'2026-09-17',...combinedSelection},controller.signal]);
 for(const field of ['partnerId','farmId','plotId']){
  const selection={contractId:'',status:'',...(field==='plotId'?{farmId:'farm-a'}:{}),[field]:combinedSelection[field]};
  globalThis.__summaryRpc=async(...args)=>{calls.push(args);return {filters:{companyId:'company-a',...selection}};};
  await fetchExecutiveSummary('company-a','2025-09-18','2026-09-17',controller.signal,selection);
  assert.deepEqual(calls.at(-1)[2],{companyId:'company-a',from:'2025-09-18',to:'2026-09-17',...(field==='plotId'?{farmId:'farm-a'}:{}),[field]:selection[field]});
  const missingField={companyId:'company-a',...selection};delete missingField[field];
  for(const filters of [undefined,missingField,{companyId:'company-a',...selection,[field]:'different-id'},{companyId:'company-other',...selection}]){
   globalThis.__summaryRpc=async()=>({filters});
   await assert.rejects(fetchExecutiveSummary('company-a','2025-09-18','2026-09-17',controller.signal,selection),/Não foi possível aplicar/,`${field} must be echoed for the correct company`);
  }
 }
 globalThis.__summaryRpc=async(...args)=>{calls.push(args);return {filters:{companyId:'company-a',contractId:'contract-a',status:'',partnerId:'',farmId:'farm-a',plotId:''}};};
 await fetchExecutiveSummary('company-a','2025-09-18','2026-09-17',controller.signal,{contractId:'contract-a',status:'',farmId:'farm-a',plotId:''});
 assert.deepEqual(calls.at(-1)[2],{companyId:'company-a',from:'2025-09-18',to:'2026-09-17',contractId:'contract-a',farmId:'farm-a'});
 globalThis.__summaryRpc=async()=>({filters:{companyId:'company-a',contractId:'',status:'',partnerId:'partner-a',farmId:'farm-a',plotId:'plot-other'}});
 await assert.rejects(fetchExecutiveSummary('company-a','2025-09-18','2026-09-17',controller.signal,{contractId:'',status:'',partnerId:'partner-a',farmId:'farm-a',plotId:''}),/Não foi possível aplicar/,'A farm-only selection must not silently become a plot selection');
 const multiSelection={contractId:'',status:'Ativo',partnerIds:['partner-b','partner-a','partner-a'],contractIds:['contract-b','contract-a'],farmIds:['farm-b','farm-a','farm-b'],plotIds:['plot-z','plot-a','plot-z']};
 const multiBefore=structuredClone(multiSelection),multiEcho={companyId:'company-a',contractId:'',status:'Ativo',partnerId:'',farmId:'',plotId:'',partnerIds:['partner-a','partner-b'],contractIds:['contract-a','contract-b'],farmIds:['farm-a','farm-b'],plotIds:['plot-a','plot-z']};
 globalThis.__summaryRpc=async(...args)=>{calls.push(args);return {filters:multiEcho};};
 await fetchExecutiveSummary('company-a','2025-09-18','2026-09-17',controller.signal,multiSelection);
 assert.deepEqual(calls.at(-1)[2],{companyId:'company-a',from:'2025-09-18',to:'2026-09-17',status:'Ativo',partnerIds:multiEcho.partnerIds,contractIds:multiEcho.contractIds,farmIds:multiEcho.farmIds,plotIds:multiEcho.plotIds});
 assert.deepEqual(multiSelection,multiBefore,'Canonicalizing selections must not mutate the applied state');
 assert.deepEqual(normalizeSummarySelection({...multiSelection,partnerIds:['partner-a','partner-b']}),normalizeSummarySelection(multiSelection),'Equivalent multiselections have the same query parameters');
 globalThis.__summaryRpc=async()=>({filters:{...multiEcho,partnerIds:['partner-b','partner-a','partner-a'],plotIds:['plot-z','plot-a']}});
 await fetchExecutiveSummary('company-a','2025-09-18','2026-09-17',controller.signal,multiSelection);
 for(const field of ['partnerIds','contractIds','farmIds','plotIds']){
  for(const echo of [undefined,[],['different-id'],'wrong-type']){
   globalThis.__summaryRpc=async()=>({filters:{...multiEcho,[field]:echo}});
   await assert.rejects(fetchExecutiveSummary('company-a','2025-09-18','2026-09-17',controller.signal,multiSelection),/Não foi possível aplicar/,`${field} must confirm every selected ID`);
  }
 }
 globalThis.__summaryRpc=async()=>({filters:{...multiEcho,companyId:'company-other'}});
 await assert.rejects(fetchExecutiveSummary('company-a','2025-09-18','2026-09-17',controller.signal,multiSelection),/Não foi possível aplicar/);
 globalThis.__summaryRpc=async(...args)=>{calls.push(args);return {};};
 await fetchExecutiveSummary('company-a','2025-09-18','2026-09-17',controller.signal,{contractId:'',status:'',partnerIds:[],contractIds:[],farmIds:[],plotIds:[]});
 assert.deepEqual(calls.at(-1)[2],{companyId:'company-a',from:'2025-09-18',to:'2026-09-17'},'Empty arrays restore the unfiltered RPC payload');
 const mixedSelection={contractId:'contract-a',status:'',contractIds:['contract-b','contract-b']};
 globalThis.__summaryRpc=async(...args)=>{calls.push(args);return {filters:{companyId:'company-a',contractId:'contract-a',status:'',contractIds:['contract-b','contract-a']}};};
 await fetchExecutiveSummary('company-a','2025-09-18','2026-09-17',controller.signal,mixedSelection);
 assert.deepEqual(calls.at(-1)[2],{companyId:'company-a',from:'2025-09-18',to:'2026-09-17',contractId:'contract-a',contractIds:['contract-b']},'Legacy scalar and multiselection are sent without dropping either');
 globalThis.__summaryRpc=async()=>({filters:{companyId:'company-a',contractId:'contract-a',status:'',contractIds:['contract-b']}});
 await assert.rejects(fetchExecutiveSummary('company-a','2025-09-18','2026-09-17',controller.signal,mixedSelection),/Não foi possível aplicar/,'Mixed input echo must include the legacy scalar in the effective set');
 const legacyPlot={contractId:'',status:'',farmId:'farm-a',plotId:'plot-a',plotIds:['plot-b']};
 globalThis.__summaryRpc=async()=>({filters:{companyId:'company-a',...legacyPlot,farmIds:[],plotIds:['plot-b','plot-a']}});
 await fetchExecutiveSummary('company-a','2025-09-18','2026-09-17',controller.signal,legacyPlot);
 globalThis.__summaryRpc=async()=>({filters:{companyId:'company-a',...legacyPlot,farmIds:['farm-a'],plotIds:['plot-b','plot-a']}});
 await assert.rejects(fetchExecutiveSummary('company-a','2025-09-18','2026-09-17',controller.signal,legacyPlot),/Não foi possível aplicar/,'A legacy plot selection must not broaden into its entire farm');
 const hookPath=join(directory,'hook.mjs');
 await build({entryPoints:['modules/resumo/hooks/useSummary.ts'],outfile:hookPath,bundle:true,platform:'node',format:'esm',plugins:[{name:'query-fixture',setup(builder){builder.onResolve({filter:/shared\/query\/useBillingQuery$/},()=>({path:'query',namespace:'fixture'}));builder.onResolve({filter:/shared\/supabase\/rpc$/},()=>({path:'rpc',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='query'?'export const useBillingQuery=(...args)=>globalThis.__summaryQuery(...args);':'export const rpcRequest=(...args)=>globalThis.__summaryRpc(...args);',loader:'js'}));}}]});
 const {useExecutiveSummary}=await import(pathToFileURL(hookPath).href);globalThis.__summaryQuery=(resource,params,fetcher)=>({resource,params,fetcher});
 const firstQuery=useExecutiveSummary('2025-09-18','2026-09-17',multiSelection),sameQuery=useExecutiveSummary('2025-09-18','2026-09-17',{...multiSelection,partnerIds:['partner-a','partner-b'],farmIds:['farm-a','farm-b']});
 assert.deepEqual(firstQuery.params,sameQuery.params,'Selecting the same IDs in a different order reuses the cache');assert.ok(Object.values(firstQuery.params).every(value=>typeof value==='string'),'Cache parameters stay serializable strings');
 const otherQuery=useExecutiveSummary('2025-09-18','2026-09-17',{...multiSelection,plotIds:['plot-other']});assert.notDeepEqual(otherQuery.params,firstQuery.params,'Different plots occupy independent cache entries');
 globalThis.__summaryRpc=async(...args)=>{calls.push(args);return {filters:multiEcho};};await firstQuery.fetcher('company-a',controller.signal);assert.deepEqual(calls.at(-1)[2].partnerIds,['partner-a','partner-b']);
 for(const table of ['billing_contracts','billing_contract_loads','billing_contract_payments','billing_contract_discounts','billing_farms','billing_farm_plots','billing_planning_periods','billing_planning_allocations','billing_planning_harvest_targets','billing_planning_field_logs'])assert.ok(realtimeResources[table].includes('summary'),`${table} must refresh the executive summary`);

 const months=Array.from({length:25},(_,index)=>{const date=new Date(2024,8+index,1),month=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;return {month,loadCount:index+1,loadedVolume:String((index+1)*10),billingPending:index===24,pendingLoadCount:index===24?1:0,grossAmount:index===24?'':String((index+1)*1000),discountAmount:String((index+1)*10),netAmount:index===24?'':String((index+1)*990),advanceAmount:'0',receiptAmount:String(index*100),receivedAmount:String(index*100),pendingAmount:index===24?'':String(index*890),creditAmount:'0'};});
 const contracts=Array.from({length:42},(_,index)=>({id:String(index),clientName:index===41?'Cliente final do painel':'Cliente '+index,contractNumber:'DASH-'+index,title:'Contrato '+index,status:'Ativo',loadCount:index+1,loadedVolume:String(index+1),billingPending:false,grossAmount:'1000',discountAmount:'10',netAmount:'990',receivedAmount:'100',pendingAmount:'890'}));
 const monthlyOperations=months.map((item,index)=>({month:item.month,loadCount:item.loadCount,loadedVolume:item.loadedVolume,averageAtr:index===24?'':'125',averageLoadVolume:'10',contractCount:1,farmCount:1,plotCount:1}));
 const contractPerformance=contracts.map((item,index)=>({id:item.id,clientName:item.clientName,contractNumber:item.contractNumber,title:item.title,status:item.status,contractedVolume:'100',periodLoadCount:item.loadCount,periodLoadedVolume:item.loadedVolume,averageAtr:'125',averageLoadVolume:'10',totalLoadedVolume:String(index+1),remainingVolume:String(99-index),deliveryPercent:String(index+1)}));
 const data={range:{from:'2024-09-01',to:'2026-09-30',dayCount:760,generatedAt:'2026-09-17T12:00:00Z'},totals:{contractCount:42,activeContractCount:42,loadCount:325,loadedVolume:'3250',farmCount:1,plotCount:1,billingPending:true,pendingLoadCount:1,grossAmount:'',discountAmount:'3250',netAmount:'',advanceAmount:'0',receiptAmount:'30000',receivedAmount:'30000',pendingAmount:'',creditAmount:''},comparison:{from:'2022-08-03',to:'2024-08-31',loadCount:1,loadedVolume:'100',netAmount:'900',receivedAmount:'100',volumeChangePercent:'25',netChangePercent:'',receivedChangePercent:'10'},months,contractStatus:[{status:'Ativo',count:42}],contracts,farms:[{id:'farm',name:'Fazenda PDF',areaHa:'50',plotCount:1,loadCount:325,loadedVolume:'3250',billingPending:false,grossAmount:'1000',discountAmount:'10',netAmount:'990'}],agriculture:{scope:'workspace',registeredFarmCount:1,registeredPlotCount:1,farmAreaHa:'50',plotAreaHa:'25'},planning:{scope:'workspace',periodCount:1,activePeriodCount:1,periodName:'Safra PDF',progressAsOf:'2026-09-30',targetAreaHa:'20',allocatedAreaHa:'20',plantedAreaHa:'5',managedAreaHa:'4',lostAreaHa:'0',fieldLogCount:2,managementEventCount:1,harvestTargetTons:'100',harvestedTons:'10',plantingPercent:'25',harvestPercent:'10'},management:[{id:'practice',name:'Adubação de plantio',eventCount:1,areaHa:'4'}],operationalTotals:{loadCount:325,loadedVolume:'3250',averageAtr:'125',averageLoadVolume:'10',contractCount:42,farmCount:1,plotCount:1},monthlyOperations,farmPerformance:[{id:'farm',name:'Fazenda PDF',areaHa:'50',loadCount:325,loadedVolume:'3250',averageAtr:'125',averageLoadVolume:'10',tonsPerHa:'65',plotCount:1,contractCount:42}],plotPerformance:[{id:'plot',name:'Talhão PDF',farmId:'farm',farmName:'Fazenda PDF',areaHa:'25',loadCount:325,loadedVolume:'3250',averageAtr:'125',averageLoadVolume:'10',tonsPerHa:'130',contractCount:42}],contractPerformance,planningPerformance:{periodName:'Safra PDF',farms:[{id:'farm',name:'Fazenda PDF',plotCount:1,targetAreaHa:'20',plantedAreaHa:'5',plantingPercent:'25',targetTons:'100',harvestedTons:'10',remainingTons:'90',harvestPercent:'10',loadCount:1}],plots:[{id:'plot',name:'Talhão PDF',farmId:'farm',farmName:'Fazenda PDF',areaHa:'25',targetAreaHa:'20',plantedAreaHa:'5',plantingPercent:'25',targetTons:'100',harvestedTons:'10',remainingTons:'90',harvestPercent:'10',loadCount:1}]}};
 const snapshot={data,companyId:'company-a'},before=structuredClone(snapshot),pdfPath=join(directory,'pdf.mjs');
 await build({entryPoints:['modules/resumo/reporting/summaryPdf.ts'],outfile:pdfPath,bundle:true,platform:'node',format:'esm'});
 const {createSummaryPdf}=await import(pathToFileURL(pdfPath).href);
 const {doc,fileName}=await createSummaryPdf(snapshot,{company:null,header:{variant:'compact',logoAlignment:'left',showCnpj:true,showContact:true},watermark:{imageUrl:null,opacity:15,size:60},issuer:{id:'user',name:'Teste',email:''},issuedAt:new Date('2026-09-17T12:00:00Z')});
 assert.equal(fileName,'resumo-gerencial-2024-09-01-a-2026-09-30.pdf');assert.ok(doc.getNumberOfPages()>=7,'Long series and tables must paginate');
 const commands=doc.internal.pages.slice(1).flat().join('\n');assert.ok(commands.includes('DASH-41'),'Final contract must reach the PDF');assert.ok(commands.includes('Cliente final do painel'));assert.ok(commands.includes('Safra PDF'));assert.ok(commands.includes('Talhão PDF'));assert.ok(commands.includes('Meses com carregamentos'));assert.deepEqual(snapshot,before,'PDF generation must not mutate its snapshot');
 const source=await readFile('modules/resumo/components/ResumoPage.tsx','utf8'),operationsSource=await readFile('modules/resumo/components/SummaryOperational.tsx','utf8');assert.match(source,/defaultRange/);assert.doesNotMatch(source,/Exportar PDF completo/);assert.match(source,/Ocultar valores financeiros/);assert.match(source,/365 dias por padrão/);assert.match(operationsSource,/filter\(row=>row\.loadCount>0\|\|Number\(row\.loadedVolume\)>0\)/);
 const filtered=structuredClone(snapshot);filtered.data.filters={companyId:'company-a',contractId:'contract-a',contractLabel:'TEST-A · Cliente filtro',status:'Ativo'};
 const filteredBefore=structuredClone(filtered),filteredPdf=await createSummaryPdf(filtered,{company:null,header:{variant:'compact',logoAlignment:'left',showCnpj:true,showContact:true},watermark:{imageUrl:null,opacity:15,size:60},issuer:{id:'user',name:'Teste',email:''},issuedAt:new Date('2026-09-17T12:00:00Z')});
 assert.equal(filteredPdf.fileName,'resumo-gerencial-2024-09-01-a-2026-09-30-filtrado.pdf');
 const filteredCommands=filteredPdf.doc.internal.pages.slice(1).flat().join('\n');assert.ok(filteredCommands.includes('Cliente filtro'));assert.ok(filteredCommands.includes('Status atual: Ativo'));assert.deepEqual(filtered,filteredBefore);
 const noTarget=structuredClone(snapshot);noTarget.data.planning.harvestTargetTons='0';
 for(const item of [...noTarget.data.planningPerformance.farms,...noTarget.data.planningPerformance.plots])item.targetTons='0';
 const noTargetPdf=await createSummaryPdf(noTarget,{company:null,header:{variant:'compact',logoAlignment:'left',showCnpj:false,showContact:false},watermark:{imageUrl:null,opacity:15,size:60},issuer:{id:'user',name:'Teste',email:''},issuedAt:new Date('2026-09-17T12:00:00Z')});
 assert.ok(noTargetPdf.doc.internal.pages.slice(1).flat().join('\n').includes('Sem meta definida'),'Zero denominator must not appear as a meaningful progress percentage');
 const filtersPath=join(directory,'filters.mjs');await build({entryPoints:['modules/resumo/filters.ts'],outfile:filtersPath,bundle:true,platform:'node',format:'esm'});
 const {monthRange,validRange,rangeDays}=await import(pathToFileURL(filtersPath).href);
 const applied={from:'2026-09-10',to:'2026-10-05',contractId:'contract-a',status:'Ativo'};
 assert.deepEqual(monthRange('2026-09',applied),{...applied,to:'2026-09-30'});assert.deepEqual(monthRange('2026-10',applied),{...applied,from:'2026-10-01'});
 assert.equal(monthRange('2026-11',applied),null);assert.equal(monthRange('2026-13',applied),null);assert.equal(rangeDays({from:'2026-09-01',to:'2026-09-01'}),1);
 assert.equal(validRange({from:'2026-10-01',to:'2026-09-01'}),false);assert.equal(validRange({from:'2020-01-01',to:'2026-01-01'}),false);assert.equal(validRange({from:'2026-09-01',to:'2026-09-30'}),true);assert.equal(validRange({from:'2026-02-30',to:'2026-03-02'}),false);
 console.log('PASS: executive summary RPC client, Realtime dependencies, 365-day UI and complete multipage immutable PDF.');
}finally{
 delete globalThis.__summaryRpc;
 delete globalThis.__summaryQuery;
 if(!resolve(directory).startsWith(join(resolve(tmpdir()),'summary-dashboard-')))throw Error('Unsafe test cleanup path');
 await rm(directory,{recursive:true,force:true});
}
