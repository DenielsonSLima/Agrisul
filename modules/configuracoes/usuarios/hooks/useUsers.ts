import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {billingKeys} from '@/shared/query/keys';
import {cancelUserInvite,fetchUsers,inviteUser,removeUser,setUserEnabled,updateUserAccess} from '../services/usersApi';
import type {UserInviteInput} from '../types';

export function useUsers(){
  const {user,ready}=useAuth();const queryClient=useQueryClient();const userId=user?.id??'anonymous';
  const query=useQuery({queryKey:billingKeys.resource(userId,'users'),queryFn:({signal})=>fetchUsers(signal),enabled:ready&&!!user});
  const refresh=async()=>{await Promise.all([
    queryClient.invalidateQueries({queryKey:billingKeys.resource(userId,'users')}),
    queryClient.invalidateQueries({queryKey:billingKeys.resource(userId,'access-profiles')}),
    queryClient.invalidateQueries({queryKey:billingKeys.resource(userId,'permissions')}),
  ]);};
  const inviteMutation=useMutation({mutationFn:inviteUser,onSuccess:refresh});
  const updateMutation=useMutation({mutationFn:({id,accessProfileId}:{id:string;accessProfileId:string})=>updateUserAccess(id,accessProfileId),onSuccess:refresh});
  const statusMutation=useMutation({mutationFn:({id,enabled}:{id:string;enabled:boolean})=>setUserEnabled(id,enabled),onSuccess:refresh});
  const cancelMutation=useMutation({mutationFn:cancelUserInvite,onSuccess:refresh});
  const removeMutation=useMutation({mutationFn:removeUser,onSuccess:refresh});
  return {users:query.data??[],loading:!ready||!!user&&query.isPending,error:query.error?.message??'',authRequired:ready&&!user,saving:inviteMutation.isPending||updateMutation.isPending||statusMutation.isPending||cancelMutation.isPending||removeMutation.isPending,reload:()=>query.refetch(),invite:(input:UserInviteInput)=>inviteMutation.mutateAsync(input),updateAccess:(id:string,accessProfileId:string)=>updateMutation.mutateAsync({id,accessProfileId}),setEnabled:(id:string,enabled:boolean)=>statusMutation.mutateAsync({id,enabled}),cancelInvite:(id:string)=>cancelMutation.mutateAsync(id),remove:(id:string)=>removeMutation.mutateAsync(id)};
}
