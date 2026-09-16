import {rpcRequest,authenticatedFetch,RpcError} from '@/shared/supabase/rpc';
export {RpcError as ClientApiError} from '@/shared/supabase/rpc';
import type {ClientInput,Client} from '../types';

export async function fetchClients(signal?:AbortSignal) {
  return (await rpcRequest<{clients:Client[]}>('clients','list',{},signal)).clients;
}
export async function persistClient(input:ClientInput,id?:string) {
  return (await rpcRequest<{client:Client}>('clients','save',{...input,id})).client;
}
export async function fetchClient(id:string,signal?:AbortSignal) {
  return (await rpcRequest<{client:Client}>('clients','get',{id},signal)).client;
}
export async function fetchClientCnpj(cnpj:string,signal?:AbortSignal) {
  const response=await authenticatedFetch('/api/clients/lookup?cnpj='+encodeURIComponent(cnpj),{signal,cache:'no-store'});
  const body=await response.json() as {details?:ClientInput;error?:string};
  if(!response.ok) throw new RpcError(body.error||'Não foi possível consultar o CNPJ.',response.status);
  if(!body.details) throw new Error('Não foi possível consultar o CNPJ.');
  return body.details;
}
