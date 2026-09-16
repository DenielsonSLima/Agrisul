import {useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import {useAuth} from "@/shared/supabase/AuthProvider";
import {billingKeys} from "@/shared/query/keys";
import type {Settings} from "@/shared/types";
import {fetchSettings,persistSettings} from "../services/settingsService";
export function useSettings(){
 const {user,ready}=useAuth();const queryClient=useQueryClient();
 const key=billingKeys.resource(user?.id??"anonymous","settings");
 const query=useQuery({queryKey:key,queryFn:({signal})=>fetchSettings(signal),enabled:ready&&!!user});
 const mutation=useMutation({mutationFn:(data:Settings)=>persistSettings(data),onSuccess:async()=>{
  await Promise.all(["settings","profile","users"].map(resource=>queryClient.invalidateQueries({queryKey:billingKeys.resource(user?.id??"anonymous",resource)})));
 }});
 return {settings:query.data,loading:!ready||!!user&&query.isPending,error:query.error?.message??"",saving:mutation.isPending,authRequired:ready&&!user,reload:()=>query.refetch(),save:async(data:Settings)=>{await mutation.mutateAsync(data)}};
}
