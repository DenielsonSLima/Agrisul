import {useCadastroMutation,useCadastroQuery} from '@/modules/cadastro/hooks/useCadastroQuery';
import {rpcRequest} from '@/shared/supabase/rpc';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {getSupabaseBrowserClient} from '@/shared/supabase/client';
import type {ImportBulkInput,ImportColumnTypeInput,ImportCollection,ImportDocument,ImportDocumentInput,ImportEntryInput,ImportExport,ImportProfile,ImportProfileInput,ImportProfileRevisionInput,ImportProfileCloneInput,ImportProfileActiveInput,ImportRevisionInput,ImportStatus,ImportOperationalSummary} from '../types';

export function useImportProfiles(){return useCadastroQuery('import-profiles',{},signal=>rpcRequest<{profiles:ImportProfile[];canManage:boolean}>('import-profiles','list',{},signal));}
export function useImportDocuments(status:ImportStatus|'all'='open',search='',clientId?:string){return useCadastroQuery('import-documents',{status,search,clientId},signal=>rpcRequest<ImportCollection>('import-documents','list',{status,search,...(clientId?{clientId}:{})},signal));}
export function useImportDocument(id:string|null){return useCadastroQuery('import-documents',{id},signal=>rpcRequest<{document:ImportDocument;summary:ImportOperationalSummary;daySummaries:Array<{date:string;summary:ImportOperationalSummary}>}>('import-documents','get',{id},signal),!!id);}
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
 const removed=useCadastroMutation('import-documents',(input:ImportRevisionInput&{entryId:string})=>call<{document:ImportDocument}>('import-documents','remove-entry',input));
 const finished=useCadastroMutation('import-documents',(input:ImportRevisionInput)=>call<{document:ImportDocument}>('import-documents','finalize',input));
 const reopened=useCadastroMutation('import-documents',(input:ImportRevisionInput)=>call<{document:ImportDocument}>('import-documents','reopen',input));
 const bulk=useCadastroMutation('import-documents',(input:ImportBulkInput)=>call<{document:ImportDocument}>('import-documents','save-bulk',input));
 const columnType=useCadastroMutation('import-documents',(input:ImportColumnTypeInput)=>call<{document:ImportDocument}>('import-documents','change-column-type',input));
 return {saveProfile:profile.mutateAsync,cloneProfile:cloned.mutateAsync,setProfileActive:activated.mutateAsync,setDefaultProfile:defaulted.mutateAsync,importDocument:imported.mutateAsync,saveEntry:entry.mutateAsync,removeEntry:removed.mutateAsync,finalize:finished.mutateAsync,reopen:reopened.mutateAsync,saveBulk:bulk.mutateAsync,changeColumnType:columnType.mutateAsync,
  exportDocument:(id:string)=>call<ImportExport>('import-documents','export',{id}),saving:[profile,cloned,activated,defaulted,imported,entry,removed,finished,reopened,bulk,columnType].some(m=>m.isPending)};
}
