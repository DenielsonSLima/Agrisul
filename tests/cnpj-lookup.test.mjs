import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const {build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const temporary=await mkdtemp(join(tmpdir(),'billing-cnpj-'));
const nativeFetch=globalThis.fetch;
try{
 const outfile=join(temporary,'lookup.mjs');
 await build({stdin:{contents:`export {GET} from './app/api/companies/lookup/route'; export {createCnpjLookup} from './shared/services/cnpjLookup';`,resolveDir:process.cwd()},outfile,bundle:true,platform:'node',format:'esm',plugins:[{name:'identity-fixture',setup(builder){
  builder.onResolve({filter:/^@\/shared\/supabase\/server$/},()=>({path:'auth',namespace:'fixture'}));
  builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export async function getRequestUser(request){return request.headers.get('authorization')==='Bearer fixture-token'?{id:'fixture-owner'}:null;}`}));
 }}]});
 const api=await import(pathToFileURL(outfile));
 const cnpj='04773159000523';
 const primary={cnpj,razao_social:'AGRISUL AGRICOLA LTDA',nome_fantasia:'AGRISUL',uf:'SP',cep:'01311902',bairro:'CENTRO',numero:'37',municipio:'SAO PAULO',logradouro:'PAULISTA',complemento:'ANDAR 4',descricao_tipo_de_logradouro:'AVENIDA',ddd_telefone_1:'1123851939',email:null,qsa:[{nome_socio:'NOT_RETURNED'}]};
 const secondary={razao_social:primary.razao_social,estabelecimento:{cnpj,nome_fantasia:'AGRISUL',tipo_logradouro:'AVENIDA',logradouro:'PAULISTA',numero:'37',complemento:'ANDAR 4',bairro:'CENTRO',cep:'01311902',cidade:{nome:'SAO PAULO'},estado:{sigla:'SP'},ddd1:'11',telefone1:'23851939',email:null},socios:[{nome:'NOT_RETURNED'}]};
 const req=(value,auth=true)=>new Request('https://company.test/api/companies/lookup?cnpj='+encodeURIComponent(value),{headers:auth?{authorization:'Bearer fixture-token'}:{}});
 let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json(primary);};
 assert.equal((await api.GET(req(cnpj,false))).status,401);
 assert.equal((await api.GET(req('123'))).status,400);
 assert.equal(calls,0);
 const response=await api.GET(req('04.773.159/0005-23'));
 assert.equal(response.status,200);
 const {company}=await response.json();
 assert.equal(company.legalName,primary.razao_social);
 assert.equal(company.street,'AVENIDA PAULISTA');
 assert.equal(company.phone,'1123851939');
 assert.equal(company.email,'');
 assert.ok(!('qsa' in company));assert.ok(!('isPrimary' in company));
 await api.GET(req(cnpj));assert.equal(calls,1,'repeated authenticated lookup uses result cache');

 let finish;calls=0;let clock=100000;
 const concurrent=api.createCnpjLookup({now:()=>clock,fetch:async(_url,options)=>{calls++;assert.ok(options.signal instanceof AbortSignal);assert.equal(options.redirect,'manual');await new Promise(resolve=>{finish=resolve;});return Response.json(primary);}});
 const first=concurrent(cnpj);const second=concurrent(cnpj);
 assert.equal(calls,1,'same CNPJ shares the pending provider request');finish();
 const [a,b]=await Promise.all([first,second]);a.legalName='changed by caller';assert.equal(b.legalName,primary.razao_social);
 assert.equal((await concurrent(cnpj)).legalName,primary.razao_social,'cache is protected against caller mutation');
 clock+=15*60000+1;const expired=concurrent(cnpj);assert.equal(calls,2);finish();await expired;

 const urls=[];
 const fallback=api.createCnpjLookup({fetch:async url=>{urls.push(url);return url.includes('brasilapi')?Response.json({},{status:429,headers:{'Retry-After':'120'}}):Response.json(secondary);}});
 const alternative=await fallback(cnpj);assert.deepEqual(alternative,company);
 assert.deepEqual(urls,[`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,`https://publica.cnpj.ws/cnpj/${cnpj}`]);

 for(const status of [400,404]){
  let count=0;
  const lookup=api.createCnpjLookup({fetch:async()=>{count++;return Response.json({},{status});}});
  await assert.rejects(lookup(cnpj),error=>error.status===status);
  assert.equal(count,1,'invalid/not found responses are not retried against other providers');
 }
 for(const failure of ['network','timeout','malformed','mismatch']){
  const lookup=api.createCnpjLookup({fetch:async()=>{
   if(failure==='network')throw new Error('network');
   if(failure==='timeout')throw new DOMException('timeout','TimeoutError');
   return Response.json(failure==='mismatch'?{...primary,cnpj:'19131243000197'}:{});
  }});
  const expected=failure==='network'?503:failure==='timeout'?504:502;
  await assert.rejects(lookup(cnpj),error=>error.status===expected);
 }

 // Respect provider Retry-After and the documented fallback quota, even across
 // different CNPJs; never rotate identity/IP or retry a throttled provider.
 let primaryCalls=0;let fallbackCalls=0;clock=200000;
 const throttled=api.createCnpjLookup({now:()=>clock,fetch:async url=>{
  if(url.includes('brasilapi')){primaryCalls++;return Response.json({},{status:429,headers:{'Retry-After':'120'}});}
  fallbackCalls++;return Response.json({},{status:503});
 }});
 for(let i=0;i<4;i++)await assert.rejects(throttled('0477315900052'+i));
 assert.equal(primaryCalls,1);assert.equal(fallbackCalls,3);
 clock+=61000;await assert.rejects(throttled(cnpj));assert.equal(primaryCalls,1,'primary waits the full Retry-After');assert.equal(fallbackCalls,4);
 clock+=60000;await assert.rejects(throttled(cnpj));assert.equal(primaryCalls,2);
 console.log('Passed: Supabase bearer gate, normalized CNPJ, provider mapping, minimal payload, cache TTL, shared requests, fallback, Retry-After, quota, invalid/missing CNPJ, network/timeout/malformed responses.');
}finally{globalThis.fetch=nativeFetch;await rm(temporary,{recursive:true,force:true});}
