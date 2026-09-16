import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {getMcpCredentials,PROJECT_REF} from '../scripts/supabase-mcp.mjs';
if(process.env.BILLING_RUN_LIVE_TESTS!=='1')throw Error('Set BILLING_RUN_LIVE_TESTS=1 to run isolated live verification.');
assert.equal(PROJECT_REF,'rbuscpwntzpyqsuycqmv');
const {authorization}=getMcpCredentials();
const response=await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`,{headers:{Authorization:authorization}});
assert.equal(response.status,200);const keys=await response.json();
const publicKey=keys.find(key=>key.type==='publishable')?.api_key;
const adminKey=keys.find(key=>key.type==='secret')?.api_key??keys.find(key=>key.name==='service_role')?.api_key;
assert.ok(publicKey&&adminKey);
const url=`https://${PROJECT_REF}.supabase.co`,options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(url,adminKey,options),users=[],clients=[];
mkdirSync('.sites-runtime/agenda-validation',{recursive:true});
const record='.sites-runtime/agenda-validation/identities-'+randomUUID()+'.json';
async function account(){const email=`agenda-${randomUUID()}@example.com`,password=randomUUID()+'aA9!';const result=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(result.error);users.push(result.data.user.id);writeFileSync(record,JSON.stringify({projectRef:PROJECT_REF,userIds:users}));const client=createClient(url,publicKey,options);clients.push(client);const signed=await client.auth.signInWithPassword({email,password});assert.ifError(signed.error);return {client,id:result.data.user.id,session:signed.data.session};}
async function rpc(client,resource,action,payload={}){const {data,error}=await client.rpc('billing_rpc',{p_resource:resource,p_action:action,p_payload:payload});if(error)throw Object.assign(Error(error.message),{code:error.code});return data;}
try {
 const a=await account(),b=await account();
 const anon=createClient(url,publicKey,options);clients.push(anon);
 await assert.rejects(rpc(anon,'agenda','list'),error=>['42501','28000'].includes(error.code));
 const details={tradeName:'',cnpj:'',street:'',number:'',complement:'',district:'',city:'',state:'',zipCode:'',phone:'',email:''};
 const company=(await rpc(a.client,'companies','save',{...details,legalName:'Empresa Teste Agenda',isPrimary:true})).company;
 const otherCompany=(await rpc(a.client,'companies','save',{...details,legalName:'Outra Empresa Teste Agenda',isPrimary:false})).company;
 const customer=(await rpc(a.client,'clients','save',{...details,legalName:'Cliente Teste Agenda',cnpj:'11222333000181',status:'Ativo'})).client;
 await rpc(a.client,'contract-types','save',{name:'Tipo de teste agenda',stages:[]});const type=(await rpc(a.client,'contract-types','list')).types[0];
 const farm=(await rpc(a.client,'farms','save',{name:'Fazenda teste agenda',areaHa:'10',city:'Cidade',state:'SP'})).farm;
 const plot=(await rpc(a.client,'plots','save',{farmId:farm.id,name:'Talhão teste agenda',areaHa:'6'})).data.plots[0];
 await rpc(a.client,'atr','save',{year:2026,month:8,monthlyGrossValue:'1',monthlyNetValue:'1',accumulatedGrossValue:'1',accumulatedNetValue:'1'});
 const contract=(await rpc(a.client,'contracts','save',{title:'Contrato teste agenda',contractNumber:'AG-LIVE',companyId:company.id,clientId:customer.id,typeId:type.id,status:'Ativo',startDate:'2026-09-01',endDate:'2026-12-31',contractedVolume:'100',value:'',notes:'',atrPriceType:'gross',atrPeriodType:'monthly'})).contract;
 const scope={companyId:company.id,contractId:contract.id};
 const load={...scope,farmId:farm.id,plotId:plot.id,loadedAt:'2026-09-10',volume:'10',atr:'100',document:'DOC-LIVE',notes:''};
 await rpc(a.client,'contracts','save-load',load);
 await rpc(a.client,'contracts','save-payment',{...scope,requestId:randomUUID(),kind:'receipt',receivedAt:'2026-09-10',referenceMonth:'2026-09',amount:'100',document:'',notes:''});
 const filter={companyId:company.id,month:'2026-09'};
 const calendar=await rpc(a.client,'agenda','list',filter);assert.equal(calendar.days.length,30);assert.equal(calendar.days.find(day=>day.date==='2026-09-10').summary.find(item=>item.kind==='load').volume,'10');
 const summary=await rpc(a.client,'summary','list',filter);assert.equal(summary.totals.grossAmount,'1000');assert.equal(summary.totals.pendingAmount,'900');
 assert.deepEqual((await rpc(a.client,'reports','list',{...filter,kind:'financial'})).totals,summary.totals);
 assert.equal((await rpc(a.client,'agenda','list',{...filter,companyId:otherCompany.id})).eventCount,0);
 await assert.rejects(rpc(b.client,'agenda','list',filter),error=>error.code==='22023');
 await assert.rejects(rpc(a.client,'agenda','list',{...filter,owner_id:b.id}),error=>error.code==='22023');
 const denied=await a.client.from('billing_contract_loads').insert({owner_id:a.id,contract_id:contract.id});assert.equal(denied.error?.code,'42501');
 assert.deepEqual((await rpc(a.client,'planning','list')).periods,[]);
 for(const resource of ['planning-goals','planning-executions'])await assert.rejects(rpc(a.client,resource,'list'),error=>error.code==='22023');
 const second=createClient(url,publicKey,{...options,global:{headers:{Authorization:`Bearer ${a.session.access_token}`}}});clients.push(second);
 if(process.env.BILLING_BROWSER_CDP){const {verifyAgendaBrowser}=await import('./agenda-browser.mjs');await verifyAgendaBrowser({session:a.session,otherSession:b.session,projectRef:PROJECT_REF,cdpUrl:process.env.BILLING_BROWSER_CDP,onRemoteLoad:()=>rpc(second,'contracts','save-load',{...load,volume:'5',document:'REMOTE-REALTIME'})});}
 console.log('PASS: live RPCs, exact totals, account/company isolation, source RLS and removed module access.');
} finally {
 for(const client of clients)await client.removeAllChannels();
 const failures=[];for(const id of users){const {error}=await admin.auth.admin.deleteUser(id);if(error)failures.push(id);}
 if(failures.length)throw Error(`Cleanup failed for ${failures.length} temporary accounts; see ${record}`);
 if(users.length)unlinkSync(record);console.log(`Cleanup: ${users.length} temporary accounts removed.`);
}
