import type {Settings} from "@/shared/types";
import {rpcRequest} from "@/shared/supabase/rpc";
export async function fetchSettings(signal?:AbortSignal){return (await rpcRequest<{settings:Settings}>("settings","get",{},signal)).settings;}
export async function persistSettings(data:Settings){
 return (await rpcRequest<{settings:Settings}>("settings","save",{name:data.name,company:data.company,compact:data.compact})).settings;
}
