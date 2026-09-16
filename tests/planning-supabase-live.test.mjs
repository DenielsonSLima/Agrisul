// Explicit integration test: creates isolated Auth accounts and removes only
// those accounts (and their owner-scoped rows) when the test finishes.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync,unlinkSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {getMcpCredentials,PROJECT_REF} from '../scripts/supabase-mcp.mjs';

if(process.env.BILLING_RUN_LIVE_TESTS!=='1')throw new Error('Set BILLING_RUN_LIVE_TESTS=1 to run isolated remote tests.');
const {authorization}=getMcpCredentials();
const url=`https://${PROJECT_REF}.supabase.co`;
const keyResponse=await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`,{headers:{Authorization:authorization}});
assert.equal(keyResponse.status,200,'Management API must authorize the configured project');
const keys=await keyResponse.json();
const publicKey=keys.find(key=>key.type==='publishable')?.api_key;
const adminKey=keys.find(key=>key.type==='secret')?.api_key??keys.find(key=>key.name==='service_role')?.api_key;
assert.ok(publicKey&&adminKey,'Remote test credentials must be available');

const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(url,adminKey,options);
const users=[];
const record='.sites-runtime/supabase/planning-live-test-users.json';

async function account(){
 const suffix=randomUUID();
 const email=`billing-planning-${suffix}@example.com`;
 const password=`${randomUUID()}aA9!`;
 const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:'Planejamento temporário'}});
 assert.ifError(error);
 users.push(data.user.id);
 writeFileSync(record,JSON.stringify({projectRef:PROJECT_REF,userIds:users}));
 const client=createClient(url,publicKey,options);
 const session=await client.auth.signInWithPassword({email,password});
 assert.ifError(session.error);
 return {client,id:data.user.id};
}

async function rpc(client,resource,action,payload={}){
 const {data,error}=await client.rpc('billing_rpc',{p_resource:resource,p_action:action,p_payload:payload});
 if(error)throw Object.assign(new Error(error.message),{code:error.code});
 return data;
}

try{
 const owner=await account();
 const outsider=await account();
 const initialPlanning=await rpc(owner.client,'planning','list',{search:'',page:1,pageSize:10,section:'seasons',dateFrom:'',dateTo:''});
 assert.deepEqual(initialPlanning.periods,[],'The initial planning screen must accept empty date filters');

 const farm=(await rpc(owner.client,'farms','save',{name:'Fazenda planejamento temporária',areaHa:'100',city:'Itabaiana',state:'SE'})).farm;
 const plotA=(await rpc(owner.client,'plots','save',{farmId:farm.id,name:'Talhão A',areaHa:'60'})).data.plots.find(plot=>plot.name==='Talhão A');
 const plotB=(await rpc(owner.client,'plots','save',{farmId:farm.id,name:'Talhão B',areaHa:'40'})).data.plots.find(plot=>plot.name==='Talhão B');
 const details={tradeName:'',cnpj:'',street:'',number:'',complement:'',district:'',city:'',state:'',zipCode:'',phone:'',email:''};
 const company=(await rpc(owner.client,'companies','save',{...details,legalName:'Empresa planejamento temporária',isPrimary:true})).company;
 const client=(await rpc(owner.client,'clients','save',{...details,legalName:'Cliente planejamento temporário',cnpj:'11222333000181',status:'Ativo'})).client;
 await rpc(owner.client,'contract-types','save',{name:'Contrato planejamento temporário',stages:[]});
 const contractType=(await rpc(owner.client,'contract-types','list')).types[0];
 await rpc(owner.client,'atr','save',{year:2026,month:8,monthlyGrossValue:'1',monthlyNetValue:'1',accumulatedGrossValue:'1',accumulatedNetValue:'1'});
 const contract=(await rpc(owner.client,'contracts','save',{title:'Contrato da colheita temporário',contractNumber:'PLAN-LIVE',companyId:company.id,clientId:client.id,typeId:contractType.id,status:'Ativo',startDate:'2026-05-01',endDate:'2026-09-30',contractedVolume:'100',value:'',notes:'',atrPriceType:'gross',atrPeriodType:'monthly'})).contract;
 const cultureId=(await rpc(owner.client,'cultures','save',{kind:'culture',name:'Cultura temporária'})).id;
 const subtypeId=(await rpc(owner.client,'cultures','save',{kind:'subtype',cultureId,name:'Ciclo temporário'})).id;
 const practice=(await rpc(owner.client,'cultural-practices','save',{cultureId,cultureSubtypeId:subtypeId,category:'soil-preparation',name:'Adubação de plantio',description:''})).practice;

 await rpc(owner.client,'planning','set-planted',{plotId:plotA.id,plantedAreaHa:'20',reason:'Situação inicial do teste'});
 const period=(await rpc(owner.client,'planning','save-period',{name:'Plano maio a setembro',startDate:'2026-05-01',endDate:'2026-09-30',targetAreaHa:'20',cultureId,cultureSubtypeId:subtypeId,notes:'Período escolhido pelo usuário',status:'active'})).period;
 let allocationA=(await rpc(owner.client,'planning','save-allocation',{periodId:period.id,plotId:plotA.id,areaHa:'15',notes:''})).allocation;
 await rpc(owner.client,'planning','save-allocation',{periodId:period.id,plotId:plotB.id,areaHa:'5',notes:''});
 allocationA=(await rpc(owner.client,'planning','set-practices',{allocationId:allocationA.id,practiceIds:[practice.id],expectedRevision:allocationA.revision,reason:'Manejo definido no teste'})).allocation;

 let snapshot=await rpc(owner.client,'planning','list',{periodId:period.id});
 assert.equal(snapshot.periods[0].allocatedAreaHa,'20');
 assert.equal(snapshot.periods[0].remainingAreaHa,'0');
 assert.equal(snapshot.farms[0].totalAreaHa,'100');
 assert.equal(snapshot.farms[0].plantedAreaHa,'20');
 assert.equal(snapshot.farms[0].plannedAreaHa,'20');
 assert.deepEqual(snapshot.farms[0].plots.find(plot=>plot.id===plotA.id).allocation.practiceIds,[practice.id]);
 assert.ok(snapshot.history.length>=5,'Creation, planted area, allocations and management must be audited');
 let filtered=await rpc(owner.client,'planning','list',{search:'maio a setembro',page:1,pageSize:1,section:'seasons'});
 assert.equal(filtered.pagination.total,1,'Season search must be calculated by the RPC');
 assert.deepEqual(filtered.visiblePeriodIds,[period.id]);
 filtered=await rpc(owner.client,'planning','list',{periodId:period.id,search:'Talhão A',page:1,pageSize:10,section:'areas'});
 assert.equal(filtered.pagination.total,1,'Plot search must retain its parent farm');
 assert.deepEqual(filtered.visibleFarmIds,[farm.id]);

 const moved=await rpc(owner.client,'planning','remanejar',{allocationId:allocationA.id,targetPlotId:plotB.id,areaHa:'5',expectedRevision:allocationA.revision,reason:'Redistribuição operacional'});
 allocationA=moved.source;
 snapshot=await rpc(owner.client,'planning','list',{periodId:period.id});
 assert.equal(snapshot.farms[0].plannedAreaHa,'20','Remanagement must preserve the plan total');
 assert.deepEqual(snapshot.farms[0].plots.map(plot=>plot.allocation.areaHa),['10','10']);
 assert.equal(snapshot.history[0].action,'remanejado');

 await rpc(owner.client,'planning','save-field-log',{periodId:period.id,plotId:plotA.id,kind:'planting',practiceId:'',occurredOn:'2026-05-10',areaHa:'10',notes:'Plantio do talhão A',requestId:randomUUID()});
 await rpc(owner.client,'planning','save-field-log',{periodId:period.id,plotId:plotB.id,kind:'planting',practiceId:'',occurredOn:'2026-05-11',areaHa:'10',notes:'Plantio do talhão B',requestId:randomUUID()});
 const bulletinDetails={operatorName:'Operador teste',responsibleName:'Responsável teste',shift:'Dia',startedAt:'07:00',endedAt:'15:30',applicationNumber:'1749',serviceOrderNumber:'157',applicationServiceOrderNumber:'1711',laborDescription:'Equipe própria',equipmentCode:'318073',equipmentDescription:'BH 185i',implementCode:'508506',implementDescription:'',hourMeterStart:'8353.2',hourMeterEnd:'8358.7',areaScope:'partial',materials:[{code:'35257',description:'Adubo 14-00-18',quantity:'2600',unit:'kg',recommendedDose:'500 kg/ha'}]};
 const detailedLog=(await rpc(owner.client,'planning','save-field-log',{periodId:period.id,plotId:plotA.id,kind:'management',practiceId:practice.id,occurredOn:'2026-05-12',areaHa:'5',notes:'Adubação realizada',requestId:randomUUID(),details:bulletinDetails})).fieldLog;
 assert.equal(detailedLog.details.operatorName,'Operador teste');
 assert.equal(detailedLog.details.hourMeterEnd,'8358.7');
 assert.equal(detailedLog.details.materials[0].quantity,'2600');
 await assert.rejects(rpc(owner.client,'planning','save-field-log',{periodId:period.id,plotId:plotA.id,kind:'management',practiceId:practice.id,occurredOn:'2026-05-13',areaHa:'5',notes:'Horímetro inválido',requestId:randomUUID(),details:{...bulletinDetails,hourMeterStart:'900',hourMeterEnd:'800'}}),error=>error.code==='23514');
 snapshot=await rpc(owner.client,'planning','list',{periodId:period.id});
 assert.equal(snapshot.farms[0].plantedAreaHa,'40','Daily planting must carry the current area from 20 to 40');
 assert.equal(snapshot.periods.find(item=>item.id===period.id).plantedExecutedAreaHa,'20');
 assert.equal(snapshot.periods.find(item=>item.id===period.id).plantingRemainingAreaHa,'0');
 assert.equal(snapshot.dailySummary.length,3);
 filtered=await rpc(owner.client,'planning','list',{periodId:period.id,search:'',page:1,pageSize:10,section:'diario',dateFrom:'2026-05-12',dateTo:'2026-05-12'});
 assert.equal(filtered.pagination.total,1,'The diary date range must filter detail pagination');
 assert.equal(filtered.fieldLogs.length,1,'The diary export dataset must use the selected range');
 assert.equal(filtered.diaryPeriodSummary.managedAreaHa,'5');
 assert.equal(filtered.diaryPeriodSummary.plantedAreaHa,'0');
 assert.equal(filtered.dailySummary[0].accumulatedManagedAreaHa,'5');

 const nextPeriod=(await rpc(owner.client,'planning','save-period',{name:'Próxima safra',startDate:'2027-05-01',endDate:'2027-09-30',targetAreaHa:'1',cultureId,cultureSubtypeId:subtypeId,notes:'',status:'active'})).period;
 assert.equal((await rpc(owner.client,'planning','list',{periodId:nextPeriod.id})).farms[0].plantedAreaHa,'40','The next season must inherit current planted area automatically');

 await rpc(owner.client,'contracts','save-load',{companyId:company.id,contractId:contract.id,farmId:farm.id,plotId:plotA.id,loadedAt:'2026-09-10',volume:'12',atr:'1',document:'PLAN-LIVE-01',notes:''});
 snapshot=await rpc(owner.client,'planning','list',{periodId:period.id});
 assert.equal(snapshot.periods.find(item=>item.id===period.id).harvestActualTons,'12','An allocated plot load must count before a harvest target is configured');
 assert.equal(snapshot.periods.find(item=>item.id===period.id).harvestScopeCount,2,'Active planting allocations must form the automatic harvest scope');
 assert.deepEqual(new Set(snapshot.harvestPlotIds),new Set([plotA.id,plotB.id]));
 assert.equal(snapshot.harvestLoads.length,1);
 assert.equal(snapshot.harvestComparison.length,1,'The overview must group the season by farm');
 assert.equal(snapshot.harvestComparison[0].targetAreaHa,'20');
 assert.equal(snapshot.harvestComparison[0].plantedAreaHa,'20');
 assert.equal(snapshot.harvestComparison[0].harvestedTons,'12');
 assert.equal(snapshot.harvestComparison[0].harvestLoadCount,1);
 assert.equal(snapshot.harvestComparison[0].plots.length,2,'The farm comparison must expose both allocated plots');
 assert.equal(snapshot.harvestComparison[0].plots.find(item=>item.plotId===plotA.id).harvestedTons,'12');
 assert.equal(snapshot.harvestComparison[0].plots.find(item=>item.plotId===plotB.id).harvestedTons,'0');
 await assert.rejects(rpc(owner.client,'planning','save-harvest-goal',{periodId:period.id,targetTons:'100',targets:[{plotId:plotA.id,targetTons:'90'}],expectedRevision:period.revision,reason:'Distribuição incompleta'}),error=>error.code==='23514');
 await rpc(owner.client,'planning','save-harvest-goal',{periodId:period.id,targetTons:'100',targets:[{plotId:plotA.id,targetTons:'60'},{plotId:plotB.id,targetTons:'40'}],expectedRevision:period.revision,reason:'Meta de colheita do teste'});
 snapshot=await rpc(owner.client,'planning','list',{periodId:period.id});
 assert.equal(snapshot.periods.find(item=>item.id===period.id).harvestTargetTons,'100');
 assert.equal(snapshot.periods.find(item=>item.id===period.id).harvestActualTons,'12','Saving the target must preserve the automatic load total');
 assert.equal(snapshot.harvestComparison[0].targetTons,'100');
 assert.equal(snapshot.harvestComparison[0].remainingTons,'88');
 assert.equal(snapshot.harvestComparison[0].harvestPercent,'12');
 assert.equal(snapshot.harvestComparison[0].plots.find(item=>item.plotId===plotA.id).targetTons,'60');
 assert.equal(snapshot.harvestComparison[0].plots.find(item=>item.plotId===plotA.id).remainingTons,'48');
 assert.equal(snapshot.harvestComparison[0].plots.find(item=>item.plotId===plotA.id).harvestPercent,'20');
 assert.equal(snapshot.harvestComparison[0].plots.find(item=>item.plotId===plotB.id).targetTons,'40');
 filtered=await rpc(owner.client,'planning','list',{periodId:period.id,search:'PLAN-LIVE-01',page:1,pageSize:1,section:'diario'});
 assert.equal(filtered.pagination.total,1,'Diary search must include contract loads');
 assert.deepEqual(filtered.visibleFieldLogIds,[]);
 assert.deepEqual(filtered.visibleHarvestLoadIds,[snapshot.harvestLoads[0].id]);
 filtered=await rpc(owner.client,'planning','list',{periodId:period.id,search:'Manejo definido',page:1,pageSize:10,section:'historico'});
 assert.ok(filtered.pagination.total>=1,'History search must include reasons');
 assert.ok(filtered.visibleHistoryIds.length>=1);

 const overlap=(await rpc(owner.client,'planning','save-period',{name:'Plano sobreposto',startDate:'2026-07-01',endDate:'2026-08-31',targetAreaHa:'31',cultureId,cultureSubtypeId:subtypeId,notes:'',status:'active'})).period;
 await assert.rejects(rpc(owner.client,'planning','save-allocation',{periodId:overlap.id,plotId:plotA.id,areaHa:'31',notes:''}),error=>error.code==='23514');
 await assert.rejects(rpc(owner.client,'planning','set-practices',{allocationId:allocationA.id,practiceIds:[],expectedRevision:1,reason:'Revisão antiga'}),error=>error.code==='PT409');

 const loss=(await rpc(owner.client,'planning','save-field-log',{periodId:period.id,plotId:plotA.id,kind:'loss',practiceId:'',occurredOn:'2026-09-20',areaHa:'3',notes:'Falha de brotação',requestId:randomUUID()})).fieldLog;
 assert.equal((await rpc(owner.client,'planning','list',{periodId:nextPeriod.id})).farms[0].plantedAreaHa,'37','A loss must reduce current area for every later season');
 await rpc(owner.client,'planning','void-field-log',{id:loss.id,reason:'Perda informada incorretamente'});
 assert.equal((await rpc(owner.client,'planning','list',{periodId:nextPeriod.id})).farms[0].plantedAreaHa,'40','Voiding a loss must restore current area');
 snapshot=await rpc(owner.client,'planning','list',{periodId:period.id,search:'',page:1,pageSize:10,section:'diario'});
 assert.ok(!snapshot.dailySummary.some(item=>item.date==='2026-09-20'),'A date containing only a voided log must not appear in the operational summary');
 assert.equal(snapshot.diaryPeriodSummary.lostAreaHa,'0');

 const direct=await owner.client.from('billing_planning_periods').insert({owner_id:owner.id,name:'DML direto',start_date:'2026-01-01',end_date:'2026-01-31',target_area_ha:1,culture_id:cultureId,culture_subtype_id:subtypeId,created_by:owner.id});
 assert.equal(direct.error?.code,'42501');
 const directLog=await owner.client.from('billing_planning_field_logs').insert({owner_id:owner.id,period_id:period.id,farm_id:farm.id,plot_id:plotA.id,request_id:randomUUID(),occurred_on:'2026-05-01',kind:'loss',area_ha:1,created_by:owner.id});
 assert.equal(directLog.error?.code,'42501');
 const directHarvestTarget=await owner.client.from('billing_planning_harvest_targets').insert({owner_id:owner.id,period_id:period.id,farm_id:farm.id,plot_id:plotA.id,target_tons:100,created_by:owner.id});
 assert.equal(directHarvestTarget.error?.code,'42501');
 const outsiderSnapshot=await rpc(outsider.client,'planning','list');
 assert.deepEqual(outsiderSnapshot.periods,[]);
 assert.deepEqual(outsiderSnapshot.harvestComparison,[]);
 await assert.rejects(rpc(outsider.client,'planning','list',{periodId:period.id}),error=>error.code==='P0002');
 await assert.rejects(rpc(outsider.client,'planning','save-harvest-goal',{periodId:period.id,targetTons:'100',targets:[{plotId:plotA.id,targetTons:'100'}],expectedRevision:2,reason:'Tentativa cruzada'}),error=>error.code==='P0002');

 console.log('PASS: planejamento remoto, safra detalhada, diário, 20→40 ha, perda/restauração, colheita por carregamentos, capacidade, histórico, RLS e DML bloqueado.');
}finally{
 const failures=[];
 for(const id of users){
  const {error}=await admin.auth.admin.deleteUser(id);
  if(error)failures.push(id);
 }
 if(failures.length)throw new Error(`Cleanup failed for ${failures.length} planning test accounts; see ${record}`);
 if(users.length)unlinkSync(record);
 console.log(`Cleanup: ${users.length} planning test accounts removed.`);
}
