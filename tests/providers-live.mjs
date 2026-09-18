import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {resolve} from 'node:path';

export async function verifyProviders({owner,member,other,rpc,projectRef,cdpUrl}){
 assert.equal(projectRef,'rbuscpwntzpyqsuycqmv');assert.ok(cdpUrl);
 const initial={documentType:'CPF',document:'52998224725',legalName:'Prestador CPF de teste',tradeName:'',street:'Rua do prestador',number:'10',complement:'',district:'Centro',city:'Japoata',state:'SE',zipCode:'49950000',phone:'79999999999',email:'prestador@example.invalid'};
 assert.equal((await rpc(member.client,'service-providers','list')).canManage,false);
 await assert.rejects(rpc(member.client,'service-providers','save',initial),error=>error.code==='42501');
 const person=(await rpc(owner.client,'signatures','save',{name:'Solicitante teste prestador',role:'requester'})).signature;
 const output=resolve('.sites-runtime/providers-validation',randomUUID());mkdirSync(output,{recursive:true});
 const tab=await(await fetch(`${cdpUrl}/json/new?about:blank`,{method:'PUT'})).json(),ws=new WebSocket(tab.webSocketDebuggerUrl),pending=new Map(),errors=[];let seq=0,lookupCount=0;
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},method==='Page.navigate'?45000:20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const lookup={cnpj:'04773159000523',legalName:'Oficina CNPJ de teste',tradeName:'Mecânica Primavera',street:'Avenida da oficina',number:'20',complement:'Galpao',district:'Centro',city:'Japoata',state:'SE',zipCode:'49950000',phone:'79999999999',email:'oficina@example.invalid'};
 ws.addEventListener('message',event=>{
  const message=JSON.parse(event.data);
  if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);
  if(message.method==='Fetch.requestPaused'){
   lookupCount++;
   assert.ok(message.params.request.headers.Authorization||message.params.request.headers.authorization,'CNPJ lookup carries the authenticated session');
   void send('Fetch.fulfillRequest',{requestId:message.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({details:lookup})).toString('base64')});
  }
  if(pending.has(message.id)){const job=pending.get(message.id);pending.delete(message.id);clearTimeout(job.timer);if(message.error)job.reject(Error(message.error.message));else job.resolve(message.result);}
 });
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;};
 const wait=async(expression,label)=>{const deadline=Date.now()+45000;while(Date.now()<deadline){if(await evaluate(`!!document.body&&!!(${expression})`))return;await new Promise(r=>setTimeout(r,200));}throw Error('Missing '+label+': '+await evaluate('document.body.innerText.slice(-2200)')+'\n'+errors.join('\n'));};
 const click=(label,scope='document')=>evaluate(`(()=>{const e=[...${scope}.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled);if(!e)throw Error('Button missing: '+${JSON.stringify(label)});e.click()})()`);
 const input=(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing input '+${JSON.stringify(selector)});const combo=e.getAttribute('role')==='combobox';if(combo)e.focus();Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(combo?new InputEvent('input',{bubbles:true,inputType:'insertText',data:${JSON.stringify(value)}}):new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
 let script;
 const visit=async(session,path)=>{if(script)await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:script});script=(await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('sb-${projectRef}-auth-token',${JSON.stringify(JSON.stringify(session))});`})).identifier;await send('Page.navigate',{url:'http://localhost:5173'+path});await wait("document.querySelector('.app-main')",'application');};
 const openProvider=async()=>{await click('Novo prestador');await wait("document.querySelector('.provider-form')",'provider modal');};
 const fillCpf=async(document,name)=>{await evaluate("document.querySelector('.provider-form input[value=CPF]').click()");await input('.provider-form input[name=document]',document);await input('.provider-form input[name=legalName]',name);};
 const saveProvider=async()=>{await click('Cadastrar prestador',"document.querySelector('.provider-form')");await wait("!document.querySelector('.provider-form')",'saved provider');};
 const shot=async(name)=>writeFileSync(resolve(output,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 const providerInputSelector='.request-provider-combobox input';
 const pointerClick=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');const box=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error('Click target is covered');return {x,y}})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',...box,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...box,button:'left',clickCount:1});};
 const selectProvider=async id=>{await pointerClick(providerInputSelector);await wait(`document.querySelector('[data-provider-id="${id}"]')`,'provider option');await pointerClick(`[data-provider-id="${id}"]`);};
 const key=async key=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:{ArrowDown:40,Enter:13,Escape:27}[key]});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:{ArrowDown:40,Enter:13,Escape:27}[key]});};
 try{
  await send('Page.enable');await send('Runtime.enable');await send('Page.bringToFront');await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:output});
  await send('Fetch.enable',{patterns:[{urlPattern:'*/api/clients/lookup*',requestStage:'Request'}]});
  let cpf;
  if(process.env.BILLING_PROVIDER_SELECTION_ONLY==='1'){
   cpf=(await rpc(owner.client,'service-providers','save',{...initial,legalName:'Prestador CPF atualizado'})).provider;
   const {cnpj,...details}=lookup;await rpc(owner.client,'service-providers','save',{...details,documentType:'CNPJ',document:cnpj});
  }else{
  await visit(owner.session,'/cadastro?secao=prestadores');await wait("document.body.innerText.includes('Nenhum prestador cadastrado')",'provider empty state');
  await openProvider();await fillCpf('123','Prestador CPF de teste');await click('Cadastrar prestador',"document.querySelector('.provider-form')");await wait("document.querySelector('.provider-form .form-error')?.textContent.includes('CPF')",'server CPF validation');
  await input('.provider-form input[name=document]','529.982.247-25');
  for(const key of ['street','number','district','city','state','zipCode','phone','email'])await input(`.provider-form input[name=${key}]`,initial[key]);
  await shot('prestador-cpf-modal');await saveProvider();
  let providers=(await rpc(owner.client,'service-providers','list')).providers;assert.equal(providers.length,1);cpf=providers[0];assert.equal(cpf.document,'52998224725');assert.equal(cpf.state,'SE');
  await click('Editar cadastro');await wait("document.querySelector('.provider-form')",'provider edit');await input('.provider-form input[name=legalName]','Prestador CPF atualizado');await click('Salvar alterações');await wait("!document.querySelector('.provider-form')",'provider edit saved');
  await visit(owner.session,'/cadastro?secao=prestadores');await wait("document.querySelector('.client-card')",'provider cards');await openProvider();
  await input('.provider-form input[name=document]','04.773.159/0005-23');await click('Consultar CNPJ');await wait("document.querySelector('.provider-form .lookup-success')",'CNPJ autofill');
  assert.equal(lookupCount,1);assert.equal(await evaluate("document.querySelector('.provider-form input[name=street]').value"),lookup.street);
  await shot('prestador-cnpj-consulta');await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await new Promise(r=>setTimeout(r,300));
  assert.equal(await evaluate("document.querySelector('.provider-modal').scrollWidth<=document.querySelector('.provider-modal').clientWidth+1"),true,'Provider modal has no horizontal overflow');await shot('prestador-cnpj-mobile');
  await saveProvider();await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await visit(owner.session,'/cadastro?secao=prestadores');await wait("document.querySelectorAll('.client-card').length===2",'separate CPF and CNPJ cards');await shot('prestadores-cards');
  await input('input[placeholder="Buscar nome, CPF, CNPJ ou cidade"]','529.982.247-25');await wait("document.querySelectorAll('.client-card').length===1",'formatted CPF search');
  await openProvider();await fillCpf('52998224725','Duplicado de teste');await click('Cadastrar prestador',"document.querySelector('.provider-form')");await wait("document.querySelector('.provider-form .form-error')?.textContent.includes('Já existe')",'server duplicate protection');await click('Cancelar',"document.querySelector('.provider-form')");await wait("document.querySelector('[role=alertdialog]')",'discard confirmation');await click('Descartar alterações');await wait("!document.querySelector('.provider-form')",'discarded duplicate form');
  }
  await visit(owner.session,'/solicitacoes?secao=servico');await wait("document.querySelector('.request-filters')",'requests');await click('Nova solicitação');await wait("document.querySelector('.request-provider-combobox input')",'provider selection');
  await input('.request-person-select',person.id);
  await pointerClick(providerInputSelector);
  await wait("document.querySelectorAll('[data-provider-id]').length===2",'click opens all providers');await shot('prestador-lista-ao-clicar');
  for(const term of ['oficina','mecanica primavera','04.773.159/0005-23','04773159000523']){
   await input(providerInputSelector,term);await wait("document.querySelectorAll('[data-provider-id]').length===1&&document.querySelector('[data-provider-id]').textContent.includes('Oficina CNPJ')",'filter by name or CNPJ: '+term);
  }
  await input(providerInputSelector,'529.982.247-25');await wait("document.querySelectorAll('[data-provider-id]').length===1&&document.querySelector('[data-provider-id]').textContent.includes('Prestador CPF')",'formatted CPF filter');
  await input(providerInputSelector,'Sem resultado cadastrado');await wait("document.querySelector('[data-slot=combobox-empty]')?.textContent.includes('Nenhum prestador encontrado')",'empty search feedback');
  assert.equal(await evaluate("document.querySelectorAll('[data-provider-id]').length"),0);
  await input(providerInputSelector,'oficina');await key('ArrowDown');await key('Enter');await wait("document.querySelector('.request-provider-summary')?.textContent.includes('Oficina CNPJ')",'keyboard selection');
  assert.equal(await evaluate("!!document.querySelector('.request-form')"),true,'Enter selects without submitting request');
  await pointerClick(providerInputSelector);await wait("document.querySelectorAll('[data-provider-id]').length===2",'reopening selected provider lists all options');
  await key('Escape');await wait("document.querySelector('.request-provider-combobox input').getAttribute('aria-expanded')==='false'",'Escape closes options');assert.equal(await evaluate("!!document.querySelector('[role=alertdialog]')"),false,'Escape does not discard the request');
  await input(providerInputSelector,'cpf');await wait("!document.querySelector('.request-provider-summary')",'editing clears the previous selection');await wait("document.querySelectorAll('[data-provider-id]').length===1",'search replaces previous selection');
  await pointerClick(`[data-provider-id="${cpf.id}"]`);await wait("document.querySelector('.request-provider-summary')?.textContent.includes('Prestador CPF atualizado')",'mouse selection');
  await input(providerInputSelector,'');await wait("!document.querySelector('.request-provider-summary')",'clear provider');
  await evaluate("document.querySelector('.request-edit-item textarea').focus()");
  await input('.request-edit-item textarea[maxlength="2000"]','Servico cadastrado antes do prestador');await input('.request-edit-item textarea[maxlength="1000"]','Trator de teste');await input('.request-form textarea[maxlength="4000"]','Rascunho mantido');
  await click('Cadastrar prestador',"document.querySelector('.request-form')");await wait("document.querySelector('.provider-form')",'provider inline modal');await fillCpf('111.444.777-35','Prestador dentro da solicitacao');await input('.provider-form input[name=street]','Rua do cadastro interno');await input('.provider-form input[name=number]','30');await saveProvider();
  await wait("document.querySelector('.request-provider-summary')?.textContent.includes('Prestador dentro da solicitacao')",'new provider automatically selected');
  assert.equal(await evaluate("document.querySelector('.request-form textarea[maxlength=\"4000\"]').value"),'Rascunho mantido');
  assert.equal((await rpc(owner.client,'service-requests','list')).total,0,'Saving the nested provider form must not submit the request');
  await input('.request-form input[inputmode="decimal"]','123,45');await shot('solicitacao-prestador-selecionado');await click('Enviar solicitação');await wait("document.querySelector('.request-detail')",'saved request with provider');
  const request=(await rpc(owner.client,'service-requests','list')).items[0];assert.ok(request.providerId);assert.equal(request.provider.legalName,'Prestador dentro da solicitacao');assert.equal(request.companyName,request.provider.legalName);assert.equal(request.companyAddress,'Rua do cadastro interno, 30');
  const snapshot=JSON.stringify(request.provider),hash=request.documentHash;
  const providerInput=Object.fromEntries(Object.keys(initial).map(key=>[key,request.provider[key]]));
  await rpc(owner.client,'service-providers','save',{...providerInput,id:request.providerId,legalName:'Prestador atualizado depois do pedido',street:'Novo endereco'});
  const preserved=(await rpc(owner.client,'service-requests','get',{id:request.id})).request;assert.equal(JSON.stringify(preserved.provider),snapshot);assert.equal(preserved.documentHash,hash);assert.equal(preserved.companyName,'Prestador dentro da solicitacao');
  await click('Exportar PDF');let pdf;const deadline=Date.now()+45000;while(Date.now()<deadline){pdf=readdirSync(output).find(name=>name.endsWith('.pdf'));if(pdf)break;await new Promise(r=>setTimeout(r,200));}assert.ok(pdf);
  const bytes=readFileSync(resolve(output,pdf)),source=bytes.toString('latin1'),streams=[];for(const match of source.matchAll(/\bstream\r?\n/g)){const start=match.index+match[0].length,end=source.indexOf('\nendstream',start);if(end<0)continue;let stream=bytes.subarray(start,end);try{if(source.slice(source.lastIndexOf('<<',match.index),match.index).includes('/FlateDecode'))stream=inflateSync(stream);}catch{continue;}streams.push(stream.toString('latin1'));}assert.ok(streams.join('\n').includes('Prestador dentro da solicitacao'),'PDF preserves the provider name at issuance');
  await visit(member.session,'/cadastro?secao=prestadores');await wait("document.querySelectorAll('.client-card').length===3",'read-only operator provider registry');assert.equal(await evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Novo prestador')"),false);
  await visit(member.session,'/solicitacoes?secao=servico');await wait("document.querySelector('.request-filters')",'operator requests');await click('Nova solicitação');await wait("document.querySelector('.request-provider-combobox input')",'operator provider selection');await selectProvider(request.providerId);
  assert.equal(await evaluate("[...document.querySelector('.request-form').querySelectorAll('button')].some(b=>b.textContent.trim()==='Cadastrar prestador')"),false);
  await rpc(owner.client,'service-providers','save',{...providerInput,id:request.providerId,legalName:'Prestador atualizado em tempo real'});
  await wait("document.querySelector('.request-provider-summary')?.textContent.includes('Prestador atualizado em tempo real')",'independent Realtime provider update');
  assert.equal((await member.client.from('billing_service_providers').update({legal_name:'DML proibido'}).eq('id',request.providerId)).error?.code,'42501');
  await assert.rejects(rpc(other.client,'service-providers','get',{id:request.providerId}),error=>['P0002','42501'].includes(error.code));assert.deepEqual((await other.client.from('billing_service_providers').select('id')).data,[]);
  await visit(other.session,'/cadastro?secao=prestadores');await wait("document.body.innerText.includes('Nenhum prestador cadastrado')",'other workspace isolation');assert.equal(await evaluate("document.querySelectorAll('.client-card').length"),0);
  assert.deepEqual(errors,[]);
  console.log(process.env.BILLING_PROVIDER_SELECTION_ONLY==='1'?'PASS: provider combobox click/search by name, trade name, formatted/unformatted CPF/CNPJ, empty state, keyboard/mouse selection, reopening, Escape, inline registration, snapshots/PDF, permissions and Realtime.':'PASS: provider CPF/CNPJ forms, mocked public lookup, edits, duplicates, cards/search, mobile, inline modal without losing request, server snapshots/PDF, permissions, independent Realtime and account isolation.');console.log('Visual evidence:',output);
 }catch(error){await shot('provider-test-error').catch(()=>{});throw error;}
 finally{try{await send('Page.close');}finally{ws.close();for(const job of pending.values())clearTimeout(job.timer);}}
}
