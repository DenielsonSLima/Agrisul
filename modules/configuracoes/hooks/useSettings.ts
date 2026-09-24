import {useCadastroMutation,useCadastroQuery} from "@/modules/cadastro/hooks/useCadastroQuery";
import type {Settings} from "@/shared/types";
import {fetchSettings,persistSettings} from "../services/settingsService";
export function useSettings(){
 const query=useCadastroQuery('settings',{},fetchSettings);
 const mutation=useCadastroMutation<Settings,Awaited<ReturnType<typeof persistSettings>>>('settings',persistSettings,['profile','users','planning']);
 return {settings:query.data,loading:query.loading,error:query.error,saving:mutation.isPending,authRequired:query.authRequired,reload:query.reload,save:async(data:Settings)=>{await mutation.mutateAsync(data)}};
}
