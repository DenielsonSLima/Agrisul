import {useCadastroMutation,useCadastroQuery} from '@/modules/cadastro/hooks/useCadastroQuery';
import {rpcRequest} from '@/shared/supabase/rpc';
import type {ContractLoad} from '../types';

export interface ImportedLoadCandidate {
 documentId:string;sourceName:string;updatedAt:string;tripKey:string;loadedAt:string;volume:string|null;
 harvestMethod:'1'|'2'|null;entryCount:number;entryNumber:string|null;farmCode:string|null;plotCode:string|null;issue:string;
}
export function useImportedLoads(companyId:string,contractId:string){
 return useCadastroQuery('import-documents',{view:'pending-loads',companyId,contractId},signal=>
  rpcRequest<{loads:ImportedLoadCandidate[];canManage:boolean}>('import-documents','pending-loads',{companyId,contractId},signal),!!companyId&&!!contractId);
}
export function useLinkImportedLoad(){
 return useCadastroMutation('import-documents',(input:{companyId:string;contractId:string;id:string;tripKey:string;expectedUpdatedAt:string;farmId:string;plotId:string})=>
  rpcRequest<{load:ContractLoad;created:boolean}>('import-documents','link-load',input),['contracts','summary']);
}
