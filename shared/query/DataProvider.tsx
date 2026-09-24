'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {QueryClient,QueryClientProvider,useQueryClient} from '@tanstack/react-query';
import {AuthProvider,AuthGate,useAuth} from '@/shared/supabase/AuthProvider';
import {getSupabaseBrowserClient} from '@/shared/supabase/client';
import {shouldRefreshAccessForMembershipChange,type MembershipRealtimeChange} from '@/shared/supabase/authLifecycle';
import {RpcError} from '@/shared/supabase/rpc';
import {billingKeys} from './keys';
import {realtimeResources} from './realtimeResources';
import {FeedbackProvider} from '@/shared/feedback';

function RealtimeSync(){
  const {user,refreshAccess}=useAuth();const userId=user?.id;const queryClient=useQueryClient();
  useEffect(()=>{
    if(!userId)return;
    const client=getSupabaseBrowserClient();
    const pending=new Set<string>();let timer:ReturnType<typeof setTimeout>|undefined;
    let accessTimer:ReturnType<typeof setTimeout>|undefined;
    let recovery:ReturnType<typeof setInterval>|undefined;
    let active=true;
    const invalidateAll=()=>{if(active)void queryClient.invalidateQueries({queryKey:billingKeys.all(userId)});};
    const resetAuthorization=()=>{void (async()=>{
      const key=billingKeys.all(userId);
      await queryClient.cancelQueries({queryKey:key});
      if(active)await queryClient.resetQueries({queryKey:key});
    })();};
    const enqueue=(resources:readonly string[])=>{
      resources.forEach(resource=>pending.add(resource));
      if(timer)return;
      timer=setTimeout(()=>{
        timer=undefined;
        if(!active)return;
        for(const resource of pending)void queryClient.invalidateQueries({queryKey:billingKeys.resource(userId,resource)});
        pending.clear();
      },80);
    };
    const enqueueAccessRefresh=()=>{
      if(accessTimer)return;
      accessTimer=setTimeout(()=>{
        accessTimer=undefined;
        if(active)void refreshAccess({silent:true});
      },80);
    };
    const revalidateAfterConnectionRecovery=()=>{
      invalidateAll();
      enqueueAccessRefresh();
    };
    let channel=client.channel(`billing:${userId}`);
    for(const [table,resources] of Object.entries(realtimeResources)){
      // RLS controls INSERT/UPDATE visibility. DELETE cannot use owner filters;
      // only invalidate cache, never place event payloads into cached records.
      channel=channel.on('postgres_changes',{event:'*',schema:'public',table},payload=>{
        if(table==='billing_memberships'){
          const affectsCurrentUser=shouldRefreshAccessForMembershipChange(userId,payload as MembershipRealtimeChange);
          if(affectsCurrentUser){resetAuthorization();enqueueAccessRefresh();}
          else enqueue(resources);
        }else if(table==='billing_access_profiles')resetAuthorization();
        else enqueue(resources);
      });
    }
    channel.subscribe(status=>{
      if(!active)return;
      if(status==='SUBSCRIBED'){
        if(recovery){clearInterval(recovery);recovery=undefined;}
        revalidateAfterConnectionRecovery(); // Refresh events and access changes missed while offline.
      }else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){
        // Keep this fallback data-only. The online/SUBSCRIBED signals perform
        // the access check once connectivity is actually available.
        if(!recovery)recovery=setInterval(invalidateAll,30000);
      }
    });
    window.addEventListener('online',revalidateAfterConnectionRecovery);
    return()=>{
      active=false;if(timer)clearTimeout(timer);if(accessTimer)clearTimeout(accessTimer);if(recovery)clearInterval(recovery);
      window.removeEventListener('online',revalidateAfterConnectionRecovery);
      void client.removeChannel(channel);
    };
  },[userId,queryClient,refreshAccess]);
  return null;
}
export function DataProvider({children}:{children:ReactNode}){
  const [client]=useState(()=>new QueryClient({defaultOptions:{queries:{
    staleTime:30000,gcTime:300000,refetchOnWindowFocus:true,refetchOnReconnect:true,
    retry:(count,error)=>!(error instanceof RpcError && error.status<500)&&count<2,
  },mutations:{retry:false}}}));
  return <QueryClientProvider client={client}><AuthProvider><FeedbackProvider><RealtimeSync/><AuthGate>{children}</AuthGate></FeedbackProvider></AuthProvider></QueryClientProvider>;
}
