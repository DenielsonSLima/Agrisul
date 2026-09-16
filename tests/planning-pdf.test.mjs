import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require=createRequire(import.meta.url),{build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const directory=await mkdtemp(join(tmpdir(),'planning-pdf-'));
const allText=doc=>doc.internal.pages.slice(1).flat().join('\n');
try{
 const outfile=join(directory,'planning-pdf.mjs');
 await build({entryPoints:['modules/planejamento/reporting/planningPdf.ts'],outfile,bundle:true,platform:'node',format:'esm'});
 const {createPlanningPdf}=await import(pathToFileURL(outfile).href);
 const diaryOutfile=join(directory,'planning-diary-pdf.mjs');
 await build({entryPoints:['modules/planejamento/reporting/planningDiaryPdf.ts'],outfile:diaryOutfile,bundle:true,platform:'node',format:'esm'});
 const {createPlanningDiaryPdf}=await import(pathToFileURL(diaryOutfile).href);
 const period={id:'period',name:'Safra Especial 2026/2027',startDate:'2026-05-01',endDate:'2027-04-30',targetAreaHa:'1000',allocatedAreaHa:'900',remainingAreaHa:'100',allocationCount:60,plantedExecutedAreaHa:'700',plantingRemainingAreaHa:'200',lostAreaHa:'5',harvestTargetTons:'80000',harvestActualTons:'42000',harvestRemainingTons:'38000',harvestPercent:'52.5',harvestScopeCount:60,cultureId:'culture',cultureName:'Cana-de-açúcar',cultureSubtypeId:'subtype',cultureSubtypeName:'Cana planta',notes:'Plano completo da safra.',status:'active',revision:1,createdAt:'2026-01-01',updatedAt:'2026-01-01'};
 const farms=Array.from({length:30},(_,farmIndex)=>({id:`farm-${farmIndex}`,name:`FAZENDA_SENTINEL_${farmIndex}`,city:'Cidade',state:'SP',totalAreaHa:'100',plotAreaHa:'80',unmappedAreaHa:'20',plantedAreaHa:'40',plannedAreaHa:'30',remainingPlannedAreaHa:'10',plots:Array.from({length:2},(_,plotIndex)=>({id:`plot-${farmIndex}-${plotIndex}`,name:`Talhão ${plotIndex+1}`,areaHa:'40',plantedAreaHa:'20',otherPlannedAreaHa:'0',maxAllocationAreaHa:'20',harvestSelected:true,allocation:{id:`allocation-${farmIndex}-${plotIndex}`,periodId:'period',farmId:`farm-${farmIndex}`,farmName:`Fazenda ${farmIndex}`,plotId:`plot-${farmIndex}-${plotIndex}`,plotName:`Talhão ${plotIndex+1}`,areaHa:'15',executedAreaHa:'10',remainingExecutionAreaHa:'5',notes:'',status:'active',revision:1,practiceIds:['practice'],practiceNames:['Adubação'],createdAt:'2026-01-01',updatedAt:'2026-01-01'}}))}));
 const dailySummary=Array.from({length:24},(_,index)=>({date:`2026-${String(Math.floor(index/2)+1).padStart(2,'0')}-${String(index%2+1).padStart(2,'0')}`,plantedAreaHa:'10',managedAreaHa:'5',lostAreaHa:'0',harvestedTons:'20',loadCount:1,eventCount:3,accumulatedPlantedAreaHa:String((index+1)*10),accumulatedManagedAreaHa:String((index+1)*5),accumulatedLostAreaHa:'0',accumulatedHarvestedTons:String((index+1)*20),accumulatedLoadCount:index+1}));
 const fieldLogs=Array.from({length:30},(_,index)=>({id:`log-${index}`,periodId:'period',allocationId:null,farmId:'farm-0',farmName:'Fazenda 0',plotId:'plot-0-0',plotName:'Talhão 1',occurredOn:'2026-06-01',kind:'management',practiceId:'practice',practiceName:'Adubação de cobertura',areaHa:'5',notes:`LOG_SENTINEL_${index}`,details:{operatorName:'Ernande',responsibleName:'Encarregado',shift:'Dia',startedAt:'07:00',endedAt:'15:30',applicationNumber:'1749',serviceOrderNumber:'157',applicationServiceOrderNumber:'1711',laborDescription:'Equipe própria',equipmentCode:'318073',equipmentDescription:'BH 185i',implementCode:'508506',implementDescription:'',hourMeterStart:'8353.2',hourMeterEnd:'8358.7',areaScope:'partial',materials:[{code:'35257',description:`MATERIAL_SENTINEL_${index}`,quantity:'2600',unit:'kg',recommendedDose:'500 kg/ha'}]},createdBy:'user',createdByName:'Usuário',createdAt:'2026-06-01T12:00:00Z',voidedAt:null,voidedBy:null,voidReason:''}));
 const history=Array.from({length:30},(_,index)=>({id:`history-${index}`,periodId:'period',allocationId:null,entityType:'field-log',action:'logged',reason:`HISTORY_SENTINEL_${index}`,snapshot:{},createdBy:'user',createdByName:'Usuário',createdAt:'2026-06-01T12:00:00Z'}));
 const harvestLoads=[{id:'load-1',contractId:'contract-1',contractNumber:'15092026',farmId:'farm-0',farmName:'Fazenda 0',plotId:'plot-0-0',plotName:'Talhão 1',loadedAt:'2026-09-15',volumeTons:'40',document:'DOC-1',notes:'LOAD_SENTINEL'}];
 const harvestComparison=[{farmId:'farm-0',farmName:'FAZENDA_SENTINEL_0',targetAreaHa:'30',plantedAreaHa:'20',remainingAreaHa:'10',plantingPercent:'66.666667',targetTons:'80000',harvestedTons:'42000',remainingTons:'38000',harvestPercent:'52.5',harvestLoadCount:20,plots:[{plotId:'plot-0-0',plotName:'Talhão 1',targetAreaHa:'15',plantedAreaHa:'10',remainingAreaHa:'5',plantingPercent:'66.666667',targetTons:'80000',harvestedTons:'42000',remainingTons:'38000',harvestPercent:'52.5',harvestLoadCount:20}]}];
 const diaryPeriodSummary={dateFrom:'2026-06-01',dateTo:'2026-09-30',plantedAreaHa:'240',managedAreaHa:'120',lostAreaHa:'0',harvestedTons:'480',fieldLogCount:30,loadCount:1,eventCount:31};
 const data={periods:[period],farms,practices:[],history,fieldLogs,harvestLoads,dailySummary,monthlySummary:[],diaryPeriodSummary,harvestPlotIds:[],harvestComparison,visiblePeriodIds:['period'],visibleFarmIds:farms.map(item=>item.id),visibleFieldLogIds:fieldLogs.map(item=>item.id),visibleHarvestLoadIds:harvestLoads.map(item=>item.id),visibleHistoryIds:history.map(item=>item.id),pagination:{page:1,pageSize:10,total:31,totalPages:4,hasPrevious:false,hasNext:true}};
 const snapshot={data,period,companyId:'company',kind:'planning'},before=JSON.stringify(snapshot);
 const brand={company:null,header:{variant:'detailed',logoAlignment:'right',showCnpj:true,showContact:true},watermark:{imageUrl:null,opacity:15,size:60},issuer:{id:'user',name:'Teste PDF',email:''},issuedAt:new Date('2026-09-16T12:00:00Z')};
 const {doc,fileName}=await createPlanningPdf(snapshot,brand),text=allText(doc);
 assert.equal(JSON.stringify(snapshot),before,'The PDF must not mutate the RPC snapshot');
 assert.ok(Math.abs(doc.internal.pageSize.getWidth()-297)<.1&&Math.abs(doc.internal.pageSize.getHeight()-210)<.1,'The report must be A4 landscape');
 assert.ok(doc.getNumberOfPages()>5,'Large planning reports must paginate naturally');
 assert.equal(fileName,'planejamento-safra-especial-2026-2027.pdf');
 for(const label of ['Fazendas, talhões e metas','Metas de colheita por fazenda e talhão','Resumo diário','Diário de campo e carregamentos','FAZENDA_SENTINEL_29','LOG_SENTINEL_29'])assert.ok(text.includes(label),`Missing complete report content: ${label}`);
 for(const label of ['Histórico da safra','HISTORY_SENTINEL_29'])assert.ok(!text.includes(label),`Planning history must not be exported: ${label}`);
 const diarySnapshot={...snapshot,kind:'diary'},diaryBefore=JSON.stringify(diarySnapshot);
 const {doc:diaryDoc,fileName:diaryFileName}=await createPlanningDiaryPdf(diarySnapshot,brand),diaryText=allText(diaryDoc);
 assert.equal(JSON.stringify(diarySnapshot),diaryBefore,'The diary PDF must not mutate the RPC snapshot');
 assert.equal(diaryFileName,'diario-de-campo-safra-especial-2026-2027.pdf');
 for(const label of ['Diário de campo','Período filtrado: 01/06/2026 a 30/09/2026','Posição por dia','realizado / acumulado','Posição por mês','Apontamentos de campo','Máquinas, equipes e ordens','Materiais e insumos aplicados','Carregamentos da colheita','LOG_SENTINEL_29','MATERIAL_SENTINEL_29','LOAD_SENTINEL'])assert.ok(diaryText.includes(label),`Missing diary report content: ${label}`);
 for(const label of ['Fazendas, talhões e metas','Metas de colheita por fazenda e talhão','Histórico da safra','HISTORY_SENTINEL_29'])assert.ok(!diaryText.includes(label),`Diary report must not contain planning summary content: ${label}`);
 console.log('PASS: planejamento em A4 paisagem, snapshot imutável, seções completas e paginação natural.');
}finally{
 if(!resolve(directory).startsWith(join(resolve(tmpdir()),'planning-pdf-')))throw Error('Unsafe test cleanup path');
 await rm(directory,{recursive:true,force:true});
}
