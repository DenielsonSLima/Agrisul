import {rpcRequest} from '@/shared/supabase/rpc';
import type {BillingUser,UserInviteInput} from '../types';

type RpcBillingUser=Omit<BillingUser,'status'>&{status:'active'|'inactive'|'disabled'|'pending'};
function normalizeUser(user:RpcBillingUser):BillingUser{
  return {...user,status:user.status==='disabled'?'inactive':user.status};
}

export async function fetchUsers(signal?:AbortSignal) {
  return (await rpcRequest<{users:RpcBillingUser[]}>('users','list',{},signal)).users.map(normalizeUser);
}

export async function inviteUser(input:UserInviteInput) {
  return normalizeUser((await rpcRequest<{user:RpcBillingUser}>('users','invite',{
    email:input.email.trim().toLowerCase(),
    accessProfileId:input.accessProfileId,
  })).user);
}

export async function updateUserAccess(id:string,accessProfileId:string) {
  const response=await rpcRequest<{user?:RpcBillingUser}>('users','update',{id,accessProfileId});
  return response.user?normalizeUser(response.user):undefined;
}

export async function setUserEnabled(id:string,enabled:boolean) {
  const response=await rpcRequest<{user?:RpcBillingUser}>('users',enabled?'enable':'disable',{id});
  return response.user?normalizeUser(response.user):undefined;
}
