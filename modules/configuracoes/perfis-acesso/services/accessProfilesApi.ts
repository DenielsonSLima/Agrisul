import {rpcRequest} from '@/shared/supabase/rpc';
import type {AccessProfile,AccessProfileInput} from '../types';

export async function fetchAccessProfiles(signal?:AbortSignal){
  return (await rpcRequest<{profiles:AccessProfile[]}>('access-profiles','list',{},signal)).profiles;
}

export async function persistAccessProfile(input:AccessProfileInput,id?:string){
  return (await rpcRequest<{profile:AccessProfile}>('access-profiles','save',{...input,...(id?{id}:{})})).profile;
}

export async function deleteAccessProfile(id:string){
  return rpcRequest<{id:string;deleted:true}>('access-profiles','delete',{id});
}

