import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {getMcpCredentials,PROJECT_REF} from '../scripts/supabase-mcp.mjs';

if(process.env.BILLING_RUN_LIVE_TESTS!=='1')throw new Error('Set BILLING_RUN_LIVE_TESTS=1 for isolated remote tests.');
assert.equal(PROJECT_REF,'rbuscpwntzpyqsuycqmv');
const {authorization}=getMcpCredentials();
const response=await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`,{headers:{Authorization:authorization}});
assert.equal(response.status,200);
const keys=await response.json(),publicKey=keys.find(k=>k.type==='publishable')?.api_key;
const adminKey=keys.find(k=>k.type==='secret')?.api_key??keys.find(k=>k.name==='service_role')?.api_key;
assert.ok(publicKey&&adminKey);
const url=`https://${PROJECT_REF}.supabase.co`,options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(url,adminKey,options),users=[],clients=[];
mkdirSync('.sites-runtime/atr-month-reference',{recursive:true});
const record=`.sites-runtime/atr-month-reference/test-users-${randomUUID()}.json`;
async function account(){
 const email=`atr-reference-${randomUUID()}@example.com`,password=`${randomUUID()}aA9!`;
 const result=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(result.error);
 users.push(result.data.user.id);writeFileSync(record,JSON.stringify({projectRef:PROJECT_REF,userIds:users}));
 const client=createClient(url,publicKey,options);clients.push(client);
 const session=await client.auth.signInWithPassword({email,password});assert.ifError(session.error);
 return {id:result.data.user.id,client,session:session.data.session};
}
async function rpc(client,resource,action,payload={}){
 const {data,error}=await client.rpc('billing_rpc',{p_resource:resource,p_action:action,p_payload:payload});
 if(error)throw Object.assign(new Error(error.message),{code:error.code});return data;
}
const details=name=>({legalName:name,tradeName:'',cnpj:'',street:'',number:'',complement:'',district:'',city:'',state:'',zipCode:'',phone:'',email:''});
try{
 const a=await account(),b=await account();
 const company=(await rpc(a.client,'companies','save',{...details('ATR reference company'),isPrimary:true})).company;
 const partner=(await rpc(a.client,'clients','save',{...details('ATR reference partner'),cnpj:'11222333000181'})).client;
 await rpc(a.client,'contract-types','save',{name:'ATR reference type',stages:[]});
 const type=(await rpc(a.client,'contract-types','list')).types[0];
 const input={companyId:company.id,clientId:partner.id,typeId:type.id,title:'ATR reference test',status:'Ativo',startDate:'2026-01-01',endDate:'',contractedVolume:'1000',atrPriceType:'gross',atrPeriodType:'monthly',value:'',notes:''};
 const contract=(await rpc(a.client,'contracts','save',input)).contract;
 const scope={companyId:company.id,contractId:contract.id};
 const detail=async()=> (await rpc(a.client,'contracts','get',{companyId:company.id,id:contract.id})).contract;
 const farm=(await rpc(a.client,'farms','save',{name:'ATR reference farm',areaHa:'10',city:'Cidade',state:'SP'})).farm;
 const plot=(await rpc(a.client,'plots','save',{farmId:farm.id,name:'ATR reference plot',areaHa:'10'})).data.plots[0];
 const augustInput={year:2026,month:8,monthlyGrossValue:'1.5',monthlyNetValue:'1.4',accumulatedGrossValue:'1.3',accumulatedNetValue:'1.2'};
 const august=(await rpc(a.client,'atr','save',augustInput)).record;
 await rpc(a.client,'atr','save',{year:2026,month:9,monthlyGrossValue:'9',monthlyNetValue:'8',accumulatedGrossValue:'7',accumulatedNetValue:'6'});
 await rpc(a.client,'atr','save',{year:2026,month:12,monthlyGrossValue:'2.5',monthlyNetValue:'2.4',accumulatedGrossValue:'2.3',accumulatedNetValue:'2.2'});
 for(const [loadedAt,volume,atr] of [['2026-09-01','10','100'],['2026-09-30','30','200'],['2027-01-31','1','200']]){
  const result=await rpc(a.client,'contracts','save-load',{...scope,farmId:farm.id,plotId:plot.id,loadedAt,volume,atr,document:'',notes:''});
  assert.equal(result.load.atr,atr,'Measured load ATR must remain independent of its quotation');
 }
 for(const [price,period,quote,total] of [['gross','monthly','1.5','11000'],['net','monthly','1.4','10280'],['gross','accumulated','1.3','9560'],['net','accumulated','1.2','8840']]){
  await rpc(a.client,'contracts','save',{...input,id:contract.id,atrPriceType:price,atrPeriodType:period});
  const data=await detail(),september=data.monthlySummary.months.find(m=>m.month==='2026-09');
  assert.equal(data.atrPriceType,price);assert.equal(data.atrPeriodType,period);
  assert.equal(september.atrQuote,quote);assert.equal(september.atrReferenceMonth,'2026-08');
  assert.equal(september.averageLoadAtr,'175');
  assert.equal(data.billingAmount,total);assert.equal(data.financialSummary.totals.grossAmount,total);
  const list=await rpc(a.client,'contracts','list',{companyId:company.id,bucket:'open'});
  assert.equal(list.contracts.find(c=>c.id===contract.id).billingAmount,total);
 }
 await rpc(a.client,'contracts','save',{...input,id:contract.id});
 const second=createClient(url,publicKey,{...options,global:{headers:{Authorization:`Bearer ${a.session.access_token}`}}});clients.push(second);
 let resolveEvent;const eventPromise=new Promise(resolve=>{resolveEvent=resolve;});
 const channel=a.client.channel('atr-reference-'+randomUUID()).on('postgres_changes',{event:'UPDATE',schema:'public',table:'billing_atr_records'},event=>{
  if(event.new.id===august.id)resolveEvent();
 });
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('ATR Realtime subscribe timeout')),25000);
  channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}else if(['CHANNEL_ERROR','TIMED_OUT'].includes(status)){clearTimeout(timer);reject(new Error('ATR Realtime failed'));}});
 });
 await rpc(second,'atr','save',{...augustInput,id:august.id,monthlyGrossValue:'3'});
 let eventTimer;
 try{await Promise.race([eventPromise,new Promise((_,reject)=>{eventTimer=setTimeout(()=>reject(new Error('ATR Realtime update missing')),15000);})]);}finally{clearTimeout(eventTimer);}
 const revised=await detail();assert.equal(revised.billingAmount,'21500');
 assert.equal(revised.monthlySummary.months.find(m=>m.month==='2026-09').averageLoadAtr,'175');
 assert.equal(revised.loads.find(l=>l.loadedAt==='2026-09-01').atr,'100');
 assert.equal((await b.client.from('billing_atr_records').select('id')).data.length,0);
 await assert.rejects(rpc(b.client,'contracts','get',{companyId:company.id,id:contract.id}));
 assert.equal((await a.client.from('billing_atr_records').update({monthly_gross_value:99}).eq('id',august.id)).error?.code,'42501');
 const anon=createClient(url,publicKey,options);clients.push(anon);
 await assert.rejects(rpc(anon,'contracts','get',{companyId:company.id,id:contract.id}));
 console.log('PASS: authenticated RPC, measured ATR preserved, four quotation criteria, previous month/year, totals, account isolation, DML denial and independent Realtime.');
}finally{
 for(const client of clients)await client.removeAllChannels();
 const failures=[];
 for(const id of users){const {error}=await admin.auth.admin.deleteUser(id);if(error)failures.push(id);}
 if(failures.length)throw new Error(`Cleanup failed for ${failures.length} temporary accounts. See ${record}`);
 if(users.length)unlinkSync(record);
 console.log(`Cleanup: ${users.length} temporary ATR accounts removed.`);
}
