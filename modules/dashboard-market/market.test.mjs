import {test} from 'node:test';
import assert from 'node:assert/strict';
import {consumeAgriculturalRow,emptyAgriculturalQuotes,parseCurrency,parseCane,getMarketFeed,mergeMarketQuotes,unavailable,parseAwesomeCurrency,fetchCurrencyQuotes,createMarketProvider} from './providers.mjs';

const caneHtml='<h2 class="text-center">Safra 2026/2027 - 24/09/2026</h2><h5>Projeção do preço da cana básica</h5><table><tr><th>Campo</th><th>Esteira</th></tr><tr><td>PREÇO BÁSICO</td><td><b>98,03</b></td><td>109,49</td></tr></table>';
test('prices preserve product, exact region, publication date and common price rather than max',()=>{
  const quotes=emptyAgriculturalQuotes();
  consumeAgriculturalRow(quotes,[null,2026,'outubro',20,'Soja industrial - sc 60 kg','Oeste',120,130,140]);
  consumeAgriculturalRow(quotes,[null,2026,'outubro',22,'Soja industrial - sc 60 kg','Oeste',121,134,150]);
  consumeAgriculturalRow(quotes,[null,2026,'outubro',23,'Soja industrial - sc 60 kg','Litoral Norte',141,160,180]);
  consumeAgriculturalRow(quotes,[null,2026,'outubro',19,'Soja industrial - sc 60 kg','Oeste',121,180,190]);
  const soy=quotes.find(quote=>quote.id==='soy');
  assert.equal(soy.value,'134');assert.equal(soy.date,'2026-10-22');assert.equal(soy.status,'available');
  assert.match(soy.note,/Oeste\/SC/);
});
test('missing, negative and invalid date publications never manufacture a price',()=>{
  const quotes=emptyAgriculturalQuotes();
  for(const price of [null,'',0,-20,Infinity,'indisponível'])consumeAgriculturalRow(quotes,[null,2026,'outubro',22,'Milho-amarelo - sc 60 kg','Oeste',1,price,3]);
  consumeAgriculturalRow(quotes,[null,2026,'fevereiro',31,'Milho-amarelo - sc 60 kg','Oeste',1,3,4]);
  assert.equal(quotes.find(quote=>quote.id==='corn').status,'unavailable');
  assert.equal(quotes.find(quote=>quote.id==='corn').value,null);
});

test('agricultural comparisons retain the latest two distinct publications from the same product and region in any worksheet order',()=>{
 for(const order of [[20,22,21,22,19],[22,21,20],[20,21,22]]){
  const quotes=emptyAgriculturalQuotes();for(const day of order)consumeAgriculturalRow(quotes,[null,2026,'outubro',day,'Soja industrial - sc 60 kg','Oeste',0,100+day,0]);
  consumeAgriculturalRow(quotes,[null,2026,'outubro',23,'Soja industrial - sc 60 kg','Litoral Norte',0,900,0]);
  const soy=quotes.find(q=>q.id==='soy');assert.equal(soy.value,'122');assert.equal(soy.previousValue,'121');assert.equal(soy.previousDate,'2026-10-21');assert.equal(soy.changePercent,undefined,'Percentage belongs in Postgres');
 }
});

test('daily fallback compares distinct published dates, not weekends or another currency, and retains the current reference if history fails',async()=>{
 const parsed=parseCurrency([{base:'USD',quote:'BRL',rate:4,date:'2026-10-23'},{base:'EUR',quote:'BRL',rate:9,date:'2026-10-26'},{base:'USD',quote:'BRL',rate:5,date:'2026-10-26'}],'usd');
 assert.equal(parsed.value,'5');assert.equal(parsed.previousValue,'4');assert.equal(parsed.previousDate,'2026-10-23');assert.equal(parsed.changePercent,undefined);
 const original=globalThis.fetch;globalThis.fetch=async url=>String(url).includes('awesomeapi')||String(url).includes('&from=')?new Response('Unavailable',{status:503}):Response.json([{base:String(url).includes('USD')?'USD':'EUR',quote:'BRL',rate:5,date:'2026-10-26'}]);
 try{const quotes=await fetchCurrencyQuotes();assert.ok(quotes.every(q=>q.value==='5'&&q.status==='available'&&q.previousValue===undefined));}finally{globalThis.fetch=original;}
});
test('arroz uses the published Litoral Sul region',()=>{
  const quotes=emptyAgriculturalQuotes();
  consumeAgriculturalRow(quotes,[null,2026,'outubro',22,'Arroz irrigado em casca - sc 50 kg','Litoral Sul',50,52.25,55]);
  assert.equal(quotes.find(quote=>quote.id==='rice').value,'52.25');
});
test('currency parser requires the requested pair and labels reference date',()=>{
  const quote=parseCurrency([{base:'USD',quote:'BRL',rate:5.12,date:'2026-10-27'}],'usd');
  assert.equal(quote.value,'5.12');assert.equal(quote.date,'2026-10-27');
  assert.throws(()=>parseCurrency([{base:'EUR',quote:'BRL',rate:5.12,date:'2026-10-27'}],'usd'));
  assert.throws(()=>parseCurrency([{base:'USD',quote:'BRL',rate:0,date:'2026-10-27'}],'usd'));
});
test('cane is the field projection and never substituted with sugar or ATR price',()=>{
  const quote=parseCane(caneHtml);
  assert.equal(quote.value,'98.03');assert.equal(quote.date,'2026-09-24');
  assert.match(quote.note,/campo/);assert.match(quote.note,/projeção/);
  assert.throws(()=>parseCane('<div>ATR mensal 0,8839; Açúcar 19,52</div>'));
});
test('one unavailable provider does not discard the other real publications',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async url=>{
    const value=String(url);
    if(value.includes('base=USD'))return Response.json([{base:'USD',quote:'BRL',rate:5.12,date:'2026-10-27'}]);
    if(value.includes('sistemafaep'))return new Response(caneHtml);
    return new Response('Unavailable',{status:503});
  };
  try{
    const feed=await getMarketFeed();
    assert.equal(feed.quotes.find(quote=>quote.id==='usd').value,'5.12');
    assert.equal(feed.quotes.find(quote=>quote.id==='cane').value,'98.03');
    assert.equal(feed.quotes.find(quote=>quote.id==='eur').status,'unavailable');
    assert.equal(feed.quotes.find(quote=>quote.id==='soy').value,null);
    assert.equal(feed.quotes.length,11);
  }finally{globalThis.fetch=original;}
});
test('provider success then failure keeps original values and dates, and recovery clears stale status',()=>{
  const first=parseCurrency([{base:'USD',quote:'BRL',rate:5.12,date:'2026-10-27'}],'usd');
  const second=parseCane(caneHtml);
  const current=[unavailable('usd',first.source,first.sourceUrl),second];
  const duringFailure=mergeMarketQuotes([first,second],current);
  const preserved=duringFailure.find(quote=>quote.id==='usd');
  assert.equal(preserved.status,'stale');assert.equal(preserved.value,'5.12');assert.equal(preserved.date,'2026-10-27');
  assert.equal(preserved.source,first.source);assert.equal(preserved.note,first.note);
  assert.equal(duringFailure.find(quote=>quote.id==='cane').status,'available');
  assert.equal(first.status,'available','cached good publication is never mutated');
  const repeated=mergeMarketQuotes(duringFailure,current);
  assert.deepEqual(repeated,duringFailure,'successive failures preserve the same original reference');
  const newest=parseCurrency([{base:'USD',quote:'BRL',rate:5.15,date:'2026-10-28'}],'usd');
  const recovered=mergeMarketQuotes(repeated,[newest,second]);
  assert.equal(recovered[0].status,'available');assert.equal(recovered[0].value,'5.15');assert.equal(recovered[0].date,'2026-10-28');
});
test('partially missing workbook data and regressed publications retain the last valid per-indicator reference',()=>{
  const previous=emptyAgriculturalQuotes();
  consumeAgriculturalRow(previous,[null,2026,'outubro',22,'Soja industrial - sc 60 kg','Oeste',120,134,150]);
  consumeAgriculturalRow(previous,[null,2026,'outubro',22,'Milho-amarelo - sc 60 kg','Oeste',50,54.5,60]);
  const partial=emptyAgriculturalQuotes();
  consumeAgriculturalRow(partial,[null,2026,'outubro',23,'Soja industrial - sc 60 kg','Oeste',121,135,151]);
  consumeAgriculturalRow(partial,[null,2026,'outubro',21,'Milho-amarelo - sc 60 kg','Oeste',49,53,59]);
  const merged=mergeMarketQuotes(previous,partial);
  assert.equal(merged.find(quote=>quote.id==='soy').value,'135');
  assert.equal(merged.find(quote=>quote.id==='soy').status,'available');
  assert.equal(merged.find(quote=>quote.id==='corn').value,'54.5');
  assert.equal(merged.find(quote=>quote.id==='corn').date,'2026-10-22');
  assert.equal(merged.find(quote=>quote.id==='corn').status,'stale');
  assert.equal(merged.find(quote=>quote.id==='rice').status,'unavailable');
});
test('intraday currency preserves provider bid, percentage and UTC observation timestamp',()=>{
  const body={USDBRL:{code:'USD',codein:'BRL',bid:'5.351',ask:'5.3521',pctChange:'-0.007473',timestamp:'1793218964'}};
  const quote=parseAwesomeCurrency(body,'usd');
  assert.equal(quote.value,'5.351');assert.equal(quote.changePercent,'-0.007473');
  assert.equal(quote.observedAt,new Date(1793218964*1000).toISOString());
  assert.equal(quote.date,'2026-10-28');assert.equal(quote.source,'AwesomeAPI');
  assert.match(quote.note,/compra \(bid\)/);assert.match(quote.note,/cache de 1 minuto/);
  assert.throws(()=>parseAwesomeCurrency(body,'eur'));
  assert.throws(()=>parseAwesomeCurrency({USDBRL:{...body.USDBRL,bid:'0'}},'usd'));
  assert.throws(()=>parseAwesomeCurrency({USDBRL:{...body.USDBRL,timestamp:'invalid'}},'usd'));
});
test('public intraday failure falls back per currency to explicitly labelled daily references',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async url=>{
    const value=String(url);
    if(value.includes('awesomeapi'))return Response.json({USDBRL:{code:'USD',codein:'BRL',bid:'5.351',pctChange:'-0.007473',timestamp:'1793218964'}});
    if(value.includes('base=EUR'))return Response.json([{base:'EUR',quote:'BRL',rate:5.96,date:'2026-10-28'}]);
    return new Response('Unavailable',{status:503});
  };
  try{
    const quotes=await fetchCurrencyQuotes();
    assert.equal(quotes[0].source,'AwesomeAPI');assert.equal(quotes[0].value,'5.351');
    assert.equal(quotes[1].source,'Frankfurter · bancos centrais');assert.equal(quotes[1].value,'5.96');
    assert.match(quotes[1].note,/intradiário indisponível/);assert.equal(quotes[1].observedAt,undefined);assert.equal(quotes[1].changePercent,undefined);
  }finally{globalThis.fetch=original;}
});
test('provider caches have independent TTLs, deduplicate requests and preserve data after timeout',async()=>{
  let clock=0,currencyCalls=0,agroCalls=0,fail=false;
  const first=parseCurrency([{base:'USD',quote:'BRL',rate:5.12,date:'2026-10-27'}],'usd');
  const usd=createMarketProvider(async()=>{currencyCalls++;if(fail)throw new Error('timeout');return [first];},()=>[unavailable('usd',first.source,first.sourceUrl)],60000,()=>clock);
  const agro=createMarketProvider(async()=>{agroCalls++;return [parseCane(caneHtml)];},()=>[],600000,()=>clock);
  await Promise.all([usd(),usd(),agro()]);
  assert.equal(currencyCalls,1);assert.equal(agroCalls,1);
  clock=61000;fail=true;
  const [stale]=await usd();await agro();
  assert.equal(currencyCalls,2);assert.equal(agroCalls,1,'minute currency polling must not reload agricultural data');
  assert.equal(stale.status,'stale');assert.equal(stale.value,'5.12');assert.equal(stale.date,'2026-10-27');
  clock=100000;await usd();assert.equal(currencyCalls,2,'failed provider is retried after one minute, not every request');
  clock=122000;fail=false;const [recovered]=await usd();
  assert.equal(currencyCalls,3);assert.equal(recovered.status,'available');assert.equal(agroCalls,1);
});
test('an earlier quote in the same trading day cannot overwrite a newer observation',()=>{
  const current=parseAwesomeCurrency({USDBRL:{code:'USD',codein:'BRL',bid:'5.351',timestamp:'1793218964'}},'usd');
  const older=parseAwesomeCurrency({USDBRL:{code:'USD',codein:'BRL',bid:'5.341',timestamp:'1793218900'}},'usd');
  const [result]=mergeMarketQuotes([current],[older]);
  assert.equal(result.value,'5.351');assert.equal(result.observedAt,current.observedAt);assert.equal(result.status,'stale');
});
test('group requests start only their own provider and return independent refresh intervals',async()=>{
  const original=globalThis.fetch,requested=[];
  const {getMarketFeed:groupFeed}=await import('./providers.mjs?group-isolation');
  globalThis.fetch=async url=>{
    const value=String(url);requested.push(value);
    if(value.includes('awesomeapi'))return Response.json({USDBRL:{code:'USD',codein:'BRL',bid:'5.351',timestamp:'1793218964'},EURBRL:{code:'EUR',codein:'BRL',bid:'5.966',timestamp:'1793218906'}});
    if(value.includes('sistemafaep'))return new Response(caneHtml);
    return new Response('Unavailable',{status:503});
  };
  try{
    const currency=await groupFeed('currency');
    assert.deepEqual(currency.quotes.map(quote=>quote.id),['usd','eur']);assert.equal(currency.refreshSeconds,60);
    assert.deepEqual(requested,['https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL']);
    const cane=await groupFeed('cane');
    assert.deepEqual(cane.quotes.map(quote=>quote.id),['cane']);assert.equal(cane.refreshSeconds,600);
    assert.equal(requested.length,2);assert.match(requested[1],/sistemafaep/);
    const agriculture=await groupFeed('agriculture');
    assert.deepEqual(agriculture.quotes.map(quote=>quote.id),['soy','corn','cattle','wheat','rice','beans','pork','chicken']);assert.equal(agriculture.refreshSeconds,600);
    assert.equal(requested.length,3);assert.match(requested[2],/Historico_precos_diario\.xlsx/);
    assert.ok(Number.isFinite(Date.parse(currency.checkedAt)));
    await groupFeed('currency');assert.equal(requested.length,3,'cached currency response does not restart any other provider');
    await assert.rejects(()=>groupFeed('unknown'),RangeError);
    await assert.rejects(()=>groupFeed('__proto__'),RangeError);
    assert.equal(requested.length,3,'invalid groups never initiate network requests');
  }finally{globalThis.fetch=original;}
});
test('currency requests resolve while an independent agricultural request is still pending',async()=>{
  const original=globalThis.fetch;
  const {getMarketFeed:groupFeed}=await import('./providers.mjs?group-pending');
  let releaseAgriculture;
  globalThis.fetch=async url=>{
    const value=String(url);
    if(value.includes('docweb.epagri'))return new Promise(resolve=>{releaseAgriculture=()=>resolve(new Response('Unavailable',{status:503}));});
    if(value.includes('awesomeapi'))return Response.json({USDBRL:{code:'USD',codein:'BRL',bid:'5.351',timestamp:'1793218964'},EURBRL:{code:'EUR',codein:'BRL',bid:'5.966',timestamp:'1793218906'}});
    throw new Error('Unexpected provider was started');
  };
  try{
    let agricultureFinished=false;
    const agricultural=groupFeed('agriculture').then(value=>{agricultureFinished=true;return value;});
    const currency=await groupFeed('currency');
    assert.equal(currency.quotes.length,2);assert.equal(agricultureFinished,false);
    releaseAgriculture();await agricultural;
  }finally{releaseAgriculture?.();globalThis.fetch=original;}
});
test('daily currency fallback uses the bounded eight-second timeout',async()=>{
  const originalFetch=globalThis.fetch,originalTimeout=AbortSignal.timeout,timeouts=[];
  AbortSignal.timeout=duration=>{timeouts.push(duration);return new AbortController().signal;};
  globalThis.fetch=async url=>String(url).includes('awesomeapi')?new Response('Unavailable',{status:503}):Response.json([{base:String(url).includes('USD')?'USD':'EUR',quote:'BRL',rate:5.12,date:'2026-10-27'}]);
  try{
    const quotes=await fetchCurrencyQuotes();
    assert.equal(quotes.length,2);assert.deepEqual(timeouts,[8000,8000,8000,8000,8000]);
  }finally{globalThis.fetch=originalFetch;AbortSignal.timeout=originalTimeout;}
});
test('HTTP route authenticates before group validation and forwards only whitelisted groups',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {transpileModule,ModuleKind,ScriptTarget}=await import('typescript');
  const uri=code=>`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  const dependencies=uri(`export async function getRequestUser(request){return request.headers.has('x-test-auth')?{id:'test'}:null;} export function getRequestSupabase(){return {rpc:(_name,args)=>({abortSignal:async()=>({data:{group:args.p_payload.group??'all',quotes:[],checkedAt:'2026-10-29T12:00:00.000Z',refreshSeconds:args.p_payload.group==='currency'?60:600}})})};}`);
  const route=(await readFile(new URL('../../app/api/dashboard-market/route.ts',import.meta.url),'utf8')).replace('@/shared/supabase/server',dependencies).replace('@/modules/dashboard-market/providers.mjs',dependencies);
  const {outputText}=transpileModule(route,{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022}});
  const {GET}=await import(uri(outputText));
  const request=group=>new Request(`https://example.test/api/dashboard-market${group===undefined?'':`?group=${group}`}`,{headers:{'x-test-auth':'yes'}});
  const anonymous=await GET(new Request('https://example.test/api/dashboard-market?group=unknown'));
  assert.equal(anonymous.status,401,'unauthenticated requests never reach group validation');
  for(const group of ['unknown','','constructor','__proto__'])assert.equal((await GET(request(group))).status,400);
  for(const group of ['currency','agriculture','cane',undefined]){
    const response=await GET(request(group));assert.equal(response.status,200);
    assert.equal((await response.json()).group,group??'all');assert.equal(response.headers.get('cache-control'),'private, no-store');
  }
});
