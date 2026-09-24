import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import test from 'node:test';

const require=createRequire(import.meta.url);
const {build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const temporary=await mkdtemp(join(tmpdir(),'billing-session-boundary-'));

try{
 const output=join(temporary,'services.mjs');
 await build({
  stdin:{
   contents:`export {persistCompany} from './modules/configuracoes/empresas/services/companyApi'; export {persistWatermark} from './modules/configuracoes/marca-dagua/services/watermarkApi';`,
   resolveDir:process.cwd(),
  },
  outfile:output,
  bundle:true,
  platform:'node',
  format:'esm',
  plugins:[{name:'session-boundary-fixtures',setup(builder){
   builder.onResolve({filter:/^@\/shared\/supabase\/(rpc|client)$/},args=>({path:args.path,namespace:'fixture'}));
   builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({
    contents:args.path.endsWith('/rpc')
     ? `export class RpcError extends Error{constructor(message,status=400,code){super(message);this.name='RpcError';this.status=status;this.code=code}};export const rpcRequest=(...args)=>globalThis.boundaryRpc(...args);`
     : `export const getSupabaseBrowserClient=()=>globalThis.boundaryClient;`,
   }));
  }}],
 });

 const {persistCompany,persistWatermark}=await import(pathToFileURL(output));
 const ownerA='owner-a';
 const ownerB='owner-b';
 const workspaceA='11111111-1111-4111-8111-111111111111';
 let session={user:{id:ownerA}};
 let switchDuringUpload=false;
 let saveFailure=null;
 const calls=[];
 const uploads=[];
 const removals=[];

 globalThis.boundaryClient={
  auth:{getSession:async()=>({data:{session},error:null})},
  storage:{from:bucket=>({
   upload:async(path,file,options)=>{
    uploads.push({bucket,path,file,options,actorId:session?.user.id});
    if(switchDuringUpload)session={user:{id:ownerB}};
    return {error:null};
   },
   remove:async paths=>{removals.push({bucket,paths,actorId:session?.user.id});return {error:null};},
   createSignedUrls:async paths=>({data:paths.map(path=>({path,signedUrl:`https://signed.example.test/${path}`,error:null})),error:null}),
  })},
 };
 globalThis.boundaryRpc=async(resource,action,payload={})=>{
  calls.push({resource,action,payload,actorId:session?.user.id});
  if(resource==='settings'&&action==='get')return {settings:{workspaceId:workspaceA}};
  if(action==='save'&&saveFailure)throw saveFailure;
  if(resource==='companies'&&action==='save')return {id:'company-a',company:{id:'company-a'},previousLogoKey:null};
  if(resource==='watermarks'&&action==='save')return {settings:payload};
  throw new Error(`Unexpected RPC ${resource}.${action}`);
 };

 const reset=()=>{
  session={user:{id:ownerA}};
  switchDuringUpload=true;
  saveFailure=null;
  calls.length=0;
  uploads.length=0;
  removals.length=0;
 };
 const assertNoCrossAccountSave=resource=>{
  assert.equal(calls.filter(call=>call.resource===resource&&call.action==='save').length,0);
  assert.equal(calls.some(call=>call.action==='save'&&call.actorId===ownerB),false);
 };

 test('company upload aborts and cleans up when the session changes before save',async()=>{
  reset();
  const data={cnpj:'',legalName:'Empresa A',tradeName:'',street:'',number:'',complement:'',district:'',city:'',state:'',zipCode:'',phone:'',email:'',isPrimary:true};
  const logo=new File(['logo'],'logo.png',{type:'image/png'});

  await assert.rejects(
   persistCompany(data,undefined,{file:logo,remove:false,previousKey:null},ownerA),
   error=>error?.status===409&&error?.code==='BILLING_SESSION_ACTOR_CHANGED',
  );

  assert.equal(uploads.length,1);
  assert.equal(uploads[0].actorId,ownerA);
  assert.match(uploads[0].path,new RegExp(`^${workspaceA}/companies/`));
  assertNoCrossAccountSave('companies');
  assert.deepEqual(removals.map(({bucket,paths})=>({bucket,paths})),[
   {bucket:'billing-company-logos',paths:[uploads[0].path]},
  ]);
 });

 test('watermark upload aborts and cleans up when the session changes before save',async()=>{
  reset();
  const settings={
   orientation:'portrait',opacity:15,size:60,
   portraitImageKey:null,portraitImageName:'',portraitImageUrl:null,
   landscapeImageKey:null,landscapeImageName:'',landscapeImageUrl:null,
  };
  const portrait=new File(['watermark'],'watermark.png',{type:'image/png'});

  await assert.rejects(
   persistWatermark(settings,{portrait},{portrait:false,landscape:false},ownerA),
   error=>error?.status===409&&error?.code==='BILLING_SESSION_ACTOR_CHANGED',
  );

  assert.equal(uploads.length,1);
  assert.equal(uploads[0].actorId,ownerA);
  assert.match(uploads[0].path,new RegExp(`^${workspaceA}/portrait/`));
  assertNoCrossAccountSave('watermarks');
  assert.deepEqual(removals.map(({bucket,paths})=>({bucket,paths})),[
   {bucket:'billing-watermarks',paths:[uploads[0].path]},
  ]);
 });

 test('ambiguous failures after dispatch preserve uploads that a committed record may reference',async()=>{
  const companyData={cnpj:'',legalName:'Empresa A',tradeName:'',street:'',number:'',complement:'',district:'',city:'',state:'',zipCode:'',phone:'',email:'',isPrimary:true};
  const watermarkSettings={
   orientation:'portrait',opacity:15,size:60,
   portraitImageKey:null,portraitImageName:'',portraitImageUrl:null,
   landscapeImageKey:null,landscapeImageName:'',landscapeImageUrl:null,
  };

  reset();switchDuringUpload=false;saveFailure=new Error('Conexão perdida após o envio');
  await assert.rejects(
   persistCompany(companyData,undefined,{file:new File(['logo'],'logo.png',{type:'image/png'}),remove:false,previousKey:null},ownerA),
   /Conexão perdida/,
  );
  assert.equal(calls.filter(call=>call.resource==='companies'&&call.action==='save').length,1);
  assert.equal(removals.length,0);

  reset();switchDuringUpload=false;saveFailure=new Error('Conexão perdida após o envio');
  await assert.rejects(
   persistWatermark(watermarkSettings,{portrait:new File(['watermark'],'watermark.png',{type:'image/png'})},{},ownerA),
   /Conexão perdida/,
  );
  assert.equal(calls.filter(call=>call.resource==='watermarks'&&call.action==='save').length,1);
  assert.equal(removals.length,0);
 });
}finally{
 await rm(temporary,{recursive:true,force:true});
 delete globalThis.boundaryRpc;
 delete globalThis.boundaryClient;
}
