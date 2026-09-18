import {functionRequest,rpcRequest} from '@/shared/supabase/rpc';
import type {BillingUser,UserInviteInput} from '../types';

type RpcBillingUser=Omit<BillingUser,'status'>&{status:'active'|'inactive'|'disabled'|'pending'};
function normalizeUser(user:RpcBillingUser):BillingUser{
  return {...user,status:user.status==='disabled'?'inactive':user.status};
}

export async function fetchUsers(signal?:AbortSignal) {
  return (await rpcRequest<{users:RpcBillingUser[]}>('users','list',{},signal)).users.map(normalizeUser);
}

export async function inviteUser(input:UserInviteInput) {
  return normalizeUser((await functionRequest<{user:RpcBillingUser}>('billing-user-invite',{
    email:input.email.trim().toLowerCase(),
    accessProfileId:input.accessProfileId,
    requestId:crypto.randomUUID(),
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

export async function cancelUserInvite(id:string){
  const response=await rpcRequest<{user?:RpcBillingUser}>('users','cancel-invite',{id});
  return response.user?normalizeUser(response.user):undefined;
}

export async function removeUser(id:string){
  const response=await rpcRequest<{user?:RpcBillingUser}>('users','remove',{id});
  return response.user?normalizeUser(response.user):undefined;
}
