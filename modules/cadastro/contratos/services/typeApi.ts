import {rpcRequest} from '@/shared/supabase/rpc';
export {RpcError as TypeApiError} from '@/shared/supabase/rpc';
import type {ContractTypeInput,ContractType} from '../types';

export async function fetchTypes(signal?:AbortSignal) {
  return (await rpcRequest<{types:ContractType[]}>('contract-types','list',{},signal)).types;
}
export async function persistType(input:ContractTypeInput,id?:string) {
  return (await rpcRequest<{type:ContractType}>('contract-types','save',{...input,id})).type;
}
export async function fetchType(id:string,signal?:AbortSignal) {
  return (await rpcRequest<{type:ContractType}>('contract-types','get',{id},signal)).type;
}
