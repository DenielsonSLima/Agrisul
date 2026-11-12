import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),{build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));

test('dashboard placeholders retain only the same authorized account, company, resource and projection',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'dashboard-filter-cache-'));
 globalThis.__filterCacheScope={user:'owner-a',company:'company-a'};
 try{
  const file=join(directory,'query.mjs');
  await build({entryPoints:['shared/query/useBillingQuery.ts'],outfile:file,platform:'node',format:'esm',bundle:true,plugins:[{name:'query-scope-fixture',setup(builder){
   builder.onResolve({filter:/^(?:@tanstack\/react-query|@\/shared\/(?:supabase\/(?:AuthProvider|rpc)|state\/WorkspaceCompanyProvider))$/},args=>({path:args.path,namespace:'fixture'}));
   builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='@tanstack/react-query'?'export const useQuery=options=>{globalThis.__filterCacheOptions=options;return {isPending:false,error:null};};':args.path.endsWith('AuthProvider')?'export const useAuth=()=>({user:{id:globalThis.__filterCacheScope.user},ready:true});':args.path.endsWith('WorkspaceCompanyProvider')?'export const useWorkspaceCompany=()=>({activeCompanyId:globalThis.__filterCacheScope.company,loading:false,error:""});':'export class RpcError extends Error{constructor(message,status){super(message);this.status=status;}}globalThis.__filterCacheError=RpcError;'}));
  }}]});
  const {useBillingQuery}=await import(pathToFileURL(file).href),previous={value:'Authorized snapshot'};
  useBillingQuery('summary',{projection:'weekly-v5',from:'2026-11-06'},async()=>({}),{keepPreviousData:true});
  const retain=globalThis.__filterCacheOptions.placeholderData;
  const query=(actor='owner-a',company='company-a',resource='summary',projection='weekly-v5',error=null)=>({queryKey:['billing',actor,resource,{companyId:company,projection,from:'2026-11-01'}],state:{error}});
  assert.equal(retain(previous,query()),previous);
  assert.equal(retain(previous,query('owner-b')),undefined);
  assert.equal(retain(previous,query('owner-a','company-b')),undefined);
  assert.equal(retain(previous,query('owner-a','company-a','contracts')),undefined);
  assert.equal(retain(previous,query('owner-a','company-a','summary','periods-v4')),undefined);
  assert.equal(retain(previous,undefined),undefined);
  for(const status of [401,403,404])assert.equal(retain(previous,query('owner-a','company-a','summary','weekly-v5',new globalThis.__filterCacheError('Denied',status))),undefined);
  assert.equal(retain(previous,query('owner-a','company-a','summary','weekly-v5',new globalThis.__filterCacheError('Offline',503))),previous);
  useBillingQuery('contracts',{},async()=>({}));assert.equal(globalThis.__filterCacheOptions.placeholderData,undefined,'Unrelated resources keep their existing behavior');
 }finally{
  delete globalThis.__filterCacheScope;delete globalThis.__filterCacheOptions;delete globalThis.__filterCacheError;
  if(!resolve(directory).startsWith(join(resolve(tmpdir()),'dashboard-filter-cache-')))throw Error('Unsafe test directory');
  await rm(directory,{recursive:true,force:true});
 }
});
