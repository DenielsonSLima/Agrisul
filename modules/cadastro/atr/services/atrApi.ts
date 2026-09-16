import {rpcRequest} from '@/shared/supabase/rpc';
export {RpcError as AtrApiError} from '@/shared/supabase/rpc';
import type {AtrInput,AtrListResult,AtrRecord} from '../types';

export const ATR_PAGE_SIZE=12;
export async function fetchAtr(page=1,signal?:AbortSignal) {
  return rpcRequest<AtrListResult>('atr','list',{page,pageSize:ATR_PAGE_SIZE},signal);
}
export async function persistAtr(input:AtrInput,id?:string) {
  return (await rpcRequest<{record:AtrRecord}>('atr','save',{...input,id})).record;
}
