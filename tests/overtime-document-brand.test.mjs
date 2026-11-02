import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const directory=await mkdtemp(join(tmpdir(),'overtime-document-brand-'));
try{
 const output=join(directory,'brand.mjs');
 await build({entryPoints:['modules/solicitacoes/horas-extras/services/overtimeBrandApi.ts'],outfile:output,bundle:true,platform:'node',format:'esm',plugins:[{name:'brand-fixture',setup(builder){
  builder.onResolve({filter:/^@\/shared\/supabase\/(rpc|client)$/},args=>({path:args.path,namespace:'fixture'}));
  builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path.endsWith('/rpc')?'export const rpcRequest=(...args)=>globalThis.brandRpc(...args);':'export const getSupabaseBrowserClient=()=>globalThis.brandClient;'}));
 }}]});
 const {fetchOvertimeBrand}=await import(pathToFileURL(output));
 const calls=[],signings=[];
 const payload={company:{id:'company-a',name:'Agrisul',legalName:'Agrisul',logoKey:'owner/logo.png'},header:{variant:'compact',logoAlignment:'left',showCnpj:false,showContact:false},watermark:{portraitImageKey:'owner/portrait/watermark.png',opacity:15,size:60},issuer:{id:'actor-a',name:'Lucas',email:'actor@example.test'}};
 let response=payload,signingError=null;
 globalThis.brandRpc=async(...args)=>{calls.push(args);return response;};
 globalThis.brandClient={storage:{from:bucket=>({createSignedUrl:async(key,seconds)=>{signings.push({bucket,key,seconds});return {data:{signedUrl:`https://signed.example.test/${key}`},error:signingError};}})}};
 await test('overtime export obtains only its authorized document projection and referenced files',async()=>{
  const result=await fetchOvertimeBrand('company-a');
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].slice(0,3),['overtime','document-brand',{companyId:'company-a'}]);
  assert.deepEqual(signings.map(item=>[item.bucket,item.key]),[['billing-company-logos','owner/logo.png'],['billing-watermarks','owner/portrait/watermark.png']]);
  assert.equal(result.company.logoUrl,'https://signed.example.test/owner/logo.png');
  assert.equal(result.watermark.imageUrl,'https://signed.example.test/owner/portrait/watermark.png');
  assert.deepEqual(result.issuer,payload.issuer);
  assert.ok(result.issuedAt instanceof Date);
 });
 await test('missing optional artwork needs no storage call and signing failures stay visible',async()=>{
  calls.length=0;signings.length=0;response={...payload,company:null,watermark:{...payload.watermark,portraitImageKey:null}};
  const result=await fetchOvertimeBrand('company-a');
  assert.equal(signings.length,0);assert.equal(result.company,null);assert.equal(result.watermark.imageUrl,null);
  response=payload;signingError=new Error('denied');
  await assert.rejects(fetchOvertimeBrand('company-a'),/identidade do relatório/);
 });
 await test('cancelled export does not return a brand from a previous screen',async()=>{
  signingError=null;response=payload;const controller=new AbortController();controller.abort();
  await assert.rejects(fetchOvertimeBrand('company-a',controller.signal),error=>error.name==='AbortError');
 });
}finally{delete globalThis.brandRpc;delete globalThis.brandClient;await rm(directory,{recursive:true,force:true});}
