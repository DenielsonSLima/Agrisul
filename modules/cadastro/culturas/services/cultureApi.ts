import {rpcRequest} from '@/shared/supabase/rpc';
export {RpcError as CultureApiError} from '@/shared/supabase/rpc';
import type {Culture} from '../types';
export async function fetchCultures(signal?:AbortSignal){
  return (await rpcRequest<{cultures:Culture[]}>('cultures','list',{},signal)).cultures;
}
export async function persistCulture(input:{kind:'culture'|'subtype';name:string;cultureId?:string;id?:string}){
  return (await rpcRequest<{id:string}>('cultures','save',input)).id;
}
