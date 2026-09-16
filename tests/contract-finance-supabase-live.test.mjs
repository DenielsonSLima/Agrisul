import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {getMcpCredentials,PROJECT_REF} from '../scripts/supabase-mcp.mjs';

if(process.env.BILLING_RUN_LIVE_TESTS!=='1')throw new Error('Set BILLING_RUN_LIVE_TESTS=1 to run isolated remote tests.');
assert.equal(PROJECT_REF,'rbuscpwntzpyqsuycqmv');
const {authorization}=getMcpCredentials();
const keyResponse=await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`,{headers:{Authorization:authorization}});
assert.equal(keyResponse.status,200);
const keys=await keyResponse.json(),publicKey=keys.find(k=>k.type==='publishable')?.api_key,adminKey=keys.find(k=>k.type==='secret')?.api_key??keys.find(k=>k.name==='service_role')?.api_key;
assert.ok(publicKey&&adminKey);
const url=`https://${PROJECT_REF}.supabase.co`,options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(url,adminKey,options),users=[],clients=[],channels=[];
mkdirSync('.sites-runtime/finance',{recursive:true});
const record=`.sites-runtime/finance/test-users-${randomUUID()}.json`;
async function account(){
 const email=`finance-${randomUUID()}@example.com`,password=`${randomUUID()}aA9!`;
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
 const company=(await rpc(a.client,'companies','save',{...details('AGRISUL • Verificação financeira'),isPrimary:true})).company;
 const company2=(await rpc(a.client,'companies','save',{...details('Outra empresa'),isPrimary:false})).company;
 const partner=(await rpc(a.client,'clients','save',{...details('USINA • CONTRATO DE VERIFICAÇÃO'),cnpj:'11222333000181'})).client;
 await rpc(a.client,'contract-types','save',{name:'Contrato semiautomático',stages:[]});
 const type=(await rpc(a.client,'contract-types','list')).types[0];
 const contract=(await rpc(a.client,'contracts','save',{title:'Financeiro de verificação',companyId:company.id,clientId:partner.id,typeId:type.id,status:'Ativo',contractNumber:'FIN-2026',startDate:'2026-07-01',endDate:'',contractedVolume:'10000',atrPriceType:'gross',atrPeriodType:'monthly',value:'',notes:''})).contract;
 const scope={companyId:company.id,contractId:contract.id};
 const detail=async()=> (await rpc(a.client,'contracts','get',{id:contract.id,companyId:company.id})).contract.financialSummary;
 assert.equal((await detail()).totals.pendingAmount,'0');
 const farm=(await rpc(a.client,'farms','save',{name:'Fazenda de verificação',areaHa:'10',city:'Itabaiana',state:'SE'})).farm;
 const plot=(await rpc(a.client,'plots','save',{farmId:farm.id,name:'Talhão de verificação',areaHa:'10'})).data.plots[0];
 for(const month of [6,7,8,9])await rpc(a.client,'atr','save',{year:2026,month,monthlyGrossValue:'1',monthlyNetValue:'0.9',accumulatedGrossValue:'0.8',accumulatedNetValue:'0.7'});
 for(const [loadedAt,volume,atr] of [['2026-07-01','10','100'],['2026-07-02','30','200'],['2026-08-01','20','150'],['2026-09-01','10','150']])await rpc(a.client,'contracts','save-load',{...scope,loadedAt,volume,atr,farmId:farm.id,plotId:plot.id,document:'',notes:''});
 const second=createClient(url,publicKey,{...options,global:{headers:{Authorization:`Bearer ${a.session.access_token}`}}});clients.push(second);
 const seen=new Set(),waiters=new Map();
 let channel=a.client.channel('finance-'+randomUUID());
 for(const table of ['billing_contract_payments','billing_contract_discounts'])channel=channel.on('postgres_changes',{event:'INSERT',schema:'public',table},event=>{if(event.new.owner_id===a.id){seen.add(table);waiters.get(table)?.();}});
 channels.push({client:a.client,channel});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Finance Realtime subscribe timeout')),25000);channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}else if(['CHANNEL_ERROR','TIMED_OUT'].includes(status)){clearTimeout(timer);reject(new Error('Finance Realtime failed'));}});});
 const payment={...scope,requestId:randomUUID(),kind:'advance',receivedAt:'2026-07-01',referenceMonth:'2026-07',amount:'1000.25',document:'ADV-01',notes:''};
 const retries=await Promise.all([a.client,second].map(client=>rpc(client,'contracts','save-payment',payment)));
 assert.equal(retries[0].id,retries[1].id,'Concurrent retries must create one payment');
 await rpc(second,'contracts','save-payment',{...payment,requestId:randomUUID(),kind:'receipt',amount:'2000.50',receivedAt:'2026-08-10',document:'REC-01'});
 const discount={...scope,requestId:randomUUID(),title:'Acordo de R$ 75 por tonelada',ratePerTon:'75',months:['2026-07','2026-09'],notes:'Aplicado somente nos meses negociados.'};
 const discounts=await Promise.all([a.client,second].map(client=>rpc(client,'contracts','save-discount',discount)));
 assert.equal(discounts[0].id,discounts[1].id,'Concurrent discount retries must create one agreement');
 for(const table of ['billing_contract_payments','billing_contract_discounts']){
  if(!seen.has(table))await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Missing Realtime event: '+table)),15000);waiters.set(table,()=>{clearTimeout(timer);resolve();});});
 }
 let financial=await detail();
 assert.equal(financial.totals.grossAmount,'11500');assert.equal(financial.totals.discountAmount,'3750');assert.equal(financial.totals.receivedAmount,'3000.75');assert.equal(financial.totals.pendingAmount,'4749.25');
 assert.equal(financial.months.find(m=>m.month==='2026-08').discountAmount,'0');assert.equal(financial.months.find(m=>m.month==='2026-07').averageAtr,'175');assert.equal(financial.payments.length,2);
 assert.equal(financial.discounts[0].notes,discount.notes,'Agreement notes survive the RPC snapshot');
 assert.deepEqual(financial.discounts[0].monthlyBreakdown,[
  {month:'2026-07',loadedVolume:'40',amount:'3000'},
  {month:'2026-09',loadedVolume:'10',amount:'750'},
 ],'Each agreement exposes its monthly quantities and discounts from Postgres');
 if(process.env.BILLING_FINANCE_BROWSER_ONLY!=='1'){
 for(const table of ['billing_contract_payments','billing_contract_discounts']){
  assert.equal((await b.client.from(table).select('id')).data.length,0);
  assert.equal((await a.client.from(table).insert({owner_id:a.id,contract_id:contract.id})).error?.code,'42501');
  assert.equal((await a.client.from(table).update({notes:'Blocked direct update'}).eq('contract_id',contract.id)).error?.code,'42501');
  assert.equal((await a.client.from(table).delete().eq('contract_id',contract.id)).error?.code,'42501');
 }
 await assert.rejects(rpc(b.client,'contracts','save-payment',payment));
 await assert.rejects(rpc(b.client,'contracts','get',{id:contract.id,companyId:company.id}));
 await assert.rejects(rpc(a.client,'contracts','save-payment',{...payment,companyId:company2.id}));
 await assert.rejects(rpc(a.client,'contracts','save-payment',{...payment,owner_id:b.id}));
 await assert.rejects(rpc(a.client,'contracts','save-payment',{...payment,amount:'0.001'}));
 const anon=createClient(url,publicKey,options);clients.push(anon);await assert.rejects(rpc(anon,'contracts','save-payment',payment));
 const edits=await Promise.allSettled([a.client,second].map((client,i)=>rpc(client,'contracts','save-payment',{...payment,id:retries[0].id,expectedRevision:1,amount:i?'1100.25':'1200.25'})));
 assert.equal(edits.filter(r=>r.status==='fulfilled').length,1,'Only one revision can win');
 financial=await detail();const advance=financial.payments.find(p=>p.id===retries[0].id);
 await rpc(a.client,'contracts','save-payment',{...payment,id:advance.id,expectedRevision:advance.revision});
 console.log('PASS: finance live RPC, exact balances, selective monthly discounts, concurrent retries/revisions, account/company isolation, DML denial, independent Realtime for both tables.');
 }
 if(process.env.BILLING_BROWSER_CDP){
  const {verifyContractFinanceBrowser}=await import('./contract-finance-browser.mjs');
  await verifyContractFinanceBrowser({cdpUrl:process.env.BILLING_BROWSER_CDP,baseUrl:process.env.BILLING_LOCAL_URL??'http://localhost:5173',session:a.session,projectRef:PROJECT_REF,contractId:contract.id});
  financial=await detail();assert.ok(financial.payments.some(p=>p.document==='REC-BROWSER'&&p.amount==='250.75'));
  const savedDiscount=financial.discounts.find(d=>d.title==='Acordo pelo navegador');
  assert.equal(savedDiscount.ratePerTon,'50');assert.equal(savedDiscount.notes,'Transporte negociado.\nObservação completa do desconto no relatório.');
  assert.deepEqual(savedDiscount.monthlyBreakdown,[{month:'2026-08',loadedVolume:'20',amount:'1000'},{month:'2026-10',loadedVolume:'0',amount:'0'}]);
 }
}finally{
 for(const {client,channel} of channels)await client.removeChannel(channel);
 for(const client of clients)await client.removeAllChannels();
 const failures=[];for(const id of users){const {error}=await admin.auth.admin.deleteUser(id);if(error)failures.push(id);}
 if(failures.length)throw new Error(`Cleanup failed for ${failures.length} accounts. See ${record}`);
 if(users.length)unlinkSync(record);
 console.log(`Cleanup: ${users.length} temporary finance accounts removed.`);
}
