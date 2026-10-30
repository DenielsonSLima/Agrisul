'use client';
import {useQuery} from '@tanstack/react-query';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {authenticatedFetch} from '@/shared/supabase/rpc';
import {billingKeys} from '@/shared/query/keys';
import {isTvFeed} from './catalog';

export function useDashboardTv(){
 const {user,ready}=useAuth();
 return useQuery({queryKey:[...billingKeys.resource(user?.id??'','dashboard-tv'),{version:2}],enabled:ready&&!!user,
  queryFn:async({signal})=>{
   const response=await authenticatedFetch('/api/dashboard-tv',{signal:AbortSignal.any([signal,AbortSignal.timeout(45000)])});
   if(!response.ok)throw Error('Não foi possível atualizar os vídeos.');
   const feed:unknown=await response.json();if(!isTvFeed(feed))throw Error('O serviço retornou uma lista de vídeos inválida.');
   return feed;
  },staleTime:300000,refetchInterval:300000,refetchOnReconnect:true,retry:1,
 });
}
