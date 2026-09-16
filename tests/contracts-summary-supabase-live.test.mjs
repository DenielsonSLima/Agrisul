import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {getMcpCredentials,PROJECT_REF} from '../scripts/supabase-mcp.mjs';
if(process.env.BILLING_RUN_LIVE_TESTS!=='1')throw Error('Set BILLING_RUN_LIVE_TESTS=1 for isolated live verification.');
assert.equal(PROJECT_REF,'rbuscpwntzpyqsuycqmv');
const {authorization}=getMcpCredentials();
const response=await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`,{headers:{Authorization:authorization}});
assert.equal(response.status,200);const keys=await response.json();
const publicKey=keys.find(k=>k.type==='publishable')?.api_key,adminKey=keys.find(k=>k.type==='secret')?.api_key??keys.find(k=>k.name==='service_role')?.api_key;
assert.ok(publicKey&&adminKey);
const url=`https://${PROJECT_REF}.supabase.co`,options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(url,adminKey,options),users=[],clients=[];
mkdirSync('.sites-runtime/contract-kpis',{recursive:true});const record=`.sites-runtime/contract-kpis/test-users-${randomUUID()}.json`;
async function account(){const email=`contract-kpis-${randomUUID()}@example.com`,password=`${randomUUID()}aA9!`;const result=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(result.error);users.push(result.data.user.id);writeFileSync(record,JSON.stringify({projectRef:PROJECT_REF,userIds:users}));const client=createClient(url,publicKey,options);clients.push(client);const login=await client.auth.signInWithPassword({email,password});assert.ifError(login.error);return {client,session:login.data.session};}
async function rpc(client,resource,action,payload={}){const {data,error}=await client.rpc('billing_rpc',{p_resource:resource,p_action:action,p_payload:payload});if(error)throw Error(error.message);return data;}
try{
 const a=await account(),b=await account();
 const details={tradeName:'',cnpj:'',street:'',number:'',complement:'',district:'',city:'',state:'',zipCode:'',phone:'',email:''};
 const company=(await rpc(a.client,'companies','save',{...details,legalName:'AGRISUL AGRÍCOLA LTDA',isPrimary:true})).company;
 const other=(await rpc(a.client,'companies','save',{...details,legalName:'Outra empresa de teste',isPrimary:false})).company;
 const client=(await rpc(a.client,'clients','save',{...details,legalName:'USINA SERRA VERDE LTDA',cnpj:'11222333000181'})).client;
 await rpc(a.client,'contract-types','save',{name:'Fornecimento de cana',stages:[]});const type=(await rpc(a.client,'contract-types','list')).types[0];
 const farm=(await rpc(a.client,'farms','save',{name:'Fazenda Santa Ana',areaHa:'10',city:'Japoatã',state:'SE'})).farm;
 const plot=(await rpc(a.client,'plots','save',{farmId:farm.id,name:'Talhão 01',areaHa:'10'})).data.plots[0];
 for(const month of [6,7,8])await rpc(a.client,'atr','save',{year:2026,month,monthlyGrossValue:'1',monthlyNetValue:'1',accumulatedGrossValue:'1',accumulatedNetValue:'1'});
 const input={title:'Fornecimento de cana',companyId:company.id,clientId:client.id,typeId:type.id,startDate:'2026-07-01',endDate:'',contractedVolume:'1000',atrPriceType:'gross',atrPeriodType:'monthly',value:'',notes:''};
 const ca=(await rpc(a.client,'contracts','save',{...input,contractNumber:'CTR-001/2026'})).contract;
 const cb=(await rpc(a.client,'contracts','save',{...input,contractNumber:'CTR-002/2026',startDate:'2026-08-01',atrPriceType:'net',atrPeriodType:'accumulated'})).contract;
 const finished=(await rpc(a.client,'contracts','save',{...input,contractNumber:'CTR-003/2026'})).contract;
 await rpc(a.client,'contracts','save',{...input,id:finished.id,contractNumber:'CTR-003/2026',status:'Concluído'});
 await rpc(a.client,'contracts','save',{...input,companyId:other.id,contractNumber:'OTHER'});
 const scope={companyId:company.id};
 for(const [contract,volume,atr,month,amount,kind] of [[ca,'10','100','07','200','advance'],[cb,'30','200','08','7000','receipt']]){
  await rpc(a.client,'contracts','save-load',{...scope,contractId:contract.id,farmId:farm.id,plotId:plot.id,loadedAt:`2026-${month}-10`,volume,atr,document:'DOC-01',notes:''});
  await rpc(a.client,'contracts','save-discount',{...scope,contractId:contract.id,requestId:randomUUID(),title:'Acordo de frete',ratePerTon:'2',months:[`2026-${month}`],notes:''});
  await rpc(a.client,'contracts','save-payment',{...scope,contractId:contract.id,requestId:randomUUID(),kind,receivedAt:`2026-${month}-01`,referenceMonth:`2026-${month}`,amount,document:'REC-01',notes:''});
 }
 const data=await rpc(a.client,'contracts','list',scope),s=data.summary;
 assert.equal(data.total,2);assert.deepEqual(data.counts,{open:2,finished:1});
 for(const [key,value] of Object.entries({loadedVolume:'40',averageAtr:'175',grossAmount:'7000',discountAmount:'80',netAmount:'6920',receivedAmount:'7200',pendingAmount:'780',creditAmount:'1060'}))assert.equal(s[key],value,key);
 for(const contract of data.contracts){const detail=(await rpc(a.client,'contracts','get',{...scope,id:contract.id})).contract;assert.deepEqual(contract.financialTotals,detail.financialSummary.totals);assert.equal(contract.atrQuoteSummary.average,'1');assert.equal(contract.atrQuoteSummary.pending,false);}
 const filtered=await rpc(a.client,'contracts','list',{...scope,search:'CTR-002'});assert.equal(filtered.total,1);assert.equal(filtered.summary.loadedVolume,'30');
 const dated=await rpc(a.client,'contracts','list',{...scope,from:'2026-07-01',to:'2026-07-01'});assert.equal(dated.total,1);assert.equal(dated.summary.loadedVolume,'10');
 const closed=await rpc(a.client,'contracts','list',{...scope,bucket:'finished'});assert.equal(closed.total,1);assert.equal(closed.summary.loadedVolume,'0');
 const empty=await rpc(a.client,'contracts','list',{...scope,search:'ABSENT'});assert.equal(empty.total,0);assert.equal(empty.summary.grossAmount,'0');
 await assert.rejects(rpc(b.client,'contracts','list',scope));await assert.rejects(rpc(a.client,'contracts','list',{...scope,owner_id:'00000000-0000-4000-8000-000000000001'}));
 const anon=createClient(url,publicKey,options);clients.push(anon);await assert.rejects(rpc(anon,'contracts','list',scope));
 if(process.env.BILLING_BROWSER_CDP){
  const independent=createClient(url,publicKey,{...options,global:{headers:{Authorization:`Bearer ${a.session.access_token}`}}});clients.push(independent);
  const {verifyContractsSummaryBrowser}=await import('./contracts-summary-browser.mjs');
  await verifyContractsSummaryBrowser({cdpUrl:process.env.BILLING_BROWSER_CDP,baseUrl:process.env.BILLING_LOCAL_URL??'http://localhost:5173',session:a.session,projectRef:PROJECT_REF,
   onRemotePayment:()=>rpc(independent,'contracts','save-payment',{...scope,contractId:ca.id,requestId:randomUUID(),kind:'receipt',receivedAt:'2026-07-20',referenceMonth:'2026-07',amount:'25',document:'REALTIME-KPI',notes:''})});
 }
 // Different delivered months must use their own preceding quotation and the
 // contract criterion; a quotation for an unused month cannot affect the mean.
 await rpc(a.client,'contracts','save-load',{...scope,contractId:ca.id,farmId:farm.id,plotId:plot.id,loadedAt:'2026-08-10',volume:'30',atr:'200',document:'QUOTE-AVERAGE',notes:''});
 const records=(await rpc(a.client,'atr','list',{page:1,pageSize:12})).records;
 for(const [month,gross,net,accGross,accNet] of [[6,'1.1','0.9','1.5','1.2'],[7,'1.3','1.1','1.7','1.4'],[8,'999','999','999','999']]){
  const quote=records.find(record=>record.month===month);
  await rpc(a.client,'atr','save',{id:quote.id,year:2026,month,monthlyGrossValue:gross,monthlyNetValue:net,accumulatedGrossValue:accGross,accumulatedNetValue:accNet});
 }
 for(const [atrPriceType,atrPeriodType,average] of [['gross','monthly','1.25'],['net','monthly','1.05'],['gross','accumulated','1.65'],['net','accumulated','1.35']]){
  await rpc(a.client,'contracts','save',{...input,id:ca.id,contractNumber:'CTR-001/2026',status:'Ativo',atrPriceType,atrPeriodType});
  const contract=(await rpc(a.client,'contracts','list',{...scope,search:'CTR-001',from:'2026-07-01',to:'2026-07-01'})).contracts[0];
  assert.equal(contract.averageAtr,'175');assert.equal(contract.atrQuoteSummary.average,average);assert.deepEqual(contract.atrQuoteSummary.loadedMonths,['2026-07','2026-08']);assert.deepEqual(contract.atrQuoteSummary.referenceMonths,['2026-06','2026-07']);
 }
 console.log('PASS: live contract KPIs, exact financial totals, weighted measured ATR/quotations, all four criteria, delivery/reference months, filters and account isolation.');
}finally{
 for(const client of clients)await client.removeAllChannels();
 const failures=[];for(const id of users){const {error}=await admin.auth.admin.deleteUser(id);if(error)failures.push(id);}
 if(failures.length)throw Error(`Cleanup failed: see ${record}`);if(users.length)unlinkSync(record);console.log(`Cleanup: ${users.length} temporary KPI accounts removed.`);
}
