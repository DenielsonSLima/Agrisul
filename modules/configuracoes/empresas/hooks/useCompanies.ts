import {useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import {useAuth} from "@/shared/supabase/AuthProvider";
import {billingKeys} from "@/shared/query/keys";
import {mutationResources} from '@/shared/query/derivedResources';
import type {CompanyInput,CompanyLogoChange} from "../types";
import {fetchCompanies,persistCompany} from "../services/companyApi";
export function useCompanies(){
 const {user,ready}=useAuth();const queryClient=useQueryClient();
 const query=useQuery({queryKey:billingKeys.resource(user?.id??"anonymous","companies"),queryFn:({signal})=>fetchCompanies(signal),enabled:ready&&!!user});
 const mutation=useMutation({mutationFn:({data,id,logo}:{data:CompanyInput;id?:string;logo?:CompanyLogoChange})=>persistCompany(data,id,logo),onMutate:async()=>{
  await Promise.all(mutationResources('companies',['contracts','report-headers']).map(resource=>queryClient.cancelQueries({queryKey:billingKeys.resource(user?.id??"anonymous",resource)})));
 },onSuccess:async()=>{
  await Promise.all(mutationResources('companies',['contracts','report-headers']).map(resource=>queryClient.invalidateQueries({queryKey:billingKeys.resource(user?.id??"anonymous",resource)})));
 }});
 return {companies:query.data??[],loading:!ready||!!user&&query.isPending,error:query.error?.message??"",authRequired:ready&&!user,reload:()=>query.refetch(),save:(data:CompanyInput,id?:string,logo?:CompanyLogoChange)=>mutation.mutateAsync({data,id,logo})};
}
