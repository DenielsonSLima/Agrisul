// Explicit integration test: creates isolated Auth accounts, then deletes only
// those accounts and their test data. No existing user's data is selected.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync,unlinkSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {getMcpCredentials,PROJECT_REF} from '../scripts/supabase-mcp.mjs';
if(process.env.BILLING_RUN_LIVE_TESTS!=='1')throw new Error('Set BILLING_RUN_LIVE_TESTS=1 to run isolated remote tests.');
const {authorization}=getMcpCredentials();
const url=`https://${PROJECT_REF}.supabase.co`;
const result=await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`,{headers:{Authorization:authorization}});
assert.equal(result.status,200,'Management API must authorize this project');
const keys=await result.json();
const publicKey=keys.find(k=>k.type==='publishable')?.api_key;
const adminKey=keys.find(k=>k.type==='secret')?.api_key??keys.find(k=>k.name==='service_role')?.api_key;
assert.ok(publicKey&&adminKey,'Test credentials available');
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(url,adminKey,options);
const users=[];const clients=[];const files=[];
const record='.sites-runtime/supabase/live-test-users.json';
let channel;
async function account(){
 const id=randomUUID();const email=`billing-rpc-${id}@example.com`;const password=`${randomUUID()}aA9!`;
 const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:'Teste temporário'}});
 assert.ifError(error);users.push(data.user.id);writeFileSync(record,JSON.stringify({projectRef:PROJECT_REF,userIds:users}));
 const client=createClient(url,publicKey,options);clients.push(client);
 const session=await client.auth.signInWithPassword({email,password});assert.ifError(session.error);
 return {client,id:data.user.id,token:session.data.session.access_token};
}
async function rpc(client,resource,action,payload={}){
 const {data,error}=await client.rpc('billing_rpc',{p_resource:resource,p_action:action,p_payload:payload});
 if(error)throw Object.assign(new Error(error.message),{code:error.code});return data;
}
const details=(name)=>({legalName:name,tradeName:'',cnpj:'',street:'',number:'',complement:'',district:'',city:'',state:'',zipCode:'',phone:'',email:''});
try{
 const a=await account();const b=await account();
 const anon=createClient(url,publicKey,options);clients.push(anon);
 await assert.rejects(rpc(anon,'farms','list'),e=>e.code==='42501'||e.code==='28000');
 const defaults=await rpc(a.client,'settings','get');assert.ok(defaults.settings.name&&defaults.settings.company);
 await assert.rejects(rpc(a.client,'settings','save',{}),e=>e.code==='22023');
 const farmResult=await rpc(a.client,'farms','save',{name:'Fazenda teste RPC',areaHa:'1.000001',city:'Itabaiana',state:'SE'});
 const farmId=farmResult.farm.id;
 const atrResult=await rpc(a.client,'atr','save',{year:2026,month:9,monthlyGrossValue:'1,253367',monthlyNetValue:'1,234567',accumulatedGrossValue:'1,217020',accumulatedNetValue:'1,198765'});
 assert.equal(atrResult.record.monthlyGrossValue,'1.253367');assert.equal(atrResult.record.monthlyNetValue,'1.234567');assert.equal(atrResult.record.accumulatedGrossValue,'1.21702');assert.equal(atrResult.record.accumulatedNetValue,'1.198765');assert.equal('monthlyValue' in atrResult.record,false);
 const atrPage=await rpc(a.client,'atr','list',{page:1,pageSize:12});
 assert.equal(atrPage.records.length,1);assert.deepEqual(atrPage.pagination,{page:1,pageSize:12,total:1,totalPages:1,hasPrevious:false,hasNext:false});
 await assert.rejects(rpc(a.client,'atr','save',{year:2026,month:10,monthlyNetValue:'1.2'}),e=>e.code==='22023');
 assert.deepEqual((await rpc(b.client,'atr','list')).records,[]);
 await assert.rejects(rpc(b.client,'atr','get',{id:atrResult.record.id}),e=>e.code==='P0002');
 const directAtr=await a.client.from('billing_atr_records').insert({owner_id:a.id,year:2026,month:11,monthly_gross_value:1,monthly_net_value:1,accumulated_gross_value:1,accumulated_net_value:1});
 assert.equal(directAtr.error?.code,'42501');
 assert.deepEqual((await rpc(b.client,'farms','list')).farms,[]);
 await assert.rejects(rpc(b.client,'farms','get',{id:farmId}),e=>e.code==='P0002');
 const direct=await a.client.from('billing_farms').insert({name:'DML deve falhar',owner_id:a.id,area_ha:1,city:'Itabaiana',state:'SE'});
 assert.equal(direct.error?.code,'42501');
 assert.equal((await b.client.from('billing_farms').select('id')).data.length,0);
 const writes=await Promise.allSettled(['A','B'].map(name=>rpc(a.client,'plots','save',{farmId,name:'Talhão '+name,areaHa:'0.6'})));
 assert.equal(writes.filter(x=>x.status==='fulfilled').length,1,'Concurrent plot writes must not exceed capacity');
 assert.equal(writes.find(x=>x.status==='rejected').reason.code,'23514');
 const plots=await rpc(a.client,'plots','list',{farmId});
 assert.equal(plots.data.usedHa,'0.6');assert.equal(plots.data.availableHa,'0.400001');
 const farmSummary=await rpc(a.client,'farms','list');
 assert.equal(farmSummary.farms[0].plotCount,1);assert.equal(farmSummary.farms[0].usedHa,'0.6');assert.equal(farmSummary.farms[0].preservedHa,'0.400001');
 assert.equal(farmSummary.summary.farmCount,1);assert.equal(farmSummary.summary.plotCount,1);assert.equal(farmSummary.summary.preservedHa,'0.400001');
 const companies=await Promise.all(['Empresa A','Empresa B'].map(name=>rpc(a.client,'companies','save',{...details(name),isPrimary:true})));
 const listedCompanies=(await rpc(a.client,'companies','list')).companies;
 assert.equal(companies.length,2);assert.equal(listedCompanies.filter(x=>x.isPrimary).length,1);
 const logoKey=`${a.id}/companies/${randomUUID()}.png`;const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=','base64');
 const logoUpload=await a.client.storage.from('billing-company-logos').upload(logoKey,image,{contentType:'image/png'});assert.ifError(logoUpload.error);files.push({bucket:'billing-company-logos',key:logoKey});
 const logoCompany=listedCompanies[0];const logoSaved=await rpc(a.client,'companies','save',{id:logoCompany.id,...details(logoCompany.legalName),isPrimary:logoCompany.isPrimary,logoKey,logoName:'Empresa.png'});
 assert.equal(logoSaved.company.logoKey,logoKey);assert.equal((await rpc(a.client,'companies','list')).companies.find(x=>x.id===logoCompany.id).logoName,'Empresa.png');
 assert.ok((await b.client.storage.from('billing-company-logos').download(logoKey)).error);
 const logoSigned=await a.client.storage.from('billing-company-logos').createSignedUrl(logoKey,60);assert.ifError(logoSigned.error);assert.equal((await fetch(logoSigned.data.signedUrl)).status,200);
 console.log('PASS: RPC, RLS, DML denied, four ATR quotations, exact decimals, capacity, primary company and private company logo.');
 let received;
 const event=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Realtime event timeout')),25000);received=()=>{clearTimeout(timeout);resolve();};});
 channel=a.client.channel('billing-live-test-'+randomUUID()).on('postgres_changes',{event:'UPDATE',schema:'public',table:'billing_farms'},payload=>{if(payload.new.id===farmId)received();});
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Realtime subscription timeout')),25000);channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timeout);resolve();}if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){clearTimeout(timeout);reject(new Error('Realtime connection failed'));}});});
 const second=createClient(url,publicKey,{...options,global:{headers:{Authorization:`Bearer ${a.token}`}}});clients.push(second);
 await rpc(second,'farms','save',{id:farmId,name:'Fazenda atualizada em outra conexão',areaHa:'1.000001',city:'Itabaiana',state:'SE'});
 await event;
 console.log('PASS: Realtime event received from an independent authenticated connection.');
 const portraitKey=`${a.id}/portrait/${randomUUID()}.png`;const landscapeKey=`${a.id}/landscape/${randomUUID()}.png`;
 for(const key of [portraitKey,landscapeKey]){const upload=await a.client.storage.from('billing-watermarks').upload(key,image,{contentType:'image/png'});assert.ifError(upload.error);files.push({bucket:'billing-watermarks',key});}
 const portraitSave=await rpc(a.client,'watermarks','save',{orientation:'portrait',opacity:15,size:60,portraitImageKey:portraitKey,portraitImageName:'Retrato.png'});assert.equal(portraitSave.settings.portraitImageKey,portraitKey);
 const landscapeSave=await rpc(a.client,'watermarks','save',{orientation:'landscape',opacity:15,size:60,landscapeImageKey:landscapeKey,landscapeImageName:'Paisagem.png'});assert.equal(landscapeSave.settings.portraitImageKey,portraitKey);assert.equal(landscapeSave.settings.landscapeImageKey,landscapeKey);
 const reloaded=(await rpc(a.client,'watermarks','get',{})).settings;assert.equal(reloaded.portraitImageKey,portraitKey);assert.equal(reloaded.landscapeImageKey,landscapeKey);
 for(const key of [portraitKey,landscapeKey]){const forbidden=await b.client.storage.from('billing-watermarks').download(key);assert.ok(forbidden.error);const signed=await a.client.storage.from('billing-watermarks').createSignedUrl(key,60);assert.ifError(signed.error);assert.equal((await fetch(signed.data.signedUrl)).status,200);}
 console.log('PASS: portrait and landscape survive independent saves/reload; private signed images and cross-account denial verified.');
 if(process.env.BILLING_LOCAL_URL){
  const res=await fetch(process.env.BILLING_LOCAL_URL+'/api/clients',{headers:{Authorization:`Bearer ${a.token}`}});assert.equal(res.status,200);
  assert.equal((await fetch(process.env.BILLING_LOCAL_URL+'/api/clients')).status,401);
  console.log('PASS: local API proxy requires a Supabase session.');
 }
}finally{
 if(channel&&clients[0])await clients[0].removeChannel(channel);
 for(const client of clients)await client.removeAllChannels();
 for(const bucket of [...new Set(files.map(file=>file.bucket))]){const removal=await admin.storage.from(bucket).remove(files.filter(file=>file.bucket===bucket).map(file=>file.key));assert.ifError(removal.error);}
 const failures=[];
 for(const id of users){const {error}=await admin.auth.admin.deleteUser(id);if(error)failures.push(id);}
 if(failures.length)throw new Error(`Cleanup failed for ${failures.length} test accounts; see ${record}`);
 if(users.length)unlinkSync(record);
 console.log(`Cleanup: ${users.length} temporary accounts removed.`);
}
