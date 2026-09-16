import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {realtimeResources} from '../shared/query/realtimeResources.ts';
import {mutationResources} from '../shared/query/derivedResources.ts';

const require=createRequire(import.meta.url);
const {build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));

test('planning frontend uses the single RPC contract and invalidates every projection',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'planning-rpc-'));const calls=[];
 globalThis.__planningRpc=async(...args)=>{calls.push(args);return args[1]==='list'?{periods:[],farms:[],practices:[],history:[]}:{saved:true};};
 try{
  const outfile=join(directory,'planning-api.mjs');
  await build({entryPoints:['modules/planejamento/services/planningApi.ts'],outfile,bundle:true,platform:'node',format:'esm',plugins:[{name:'rpc-fixture',setup(builder){builder.onResolve({filter:/shared\/supabase\/rpc$/},()=>({path:'rpc',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const rpcRequest=(...args)=>globalThis.__planningRpc(...args);',loader:'js'}));}}]});
  const api=await import(pathToFileURL(outfile).href);const controller=new AbortController();
  const fieldDetails={operatorName:'Ernande',responsibleName:'Encarregado',shift:'Dia',startedAt:'07:00',endedAt:'15:30',applicationNumber:'1749',serviceOrderNumber:'157',applicationServiceOrderNumber:'1711',laborDescription:'Equipe própria',equipmentCode:'318073',equipmentDescription:'BH 185i',implementCode:'508506',implementDescription:'',hourMeterStart:'8353.2',hourMeterEnd:'8358.7',areaScope:'partial',materials:[{code:'35257',description:'Adubo 14-00-18',quantity:'2600',unit:'kg',recommendedDose:'500 kg/ha'}]};
  await api.fetchPlanning({periodId:'period-a',search:'talhão a',page:2,pageSize:10,section:'areas',dateFrom:'',dateTo:''},controller.signal);
  await api.persistPlanning({action:'save-period',id:'period-a',expectedRevision:2,input:{name:'Inverno',startDate:'2026-05-01',endDate:'2026-08-31',targetAreaHa:'20',cultureId:'culture-a',cultureSubtypeId:'subtype-a',notes:'',status:'active',revisionReason:'Ajuste'}});
  await api.persistPlanning({action:'save-allocation',periodId:'period-a',plotId:'plot-a',input:{areaHa:'10',notes:''}});
  await api.persistPlanning({action:'remanejar',allocationId:'allocation-a',targetPlotId:'plot-b',areaHa:'5',expectedRevision:1,reason:'Troca de talhão'});
  await api.persistPlanning({action:'set-practices',allocationId:'allocation-a',practiceIds:['practice-a'],expectedRevision:2});
  await api.persistPlanning({action:'set-planted',plotId:'plot-a',plantedAreaHa:'20',reason:'Posição inicial'});
  await api.persistPlanning({action:'save-harvest-goal',periodId:'period-a',targetTons:'1000',targets:[{plotId:'plot-a',targetTons:'1000'}],expectedRevision:3,reason:'Meta anual'});
  await api.persistPlanning({action:'save-field-log',periodId:'period-a',plotId:'plot-a',kind:'management',practiceId:'practice-a',occurredOn:'2026-05-10',areaHa:'10',notes:'Adubação',requestId:'request-a',details:fieldDetails});
  await api.persistPlanning({action:'void-field-log',id:'log-a',reason:'Lançamento incorreto'});
  assert.deepEqual(calls.map(([resource,action,payload,signal])=>({resource,action,payload,signal})),[
   {resource:'planning',action:'list',payload:{periodId:'period-a',search:'talhão a',page:2,pageSize:10,section:'areas',dateFrom:'',dateTo:''},signal:controller.signal},
   {resource:'planning',action:'save-period',payload:{name:'Inverno',startDate:'2026-05-01',endDate:'2026-08-31',targetAreaHa:'20',cultureId:'culture-a',cultureSubtypeId:'subtype-a',notes:'',status:'active',revisionReason:'Ajuste',id:'period-a',expectedRevision:2},signal:undefined},
   {resource:'planning',action:'save-allocation',payload:{areaHa:'10',notes:'',id:undefined,periodId:'period-a',plotId:'plot-a',expectedRevision:undefined},signal:undefined},
   {resource:'planning',action:'remanejar',payload:{allocationId:'allocation-a',targetPlotId:'plot-b',areaHa:'5',expectedRevision:1,reason:'Troca de talhão'},signal:undefined},
   {resource:'planning',action:'set-practices',payload:{allocationId:'allocation-a',practiceIds:['practice-a'],expectedRevision:2},signal:undefined},
   {resource:'planning',action:'set-planted',payload:{plotId:'plot-a',plantedAreaHa:'20',reason:'Posição inicial'},signal:undefined},
   {resource:'planning',action:'save-harvest-goal',payload:{periodId:'period-a',targetTons:'1000',targets:[{plotId:'plot-a',targetTons:'1000'}],expectedRevision:3,reason:'Meta anual'},signal:undefined},
   {resource:'planning',action:'save-field-log',payload:{periodId:'period-a',plotId:'plot-a',kind:'management',practiceId:'practice-a',occurredOn:'2026-05-10',areaHa:'10',notes:'Adubação',requestId:'request-a',details:fieldDetails},signal:undefined},
   {resource:'planning',action:'void-field-log',payload:{id:'log-a',reason:'Lançamento incorreto'},signal:undefined},
  ]);
  for(const table of ['billing_planning_periods','billing_planning_allocations','billing_planning_allocation_practices','billing_planning_history','billing_planning_harvest_plots','billing_planning_harvest_targets','billing_planning_field_logs','billing_contract_loads'])assert.ok(realtimeResources[table].includes('planning'));
  assert.ok(mutationResources('plots').includes('planning'));assert.ok(mutationResources('cultural-practices').includes('planning'));assert.ok(mutationResources('contracts').includes('planning'));
  const page=await readFile('modules/planejamento/components/PlanejamentoPage.tsx','utf8');
  const bulletinMigration=await readFile('supabase/migrations/20260916175817_planning_field_log_details.sql','utf8');
  const diaryPeriodMigration=await readFile('supabase/migrations/20260916182052_planning_diary_period_summary.sql','utf8');
  const distribution=await readFile('modules/planejamento/components/PlanningDistribution.tsx','utf8');
  const fieldLogForm=await readFile('modules/planejamento/forms/PlanningSeasonForms.tsx','utf8');
  const harvestDistribution=await readFile('modules/planejamento/components/PlanningHarvestDistribution.tsx','utf8');
  const exportDialog=await readFile('modules/planejamento/components/PlanningExportDialog.tsx','utf8');
  const overview=await readFile('modules/planejamento/components/PlanningOverview.tsx','utf8');
  assert.match(page,/Voltar para safras/);assert.doesNotMatch(page,/Mudar de safra/);assert.match(page,/Exportar/);assert.match(page,/PlanningSearchBar/);assert.match(page,/PlanningPeriodFilter/);assert.match(page,/PlanningPaginationNav/);assert.match(page,/Diário de campo/);assert.match(page,/Histórico/);
  assert.match(page,/distribuicao-colheita/);assert.doesNotMatch(page,/HarvestGoalForm|harvestOpen/);
  assert.match(page,/tab==='diario'\?'diary':'planning'/);assert.match(exportDialog,/createPlanningDiaryPdf/);assert.match(exportDialog,/somente os movimentos do Diário de campo/);
  assert.match(bulletinMigration,/planning_v8_dispatch/);assert.match(bulletinMigration,/planning_v8_normalize_field_log_details/);assert.match(bulletinMigration,/hourMeterEnd/);assert.match(bulletinMigration,/materials/);
  assert.match(diaryPeriodMigration,/planning_v9_dispatch/);assert.match(diaryPeriodMigration,/dateFrom/);assert.match(diaryPeriodMigration,/accumulatedManagedAreaHa/);assert.match(diaryPeriodMigration,/voided_at IS NULL/);
  assert.match(distribution,/useConfirmation/);assert.match(distribution,/remanejar/);assert.match(distribution,/set-planted/);
  for(const label of ['Dados do boletim recebido do campo','Operador','Horímetro inicial','Materiais e insumos','Dose recomendada'])assert.match(fieldLogForm,new RegExp(label));
  assert.match(harvestDistribution,/Voltar para metas/);assert.match(harvestDistribution,/PlanningSearchBar/);assert.match(harvestDistribution,/<details/);assert.match(harvestDistribution,/Área distribuída/);assert.match(harvestDistribution,/Colhido/);
  assert.match(overview,/Metas e colheita por fazenda e talhão/);assert.match(overview,/Distribuir meta/);assert.match(overview,/Meta de colheita/);assert.match(overview,/harvestComparison/);
 }finally{delete globalThis.__planningRpc;if(!resolve(directory).startsWith(join(resolve(tmpdir()),'planning-rpc-')))throw Error('Unsafe test cleanup path');await rm(directory,{recursive:true,force:true});}
});
