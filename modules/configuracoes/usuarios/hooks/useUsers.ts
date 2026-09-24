import {useQuery} from '@tanstack/react-query';
import {useCadastroMutation} from '@/modules/cadastro/hooks/useCadastroQuery';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {billingKeys} from '@/shared/query/keys';
import {cancelUserInvite,fetchUsers,inviteUser,removeUser,setUserEnabled,updateUserAccess} from '../services/usersApi';
import type {UserInviteInput} from '../types';

export function useUsers(){
  const {user,ready}=useAuth();const userId=user?.id??'anonymous';
  const query=useQuery({queryKey:billingKeys.resource(userId,'users'),queryFn:({signal})=>fetchUsers(signal),enabled:ready&&!!user});
  const related=['access-profiles','permissions'];
  const inviteMutation=useCadastroMutation('users',inviteUser,related);
  const updateMutation=useCadastroMutation('users',({id,accessProfileId}:{id:string;accessProfileId:string})=>updateUserAccess(id,accessProfileId),related);
  const statusMutation=useCadastroMutation('users',({id,enabled}:{id:string;enabled:boolean})=>setUserEnabled(id,enabled),related);
  const cancelMutation=useCadastroMutation('users',cancelUserInvite,related);
  const removeMutation=useCadastroMutation('users',removeUser,related);
  return {users:query.data??[],loading:!ready||!!user&&query.isPending,error:query.error?.message??'',authRequired:ready&&!user,saving:inviteMutation.isPending||updateMutation.isPending||statusMutation.isPending||cancelMutation.isPending||removeMutation.isPending,reload:()=>query.refetch(),invite:(input:UserInviteInput)=>inviteMutation.mutateAsync(input),updateAccess:(id:string,accessProfileId:string)=>updateMutation.mutateAsync({id,accessProfileId}),setEnabled:(id:string,enabled:boolean)=>statusMutation.mutateAsync({id,enabled}),cancelInvite:(id:string)=>cancelMutation.mutateAsync(id),remove:(id:string)=>removeMutation.mutateAsync(id)};
}
