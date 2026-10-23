import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const fixtureUrl=url(`export const state={user:{id:'owner-one'},actor:'owner-one',calls:[]};
export function useCadastroQuery(resource,params,fetcher){return {resource,params,fetch:()=>fetcher(new AbortController().signal)}}
export function useCadastroMutation(resource,save){return {resource,mutateAsync:save,isPending:false}}
export function useAuth(){return {user:state.user}}
export function getSupabaseBrowserClient(){return {auth:{getSession:async()=>({data:{session:{user:{id:state.actor}}},error:null})}}}
export async function rpcRequest(resource,action,payload,signal){state.calls.push({resource,action,payload,signal});return action==='list'?{profiles:[{id:'inactive',active:false}],canManage:true}:{profile:{id:'new-profile',active:false,isDefault:false}}}`);
const {state}=await import(fixtureUrl);
let source=ts.transpileModule(readFileSync(new URL('../modules/importacoes/hooks/useImportacoes.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
source=source.replace(/from ['"]@\/(?:modules\/cadastro\/hooks\/useCadastroQuery|shared\/supabase\/(?:rpc|AuthProvider|client))['"]/g,`from ${JSON.stringify(fixtureUrl)}`);
const {useImportMutations,useImportProfiles,useImportDocuments}=await import(url(source));

test('profile lifecycle mutations route revision-protected payloads through the shared RPC wrapper',async()=>{
 state.calls=[];state.actor='owner-one';const actions=useImportMutations();
 const clone={id:'source-id',expectedUpdatedAt:'revision-one',name:'Nova cópia',clientId:'client-one'};
 await actions.cloneProfile(clone);await actions.setProfileActive({id:'new-profile',expectedUpdatedAt:'revision-two',active:true});await actions.setDefaultProfile({id:'new-profile',expectedUpdatedAt:'revision-three'});
 assert.deepEqual(state.calls.map(call=>[call.resource,call.action]),[['import-profiles','clone'],['import-profiles','set-active'],['import-profiles','set-default']]);
 assert.deepEqual(state.calls[0].payload,clone);assert.equal(state.calls[1].payload.expectedUpdatedAt,'revision-two');assert.equal(state.calls[1].payload.active,true);assert.equal(state.calls[2].payload.expectedUpdatedAt,'revision-three');
});
test('configuration query retains inactive models and passes the cancellation signal',async()=>{
 state.calls=[];const result=await useImportProfiles().fetch();assert.equal(result.profiles[0].active,false);assert.deepEqual(state.calls[0].payload,{});assert.ok(state.calls[0].signal instanceof AbortSignal);
});
test('company queries scope their server summaries and document lists through the shared RPC',async()=>{
 state.calls=[];await useImportDocuments('finished','','client-one').fetch();
 assert.equal(state.calls[0].resource,'import-documents');assert.equal(state.calls[0].action,'list');assert.deepEqual(state.calls[0].payload,{status:'finished',search:'',clientId:'client-one'});assert.ok(state.calls[0].signal instanceof AbortSignal);
});
test('account changes prevent profile metadata writes before RPC dispatch',async()=>{
 state.calls=[];state.actor='another-owner';const actions=useImportMutations();await assert.rejects(actions.cloneProfile({id:'source',expectedUpdatedAt:'revision'}),/conta foi alterada/);assert.equal(state.calls.length,0);state.actor='owner-one';
});
