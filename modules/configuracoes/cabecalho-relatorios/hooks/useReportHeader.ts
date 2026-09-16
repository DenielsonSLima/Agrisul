import {useState} from "react";
import {useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import {useAuth} from "@/shared/supabase/AuthProvider";
import {billingKeys} from "@/shared/query/keys";
import {notifications} from "@/shared/feedback";
import type {ReportCompanyBrand,ReportHeaderVariant,ReportIssuer,ReportOrientation,ReportWatermarkBrand} from "@/shared/reporting";
import {fetchCompanies} from "../../empresas/services/companyApi";
import {fetchWatermark} from "../../marca-dagua/services/watermarkApi";
import {fetchSettings} from "../../services/settingsService";
import {defaultReportHeaderSettings,type ReportHeaderSettings} from "../types";
import {fetchReportHeader,persistReportHeader} from "../services/reportHeaderApi";

export function useReportHeader(activeCompanyId?:string,orientationOverride?:ReportOrientation){
 const {user,ready}=useAuth();const queryClient=useQueryClient();const userId=user?.id??"anonymous";
 const headerQuery=useQuery({queryKey:billingKeys.resource(userId,"report-headers"),queryFn:({signal})=>fetchReportHeader(signal),enabled:ready&&!!user});
 const companiesQuery=useQuery({queryKey:billingKeys.resource(userId,"companies"),queryFn:({signal})=>fetchCompanies(signal),enabled:ready&&!!user});
 const watermarkQuery=useQuery({queryKey:billingKeys.resource(userId,"watermarks"),queryFn:({signal})=>fetchWatermark(signal),enabled:ready&&!!user,staleTime:300000,refetchInterval:3000000});
 const profileQuery=useQuery({queryKey:billingKeys.resource(userId,"settings"),queryFn:({signal})=>fetchSettings(signal),enabled:ready&&!!user});
 const [draft,setDraft]=useState<ReportHeaderSettings|null>(null);const [operationError,setOperationError]=useState('');const [issuedAt]=useState(()=>new Date());
 const settings=draft??headerQuery.data??defaultReportHeaderSettings;
 const companies=companiesQuery.data??[];
 const selected=companies.find(company=>company.id===activeCompanyId)??companies.find(company=>company.id===settings.defaultCompanyId)??companies.find(company=>company.isPrimary)??companies[0]??null;
 const company:ReportCompanyBrand|null=selected?{id:selected.id,name:selected.name,legalName:selected.legalName,cnpj:selected.cnpj,phone:selected.phone,email:selected.email,street:selected.street,number:selected.number,complement:selected.complement,district:selected.district,city:selected.city,state:selected.state,zipCode:selected.zipCode,logoUrl:selected.logoUrl}:null;
 const watermarkSettings=watermarkQuery.data;
 const watermarkFor=(value:typeof watermarkSettings):ReportWatermarkBrand=>({imageUrl:(orientationOverride??settings.orientation)==="portrait"?value?.portraitImageUrl??null:value?.landscapeImageUrl??null,opacity:value?.opacity??15,size:value?.size??60});
 const watermark=watermarkFor(watermarkSettings);
 const refreshWatermark=async()=>{const result=await watermarkQuery.refetch();if(result.error)throw result.error;return watermarkFor(result.data);};
 const issuer:ReportIssuer={id:user?.id??"",name:profileQuery.data?.name??user?.user_metadata?.display_name??user?.email??"Usuário",email:user?.email??profileQuery.data?.email??""};
 const mutation=useMutation({mutationFn:persistReportHeader,onSuccess:async saved=>{queryClient.setQueryData(billingKeys.resource(userId,"report-headers"),saved);await queryClient.invalidateQueries({queryKey:billingKeys.resource(userId,"report-headers")});}});
 const change=(patch:Partial<Pick<ReportHeaderSettings,"orientation"|"defaultCompanyId">>)=>setDraft(current=>({...current??headerQuery.data??defaultReportHeaderSettings,...patch}));
 const changeVariant=(orientation:ReportOrientation,patch:Partial<ReportHeaderVariant>)=>setDraft(current=>{const base=current??headerQuery.data??defaultReportHeaderSettings;return {...base,[orientation]:{...base[orientation],...patch}};});
 const save=async()=>{if(!user||mutation.isPending)return;setOperationError('');try{const saved=await mutation.mutateAsync(settings);setDraft(null);notifications.saved("Os modelos de cabeçalho em retrato e paisagem foram salvos.");return saved;}catch(error){const message=(error as Error).message;setOperationError(message);notifications.error(message);throw error;}};
 const errors=[headerQuery.error,companiesQuery.error,watermarkQuery.error,profileQuery.error].filter(Boolean) as Error[];
 return {settings,companies,company,watermark,refreshWatermark,issuer,issuedAt,loading:!ready||!!user&&[headerQuery,companiesQuery,watermarkQuery,profileQuery].some(query=>query.isPending),saving:mutation.isPending,error:errors[0]?.message??"",operationError,authRequired:ready&&!user,dirty:!!draft,change,changeVariant,save,reload:async()=>{setOperationError('');await Promise.all([headerQuery.refetch(),companiesQuery.refetch(),watermarkQuery.refetch(),profileQuery.refetch()]);}};
}
