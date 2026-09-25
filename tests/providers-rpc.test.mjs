import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),{build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const directory=await mkdtemp(join(tmpdir(),'provider-rpc-'));
try{
 const output=join(directory,'api.mjs');
 await build({stdin:{contents:"export * from './modules/cadastro/prestadores/services/providerApi';export * from './modules/cadastro/prestadores/types';export * from './modules/cadastro/prestadores/presentation';export {createRequest} from './modules/solicitacoes/services/requestApi';",resolveDir:process.cwd()},outfile:output,bundle:true,platform:'node',format:'esm',plugins:[{name:'fixtures',setup(builder){
  builder.onResolve({filter:/^@\/shared\/supabase\/(rpc|client)$/},args=>({path:args.path,namespace:'fixture'}));
  builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path.endsWith('/rpc')?'export class RpcError extends Error{};export const rpcRequest=(...args)=>globalThis.providerRpc(...args);export const authenticatedFetch=(...args)=>globalThis.providerFetch(...args);':'export const getSupabaseBrowserClient=()=>globalThis.providerClient;'}));
 }}]});
 const api=await import(pathToFileURL(output)),calls=[],actorId='provider-operator',controller=new AbortController(),execution={actorId,signal:controller.signal};let session={user:{id:actorId}};
 globalThis.providerClient={auth:{getSession:async()=>({data:{session},error:null})}};
 const provider={...api.emptyProvider,id:'provider-a',documentType:'CPF',document:'52998224725',legalName:'Prestador cadastrado',address:'Rua Teste, 10'};
 const contact={id:'contact-a',providerId:provider.id,name:'José Carlos',phone:'79999999999',createdAt:'2026-09-25',updatedAt:'2026-09-25'};
 globalThis.providerRpc=async(resource,action,payload,signal)=>{calls.push({resource,action,payload,signal});return resource==='service-requests'?{request:{providerId:payload.providerId}}:action==='list'?{providers:[provider],canManage:true}:action==='save-contact'||action==='delete-contact'?{contact}:{provider,contacts:[contact],canManage:true};};
 assert.equal((await api.fetchProviders(controller.signal)).providers[0].id,provider.id);assert.equal(calls.at(-1).resource,'service-providers');assert.equal(calls.at(-1).signal,controller.signal);
 const input={...api.emptyProvider,documentType:'CPF',document:'529.982.247-25',legalName:'Prestador cadastrado'};
 assert.deepEqual(await api.saveProvider({input,execution:{actorId,signal:controller.signal}}),provider);assert.deepEqual(calls.at(-1).payload,{...input,id:undefined});assert.equal(calls.at(-1).signal,controller.signal);
 assert.deepEqual((await api.fetchProvider(provider.id,controller.signal)).contacts,[contact]);
 assert.deepEqual(await api.saveProviderContact({input:{providerId:provider.id,name:'José Carlos',phone:'79999999999'},execution}),contact);assert.equal(calls.at(-1).action,'save-contact');
 assert.deepEqual(await api.deleteProviderContact({id:contact.id,execution}),contact);assert.deepEqual(calls.at(-1).payload,{id:contact.id});
 assert.equal(api.providerDocument(provider),'529.982.247-25');assert.equal(api.providerDocument({documentType:'CNPJ',document:'04773159000523'}),'04.773.159/0005-23');
 let lookedUp;
 globalThis.providerFetch=async(url,options)=>{lookedUp={url,options};return Response.json({details:{cnpj:'04773159000523',legalName:'Empresa consultada',tradeName:'',street:'Rua consultada',number:'10',complement:'',district:'Centro',city:'Cidade',state:'SE',zipCode:'49950000',phone:'79999999999',email:''}});};
 const found=await api.lookupProviderCnpj('04.773.159/0005-23',controller.signal);assert.equal(found.documentType,'CNPJ');assert.equal(found.document,'04773159000523');assert.equal(found.street,'Rua consultada');assert.ok(!('cnpj' in found));assert.equal(lookedUp.options.signal,controller.signal);
 globalThis.providerFetch=async()=>Response.json({error:'Consulta indisponível'},{status:503});await assert.rejects(api.lookupProviderCnpj('04773159000523',controller.signal),/Consulta indisponível/);
 await api.createRequest({input:{requestId:'request-a',providerId:provider.id},execution});assert.deepEqual(calls.at(-1).payload,{requestId:'request-a',providerId:provider.id},'Provider details are resolved by Postgres, not sent as editable browser fields');
 const previous=calls.length;session={user:{id:'another-account'}};await assert.rejects(api.saveProvider({input,execution}),error=>error.name==='AbortError');assert.equal(calls.length,previous,'Account changes cannot save old form inputs');
 session={user:{id:actorId}};controller.abort();await assert.rejects(api.saveProvider({input,execution}),error=>error.name==='AbortError');assert.equal(calls.length,previous);
 console.log('Passed: provider RPC data and contacts, CPF/CNPJ presentation, CNPJ lookup mapping/failure, server-resolved request provider and account cancellation.');
}finally{delete globalThis.providerRpc;delete globalThis.providerFetch;delete globalThis.providerClient;await rm(directory,{recursive:true,force:true});}
