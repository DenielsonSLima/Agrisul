import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {getMcpCredentials,PROJECT_REF} from '../scripts/supabase-mcp.mjs';
if(process.env.BILLING_RUN_LIVE_TESTS!=='1')throw new Error('Enable isolated live tests explicitly.');
assert.equal(PROJECT_REF,'rbuscpwntzpyqsuycqmv');
const {authorization}=getMcpCredentials();
const response=await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`,{headers:{Authorization:authorization}});assert.equal(response.status,200);
const keys=await response.json(),publicKey=keys.find(k=>k.type==='publishable')?.api_key,adminKey=keys.find(k=>k.type==='secret')?.api_key??keys.find(k=>k.name==='service_role')?.api_key;
assert.ok(publicKey&&adminKey);
const url=`https://${PROJECT_REF}.supabase.co`,options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}},admin=createClient(url,adminKey,options),users=[],clients=[];
mkdirSync('.sites-runtime/loads',{recursive:true});const record='.sites-runtime/loads/users-'+randomUUID()+'.json';
async function account(){const email=`loads-${randomUUID()}@example.com`,password=randomUUID()+'aA9!';const result=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(result.error);users.push(result.data.user.id);writeFileSync(record,JSON.stringify({projectRef:PROJECT_REF,userIds:users}));const client=createClient(url,publicKey,options);clients.push(client);const signed=await client.auth.signInWithPassword({email,password});assert.ifError(signed.error);return {id:result.data.user.id,client,session:signed.data.session};}
async function rpc(client,resource,action,payload={}){const {data,error}=await client.rpc('billing_rpc',{p_resource:resource,p_action:action,p_payload:payload});if(error)throw Object.assign(new Error(error.message),{code:error.code});return data;}
const details={tradeName:'',cnpj:'',street:'',number:'',complement:'',district:'',city:'',state:'',zipCode:'',phone:'',email:''};
try{
 const a=await account(),b=await account();
 const company=(await rpc(a.client,'companies','save',{...details,legalName:'AGRISUL · Verificação',isPrimary:true})).id;
 const other=(await rpc(a.client,'companies','save',{...details,legalName:'Outra empresa',isPrimary:false})).id;
 const client=(await rpc(a.client,'clients','save',{...details,legalName:'USINA SÃO JOSÉ DO PINHEIRO',cnpj:'11222333000181'})).client;
 await rpc(a.client,'contract-types','save',{name:'Fornecimento de cana',stages:[{id:'load',name:'Carregamento'}]});
 const kind=(await rpc(a.client,'contract-types','list')).types[0];
 const contract=(await rpc(a.client,'contracts','save',{companyId:company,clientId:client.id,typeId:kind.id,title:'Safra 2026',contractNumber:'CTR-2026/001',status:'Ativo',startDate:'2026-01-01',contractedVolume:'200'})).contract;
 const origins=[];
 for(const [name,plotName] of [['Fazenda Aurora','Talhão Norte'],['Fazenda Bela Vista','Talhão Sul']]){
  const farm=(await rpc(a.client,'farms','save',{name,areaHa:'20',city:'Itabaiana',state:'SE'})).farm;
  const plot=(await rpc(a.client,'plots','save',{farmId:farm.id,name:plotName,areaHa:'10'})).data.plots[0];origins.push({farmId:farm.id,plotId:plot.id});
 }
 for(const [year,month,value] of [[2025,12,'80'],[2026,1,'160'],[2026,2,'120']])await rpc(a.client,'atr','save',{year,month,monthlyGrossValue:value,monthlyNetValue:'70',accumulatedGrossValue:'60',accumulatedNetValue:'50'});
 const scope={companyId:company,contractId:contract.id},base={...scope,...origins[0],loadedAt:'2026-01-31',volume:'10.125',atr:'80',document:'ROM%01',notes:'Frente de colheita norte'};
 await rpc(a.client,'contracts','save-load',base);
 await rpc(a.client,'contracts','save-load',{...base,loadedAt:'2026-02-01',volume:'20',atr:'100',document:'ROM-02'});
 await rpc(a.client,'contracts','save-load',{...base,...origins[1],loadedAt:'2026-02-28',volume:'30',atr:'200',document:'ROM-03',notes:'Frente de colheita sul'});
 await rpc(a.client,'contracts','save-load',{...base,...origins[1],loadedAt:'2026-03-01',volume:'39.875',atr:'120',document:'ROM-04',notes:''});
 await rpc(a.client,'contracts','save-discount',{...scope,requestId:randomUUID(),title:'Transporte',ratePerTon:'7.125',months:['2026-01','2026-02'],notes:''});
 await rpc(a.client,'contracts','save-discount',{...scope,requestId:randomUUID(),title:'Serviço',ratePerTon:'2.875',months:['2026-02'],notes:''});
 const list=(client,filters={})=>rpc(client,'contracts','list',{view:'loads',...scope,...filters});
 let snapshot=await list(a.client);assert.equal(snapshot.summary.volume,'100');assert.equal(snapshot.summary.averageAtr,'135.95');assert.equal(snapshot.summary.loadCount,4);
 assert.deepEqual([snapshot.summary.grossAmount,snapshot.summary.discountAmount,snapshot.summary.netAmount,snapshot.summary.billingPending],['1919000','572.14','1918427.86',false]);
 snapshot=await list(a.client,{from:'2026-02-01',to:'2026-02-28'});assert.equal(snapshot.summary.volume,'50');assert.equal(snapshot.summary.averageAtr,'160');assert.equal(snapshot.groups[0].loads.length,2);
 assert.deepEqual([snapshot.summary.grossAmount,snapshot.summary.discountAmount,snapshot.summary.netAmount],['1280000','500','1279500']);
 const priced=snapshot.groups[0].loads.find(load=>load.document==='ROM-02');
 assert.deepEqual([priced.grossAmount,priced.discountAmount,priced.netAmount,priced.billingPending],['320000','200','319800',false]);
 const filteredPriced=(await list(a.client,{search:'ROM-02',groupBy:'none'})).groups[0].loads[0];assert.deepEqual(filteredPriced,priced,'Search/grouping keep allocated financial values');
 snapshot=await list(a.client,{search:'Aurora',groupBy:'farm'});assert.equal(snapshot.summary.volume,'30.125');assert.equal(snapshot.summary.farmCount,1);
 assert.equal((await list(a.client,{search:'%'})).summary.loadCount,1);
 await assert.rejects(list(a.client,{from:'2026-03-01',to:'2026-02-01'}),e=>e.code==='22023');
 await assert.rejects(list(a.client,{companyId:other}),e=>e.code==='P0002');
 await assert.rejects(list(b.client),e=>e.code==='P0002');
 await assert.rejects(rpc(b.client,'contracts','save-load',base));
 const anon=createClient(url,publicKey,options);clients.push(anon);await assert.rejects(list(anon),e=>['42501','28000'].includes(e.code));
 const denied=await a.client.from('billing_contract_loads').insert({owner_id:a.id});assert.equal(denied.error?.code,'42501');
 if(process.env.BILLING_BROWSER_CDP){const {verifyLoadsBrowser}=await import('./contract-loads-browser.mjs');await verifyLoadsBrowser({cdpUrl:process.env.BILLING_BROWSER_CDP,baseUrl:process.env.BILLING_LOCAL_URL??'http://localhost:5173',session:a.session,projectRef:PROJECT_REF,contractId:contract.id});}
 const second=createClient(url,publicKey,{...options,global:{headers:{Authorization:`Bearer ${a.session.access_token}`}}});clients.push(second);
 await a.client.realtime.setAuth(a.session.access_token);
 const channel=a.client.channel('loads-live-'+randomUUID());let resolveEvent;const event=new Promise(resolve=>{resolveEvent=resolve;});
 channel.on('postgres_changes',{event:'INSERT',schema:'public',table:'billing_contract_loads'},payload=>{console.log('Realtime received:',payload.eventType);if(payload.new.owner_id===a.id)resolveEvent();});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Realtime subscription timeout')),25000);channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}});});
 const inserted=(await rpc(second,'contracts','save-load',{...base,volume:'1',document:'Realtime'})).load;
 let eventTimer;try{await Promise.race([event,new Promise((_,reject)=>{eventTimer=setTimeout(()=>reject(new Error('Realtime event timeout')),25000);})]);}finally{clearTimeout(eventTimer);}
 await rpc(a.client,'contracts','delete-load',{...scope,id:inserted.id});await a.client.removeChannel(channel);
 const races=await Promise.allSettled([a.client,second].map(c=>rpc(c,'contracts','save-load',{...base,volume:'70',document:'Capacidade'})));
 assert.equal(races.filter(r=>r.status==='fulfilled').length,1);const winner=races.find(r=>r.status==='fulfilled').value.load;
 await rpc(a.client,'contracts','delete-load',{...scope,id:winner.id});
 console.log('PASS: remote filtered snapshots, grouping, decimals, tenant/company isolation, direct writes denied, concurrent capacity and independent Realtime.');
}finally{
 for(const client of clients)await client.removeAllChannels();
 const failures=[];for(const id of users){const {error}=await admin.auth.admin.deleteUser(id);if(error)failures.push(id);}
 if(failures.length)throw new Error(`Cleanup failed; see ${record}`);
 if(users.length)unlinkSync(record);console.log(`Cleanup: ${users.length} temporary load accounts removed.`);
}
