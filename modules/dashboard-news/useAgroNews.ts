'use client';
import {useQuery} from '@tanstack/react-query';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {authenticatedFetch} from '@/shared/supabase/rpc';
import {billingKeys} from '@/shared/query/keys';
import {isAgroNewsFeed} from './catalog';

export function useAgroNews(){
 const {user,ready}=useAuth();
 return useQuery({queryKey:[...billingKeys.resource(user?.id??'','dashboard-news'),{version:4}],enabled:ready&&!!user,
  queryFn:async({signal})=>{
   // Bound the whole request, including session lookup and response decoding.
   // Aborting fetch alone does not release a stalled session lookup.
   const controller=new AbortController();
   const cancel=()=>controller.abort(signal.reason);
   const timer=setTimeout(()=>controller.abort(new Error('A consulta de notícias demorou demais. Tente novamente.')),15000);
   signal.addEventListener('abort',cancel,{once:true});
   if(signal.aborted)cancel();
   let onAbort:()=>void=()=>{};
   try{
    const aborted=new Promise<never>((_,reject)=>{
     onAbort=()=>reject(controller.signal.reason);
     controller.signal.addEventListener('abort',onAbort,{once:true});
     if(controller.signal.aborted)onAbort();
    });
    return await Promise.race([aborted,(async()=>{
     controller.signal.throwIfAborted();
     const response=await authenticatedFetch('/api/dashboard-news',{signal:controller.signal});
     if(!response.ok)throw Error('Não foi possível atualizar as notícias.');
     const feed:unknown=await response.json();if(!isAgroNewsFeed(feed))throw Error('O serviço retornou notícias inválidas.');
     return feed;
    })()]);
   }finally{
    clearTimeout(timer);signal.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',onAbort);
   }
  },staleTime:300000,refetchInterval:300000,refetchOnReconnect:true,refetchOnWindowFocus:true,
  retry:1,
 });
}
