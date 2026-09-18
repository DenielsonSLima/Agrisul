import {useCadastroQuery,useCadastroMutation} from '@/modules/cadastro/hooks/useCadastroQuery';
import {closeContract,deleteContractLoad,fetchContract,fetchContracts,persistContract,persistContractLoad} from '../services/contractApi';
import type {ContractFilters,ContractInput,ContractLoadInput} from '../types';
import {useWorkspaceCompany} from '@/shared/state/WorkspaceCompanyProvider';
const defaultFilters:Omit<ContractFilters,'companyId'>={bucket:'open',search:'',from:'',to:''};
export function useContracts(id?:string,filters:Omit<ContractFilters,'companyId'>=defaultFilters){
  const workspace=useWorkspaceCompany();const companyId=workspace.activeCompanyId;const scopedFilters={...filters,companyId};
  const list=useCadastroQuery('contracts',scopedFilters,signal=>fetchContracts(scopedFilters,signal),!id&&!!companyId);
  const detail=useCadastroQuery('contracts',{view:'detail',id,companyId},signal=>fetchContract(id!,companyId,signal),!!id&&!!companyId);
  const selected=id?detail:list;
  return {...selected,loading:workspace.loading||selected.loading,error:workspace.error||selected.error,contracts:list.data?.contracts??[],counts:list.data?.counts??{open:0,finished:0},total:list.data?.total??0,summary:list.data?.summary??null,contract:detail.data??null};
}
export function useContractLoadsMutation(){
 const {activeCompanyId}=useWorkspaceCompany();
 const save=useCadastroMutation('contracts',({contractId,input,id}:{contractId:string;input:ContractLoadInput;id?:string})=>persistContractLoad(contractId,activeCompanyId,input,id));
 const remove=useCadastroMutation('contracts',({contractId,id}:{contractId:string;id:string})=>deleteContractLoad(contractId,activeCompanyId,id));
 return {save:(contractId:string,input:ContractLoadInput,id?:string)=>save.mutateAsync({contractId,input,id}),remove:(contractId:string,id:string)=>remove.mutateAsync({contractId,id}),saving:save.isPending||remove.isPending};
}
export function useContractsMutation(){
  const {activeCompanyId}=useWorkspaceCompany();
  return useCadastroMutation('contracts',({input,id}:{input:ContractInput;id?:string})=>persistContract({...input,companyId:activeCompanyId},id));
}
export function useContractLifecycleMutation(){
 const {activeCompanyId}=useWorkspaceCompany();
 return useCadastroMutation('contracts',(contractId:string)=>closeContract(contractId,activeCompanyId));
}
