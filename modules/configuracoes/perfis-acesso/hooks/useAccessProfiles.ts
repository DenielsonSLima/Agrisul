import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {billingKeys} from '@/shared/query/keys';
import {deleteAccessProfile,fetchAccessProfiles,persistAccessProfile} from '../services/accessProfilesApi';
import type {AccessProfileInput} from '../types';

export function useAccessProfiles(){
  const {user,ready}=useAuth();const queryClient=useQueryClient();const userId=user?.id??'anonymous';
  const query=useQuery({queryKey:billingKeys.resource(userId,'access-profiles'),queryFn:({signal})=>fetchAccessProfiles(signal),enabled:ready&&!!user});
  const refresh=async()=>{await Promise.all([
    queryClient.invalidateQueries({queryKey:billingKeys.resource(userId,'access-profiles')}),
    queryClient.invalidateQueries({queryKey:billingKeys.resource(userId,'users')}),
    queryClient.invalidateQueries({queryKey:billingKeys.resource(userId,'permissions')}),
  ]);};
  const saveMutation=useMutation({mutationFn:({input,id}:{input:AccessProfileInput;id?:string})=>persistAccessProfile(input,id),onSuccess:refresh});
  const deleteMutation=useMutation({mutationFn:deleteAccessProfile,onSuccess:refresh});
  return {profiles:query.data??[],loading:!ready||!!user&&query.isPending,error:query.error?.message??'',authRequired:ready&&!user,saving:saveMutation.isPending||deleteMutation.isPending,reload:()=>query.refetch(),save:(input:AccessProfileInput,id?:string)=>saveMutation.mutateAsync({input,id}),remove:(id:string)=>deleteMutation.mutateAsync(id)};
}

