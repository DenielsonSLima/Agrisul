// Opt-in integration/browser test. Credentials stay in memory; cleanup is
// restricted to identities created by this invocation and their Storage paths.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {jsPDF} from 'jspdf';

if(process.env.BILLING_RUN_LIVE_TESTS!=='1')throw Error('Set BILLING_RUN_LIVE_TESTS=1 to use isolated temporary accounts.');
const ref='ykounjabfsrtkzostbbz';assert.equal(readFileSync('supabase/.temp/project-ref','utf8').trim(),ref);
const {keys}=JSON.parse(execFileSync('.sites-runtime/tools/supabase.exe',['projects','api-keys','--project-ref',ref,'--reveal','--output-format','json'],{encoding:'utf8'}));
const publicKey=keys.find(k=>k.type==='publishable')?.api_key,secretKey=keys.find(k=>k.type==='secret')?.api_key;
assert.ok(publicKey&&secretKey);
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(`https://${ref}.supabase.co`,secretKey,options),accounts=[];
const output='.sites-runtime/documentation-validation';mkdirSync(output,{recursive:true});
const cleanupRecord=`${output}/identities-${randomUUID()}.json`;
const pdf=new jsPDF();pdf.text('Documento de teste temporario',20,20);const bytes=Buffer.from(pdf.output('arraybuffer'));
const pdfPath=resolve(output,'test-invoice.pdf');writeFileSync(pdfPath,bytes);
let ws,tab,send;
const rpc=async(client,resource,action,payload={})=>{const {data,error}=await client.rpc('billing_rpc',{p_resource:resource,p_action:action,p_payload:payload});if(error)throw Object.assign(Error(`${resource}/${action}: ${error.message}`),{code:error.code});return data;};
async function account(){
 const email=`billing-docs-${randomUUID()}@example.com`,password=`Aa9!${randomUUID()}`;
 const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(error);
 const client=createClient(`https://${ref}.supabase.co`,publicKey,options);const entry={id:data.user.id,client};accounts.push(entry);
 writeFileSync(cleanupRecord,JSON.stringify({projectRef:ref,userIds:accounts.map(a=>a.id)}));
 const signed=await client.auth.signInWithPassword({email,password});assert.ifError(signed.error);entry.session=signed.data.session;
 return entry;
}
async function upload(client,resource,action,payload){
 const {file}=await rpc(client,resource,action,{...payload,fileName:'nota-teste.pdf',contentType:'application/pdf',size:bytes.length});
 const {error}=await client.storage.from(file.bucket).upload(file.path,bytes,{contentType:'application/pdf',upsert:false});assert.ifError(error);return file;
}
try{
 const owner=await account(),other=await account();
 const details={tradeName:'',street:'',number:'',complement:'',district:'',city:'',state:'',zipCode:'',phone:'',email:''};
 const company=(await rpc(owner.client,'companies','save',{...details,cnpj:'',legalName:'Empresa documental temporária',isPrimary:true})).company;
 const provider=(await rpc(owner.client,'service-providers','save',{...details,documentType:'CNPJ',document:'11222333000181',legalName:'Oficina documental temporária'})).provider;
 const requester=(await rpc(owner.client,'signatures','save',{name:'Solicitante documental',role:'requester'})).signature;
 const requestId=randomUUID(),budget=await upload(owner.client,'service-requests','prepare-upload',{requestId});
 const service=(await rpc(owner.client,'service-requests','create',{requestId,requesterSignatureId:requester.id,providerId:provider.id,items:[{description:'Conserto documental',application:'Trator 10'}],notes:'',attachmentIds:[budget.id],serviceValue:null,returnDate:null})).request;
 const source={type:'service',id:service.id};
 await rpc(owner.client,'documentation','expectation',{source,kind:'budget',required:true,dueOn:'',notes:''});
 assert.equal((await rpc(owner.client,'documentation','list')).pending.length,0,'Original budget is reused without duplication');
 await rpc(owner.client,'documentation','expectation',{source,kind:'invoice',required:true,dueOn:'2026-10-01',notes:'Cobrar nota'});
 assert.equal((await rpc(owner.client,'documentation','list')).pending[0].reason,'missing');
 const id=randomUUID(),file=await upload(owner.client,'documentation','prepare-upload',{documentId:id});
 const input={id,expectedRevision:0,kind:'invoice',title:'Nota fiscal do conserto',documentNumber:'DOC-100',issuedOn:'2026-10-22',dueOn:'',amount:'150.25',providerId:'',companyId:company.id,parentId:'',notes:'Trator 10',sources:[source],fileIds:[file.id]};
 let document=(await rpc(owner.client,'documentation','save',input)).document;
 assert.equal(document.providerId,provider.id);assert.equal(document.files.length,1);
 assert.equal((await rpc(owner.client,'documentation','save',input)).document.id,id,'Retries are idempotent');
 assert.equal((await rpc(owner.client,'documentation','list',{search:'11.222.333/0001-81'})).total,1,'Formatted CNPJ is searchable');
 const signed=await owner.client.storage.from(file.bucket).createSignedUrl(file.path,60);assert.ifError(signed.error);assert.equal((await fetch(signed.data.signedUrl)).status,200);
 const denied=await other.client.storage.from(file.bucket).createSignedUrl(file.path,60);assert.ok(denied.error,'Another workspace cannot sign a private file');
 await assert.rejects(rpc(other.client,'documentation','get',{id}),e=>e.code==='P0002');
 assert.deepEqual((await other.client.from('billing_documents').select('id')).data,[]);
 assert.ok((await owner.client.from('billing_documents').update({title:'Forbidden'}).eq('id',id)).error,'Direct DML is denied');
 const anonymous=createClient(`https://${ref}.supabase.co`,publicKey,options);assert.ok((await anonymous.rpc('billing_rpc',{p_resource:'documentation',p_action:'list',p_payload:{}})).error);
 await rpc(owner.client,'documentation','review',{id,expectedRevision:1,status:'verified',note:'Dados conferidos',replacementId:''});
 assert.equal((await rpc(owner.client,'documentation','list')).pendingTotal,0,'Invoice works without a boleto');
 for(const number of [1,2]){
  const childId=randomUUID(),childFile=await upload(owner.client,'documentation','prepare-upload',{documentId:childId});
  await rpc(owner.client,'documentation','save',{...input,id:childId,kind:'boleto',title:`Boleto parcela ${number}`,documentNumber:`PARC-${number}`,providerId:provider.id,parentId:id,dueOn:`2026-11-${number===1?'10':'20'}`,amount:'75.12',fileIds:[childFile.id]});
 }
 assert.equal((await rpc(owner.client,'documentation','get',{id})).children.length,2,'Multiple boletos are linked to the invoice');
 const material=(await rpc(owner.client,'materials','save',{name:'Filtro documental',internalCode:'DOC-001',unit:'UN',application:'Trator'})).material;
 const quote=(await rpc(owner.client,'quotations','save',{title:'Compra documental',number:'DOC-001',requestDate:'2026-10-22',requesterSignatureId:requester.id,notes:'',items:[{id:randomUUID(),materialId:material.id,quantity:'2',notes:''}],providers:[{id:randomUUID(),providerId:provider.id,values:{},notes:'',sentAt:null}]})).quote;
 await rpc(owner.client,'quotations','record-negotiation',{id:quote.id,requestId:randomUUID(),quotationProviderId:quote.providers[0].id,quotationItemId:quote.items[0].id,unitPrice:'10',availableQuantity:'2',discountType:'none',discountValue:'0',notes:''});
 await rpc(owner.client,'quotations','award-item',{id:quote.id,quotationProviderId:quote.providers[0].id,quotationItemId:quote.items[0].id});
 const order=(await rpc(owner.client,'quotations','finalize',{id:quote.id})).purchaseOrders[0];
 assert.ok((await rpc(owner.client,'documentation','context',{type:'order',id:order.id})).source.label.includes(order.number));
 assert.equal((await rpc(owner.client,'documentation','sources')).sources.length,3);
 console.log('PASS live RPC and Storage: all source types, legacy budget reuse, invoice without boleto, multiple installments, exact retries, private downloads, direct DML denied and two-account isolation.');

 const cdp=process.env.BILLING_CDP_URL;
 if(cdp){
  const base=process.env.BILLING_BASE_URL||'http://127.0.0.1:5173';
  tab=await(await fetch(`${cdp}/json/new?about:blank`,{method:'PUT'})).json();ws=new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  const pending=new Map(),errors=[];let sequence=0;
  send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout ${method}`));},45000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);const job=pending.get(message.id);if(job){pending.delete(message.id);clearTimeout(job.timer);message.error?job.reject(Error(message.error.message)):job.resolve(message.result);}});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;};
  const wait=async(expression,label,ms=45000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,200));}throw Error(`Missing ${label}: ${await evaluate('document.body.innerText.slice(-2300)')} ${errors.join('\n')}`);};
  const clickText=async text=>assert.ok(await evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(text)});if(!button)return false;button.click();return true;})()`),text);
  const setLabel=async(label,value)=>assert.ok(await evaluate(`(()=>{const label=[...document.querySelectorAll('.documentation-form-dialog label')].find(e=>e.textContent.startsWith(${JSON.stringify(label)}));const input=label?.querySelector('input,select,textarea');if(!input)return false;Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`),label);
  const shot=async name=>{const result=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(`${output}/${name}.png`,Buffer.from(result.data,'base64'));};
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(base)}){localStorage.clear();localStorage.setItem('sb-${ref}-auth-token',${JSON.stringify(JSON.stringify(owner.session))});localStorage.setItem('billing:${owner.id}:active-company',${JSON.stringify(company.id)});}`});
  await send('Page.navigate',{url:`${base}/documentacao`});
  await wait("document.querySelector('.documentation-table') && document.body.innerText.includes('Nota fiscal do conserto')",'documentation list');await shot('01-list');
  await clickText('Adicionar documento');await wait("!!document.querySelector('.documentation-form-dialog input[type=file]')",'document form');
  await setLabel('Título','Arquivo enviado pelo navegador');await setLabel('Empresa destinatária',company.id);
  await wait("document.querySelectorAll('.documentation-source-option').length>0",'source options');
  assert.ok(await evaluate(`(()=>{const button=[...document.querySelectorAll('.documentation-source-option')].find(button=>button.textContent.includes('Serviço nº ${service.number}'));if(!button)return false;button.click();return true;})()`));
  const root=await send('DOM.getDocument');const fileNode=await send('DOM.querySelector',{nodeId:root.root.nodeId,selector:'.documentation-form-dialog input[type=file]'});
  await send('DOM.setFileInputFiles',{nodeId:fileNode.nodeId,files:[pdfPath]});await wait("document.querySelector('.documentation-staged-files')?.textContent.includes('test-invoice.pdf')",'selected file');await shot('02-upload-form');
  await clickText('Cadastrar documento');await wait("!document.querySelector('.documentation-form-dialog') && document.querySelector('.documentation-detail h2')?.textContent==='Arquivo enviado pelo navegador'",'uploaded document detail');
  const browserId=await evaluate("new URLSearchParams(location.search).get('documento')");assert.ok(browserId);
  const saved=(await rpc(owner.client,'documentation','get',{id:browserId})).document;assert.equal(saved.sources[0].id,service.id);assert.equal(saved.files.length,1);
  await clickText('Visualizar');await wait("!!document.querySelector('.documentation-preview iframe')",'PDF preview');assert.equal((await fetch(await evaluate("document.querySelector('.documentation-preview iframe').src"))).status,200);await shot('03-private-preview');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});await wait("!document.querySelector('.documentation-preview-dialog')",'preview closed');
  await clickText('Conferir documento');await wait("!!document.querySelector('.documentation-review-dialog')",'review dialog');await clickText('Registrar conferência');await wait("!document.querySelector('.documentation-review-dialog') && !!document.querySelector('.documentation-heading .is-verified')",'verified document');
  document=(await rpc(owner.client,'documentation','get',{id:browserId})).document;
  await rpc(owner.client,'documentation','review',{id:browserId,expectedRevision:document.revision,status:'divergent',note:'Conferência independente em outra conexão',replacementId:''});
  await wait("!!document.querySelector('.documentation-heading .is-divergent')",'Realtime review update',15000);await shot('04-detail');
  for(const [url,heading] of [[`/solicitacoes?secao=servico&solicitacao=${service.id}`,'Solicitação de serviço'],[`/pedidos?pedido=${order.id}`,'Pedido'],[`/cotacao?cotacao=${quote.id}`,'Resumo']]){
   await send('Page.navigate',{url:base+url});await wait("[...document.querySelectorAll('[role=tab]')].some(e=>e.textContent==='Documentação')",`documentation tab ${heading}`);
   const point=await evaluate("(()=>{const tab=[...document.querySelectorAll('[role=tab]')].find(e=>e.textContent==='Documentação');tab.scrollIntoView({block:'center'});const r=tab.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()");
   await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
   await wait("!!document.querySelector('.documentation-context-heading')",`linked documentation ${heading}`);
  }
  await send('Page.navigate',{url:`${base}/documentacao?aba=pendencias`});await wait("!!document.querySelector('.documentation-pending-list')",'pending documents');await shot('05-pending');
  for(const width of [390,768,1024]){
   await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});
   await new Promise(resolve=>setTimeout(resolve,200));assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),`No page overflow at ${width}`);if(width===390)await shot('06-mobile');
  }
  assert.deepEqual(errors,[],'No browser JavaScript exceptions');
  console.log('PASS browser: real PDF upload with service link, private preview/download, review, independent Realtime update, service/order/quotation tabs, pending list and responsive layouts.');
 }
}catch(error){console.error('LIVE FAILURE:',error.message);throw error;
}finally{
 if(send){try{await send('Page.navigate',{url:'about:blank'});}catch{}}
 if(ws)ws.close();if(tab&&process.env.BILLING_CDP_URL)await fetch(`${process.env.BILLING_CDP_URL}/json/close/${tab.id}`).catch(()=>{});
 const failed=[];
 for(const account of accounts){
  for(const [table,bucket,column] of [['billing_document_files','billing-documentation','path'],['billing_request_files','billing-request-files','path']]){
   const {data,error}=await admin.from(table).select(column).eq('owner_id',account.id);assert.ifError(error);
   const paths=(data??[]).map(row=>row[column]);assert.ok(paths.every(path=>path.startsWith(account.id+'/')),'Cleanup paths must belong to a temporary identity');
   if(paths.length){const result=await admin.storage.from(bucket).remove(paths);assert.ifError(result.error);}
  }
  await account.client.auth.signOut({scope:'global'});const {error}=await admin.auth.admin.deleteUser(account.id);if(error){console.error('Temporary identity cleanup:',account.id,error.message);failed.push(account.id);}
 }
 writeFileSync(cleanupRecord,JSON.stringify({projectRef:ref,userIds:failed,cleanupComplete:!failed.length}));assert.deepEqual(failed,[],'All temporary users must be removed');
 console.log('Removed only the temporary identities, their records and their uploaded test files.');
}
