import {useCadastroMutation,useCadastroQuery} from '@/modules/cadastro/hooks/useCadastroQuery';
import {useQuery} from '@tanstack/react-query';
import {billingKeys} from '@/shared/query/keys';
import {rpcRequest} from '@/shared/supabase/rpc';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {getSupabaseBrowserClient} from '@/shared/supabase/client';
import type {ImportTable,ImportTableFilters,ImportAtrInput} from '../types';
import type {ImportBulkInput,ImportColumnTypeInput,ImportCollection,ImportDocument,ImportDocumentInput,ImportEntryInput,ImportExport,ImportProfile,ImportProfileInput,ImportProfileRevisionInput,ImportProfileCloneInput,ImportProfileActiveInput,ImportRevisionInput,ImportStatus,ImportOperationalSummary,ImportNumberGroupsInput,ImportLedger,ImportLedgerParams} from '../types';

export function useImportProfiles(){return useCadastroQuery('import-profiles',{},signal=>rpcRequest<{profiles:ImportProfile[];canManage:boolean}>('import-profiles','list',{},signal));}
export function useImportDocuments(status:ImportStatus|'all'='open',search='',clientId?:string){return useCadastroQuery('import-documents',{status,search,clientId},signal=>rpcRequest<ImportCollection>('import-documents','list',{status,search,...(clientId?{clientId}:{})},signal));}
export function useImportDocument(id:string|null){return useCadastroQuery('import-documents',{id,snapshotVersion:2},signal=>rpcRequest<{document:ImportDocument;summary:ImportOperationalSummary;daySummaries:Array<{date:string;summary:ImportOperationalSummary}>}>('import-documents','get',{id},signal),!!id);}
export function useImportLedger(params:ImportLedgerParams){return useCadastroQuery('import-documents',{view:'ledger',...params},signal=>rpcRequest<ImportLedger>('import-documents','ledger',params as unknown as Record<string,unknown>,signal));}
export function useImportTable(id:string,filters:ImportTableFilters,enabled=true){
 const {user,ready}=useAuth();const userId=user?.id??'';
 const query=useQuery({queryKey:[...billingKeys.resource(userId,'import-documents'),{view:'table',snapshotVersion:2,id,...filters}],
  queryFn:({signal})=>rpcRequest<ImportTable>('import-documents','table',{id,...filters},signal),enabled:ready&&!!user&&enabled,
  placeholderData:(previous,previousQuery)=>{
   const key=previousQuery?.queryKey;const params=key?.[3] as {id?:string;view?:string}|undefined;
   return key?.[1]===userId&&params?.view==='table'&&params.id===id?previous:undefined;
  },
 });
 return {data:query.data,loading:!ready||(!!user&&enabled&&query.isPending),updating:query.isFetching||query.isPlaceholderData,
  error:ready&&!user?'Entre para acessar seus cadastros.':query.error?.message??'',reload:async()=>{if(user&&enabled)await query.refetch();}};
}
export function useImportMutations(){
 const {user}=useAuth();
 const assertActor=async()=>{const {data:{session},error}=await getSupabaseBrowserClient().auth.getSession();if(error||!user||session?.user.id!==user.id)throw new DOMException('A conta foi alterada. Reabra o formulário.','AbortError');};
 const call=async<T>(resource:string,action:string,input:object)=>{await assertActor();const result=await rpcRequest<T>(resource,action,input as Record<string,unknown>);await assertActor();return result;};
 const profile=useCadastroMutation('import-profiles',(input:ImportProfileInput)=>call<{profile:ImportProfile}>('import-profiles','save',input));
 const cloned=useCadastroMutation('import-profiles',(input:ImportProfileCloneInput)=>call<{profile:ImportProfile}>('import-profiles','clone',input));
 const activated=useCadastroMutation('import-profiles',(input:ImportProfileActiveInput)=>call<{profile:ImportProfile}>('import-profiles','set-active',input));
 const defaulted=useCadastroMutation('import-profiles',(input:ImportProfileRevisionInput)=>call<{profile:ImportProfile}>('import-profiles','set-default',input));
 const imported=useCadastroMutation('import-documents',(input:ImportDocumentInput)=>call<{document:ImportDocument;created:boolean}>('import-documents','import',input));
 const entry=useCadastroMutation('import-documents',(input:ImportEntryInput)=>call<{document:ImportDocument}>('import-documents','save-entry',input));
 const atrs=useCadastroMutation('import-documents',(input:ImportAtrInput)=>call<{document:ImportDocument;savedCount:number}>('import-documents','save-atrs',input));
 const removed=useCadastroMutation('import-documents',(input:ImportRevisionInput&{entryId:string})=>call<{document:ImportDocument}>('import-documents','remove-entry',input));
 const finished=useCadastroMutation('import-documents',(input:ImportRevisionInput)=>call<{document:ImportDocument}>('import-documents','finalize',input));
 const reopened=useCadastroMutation('import-documents',(input:ImportRevisionInput)=>call<{document:ImportDocument}>('import-documents','reopen',input));
 const bulk=useCadastroMutation('import-documents',(input:ImportBulkInput)=>call<{document:ImportDocument}>('import-documents','save-bulk',input));
 const columnType=useCadastroMutation('import-documents',(input:ImportColumnTypeInput)=>call<{document:ImportDocument}>('import-documents','change-column-type',input));
 const numbered=useCadastroMutation('import-documents',(input:ImportNumberGroupsInput)=>call<{document:ImportDocument}>('import-documents','number-groups',input));
 return {saveProfile:profile.mutateAsync,cloneProfile:cloned.mutateAsync,setProfileActive:activated.mutateAsync,setDefaultProfile:defaulted.mutateAsync,importDocument:imported.mutateAsync,saveEntry:entry.mutateAsync,removeEntry:removed.mutateAsync,finalize:finished.mutateAsync,reopen:reopened.mutateAsync,saveBulk:bulk.mutateAsync,changeColumnType:columnType.mutateAsync,
  numberGroups:numbered.mutateAsync,saveAtrs:atrs.mutateAsync,exportDocument:(id:string,filters?:ImportTableFilters,expectedUpdatedAt?:string)=>filters?call<ImportExport>('import-documents','export-filtered',{id,...filters,expectedUpdatedAt}):call<ImportExport>('import-documents','export',{id}),saving:[profile,cloned,activated,defaulted,imported,entry,atrs,removed,finished,reopened,bulk,columnType,numbered].some(m=>m.isPending)};
}
