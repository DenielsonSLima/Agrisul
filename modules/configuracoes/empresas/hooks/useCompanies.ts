import {useQuery} from "@tanstack/react-query";
import {useCadastroMutation} from '@/modules/cadastro/hooks/useCadastroQuery';
import {useAuth} from "@/shared/supabase/AuthProvider";
import {billingKeys} from "@/shared/query/keys";
import type {CompanyInput,CompanyLogoChange} from "../types";
import {fetchCompanies,persistCompany} from "../services/companyApi";
export function useCompanies(){
 const {user,ready}=useAuth();
 const query=useQuery({queryKey:billingKeys.resource(user?.id??"anonymous","companies"),queryFn:({signal})=>fetchCompanies(signal),enabled:ready&&!!user});
 const mutation=useCadastroMutation('companies',({data,id,logo,actorId}:{data:CompanyInput;id?:string;logo?:CompanyLogoChange;actorId:string})=>persistCompany(data,id,logo,actorId),['contracts','report-headers']);
 return {companies:query.data??[],loading:!ready||!!user&&query.isPending,error:query.error?.message??"",authRequired:ready&&!user,reload:()=>query.refetch(),save:(data:CompanyInput,id?:string,logo?:CompanyLogoChange)=>mutation.mutateAsync({data,id,logo,actorId:user?.id??''})};
}
