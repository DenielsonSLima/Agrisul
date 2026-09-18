import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {crc32,deflateSync,inflateSync} from 'node:zlib';
import {mkdirSync,writeFileSync,readdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {readRequestPreviewPdf} from './request-pdf-browser.mjs';

// A synthetic green frame makes watermark visibility verifiable without any
// production identity, image or personal file in this test.
export function fixturePng(){
 const chunk=(name,data)=>{const type=Buffer.from(name),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([length,type,data,checksum]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(64);header.writeUInt32BE(32,4);header[8]=8;header[9]=6;
 const pixels=Buffer.alloc((64*4+1)*32);
 for(let y=0;y<32;y++)for(let x=0;x<64;x++){const i=y*(64*4+1)+1+x*4;pixels[i]=20;pixels[i+1]=105;pixels[i+2]=55;pixels[i+3]=(x<6||x>57||y<6||y>25)?255:0;}
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}

// A full A4 artwork reproduces the edge stripe from the configured stationery.
export function fixturePortraitPng(){
 const chunk=(name,data)=>{const type=Buffer.from(name),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([length,type,data,checksum]);};
 const width=420,height=594,header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const pixels=Buffer.alloc((width*4+1)*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*(width*4+1)+1+x*4;pixels[i]=0;pixels[i+1]=101;pixels[i+2]=50;pixels[i+3]=x<10?255:(y>255&&y<345&&x>80&&x<355?18:0);}
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}

export async function verifyDocumentWatermark({owner,member,other,rpc,projectRef,trackFile,cdpUrl}){
 assert.equal(projectRef,'rbuscpwntzpyqsuycqmv');
 const path=`${owner.id}/portrait/${randomUUID()}.png`,bucket='billing-watermarks';
 trackFile({bucket,path});
 assert.ifError((await owner.client.storage.from(bucket).upload(path,fixturePng(),{contentType:'image/png'})).error);
 let settings={orientation:'landscape',opacity:28,size:71,portraitImageKey:path,portraitImageName:'Marca temporária.png',landscapeImageKey:null,landscapeImageName:''};
 await rpc(owner.client,'watermarks','save',settings);
 const read=(await rpc(member.client,'watermarks','get')).settings;
 assert.equal(read.portraitImageKey,path);assert.equal(read.opacity,28);assert.equal(read.size,71);
 await assert.rejects(rpc(member.client,'watermarks','save',settings),error=>error.code==='42501');
 const signed=await member.client.storage.from(bucket).createSignedUrl(path,60);assert.ifError(signed.error);assert.equal((await fetch(signed.data.signedUrl)).status,200);
 assert.ok((await other.client.storage.from(bucket).download(path)).error);
 assert.equal((await rpc(other.client,'watermarks','get')).settings.portraitImageKey,null);
 const person=(await rpc(member.client,'signatures','save',{name:'Solicitante teste visual',role:'requester',userId:null})).signature;
 await rpc(owner.client,'signatures','save',{name:'Diretor teste visual',role:'manager',userId:owner.id});
 const request=(await rpc(member.client,'service-requests','create',{requestId:randomUUID(),requesterSignatureId:person.id,requesterSigningMode:'manual',companyName:'Oficina teste marca',companyAddress:'Endereço de teste',items:[{description:'Serviço de teste',application:'Equipamento de teste'}],serviceValue:'100.00',returnDate:null,notes:'Documento com marca d’água configurada.',attachmentIds:[]})).request;
 await rpc(owner.client,'service-requests','decide',{id:request.id,decision:'approved',reason:'',managerSigningMode:'manual'});
 if(!cdpUrl)throw Error('BILLING_BROWSER_CDP is required for watermark visual verification');
 const output=resolve('.sites-runtime/watermark-validation',randomUUID());mkdirSync(output,{recursive:true});
 const tab=await(await fetch(`${cdpUrl}/json/new?about:blank`,{method:'PUT'})).json(),socket=new WebSocket(tab.webSocketDebuggerUrl),pending=new Map();let seq=0;
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(pending.has(message.id)){const job=pending.get(message.id);pending.delete(message.id);clearTimeout(job.timer);if(message.error)job.reject(Error(message.error.message));else job.resolve(message.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},45000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const value=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(value.exceptionDetails)throw Error(value.exceptionDetails.exception?.description??value.exceptionDetails.text);return value.result.value;};
 const wait=async(expression,label)=>{const deadline=Date.now()+45000;while(Date.now()<deadline){if(await evaluate(`!!document.body&&!!(${expression})`))return;await new Promise(r=>setTimeout(r,200));}throw Error('Missing '+label+': '+await evaluate('document.body.innerText.slice(-1800)'));};
 const click=label=>evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!button)throw Error('Button missing');button.click()})()`);
 let script;
 const visit=async(session,path)=>{if(script)await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:script});script=(await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('sb-${projectRef}-auth-token',${JSON.stringify(JSON.stringify(session))});`})).identifier;await send('Page.navigate',{url:'http://localhost:5173'+path});};
 const checkImage=async(selector,opacity)=>{
  await wait(`(()=>{const e=document.querySelector(${JSON.stringify(selector+' img')});return e&&e.complete&&e.naturalWidth>0})()`,'loaded private watermark');
  const style=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(e);return {opacity:s.opacity,width:e.style.width,height:e.style.height,zIndex:s.zIndex,pointerEvents:s.pointerEvents,fit:getComputedStyle(e.querySelector('img')).objectFit}})()`);
  assert.deepEqual(style,{opacity:String(opacity),width:'71%',height:'71%',zIndex:'-1',pointerEvents:'none',fit:'contain'});
 };
 const screenshot=async name=>writeFileSync(resolve(output,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 try{
  await send('Page.enable');await send('Page.bringToFront');await send('Emulation.setFocusEmulationEnabled',{enabled:true});await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:output});
  await visit(owner.session,'/cadastro?secao=modelos-documentos&modelo=service-request');
  await checkImage('.document-layout-page>.report-document-watermark',.28);await screenshot('editor-marca-configurada');
  // An operator with requests.read and no watermark permission sees the same identity.
  await visit(member.session,`/solicitacoes?secao=servico&solicitacao=${request.id}`);
  await wait("document.querySelector('.request-detail')",'request detail');
  await click('Prévia do documento');const preview=await readRequestPreviewPdf(evaluate,wait);assert.match(preview.source,/\/ca 0\.28/);await screenshot('previa-marca-configurada');const previousUrl=await evaluate("document.querySelector('.request-preview-modal iframe').src");
  settings={...settings,opacity:42};await rpc(owner.client,'watermarks','save',settings);
  await wait(`document.querySelector('.request-preview-modal iframe')?.src!==${JSON.stringify(previousUrl)}&&document.querySelector('.request-preview-modal iframe')?.src.startsWith('blob:')`,'Realtime watermark update without reopening preview');assert.match((await readRequestPreviewPdf(evaluate,wait)).source,/\/ca 0\.42/);
  await evaluate("document.querySelector('.request-preview-modal [data-slot=dialog-close]').click()");
  await click('Exportar PDF');
  const deadline=Date.now()+45000;let pdf;
  while(Date.now()<deadline){pdf=readdirSync(output).find(name=>name.endsWith('.pdf'));if(pdf)break;await new Promise(r=>setTimeout(r,250));}
  assert.ok(pdf,'PDF download completed');
  const bytes=readFileSync(resolve(output,pdf)),source=bytes.toString('latin1');let painted=0;
  for(const match of source.matchAll(/\bstream\r?\n/g)){const start=match.index+match[0].length,end=source.indexOf('\nendstream',start);if(end<0)continue;const header=source.slice(source.lastIndexOf('<<',match.index),match.index);if(header.includes('/Subtype /Image'))continue;let stream=bytes.subarray(start,end);try{if(header.includes('/FlateDecode'))stream=inflateSync(stream);}catch{continue;}if(/\/I\d+ Do/.test(stream.toString('latin1')))painted++;}
  const pages=(source.match(/\/Type \/Page\b/g)||[]).length;
  assert.ok(pages>=2,'Approved document has an audit page');assert.equal(painted,pages,'Every form and audit page contains watermark');assert.match(source,/\/ca 0\.42/);
  await rpc(owner.client,'watermarks','save',{...settings,portraitImageKey:null,portraitImageName:''});
  await visit(owner.session,'/cadastro?secao=modelos-documentos&modelo=service-request');await wait("document.querySelector('.document-layout-page')&&!document.querySelector('.document-layout-page>.report-document-watermark')",'removed watermark invalidates editor');
  await visit(other.session,'/cadastro?secao=modelos-documentos&modelo=service-request');await wait("document.querySelector('.document-layout-page')",'other account template');assert.equal(await evaluate("!!document.querySelector('.report-document-watermark')"),false);
  console.log('PASS: configured portrait image, preview/editor geometry, operator read-only access, Realtime update/removal, all PDF/audit pages and workspace isolation.');
  console.log('Visual evidence:',output);
 }finally{try{await send('Page.close');}finally{socket.close();for(const job of pending.values())clearTimeout(job.timer);}}
}
