import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const fixtureUrl=url(`export const state={user:{id:'owner-one'},actor:'owner-one',calls:[]};
export function useCadastroQuery(resource,params,fetcher){return {resource,params,fetch:()=>fetcher(new AbortController().signal)}}
export function useCadastroMutation(resource,save){return {resource,mutateAsync:save,isPending:false}}
export function useAuth(){return {user:state.user,ready:true}}
export const billingKeys={resource:(userId,resource)=>['billing',userId,resource]};
export function useQuery(options){state.queryOptions=options;return {data:state.queryData,isPending:false,isFetching:!!state.queryFetching,isPlaceholderData:!!state.queryPlaceholder,error:null,refetch:async()=>{}}}
export function getSupabaseBrowserClient(){return {auth:{getSession:async()=>({data:{session:{user:{id:state.actor}}},error:null})}}}
export async function rpcRequest(resource,action,payload,signal){state.calls.push({resource,action,payload,signal});return action==='list'?{profiles:[{id:'inactive',active:false}],canManage:true}:{profile:{id:'new-profile',active:false,isDefault:false}}}`);
const {state}=await import(fixtureUrl);
let source=ts.transpileModule(readFileSync(new URL('../modules/importacoes/hooks/useImportacoes.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
source=source.replace(/from ['"]@\/(?:modules\/cadastro\/hooks\/useCadastroQuery|shared\/supabase\/(?:rpc|AuthProvider|client))['"]/g,`from ${JSON.stringify(fixtureUrl)}`);
source=source.replace(/from ['"](?:@tanstack\/react-query|@\/shared\/query\/keys)['"]/g,`from ${JSON.stringify(fixtureUrl)}`);
const {useImportMutations,useImportProfiles,useImportDocuments,useImportLedger,useImportTable}=await import(url(source));

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

test('Pinheiro profile save preserves the sequence start as exact text through the shared RPC',async()=>{
 state.calls=[];state.actor='owner-one';
 const profile={name:'Pinheiro',clientId:null,parser:'pinheiro-usjp-v1',sheetName:'Plan1',startRow:2,fields:[],entrySequenceStart:'999999999999999'};
 await useImportMutations().saveProfile(profile);
 assert.equal(state.calls[0].resource,'import-profiles');assert.equal(state.calls[0].action,'save');assert.deepEqual(state.calls[0].payload,profile);assert.equal(typeof state.calls[0].payload.entrySequenceStart,'string');
});

test('Taquari profile save distinguishes an explicit cleared start from an unchanged omitted start',async()=>{
 state.calls=[];state.actor='owner-one';const mutations=useImportMutations();
 const unchanged={id:'taquari',name:'Taquari',clientId:null,parser:'taquari-equipment-v1',sheetName:'Plan1',startRow:2,fields:[],expectedUpdatedAt:'revision'};
 await mutations.saveProfile(unchanged);await mutations.saveProfile({...unchanged,entrySequenceStart:''});
 assert.equal(Object.hasOwn(state.calls[0].payload,'entrySequenceStart'),false);
 assert.equal(Object.hasOwn(state.calls[1].payload,'entrySequenceStart'),true);assert.equal(state.calls[1].payload.entrySequenceStart,'');
});

test('anchored entry numbering and edit endpoints preserve exact inputs for atomic server distribution',async()=>{
 state.calls=[];state.actor='owner-one';const mutations=useImportMutations();
 const anchored={id:'document',expectedUpdatedAt:'revision',start:'921',anchorEntryId:'entry-middle'};
 await mutations.numberGroups(anchored);
 const bulk={id:'document',expectedUpdatedAt:'revision-two',entryIds:['entry-last','entry-middle'],fieldKeys:['COD_ENTRADA'],value:'921'};
 await mutations.saveBulk(bulk);
 const edited={id:'document',entryId:'entry-middle',expectedUpdatedAt:'revision-three',date:'2026-10-22',values:{COD_ENTRADA:'921',COD_TALHAO:'00054'},reviewed:false};
 await mutations.saveEntry(edited);
 assert.deepEqual(state.calls.map(call=>[call.resource,call.action]),[['import-documents','number-groups'],['import-documents','save-bulk'],['import-documents','save-entry']]);
 assert.deepEqual(state.calls.map(call=>call.payload),[anchored,bulk,edited]);
});
test('company queries scope their server summaries and document lists through the shared RPC',async()=>{
 state.calls=[];await useImportDocuments('finished','','client-one').fetch();
 assert.equal(state.calls[0].resource,'import-documents');assert.equal(state.calls[0].action,'list');assert.deepEqual(state.calls[0].payload,{status:'finished',search:'',clientId:'client-one'});assert.ok(state.calls[0].signal instanceof AbortSignal);
});

test('company ledger sends filters and grouping to Postgres with an isolated query key and abort signal',async()=>{
 state.calls=[];const params={clientId:'client-one',status:'open',dateFrom:'2026-10-22',dateTo:'2026-10-25',farm:'0005010',plot:'__empty__',groupBy:'source-group'};
 const query=useImportLedger(params);await query.fetch();
 assert.deepEqual(query.params,{view:'ledger',...params});assert.equal(state.calls[0].resource,'import-documents');assert.equal(state.calls[0].action,'ledger');assert.deepEqual(state.calls[0].payload,params);assert.ok(state.calls[0].signal instanceof AbortSignal);
});
test('account changes prevent profile metadata writes before RPC dispatch',async()=>{
 state.calls=[];state.actor='another-owner';const actions=useImportMutations();await assert.rejects(actions.cloneProfile({id:'source',expectedUpdatedAt:'revision'}),/conta foi alterada/);assert.equal(state.calls.length,0);state.actor='owner-one';
});


test('table retains prior results only for the same account and PDF and exposes updates to block writes',async()=>{
 state.user={id:'owner-one'};state.queryFetching=true;state.queryPlaceholder=true;
 const view=useImportTable('pdf-one',{columnFilters:{COD_TALHAO:['8']}});
 const options=state.queryOptions;const previous={entries:[{id:'row-one'}]};
 assert.deepEqual(options.queryKey,['billing','owner-one','import-documents',{view:'table',id:'pdf-one',columnFilters:{COD_TALHAO:['8']}}]);
 assert.equal(options.placeholderData(previous,{queryKey:['billing','owner-one','import-documents',{view:'table',id:'pdf-one'}]}),previous);
 assert.equal(options.placeholderData(previous,{queryKey:['billing','other-owner','import-documents',{view:'table',id:'pdf-one'}]}),undefined);
 assert.equal(options.placeholderData(previous,{queryKey:['billing','owner-one','import-documents',{view:'table',id:'other-pdf'}]}),undefined);
 assert.equal(view.updating,true);
 state.queryFetching=false;state.queryPlaceholder=false;assert.equal(useImportTable('pdf-one',{}).updating,false);
});
