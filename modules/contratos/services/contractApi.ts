import {rpcRequest} from '@/shared/supabase/rpc';
export {RpcError as ContractApiError} from '@/shared/supabase/rpc';
import type {BillingContract,ContractFilters,ContractInput,ContractListData,ContractLoad,ContractLoadInput,ContractLoadFilters,ContractLoadsData} from '../types';
export async function fetchContractLoads(contractId:string,companyId:string,filters:ContractLoadFilters,signal?:AbortSignal){
 return rpcRequest<ContractLoadsData>('contracts','list',{view:'loads',contractId,companyId,...filters},signal);
}
export async function fetchContracts(filters:ContractFilters,signal?:AbortSignal):Promise<ContractListData>{
  return rpcRequest<ContractListData>('contracts','list',filters,signal);
}
export async function fetchContract(id:string,companyId:string,signal?:AbortSignal){
  return (await rpcRequest<{contract:BillingContract}>('contracts','get',{id,companyId},signal)).contract;
}
export async function persistContract(input:ContractInput,id?:string){
  return (await rpcRequest<{contract:BillingContract}>('contracts','save',{...input,id})).contract;
}
export async function persistContractLoad(contractId:string,companyId:string,input:ContractLoadInput,id?:string){
 return (await rpcRequest<{load:ContractLoad}>('contracts','save-load',{...input,contractId,companyId,...(id?{id}:{})})).load;
}
export async function deleteContractLoad(contractId:string,companyId:string,id:string){
 return rpcRequest<{id:string;deleted:true}>('contracts','delete-load',{contractId,companyId,id});
}
