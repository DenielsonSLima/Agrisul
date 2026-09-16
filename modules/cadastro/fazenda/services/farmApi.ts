import {rpcRequest} from '@/shared/supabase/rpc';
export {RpcError as FarmApiError} from '@/shared/supabase/rpc';
import type {FarmInput,Farm,FarmListData} from '../types';

export async function fetchFarms(signal?:AbortSignal) {
  return rpcRequest<FarmListData>('farms','list',{},signal);
}
export async function persistFarm(input:FarmInput,id?:string) {
  return (await rpcRequest<{farm:Farm}>('farms','save',{...input,id})).farm;
}
