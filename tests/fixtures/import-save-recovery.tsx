import React,{useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider,onlineManager} from '@tanstack/react-query';
import {invalidateRealtimeResources} from '../../shared/query/realtimeInvalidation';
import {useImportDocument,useImportMutations,useImportTable} from '../../modules/importacoes/hooks/useImportacoes';
import {ImportEditableCell} from '../../modules/importacoes/components/ImportEditableCell';
import {useImportCellNavigation} from '../../modules/importacoes/hooks/useImportCellNavigation';
import type {ImportDocument,ImportEntry,ImportField} from '../../modules/importacoes/types';

const field:ImportField={key:'COD_TALHAO',type:'decimal',label:'Talhão',column:'H',source:'manual',required:false,defaultValue:''};
const entries:ImportEntry[]=['row-one','row-two','row-three'].map(id=>({id,date:'2026-11-05',values:{COD_TALHAO:''},source:{},sourcePage:1,sourceLine:'fixture',reviewed:false}));
type Mode='normal'|'hang-write'|'hang-session'|'commit-without-response'|'hang-refresh'|'realtime-stream'|'lagging-metadata';
const server={revision:0,entries};
const state={mode:'normal' as Mode,online:true,writes:[] as Array<{entryId:string;value:string;revision:string}>,aborts:0,reads:0,
 releaseSession:null as null|(()=>void),releaseWrite:null as null|(()=>void),
 setOnline(value:boolean){state.online=value;onlineManager.setOnline(value);},
 changeOtherRow(){server.entries[2].values.COD_TALHAO='8';server.revision++;},
 changeCurrentRow(){server.entries[0].values.COD_TALHAO='9';server.revision++;},
 refresh:async()=>{await queryClient.invalidateQueries({queryKey:['billing','owner-one','import-documents']});},
 client:{auth:{getSession:()=>state.mode==='hang-session'?new Promise<{data:{session:{user:{id:string}}};error:null}>(resolve=>{
  state.releaseSession=()=>resolve({data:{session:{user:{id:'owner-one'}}},error:null});
 }):Promise.resolve({data:{session:{user:{id:'owner-one'}}},error:null})},
 rpc(_name:string,args:{p_action:string;p_payload:Record<string,unknown>}){
  return {retry(){return this;},abortSignal(signal:AbortSignal){return handle(args.p_action,args.p_payload,signal);}};
 }},
};
Object.assign(window,{importRecovery:state});

function snapshot(){return {id:'document',clientId:'client',clientName:'Pinheiro',profileId:'profile',profileSnapshot:{fields:[field]},sourceName:'Fixture',sourceHash:'fixture',status:'open',entries:structuredClone(server.entries),entryCount:3,pendingCount:3,createdAt:'0',updatedAt:String(server.revision),finishedAt:null} as ImportDocument;}
function hang(signal:AbortSignal){
 signal.addEventListener('abort',()=>{state.aborts++;},{once:true});
 return new Promise<{data:unknown;error:null;status:number}>(resolve=>{state.releaseWrite=()=>resolve({data:{saved:true,document:snapshot()},error:null,status:200});});
}
async function handle(action:string,payload:Record<string,unknown>,signal:AbortSignal){
 if(action==='save-plot-area'){
  const entryId=(payload.entryIds as string[])[0],value=String(payload.value),revision=String(payload.expectedUpdatedAt);
  state.writes.push({entryId,value,revision});
  if(!state.online)throw new TypeError('Failed to fetch');
  if(revision!==String(server.revision))return {data:null,error:{code:'40001',message:'Revisão alterada'},status:400};
  if(state.mode==='hang-write')return hang(signal);
  server.entries.find(entry=>entry.id===entryId)!.values.COD_TALHAO=value;server.revision++;
  if(state.mode==='commit-without-response')return hang(signal);
  if(state.mode==='realtime-stream'){
   // A bulk save emits a row event for each stored field. Events can keep
   // arriving while the next cell's mutation awaits its own fresh projection.
   for(let delay=20;delay<=420;delay+=20)setTimeout(()=>void invalidateRealtimeResources(queryClient,'owner-one',['import-documents']),delay);
  }
  return {data:{saved:true,document:snapshot(),filledCount:1,unmatchedCount:0},error:null,status:200};
 }
 state.reads++;
 if(state.mode==='hang-refresh')return hang(signal);
 if(state.mode==='realtime-stream')await new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(resolve,120);
  signal.addEventListener('abort',()=>{state.aborts++;clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));},{once:true});
 });
 const doc=snapshot();
 if(action!=='table'&&state.mode==='lagging-metadata')doc.updatedAt=String(Math.max(0,server.revision-1));
 return {data:action==='table'?{entries:doc.entries,summary:{entryCount:3},facets:{},updatedAt:doc.updatedAt}:{document:doc,summary:{entryCount:3},daySummaries:[]},error:null,status:200};
}

function Fixture(){
 const model=useImportDocument('document'),table=useImportTable('document',{}),mutations=useImportMutations();
 const gridRef=useRef<HTMLDivElement>(null);
 const navigate=useImportCellNavigation({gridRef,entries:table.data?.entries??[],fields:[field],blocked:mutations.saving,updating:table.updating});
 if(!model.data||!table.data)return <p>Carregando…</p>;
 const currentDocument=model.data.document;
 const currentTable=table.data;
 return <>
  <output id="mutation-status">{mutations.saving?'saving':'idle'}</output>
  <output id="revision">{currentDocument.updatedAt}</output>
  <output id="table-revision">{currentTable.updatedAt}</output>
  <button id="refresh" onClick={()=>void Promise.all([model.reload(),table.reload()])}>Atualizar dados</button>
  <div ref={gridRef}><table><tbody>{currentTable.entries.map((entry,index)=><tr key={entry.id}><td>
   <ImportEditableCell entryId={entry.id} field={field} value={entry.values.COD_TALHAO} revision={currentTable.updatedAt}
    rowNumber={index+1} blocked={mutations.saving||table.changingFilters} saveUnchanged
    onSave={async(value,revision)=>{await mutations.savePlotArea({id:'document',entryIds:[entry.id],value,expectedUpdatedAt:revision});return true;}}
    onNavigate={move=>navigate(entry.id,field.key,move)}/>
  </td></tr>)}</tbody></table></div>
 </>;
}
const queryClient=new QueryClient({defaultOptions:{queries:{retry:2,retryDelay:50,staleTime:30_000},mutations:{retry:false}}});
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><Fixture/></QueryClientProvider>);
