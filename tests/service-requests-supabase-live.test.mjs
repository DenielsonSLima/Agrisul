import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {getMcpCredentials,PROJECT_REF} from '../scripts/supabase-mcp.mjs';

if(process.env.BILLING_RUN_LIVE_TESTS!=='1')throw Error('Set BILLING_RUN_LIVE_TESTS=1 for isolated live verification.');
assert.equal(PROJECT_REF,'rbuscpwntzpyqsuycqmv');
const {authorization}=getMcpCredentials();
const response=await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`,{headers:{Authorization:authorization}});
assert.equal(response.status,200);
const keys=await response.json();
const publicKey=keys.find(key=>key.type==='publishable')?.api_key;
const adminKey=keys.find(key=>key.type==='secret')?.api_key??keys.find(key=>key.name==='service_role')?.api_key;
assert.ok(publicKey&&adminKey);
const url=`https://${PROJECT_REF}.supabase.co`,options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(url,adminKey,options),users=[],clients=[],files=[];
mkdirSync('.sites-runtime/requests-validation',{recursive:true});
const record='.sites-runtime/requests-validation/identities-'+randomUUID()+'.json';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64');
let channel;
async function account(name){
 const email=`requests-${randomUUID()}@example.com`,password=randomUUID()+'aA9!';
 const created=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:name}});
 assert.ifError(created.error);users.push(created.data.user.id);writeFileSync(record,JSON.stringify({projectRef:PROJECT_REF,userIds:users,files}));
 const client=createClient(url,publicKey,options);clients.push(client);
 const signed=await client.auth.signInWithPassword({email,password});assert.ifError(signed.error);
 return {client,id:created.data.user.id,session:signed.data.session};
}
async function rpc(client,resource,action,payload={}){
 const {data,error}=await client.rpc('billing_rpc',{p_resource:resource,p_action:action,p_payload:payload});
 if(error)throw Object.assign(Error(error.message),{code:error.code});return data;
}
async function upload(client,resource,extra={}){
 const {file}=await rpc(client,resource,'prepare-upload',{fileName:'teste.png',contentType:'image/png',size:png.length,...extra});
 const uploaded=await client.storage.from(file.bucket).upload(file.path,png,{contentType:'image/png',upsert:false});assert.ifError(uploaded.error);
 files.push(file);writeFileSync(record,JSON.stringify({projectRef:PROJECT_REF,userIds:users,files}));return file;
}
async function signature(owner,userId,role,name){
 const file=await upload(owner.client,'signatures');
 return (await rpc(owner.client,'signatures','save',{name,userId,role,fileId:file.id})).signature;
}
const forbidden=error=>error.code==='42501';
try{
 const owner=await account('Diretor de teste'),member=await account('Operador de teste'),other=await account('Outro espaço');
 await rpc(owner.client,'settings','get');await rpc(other.client,'settings','get');
 const profile=(await rpc(owner.client,'access-profiles','save',{name:'Operador teste',description:'Cadastra pessoas e registra solicitações, sem aprovar',permissions:['companies.read','requests.read','requests.write','signatures.manage']})).profile;
 assert.ifError((await admin.from('billing_memberships').insert({owner_id:owner.id,user_id:member.id,access_profile_id:profile.id,is_owner:false,status:'active'})).error);
 await rpc(member.client,'onboarding','complete',{name:'Operador de teste'});
 const company=(await rpc(owner.client,'companies','save',{legalName:'Empresa Teste Solicitações',tradeName:'',cnpj:'',street:'',number:'',complement:'',district:'',city:'Japoatã',state:'SE',zipCode:'',phone:'',email:'',isPrimary:true})).company;
 assert.ok(company.id);
 if(process.env.BILLING_HEADER_ONLY==='1'){
  const {verifyDocumentHeader}=await import('./document-header-live.mjs');
  await verifyDocumentHeader({owner,member,other,company,profile,rpc,projectRef:PROJECT_REF,cdpUrl:process.env.BILLING_BROWSER_CDP,trackFile:file=>{assert.ok(file.path.startsWith(owner.id+'/'));files.push(file);writeFileSync(record,JSON.stringify({projectRef:PROJECT_REF,userIds:users,files}));}});
 }else if(process.env.BILLING_COMPLEMENTS_ONLY==='1'){
  const {verifyRequestComplements}=await import('./request-complements-live.mjs');
  await verifyRequestComplements({owner,member,other,profile,rpc,upload,projectRef:PROJECT_REF,cdpUrl:process.env.BILLING_BROWSER_CDP});
 }else if(process.env.BILLING_PROVIDERS_ONLY==='1'){
  const {verifyProviders}=await import('./providers-live.mjs');
  await verifyProviders({owner,member,other,rpc,projectRef:PROJECT_REF,cdpUrl:process.env.BILLING_BROWSER_CDP});
 }else if(process.env.BILLING_WATERMARK_ONLY==='1'){
  const {verifyDocumentWatermark}=await import('./document-watermark-live.mjs');
  await verifyDocumentWatermark({owner,member,other,rpc,projectRef:PROJECT_REF,cdpUrl:process.env.BILLING_BROWSER_CDP,trackFile:file=>{assert.ok(file.path.startsWith(owner.id+'/'));files.push(file);writeFileSync(record,JSON.stringify({projectRef:PROJECT_REF,userIds:users,files}));}});
 }else{
 const requester=await signature(member,null,'requester','Edmilson de teste');
 const maria=await signature(member,null,'requester','Maria de teste');
 const manager=await signature(owner,owner.id,'manager','Diretor geral de teste');
 assert.equal(requester.userId,null);assert.equal(maria.userId,null);
 const operatorOptions=await rpc(member.client,'service-requests','options');
 assert.equal(operatorOptions.canCreate,true);assert.equal(operatorOptions.canDecide,false);assert.equal(operatorOptions.managerSignature,null);
 assert.deepEqual(new Set(operatorOptions.requesterSignatures.map(person=>person.id)),new Set([requester.id,maria.id]));
 assert.ok(operatorOptions.requesterSignatures.every(person=>person.userId===null),'People have no authentication accounts');
 assert.equal((await rpc(member.client,'signatures','list',{status:'all'})).items.some(person=>person.userId===member.id),false,'The operator has no signature of their own');
 await assert.rejects(rpc(member.client,'signatures','save',{name:'Vínculo indevido',userId:member.id,role:'requester',fileId:requester.fileId}),error=>['22023','23514'].includes(error.code));
 const anon=createClient(url,publicKey,options);clients.push(anon);
 await assert.rejects(rpc(anon,'service-requests','list'),error=>['42501','28000'].includes(error.code));
 if(process.env.BILLING_BROWSER_ONLY!=='1'){
 const requestId=randomUUID();const attachment=await upload(member.client,'service-requests',{requestId});
 const payload={requestId,requesterSignatureId:requester.id,requesterSigningMode:'registered',companyName:'Tornearia Teste',companyAddress:'Japoatã, SE',items:[{description:'Confeccionar 2 mangueiras hidráulicas',application:'Carregadeira Valtra BM100 nº 220/221'}],serviceValue:'1433.00',returnDate:'2026-09-30',notes:'Orçamento de teste',attachmentIds:[attachment.id]};
 await assert.rejects(rpc(member.client,'service-requests','create',{...payload,requesterSigningMode:'invented'}),error=>error.code==='22023');
 await assert.rejects(rpc(member.client,'service-requests','create',{...payload,owner_id:other.id}),error=>error.code==='22023');
 await assert.rejects(rpc(member.client,'service-requests','create',{...payload,requesterSignatureId:null}),error=>['22023','23514'].includes(error.code));
 await assert.rejects(rpc(member.client,'service-requests','create',{...payload,requesterSignatureId:manager.id}),error=>['22023','23514'].includes(error.code));
 await assert.rejects(rpc(member.client,'service-requests','create',{...payload,createdBy:{userId:owner.id,name:'Impostor'}}),error=>error.code==='22023');
 let eventResolve;const event=new Promise(resolve=>{eventResolve=resolve;});const realtimeDiagnostics=[];
 const second=createClient(url,publicKey,{...options,global:{headers:{Authorization:`Bearer ${owner.session.access_token}`}}});clients.push(second);
 await second.realtime.setAuth(owner.session.access_token);
 channel=second.channel('request-live-'+randomUUID()).on('system',{},message=>{realtimeDiagnostics.push({status:message.status,message:message.message});}).on('postgres_changes',{event:'*',schema:'public',table:'billing_service_requests'},change=>{if(change.new.owner_id===owner.id)eventResolve(change);});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Realtime subscription timeout')),25000);channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){clearTimeout(timer);reject(Error('Realtime unavailable'));}});});
 const created=(await rpc(member.client,'service-requests','create',payload)).request;
 assert.equal(created.status,'pending');assert.equal(created.requester.userId,null);assert.equal(created.requester.signatureId,requester.id);assert.equal(created.requester.name,'Edmilson de teste');assert.equal(created.requester.signaturePath,requester.filePath);assert.equal(Number(created.serviceValue),1433);
 assert.equal(created.requester.signingMode,'registered');assert.match(created.requester.signatureHash,/^[a-f0-9]{64}$/i);assert.match(created.documentHash,/^[a-f0-9]{64}$/i);assert.equal(created.template.key,'service-request');
 assert.deepEqual(created.createdBy,{userId:member.id,name:'Operador de teste'});assert.equal(created.history[0].actorId,member.id);assert.equal(created.history[0].actorName,'Operador de teste');
 let eventTimer;await Promise.race([event,new Promise((_,reject)=>{eventTimer=setTimeout(()=>reject(Error('Realtime event timeout: '+JSON.stringify(realtimeDiagnostics))),45000);})]).finally(()=>clearTimeout(eventTimer));
 const retried=(await rpc(member.client,'service-requests','create',payload)).request;assert.equal(retried.id,created.id);
 assert.equal((await rpc(owner.client,'service-requests','list',{tab:'pending',page:1,pageSize:1,search:'Tornearia',requesterId:requester.id,dateFrom:'2026-01-01',dateTo:'2026-12-31'})).total,1);
 assert.equal((await rpc(owner.client,'service-requests','list',{tab:'pending',requesterId:maria.id})).total,0);
 assert.equal((await rpc(owner.client,'service-requests','list',{tab:'pending',requesterId:member.id})).total,0,'Requester filter uses the person signature, not the operator login');
 assert.equal((await rpc(other.client,'service-requests','list',{tab:'pending'})).total,0);
 await assert.rejects(rpc(other.client,'service-requests','get',{id:created.id}),error=>['P0002','42501'].includes(error.code));
 assert.deepEqual((await other.client.from('billing_service_requests').select('id')).data,[]);
 assert.equal((await member.client.from('billing_service_requests').update({status:'approved'}).eq('id',created.id)).error?.code,'42501');
 await assert.rejects(rpc(member.client,'service-requests','decide',{id:created.id,decision:'approved',reason:''}),forbidden);
 assert.ok((await other.client.storage.from(attachment.bucket).download(attachment.path)).error);
 assert.ok((await other.client.storage.from('billing-signatures').download(requester.filePath)).error);
 assert.ok((await member.client.storage.from(attachment.bucket).upload(attachment.path,png,{contentType:'image/png',upsert:true})).error);
 await member.client.storage.from(attachment.bucket).remove([attachment.path]);
 assert.ifError((await member.client.storage.from(attachment.bucket).download(attachment.path)).error);
 const signed=await owner.client.storage.from(attachment.bucket).createSignedUrl(attachment.path,60);assert.ifError(signed.error);assert.equal((await fetch(signed.data.signedUrl)).status,200);
 const race=await Promise.allSettled([
  rpc(owner.client,'service-requests','decide',{id:created.id,decision:'approved',reason:'Orçamento conferido'}),
  rpc(second,'service-requests','decide',{id:created.id,decision:'rejected',reason:'Outra decisão concorrente'}),
 ]);
 assert.equal(race.filter(result=>result.status==='fulfilled').length,1,'Only one concurrent decision commits');
 const decided=(await rpc(owner.client,'service-requests','get',{id:created.id})).request;
 assert.equal(decided.decision.userId,owner.id);assert.equal(decided.decision.signaturePath,manager.filePath);assert.ok(decided.decision.at);assert.equal(decided.history.length,2);
 assert.equal(decided.documentHash,created.documentHash);assert.equal(decided.requester.signatureHash,created.requester.signatureHash);assert.match(decided.decision.signatureHash,/^[a-f0-9]{64}$/i);
 const replacement=await upload(owner.client,'signatures');
 await rpc(owner.client,'signatures','save',{id:manager.id,userId:owner.id,role:'manager',name:'Diretor atualizado',fileId:replacement.id});
 assert.equal((await rpc(owner.client,'service-requests','get',{id:created.id})).request.decision.signaturePath,manager.filePath);
 const selfId=randomUUID(),selfFile=await upload(owner.client,'service-requests',{requestId:selfId});
 const self=(await rpc(owner.client,'service-requests','create',{...payload,requestId:selfId,requesterSignatureId:maria.id,attachmentIds:[selfFile.id],companyName:'Serviço registrado pelo gerente'})).request;
 const selfApproved=(await rpc(owner.client,'service-requests','decide',{id:self.id,decision:'approved',reason:''})).request;
 assert.equal(selfApproved.requester.userId,null);assert.equal(selfApproved.requester.signatureId,maria.id);assert.equal(selfApproved.requester.name,'Maria de teste');assert.equal(selfApproved.createdBy.userId,owner.id);assert.equal(selfApproved.decision.userId,owner.id);assert.equal(selfApproved.status,'approved');
 const rejectedId=randomUUID(),rejectedFile=await upload(member.client,'service-requests',{requestId:rejectedId});
 const toReject=(await rpc(member.client,'service-requests','create',{...payload,requestId:rejectedId,attachmentIds:[rejectedFile.id],companyName:'Orçamento a recusar'})).request;
 await assert.rejects(rpc(owner.client,'service-requests','decide',{id:toReject.id,decision:'rejected',reason:''}),error=>error.code==='22023');
 const rejected=(await rpc(owner.client,'service-requests','decide',{id:toReject.id,decision:'rejected',reason:'Solicitar orçamento revisado'})).request;assert.equal(rejected.status,'rejected');
 assert.equal((await rpc(owner.client,'service-requests','list',{tab:'finished',page:1,pageSize:2})).total,decided.status==='rejected'?2:1);
 assert.equal((await rpc(owner.client,'service-requests','list',{tab:'in_progress',page:1,pageSize:2})).total,decided.status==='approved'?2:1);
 const manualPerson=(await rpc(member.client,'signatures','save',{name:'Solicitante sem PNG',role:'requester',userId:null})).signature;
 assert.equal(manualPerson.fileId,null);assert.equal(manualPerson.filePath,null);
 await assert.rejects(rpc(member.client,'service-requests','create',{...payload,requestId:randomUUID(),requesterSignatureId:manualPerson.id,requesterSigningMode:'registered',attachmentIds:[]}),error=>['22023','23514'].includes(error.code));
 const manualRequest=(await rpc(member.client,'service-requests','create',{...payload,requestId:randomUUID(),requesterSignatureId:manualPerson.id,requesterSigningMode:'manual',attachmentIds:[],companyName:'Serviço sem orçamento anexado'})).request;
 assert.deepEqual(manualRequest.attachments,[]);assert.equal(manualRequest.requester.signingMode,'manual');assert.equal(manualRequest.requester.signaturePath,null);assert.equal(manualRequest.requester.signatureHash,null);assert.match(manualRequest.documentHash,/^[a-f0-9]{64}$/i);
 const manualWithPng=(await rpc(member.client,'service-requests','create',{...payload,requestId:randomUUID(),requesterSigningMode:'manual',attachmentIds:[],companyName:'PNG dispensado nesta solicitação'})).request;
 assert.equal(manualWithPng.requester.signaturePath,null);assert.equal(manualWithPng.requester.signatureHash,null);
 const directorManual=(await rpc(owner.client,'signatures','save',{id:manager.id,name:'Diretor geral manual',userId:owner.id,role:'manager',fileId:null})).signature;
 assert.equal(directorManual.filePath,null);assert.equal(directorManual.userId,owner.id);
 const manualDecision=(await rpc(owner.client,'service-requests','decide',{id:manualRequest.id,decision:'approved',reason:'Conferido para assinatura impressa',managerSigningMode:'manual'})).request;
 assert.equal(manualDecision.status,'approved');assert.equal(manualDecision.decision.signaturePath,null);assert.equal(manualDecision.decision.signatureHash,null);assert.equal(manualDecision.documentHash,manualRequest.documentHash);assert.equal(manualDecision.decision.userId,owner.id);
 assert.equal((await rpc(owner.client,'service-requests','get',{id:created.id})).request.decision.signaturePath,manager.filePath,'Removing PNG from the registry must preserve prior signed documents');
 const directorRestored=await upload(owner.client,'signatures');
 await rpc(owner.client,'signatures','save',{id:manager.id,name:'Diretor geral de teste',userId:owner.id,role:'manager',fileId:directorRestored.id});
 console.log('PASS: optional PNG/budget, manual overrides, immutable hashes/templates, operator audit, uploads, RPC/RLS, filters, idempotency, decision permissions/concurrency, snapshots, refusal and independent Realtime.');
 }
 if(process.env.BILLING_BROWSER_CDP){
  // The template editor MUST run as the newly generated workspace owner, never
  // as an existing organization account. Verify ownership before opening it.
  assert.ok(users.includes(owner.id));
  const fixtureMemberships=await admin.from('billing_memberships').select('owner_id,user_id,is_owner').eq('user_id',owner.id);
  assert.ifError(fixtureMemberships.error);
  assert.equal(fixtureMemberships.data.length,1);
  assert.deepEqual(fixtureMemberships.data[0],{owner_id:owner.id,user_id:owner.id,is_owner:true});
  const {verifyDocumentTemplatesBrowser}=await import('./document-templates-browser.mjs');
  const templateResult=await verifyDocumentTemplatesBrowser({managerSession:owner.session,operatorSession:member.session,otherSession:other.session,projectRef:PROJECT_REF,cdpUrl:process.env.BILLING_BROWSER_CDP});
  const fixtureTemplate=await admin.from('billing_document_templates').select('owner_id,updated_by').eq('owner_id',owner.id).single();
  assert.ifError(fixtureTemplate.error);
  assert.deepEqual(fixtureTemplate.data,{owner_id:owner.id,updated_by:owner.id});
  const {verifyRequestsBrowser}=await import('./service-requests-browser.mjs');
  for(const [index,name] of ['Tornearia Navegador','Tornearia PNG dispensado','Tornearia assinatura cadastrada'].entries()){
   await rpc(owner.client,'service-providers','save',{documentType:'CPF',document:['52998224725','11144477735','12345678909'][index],legalName:name,tradeName:'',street:'',number:'',complement:'',district:'',city:'Japoatã',state:'SE',zipCode:'',phone:'',email:''});
  }
  const browserResult=await verifyRequestsBrowser({operatorSession:member.session,managerSession:owner.session,otherSession:other.session,operatorName:'Operador de teste',projectRef:PROJECT_REF,cdpUrl:process.env.BILLING_BROWSER_CDP,png});
  const browserRequest=(await rpc(owner.client,'service-requests','get',{id:browserResult.requestId})).request;
  assert.equal(browserRequest.requester.userId,null);assert.equal(browserRequest.requester.name,browserResult.requesterName);assert.equal(browserRequest.requester.signatureId,browserResult.requesterSignatureId);
  assert.deepEqual(browserRequest.createdBy,{userId:member.id,name:'Operador de teste'});assert.equal(browserRequest.decision.userId,owner.id);assert.equal(browserRequest.status,'approved');
  assert.deepEqual(browserRequest.attachments,[]);assert.equal(browserRequest.requester.signaturePath,null);assert.equal(browserRequest.requester.signatureHash,null);assert.equal(browserRequest.requester.signingMode,'manual');assert.equal(browserRequest.decision.signaturePath,null);assert.equal(browserRequest.decision.signatureHash,null);assert.equal(browserRequest.decision.signingMode,'manual');
  const browserPerson=(await rpc(owner.client,'signatures','list',{search:browserResult.requesterName})).items.find(person=>person.id===browserResult.requesterSignatureId);
  assert.equal(browserPerson?.userId,null,'Browser-created requester must have no associated login');
  assert.equal(browserPerson.filePath,null,'Browser-created requester needs only a name');
  const registeredRequest=(await rpc(owner.client,'service-requests','get',{id:browserResult.registeredRequestId})).request;
  assert.equal(registeredRequest.requester.signatureId,browserResult.registeredRequesterSignatureId);assert.equal(registeredRequest.requester.signingMode,'registered');assert.equal(registeredRequest.decision.signingMode,'registered');assert.equal(registeredRequest.attachments.length,1);assert.match(registeredRequest.requester.signatureHash,/^[a-f0-9]{64}$/i);assert.match(registeredRequest.decision.signatureHash,/^[a-f0-9]{64}$/i);
  assert.equal(registeredRequest.template.name,templateResult.name);assert.equal(registeredRequest.template.version,templateResult.version);
  assert.ok(registeredRequest.template.layout.blocks.some(block=>block.type==='text'&&block.text===templateResult.title));
  assert.ok(registeredRequest.template.layout.blocks.some(block=>block.type==='text'&&block.text===templateResult.addedText));
  const manualWithPng=(await rpc(owner.client,'service-requests','get',{id:browserResult.manualWithPngRequestId})).request;
  assert.equal(manualWithPng.requester.signatureId,browserResult.registeredRequesterSignatureId);assert.equal(manualWithPng.requester.signaturePath,null);assert.equal(manualWithPng.requester.signatureHash,null);assert.equal(manualWithPng.requester.signingMode,'manual');
 }
 }
}finally{
 if(channel)await channel.unsubscribe();
 for(const client of clients)await client.removeAllChannels();
 const failures=[];
 // The browser reserves/uploads files independently. Discover only fixtures
 // belonging to accounts created by this test before cascading their deletion.
 if(users.length){
  const discovered=await admin.from('billing_request_files').select('bucket,path').in('owner_id',users);
  if(discovered.error)throw Error(`Temporary file discovery failed; fixtures retained for cleanup in ${record}`);
  for(const file of discovered.data??[]){
   assert.ok(['billing-signatures','billing-request-files'].includes(file.bucket));
   assert.ok(users.some(id=>file.path.startsWith(id+'/')),'Cleanup path must belong to a temporary workspace');
   if(!files.some(existing=>existing.bucket===file.bucket&&existing.path===file.path))files.push(file);
  }
  writeFileSync(record,JSON.stringify({projectRef:PROJECT_REF,userIds:users,files}));
 }
 for(const bucket of [...new Set(files.map(file=>file.bucket))]){
  const removal=await admin.storage.from(bucket).remove([...new Set(files.filter(file=>file.bucket===bucket).map(file=>file.path))]);if(removal.error)failures.push('files:'+bucket);
 }
 if(failures.length)throw Error(`Temporary-file cleanup failed; accounts retained, see ${record}`);
 // Explicitly remove only models belonging to the UUIDs created in account()
 // above. Their owner_id FK would also cascade when these users are removed.
 if(users.length){
  const removedTemplates=await admin.from('billing_document_templates').delete().in('owner_id',users);
  assert.ifError(removedTemplates.error);
  const remainingTemplates=await admin.from('billing_document_templates').select('owner_id').in('owner_id',users);
  assert.ifError(remainingTemplates.error);assert.deepEqual(remainingTemplates.data,[]);
 }
 for(const id of [...users].reverse()){const removed=await admin.auth.admin.deleteUser(id);if(removed.error)failures.push(id);}
 if(failures.length)throw Error(`Temporary-data cleanup failed; see ${record}`);
 if(users.length)unlinkSync(record);
 console.log(`Cleanup: ${users.length} temporary accounts and ${files.length} uploaded files removed.`);
}
