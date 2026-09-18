import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {mkdirSync,writeFileSync,readdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fixturePng,fixturePortraitPng} from './document-watermark-live.mjs';
import {captureRequestPdfPages,readRequestPreviewPdf} from './request-pdf-browser.mjs';

export async function verifyDocumentHeader({owner,member,other,company,profile,rpc,projectRef,trackFile,cdpUrl}){
 assert.equal(projectRef,'rbuscpwntzpyqsuycqmv');assert.ok(cdpUrl);
 await rpc(owner.client,'access-profiles','save',{id:profile.id,name:profile.name,description:'Request-only reader',permissions:['requests.read','requests.write','signatures.manage']});
 const logoPath=`${owner.id}/companies/${randomUUID()}.png`,watermarkPath=`${owner.id}/portrait/${randomUUID()}.png`;
 for(const [bucket,path] of [['billing-company-logos',logoPath],['billing-watermarks',watermarkPath]]){
  trackFile({bucket,path});assert.ifError((await owner.client.storage.from(bucket).upload(path,bucket==='billing-watermarks'?fixturePortraitPng():fixturePng(),{contentType:'image/png'})).error);
 }
 const selected=(await rpc(owner.client,'companies','save',{legalName:'EMPRESA PADRAO DO RELATORIO',tradeName:'',cnpj:'04773159000523',street:'Rua do teste',number:'45',complement:'',district:'Zona rural',city:'Japoatã',state:'SE',zipCode:'49950000',phone:'7932261234',email:'fixture@example.invalid',isPrimary:false,logoKey:logoPath,logoName:'Logo temporaria.png'})).company;
 let settings={orientation:'landscape',defaultCompanyId:selected.id,portrait:{variant:'detailed',logoAlignment:'left',showCnpj:true,showContact:true},landscape:{variant:'compact',logoAlignment:'right',showCnpj:false,showContact:false}};
 await rpc(owner.client,'report-headers','save',settings);
 await rpc(owner.client,'watermarks','save',{orientation:'landscape',opacity:100,size:100,portraitImageKey:watermarkPath,portraitImageName:'Marca temporaria.png',landscapeImageKey:null,landscapeImageName:''});
 const brand=await rpc(member.client,'service-requests','document-brand');assert.equal(brand.company.id,selected.id);assert.deepEqual(brand.header,settings.portrait);
 await assert.rejects(rpc(member.client,'report-headers','save',settings),error=>error.code==='42501');
 await assert.rejects(rpc(member.client,'companies','list'),error=>error.code==='42501');
 assert.deepEqual((await member.client.from('billing_companies').select('id')).data,[{id:selected.id}]);
 const signed=await member.client.storage.from('billing-company-logos').createSignedUrl(logoPath,60);assert.ifError(signed.error);assert.equal((await fetch(signed.data.signedUrl)).status,200);
 assert.ok((await other.client.storage.from('billing-company-logos').download(logoPath)).error);
 assert.equal((await rpc(other.client,'service-requests','document-brand')).company,null);
 const person=(await rpc(member.client,'signatures','save',{name:'Solicitante teste cabeçalho',role:'requester',userId:null})).signature;
 await rpc(owner.client,'signatures','save',{name:'Diretor teste cabeçalho',role:'manager',userId:owner.id});
 const shortRequest=(await rpc(member.client,'service-requests','create',{requestId:randomUUID(),requesterSignatureId:person.id,requesterSigningMode:'manual',companyName:'OFICINA DE MANUTENCAO E SERVICOS AGRICOLAS LTDA',companyAddress:'Rua Pernambuco, 678 · Loja A · Siqueira Campos · Aracaju / SE · 49075460',items:[{description:'Confeccionar 2 mangueiras hidráulicas de pressão do comando.',application:'Carregadeira Valtra BM100 nº 220/221'}],serviceValue:null,returnDate:null,notes:'',attachmentIds:[]})).request;
 const request=(await rpc(member.client,'service-requests','create',{requestId:randomUUID(),requesterSignatureId:person.id,requesterSigningMode:'manual',companyName:'Oficina teste cabeçalho',companyAddress:'Rua do prestador',items:Array.from({length:14},(_,i)=>({description:`Servico ${i+1}: `+'Descricao do material e trabalho a executar. '.repeat(4),application:`Equipamento ${i+1}`})),serviceValue:null,returnDate:null,notes:'Sem valor ou prazo inicial.',attachmentIds:[]})).request;
 await rpc(owner.client,'service-requests','decide',{id:request.id,decision:'approved',reason:'',managerSigningMode:'manual'});
 const snapshot=JSON.stringify(request.template);
 const output=resolve('.sites-runtime/header-validation',randomUUID());mkdirSync(output,{recursive:true});
 const tab=await(await fetch(`${cdpUrl}/json/new?about:blank`,{method:'PUT'})).json(),socket=new WebSocket(tab.webSocketDebuggerUrl),pending=new Map();let seq=0;
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(pending.has(message.id)){const job=pending.get(message.id);pending.delete(message.id);clearTimeout(job.timer);if(message.error)job.reject(Error(message.error.message));else job.resolve(message.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},45000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const value=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(value.exceptionDetails)throw Error(value.exceptionDetails.exception?.description??value.exceptionDetails.text);return value.result.value;};
 const wait=async(expression,label)=>{const deadline=Date.now()+45000;while(Date.now()<deadline){if(await evaluate(`!!document.body&&!!(${expression})`))return;await new Promise(r=>setTimeout(r,200));}throw Error('Missing '+label+': '+await evaluate('document.body.innerText.slice(-1800)'));};
 const click=label=>evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Button missing: '+${JSON.stringify(label)});b.click()})()`);
 let script;
 const visit=async(session,path)=>{if(script)await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:script});script=(await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('sb-${projectRef}-auth-token',${JSON.stringify(JSON.stringify(session))});`})).identifier;await send('Page.navigate',{url:'http://localhost:5173'+path});};
 const screenshot=async name=>writeFileSync(resolve(output,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 const header=async(parent,showContact=true)=>{
  await wait(`(()=>{const h=document.querySelector(${JSON.stringify(parent+' .report-document-header')}),i=h?.querySelector('img');return h?.textContent.includes('EMPRESA PADRAO DO RELATORIO')&&i?.complete&&i.naturalWidth>0})()`,'company header and private logo');
  const content=await evaluate(`document.querySelector(${JSON.stringify(parent+' .report-document-header')}).innerText`);
  assert.match(content,/04\.773\.159\/0005-23/);assert.match(content,/Solicitação de serviço/);
  if(showContact){assert.match(content,/Rua do teste/);assert.match(content,/Japoatã/);}else {assert.ok(!content.includes('Rua do teste'));assert.ok(!content.includes('fixture@example.invalid'));}
 };
 try{
  await send('Page.enable');await send('Emulation.setFocusEmulationEnabled',{enabled:true});await send('Emulation.setDeviceMetricsOverride',{width:1500,height:1100,deviceScaleFactor:1,mobile:false});await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:output});
  await visit(owner.session,'/cadastro?secao=modelos-documentos&modelo=service-request');await header('.document-layout-page');
  const geometry=await evaluate(`(()=>{const p=document.querySelector('.document-layout-page'),h=p.querySelector('.report-document-header').getBoundingClientRect();return [...p.querySelectorAll('[data-document-block]')].map(b=>({top:b.getBoundingClientRect().top,headerBottom:h.bottom}))})()`);
  assert.ok(geometry.length>0&&geometry.every(b=>b.top>=b.headerBottom),'Body does not overlap header');
  await screenshot('editor-cabecalho-padrao');
  await visit(member.session,`/solicitacoes?secao=servico&solicitacao=${shortRequest.id}`);await wait("document.querySelector('.request-detail')",'pending request detail');
  assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),true,'Desktop has no horizontal overflow');await screenshot('detalhe-desktop');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),true,'Mobile detail has no horizontal overflow');await screenshot('detalhe-mobile');
  await send('Emulation.setDeviceMetricsOverride',{width:1500,height:1100,deviceScaleFactor:1,mobile:false});
  await click('Pr\u00e9via do documento');const shortPdf=await readRequestPreviewPdf(evaluate,wait);assert.equal(shortPdf.pages,1,'Short manual request remains a single page');
  const shortFile=resolve(output,'solicitacao-curta.pdf');writeFileSync(shortFile,shortPdf.bytes);await new Promise(resolve=>setTimeout(resolve,2200));await screenshot('previa-pdf-real');
  const initialPreview=await evaluate("document.querySelector('.request-preview-modal iframe').src");
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await new Promise(resolve=>setTimeout(resolve,600));await screenshot('previa-mobile');
  const mobileModal=await evaluate("(()=>{const e=document.querySelector('.request-preview-modal'),r=e.getBoundingClientRect(),s=getComputedStyle(e);return {left:r.left,right:r.right,width:r.width,viewport:innerWidth,cssWidth:s.width,transform:s.transform,translate:s.translate}})()");
  assert.ok(mobileModal.left>=0&&mobileModal.right<=mobileModal.viewport+1,'PDF modal fits mobile viewport: '+JSON.stringify(mobileModal));
  assert.equal(await evaluate("document.querySelector('.request-preview-modal iframe').src"),initialPreview,'Resizing preserves the loaded PDF');await screenshot('previa-mobile');
  await send('Emulation.setDeviceMetricsOverride',{width:1500,height:1100,deviceScaleFactor:1,mobile:false});
  await captureRequestPdfPages({cdpUrl,filename:shortFile,output,prefix:'solicitacao-curta',pages:[1]});
  await evaluate("document.querySelector('.request-preview-modal [data-slot=dialog-close]').click()");
  await wait("document.activeElement?.textContent.includes('Prévia do documento')",'focus returns to the preview action');
  await visit(member.session,`/solicitacoes?secao=servico&solicitacao=${request.id}`);await wait("document.querySelector('.request-detail')",'approved request detail');
  await click('Prévia do documento');const beforePdf=await readRequestPreviewPdf(evaluate,wait);assert.ok(beforePdf.text.includes('EMPRESA PADRAO DO RELATORIO'));assert.ok(beforePdf.text.includes('fixture@example.invalid'));const oldPreviewUrl=await evaluate("document.querySelector('.request-preview-modal iframe').src");await screenshot('previa-cabecalho-padrao');
  settings={...settings,portrait:{...settings.portrait,logoAlignment:'right',showContact:false}};await rpc(owner.client,'report-headers','save',settings);
  await wait(`document.querySelector('.request-preview-modal iframe')?.src!==${JSON.stringify(oldPreviewUrl)}&&document.querySelector('.request-preview-modal iframe')?.src.startsWith('blob:')`,'header configuration update through Realtime');const afterPdf=await readRequestPreviewPdf(evaluate,wait);assert.ok(!afterPdf.text.includes('fixture@example.invalid'));
  await screenshot('previa-atualizada-em-tempo-real');
  await evaluate("document.querySelector('.request-preview-modal [data-slot=dialog-close]').click()");await click('Exportar PDF');
  const deadline=Date.now()+45000;let filename;
  while(Date.now()<deadline){filename=readdirSync(output).find(name=>name===`solicitacao-servico-${request.number}.pdf`);if(filename)break;await new Promise(r=>setTimeout(r,250));}
  assert.ok(filename,'PDF download completed');
  const bytes=readFileSync(resolve(output,filename)),source=bytes.toString('latin1');let headers=0,images=0;const streams=[];
  for(const match of source.matchAll(/\bstream\r?\n/g)){
   const start=match.index+match[0].length,end=source.indexOf('\nendstream',start);if(end<0)continue;const dictionary=source.slice(source.lastIndexOf('<<',match.index),match.index);if(dictionary.includes('/Subtype /Image'))continue;let data=bytes.subarray(start,end);try{if(dictionary.includes('/FlateDecode'))data=inflateSync(data);}catch{continue;}const content=data.toString('latin1');streams.push(content);headers+=(content.match(/\(EMPRESA PADRAO DO RELATORIO\)/g)||[]).length;if((content.match(/\/I\d+ Do/g)||[]).length>=2)images++;
  }
  const pages=(source.match(/\/Type \/Page\b/g)||[]).length;assert.ok(pages>=3,'Overflow and audit pages generated');assert.equal(headers,pages,'Every PDF page has configured header');assert.equal(images,pages,'Every PDF page has private logo and watermark');assert.ok(streams.join('').includes('Servico 14'),'Last item preserved');assert.ok(!streams.join('').includes('fixture@example.invalid'),'Contact visibility follows portrait setting');
  await captureRequestPdfPages({cdpUrl,filename:resolve(output,filename),output,prefix:'solicitacao-longa',pages:[1,2,pages]});
  const after=(await rpc(member.client,'service-requests','get',{id:request.id})).request;assert.equal(after.documentHash,request.documentHash);assert.equal(JSON.stringify(after.template),snapshot);
  await rpc(owner.client,'report-headers','save',{...settings,defaultCompanyId:null});
  await visit(owner.session,'/cadastro?secao=modelos-documentos&modelo=service-request');await wait(`document.querySelector('.document-layout-page .report-company-copy')?.textContent.includes(${JSON.stringify(company.name)})`,'default primary company after clearing override');
  await visit(other.session,'/cadastro?secao=modelos-documentos&modelo=service-request');await wait("document.querySelector('.document-layout-page')",'other workspace editor');assert.equal(await evaluate("document.querySelector('.document-layout-page').textContent.includes('EMPRESA PADRAO DO RELATORIO')"),false);
  const {verifyDocumentTemplatesBrowser}=await import('./document-templates-browser.mjs');
  await verifyDocumentTemplatesBrowser({managerSession:owner.session,operatorSession:member.session,otherSession:other.session,projectRef,cdpUrl});
  console.log('PASS: configured portrait header/logo, editor geometry, request-only operator, Realtime preferences/default company, multipage PDF with watermark, immutable snapshots and workspace isolation.');console.log('Visual evidence:',output);
 }finally{try{await send('Page.close');}finally{socket.close();for(const job of pending.values())clearTimeout(job.timer);}}
}
