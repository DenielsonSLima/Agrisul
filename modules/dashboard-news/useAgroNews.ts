'use client';
import {useQuery} from '@tanstack/react-query';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {authenticatedFetch} from '@/shared/supabase/rpc';
import {billingKeys} from '@/shared/query/keys';
import {isAgroNewsFeed} from './catalog';

export function useAgroNews(){
 const {user,ready}=useAuth();
 return useQuery({queryKey:[...billingKeys.resource(user?.id??'','dashboard-news'),{version:2}],enabled:ready&&!!user,
  queryFn:async({signal})=>{
   const response=await authenticatedFetch('/api/dashboard-news',{signal});
   if(!response.ok)throw Error('Não foi possível atualizar as notícias.');
   const feed:unknown=await response.json();if(!isAgroNewsFeed(feed))throw Error('O serviço retornou notícias inválidas.');
   return feed;
  },staleTime:300000,refetchInterval:300000,refetchOnReconnect:true,refetchOnWindowFocus:true,
 });
}
