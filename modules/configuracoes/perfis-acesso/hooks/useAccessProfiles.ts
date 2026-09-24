import {useQuery} from '@tanstack/react-query';
import {useCadastroMutation} from '@/modules/cadastro/hooks/useCadastroQuery';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {billingKeys} from '@/shared/query/keys';
import {deleteAccessProfile,fetchAccessProfiles,persistAccessProfile} from '../services/accessProfilesApi';
import type {AccessProfileInput} from '../types';

export function useAccessProfiles(){
  const {user,ready}=useAuth();const userId=user?.id??'anonymous';
  const query=useQuery({queryKey:billingKeys.resource(userId,'access-profiles'),queryFn:({signal})=>fetchAccessProfiles(signal),enabled:ready&&!!user});
  const related=['users','permissions'];
  const saveMutation=useCadastroMutation('access-profiles',({input,id}:{input:AccessProfileInput;id?:string})=>persistAccessProfile(input,id),related);
  const deleteMutation=useCadastroMutation('access-profiles',deleteAccessProfile,related);
  return {profiles:query.data??[],loading:!ready||!!user&&query.isPending,error:query.error?.message??'',authRequired:ready&&!user,saving:saveMutation.isPending||deleteMutation.isPending,reload:()=>query.refetch(),save:(input:AccessProfileInput,id?:string)=>saveMutation.mutateAsync({input,id}),remove:(id:string)=>deleteMutation.mutateAsync(id)};
}

