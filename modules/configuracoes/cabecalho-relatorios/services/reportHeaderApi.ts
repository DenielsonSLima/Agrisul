import {rpcRequest} from "@/shared/supabase/rpc";
import type {ReportHeaderVariant} from "@/shared/reporting";
import {defaultReportHeaderSettings,type ReportHeaderSettings} from "../types";

function variant(value:Partial<ReportHeaderVariant>|null|undefined,fallback:ReportHeaderVariant):ReportHeaderVariant{
 return {variant:value?.variant==="compact"?"compact":"detailed",logoAlignment:["left","center","right"].includes(value?.logoAlignment??"")?value!.logoAlignment!:fallback.logoAlignment,showCnpj:value?.showCnpj!==false,showContact:value?.showContact!==false};
}
function normalize(value:Partial<ReportHeaderSettings>|null|undefined):ReportHeaderSettings{
 return {orientation:value?.orientation==="landscape"?"landscape":"portrait",defaultCompanyId:typeof value?.defaultCompanyId==="string"&&value.defaultCompanyId?value.defaultCompanyId:null,portrait:variant(value?.portrait,defaultReportHeaderSettings.portrait),landscape:variant(value?.landscape,defaultReportHeaderSettings.landscape),updatedAt:typeof value?.updatedAt==="string"?value.updatedAt:null};
}
export async function fetchReportHeader(signal?:AbortSignal){const response=await rpcRequest<{settings:Partial<ReportHeaderSettings>}>('report-headers','get',{},signal);return normalize(response.settings);}
export async function persistReportHeader(settings:ReportHeaderSettings){
 const payload={orientation:settings.orientation,defaultCompanyId:settings.defaultCompanyId,portrait:settings.portrait,landscape:settings.landscape};
 const response=await rpcRequest<{settings:Partial<ReportHeaderSettings>}>('report-headers','save',payload);
 return normalize(response.settings);
}
