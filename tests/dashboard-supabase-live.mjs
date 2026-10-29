import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
import {verifyDashboardBrowser} from './dashboard-browser.mjs';
if(process.env.BILLING_RUN_LIVE_TESTS!=='1')throw Error('Set BILLING_RUN_LIVE_TESTS=1 for isolated live Dashboard verification.');
const ref='ykounjabfsrtkzostbbz';assert.equal(readFileSync('supabase/.temp/project-ref','utf8').trim(),ref);
const raw=JSON.parse(execFileSync('.sites-runtime/tools/supabase.exe',['projects','api-keys','--project-ref',ref,'--reveal','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const keys=Array.isArray(raw)?raw:raw.api_keys??raw.apiKeys??raw.keys;
const pub=keys.find(k=>k.type==='publishable')?.api_key,secret=keys.find(k=>k.type==='secret')?.api_key??keys.find(k=>k.name==='service_role')?.api_key;assert.ok(pub&&secret);
const url=`https://${ref}.supabase.co`,options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}},admin=createClient(url,secret,options),users=[],clients=[];
const journal='.sites-runtime/dashboard-live-identities.json';let observer;
async function rpc(client,resource,action,payload={}){const {data,error}=await client.rpc('billing_rpc',{p_resource:resource,p_action:action,p_payload:payload}).abortSignal(AbortSignal.timeout(45000));if(error)throw Object.assign(Error(error.message),{code:error.code});return data;}
async function account(){const email=`dashboard-${randomUUID()}@example.com`,password=`${randomUUID()}Aa9!`;const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);users.push(created.data.user.id);writeFileSync(journal,JSON.stringify({projectRef:ref,userIds:users}));const client=createClient(url,pub,options);clients.push(client);const result=await client.auth.signInWithPassword({email,password});assert.ifError(result.error);await rpc(client,'settings','get');return {id:created.data.user.id,client,session:result.data.session};}
try{
 const a=await account(),b=await account();const call=(resource,action,payload)=>rpc(a.client,resource,action,payload);
 const details={tradeName:'',cnpj:'',street:'',number:'',complement:'',district:'',city:'',state:'',zipCode:'',phone:'',email:''};
 const company=(await call('companies','save',{...details,legalName:'AGRISUL · Dashboard teste',isPrimary:true})).company;
 const client=(await call('clients','save',{...details,legalName:'Usina de teste Dashboard',cnpj:'00000000000000'})).client;
 await call('contract-types','save',{name:'Fornecimento teste Dashboard',stages:[]});const kind=(await call('contract-types','list')).types[0];
 const farm=(await call('farms','save',{name:'Fazenda de teste Dashboard',areaHa:'100',city:'Cuiabá',state:'MT'})).farm;
 const plot=(await call('plots','save',{farmId:farm.id,name:'Talhão 01',areaHa:'50'})).data.plots[0];
 const contract=(await call('contracts','save',{title:'Fornecimento safra 2026',contractNumber:'DASH-TEST',companyId:company.id,clientId:client.id,typeId:kind.id,status:'Ativo',startDate:'2026-10-01',endDate:'',contractedVolume:'1000',value:'',notes:'',atrPriceType:'gross',atrPeriodType:'monthly'})).contract;
 const scope={companyId:company.id,contractId:contract.id};
 const culture=await call('cultures','save',{kind:'culture',name:'Cana Dashboard'});const subtype=await call('cultures','save',{kind:'subtype',cultureId:culture.id,name:'Cana planta'});
 const period=(await call('planning','save-period',{name:'Safra 2026/27 · Teste',startDate:'2026-10-01',endDate:'2027-06-30',targetAreaHa:'50',cultureId:culture.id,cultureSubtypeId:subtype.id,notes:'',status:'active'})).period;
 await call('planning','save-allocation',{periodId:period.id,plotId:plot.id,areaHa:'50',notes:''});
 await call('planning','save-harvest-goal',{periodId:period.id,targetTons:'1000',targets:[{plotId:plot.id,targetTons:'1000'}],expectedRevision:1,reason:'Meta de teste'});
 const field=(key,column,type='text')=>({key,column,type,label:key,source:'manual',sourceKey:'',required:false,defaultValue:'',mappings:{},pattern:''});
 const profile=(await call('import-profiles','save',{name:'Modelo fila Dashboard teste',clientId:client.id,parser:'taquari-equipment-v1',sheetName:'Plan1',startRow:2,fields:[field('COD_ENTRADA','L','decimal'),field('COD_TIPOCOLHEITA','K'),field('PESOBRUTO','AA','decimal'),field('TARA','AB','decimal')]})).profile;
 const row=(entrada,method,gross,tare)=>({date:'2026-10-22',source:{entrada,sequencia:'1',dataMovimento:'2026-10-22'},values:{COD_ENTRADA:entrada,COD_TIPOCOLHEITA:method,PESOBRUTO:gross,TARA:tare},sourcePage:1,sourceLine:'Fixture Dashboard'});
 let document=(await call('import-documents','import',{profileId:profile.id,clientId:client.id,sourceName:'dashboard-teste.pdf',sourceHash:randomUUID().replaceAll('-','').repeat(2),entries:[row('101','1','22.125','2'),row('102','2','33','3')]})).document;
 assert.equal((await call('import-documents','pending-loads',scope)).loads.length,0);
 document=(await call('import-documents','finalize',{id:document.id,expectedUpdatedAt:document.updatedAt})).document;
 const queue=(await call('import-documents','pending-loads',scope)).loads;assert.equal(queue.length,2);
 const independent=createClient(url,pub,{...options,global:{headers:{Authorization:`Bearer ${a.session.access_token}`}}});clients.push(independent);
 let seenResolve;const seen=new Promise(resolve=>{seenResolve=resolve;});
 observer=a.client.channel('dashboard-live-'+randomUUID()).on('postgres_changes',{event:'INSERT',schema:'public',table:'billing_contract_loads'},event=>{if(event.new.contract_id===contract.id)seenResolve();});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Realtime subscription timed out')),30000);observer.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){clearTimeout(timer);reject(Error(status));}});});
 const linked=[];
 for(const item of queue){const payload={...scope,id:document.id,tripKey:item.tripKey,expectedUpdatedAt:document.updatedAt,farmId:farm.id,plotId:plot.id};const saved=await rpc(independent,'import-documents','link-load',payload);linked.push(saved.load);assert.equal(saved.created,true);assert.equal(saved.load.atr,'');assert.equal((await call('import-documents','link-load',payload)).created,false);}
 await Promise.race([seen,new Promise((_,reject)=>setTimeout(()=>reject(Error('Independent Realtime event missing')),20000))]);
 const filters={companyId:company.id,from:'2026-01-01',to:'2026-12-31'};const data=await call('summary','dashboard',filters);
 assert.deepEqual(data.harvestMethods.map(m=>m.code),['1','2','unknown']);assert.equal(data.harvestMethods[0].loadedVolume,'20.125');assert.match(data.harvestMethods[1].loadedVolume,/^30(?:\.0+)?$/);assert.match(data.harvestMethods[2].loadedVolume,/^0(?:\.0+)?$/);assert.equal(data.totals.loadedVolume,'50.125');assert.equal(data.totals.billingPending,true);assert.equal((await call('import-documents','pending-loads',scope)).loads.length,0);
 await assert.rejects(()=>rpc(b.client,'summary','dashboard',filters));await assert.rejects(()=>rpc(b.client,'import-documents','pending-loads',scope));
 assert.ok((await a.client.from('billing_contract_loads').update({volume:'999'}).eq('id',linked[0].id)).error);assert.ok((await a.client.from('billing_import_load_links').delete().eq('load_id',linked[0].id)).error);
 assert.equal((await b.client.from('billing_import_load_links').select('load_id')).data.length,0);
 const anon=createClient(url,pub,options);clients.push(anon);await assert.rejects(()=>rpc(anon,'summary','dashboard',filters));
 await call('contracts','save-load',{...scope,id:linked[0].id,farmId:farm.id,plotId:plot.id,loadedAt:'2026-10-22',volume:linked[0].volume,atr:'123.45',document:'101',notes:'ATR preenchido depois'});
 assert.equal((await call('summary','dashboard',filters)).harvestMethods[0].loadedVolume,'20.125');
 console.log('PASS live queue/RPC: finalization, exact tonnes, K methods, idempotency, nullable then entered ATR, dashboard totals, independent Realtime, account/RLS/no-session isolation.');
 const market=await fetch('http://127.0.0.1:5173/api/dashboard-market',{headers:{Authorization:`Bearer ${a.session.access_token}`},signal:AbortSignal.timeout(60000)});assert.equal(market.status,200);const feed=await market.json();console.log('Market route authenticated status:',market.status,'keys:',Object.keys(feed));
 const queueDocument=(await call('import-documents','import',{profileId:profile.id,clientId:client.id,sourceName:'queue-browser.pdf',sourceHash:randomUUID().replaceAll('-','').repeat(2),entries:[row('104','2','14.5','2')]})).document;
 await verifyDashboardBrowser({session:a.session,projectRef:ref,cdpUrl:process.env.BILLING_DASHBOARD_CDP_URL??'http://127.0.0.1:9358',onRemoteLoad:()=>rpc(independent,'contracts','save-load',{...scope,farmId:farm.id,plotId:plot.id,loadedAt:'2026-10-28',volume:'5',atr:'',document:'LIVE-DASH',notes:''}),
  queueFixture:{contractId:contract.id,sourceName:'queue-browser.pdf',farmName:farm.name,
   finalize:()=>rpc(independent,'import-documents','finalize',{id:queueDocument.id,expectedUpdatedAt:queueDocument.updatedAt}),
   verify:async()=>{const list=await call('contracts','list',{...scope,view:'loads',search:'104',from:'',to:'',groupBy:'none'});const item=list.groups.flatMap(group=>group.loads).find(load=>load.document==='104');assert.ok(item);assert.equal(item.volume,'12.5');assert.equal(item.atr,'');}}
 });
}finally{
 if(observer)await clients[0]?.removeChannel(observer);
 for(const client of clients){await client.removeAllChannels();client.realtime.disconnect();await client.auth.signOut().catch(()=>{});}
 for(const id of users){const result=await admin.auth.admin.deleteUser(id);assert.ifError(result.error);}
 if(users.length)unlinkSync(journal);console.log('Temporary dashboard identities removed:',users.length);
}
