import {useCadastroMutation,useCadastroQuery} from '@/modules/cadastro/hooks/useCadastroQuery';
import {rpcRequest} from '@/shared/supabase/rpc';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {getSupabaseBrowserClient} from '@/shared/supabase/client';
import type {PurchaseCollection,PurchaseFilters,PurchaseInput,PurchaseRequest} from '../purchaseTypes';
export function usePurchaseRequests(filters:PurchaseFilters){return useCadastroQuery('purchase-requests',filters,signal=>rpcRequest<PurchaseCollection>('purchase-requests','list',filters,signal));}
export function usePurchaseMutations(){
 const {user}=useAuth();
 const assertActor=async()=>{const {data:{session},error}=await getSupabaseBrowserClient().auth.getSession();if(error||!user||session?.user.id!==user.id)throw new DOMException('A conta foi alterada. Reabra o formulário.','AbortError');};
 const save=useCadastroMutation('purchase-requests',async(input:PurchaseInput)=>{await assertActor();const result=await rpcRequest<{request:PurchaseRequest;created:boolean}>('purchase-requests','save',input);await assertActor();return result;});
 const remove=useCadastroMutation('purchase-requests',async(input:{id:string;expectedUpdatedAt:string})=>{await assertActor();const result=await rpcRequest('purchase-requests','delete',input);await assertActor();return result;});
 return {save:save.mutateAsync,remove:remove.mutateAsync,saving:save.isPending||remove.isPending};
}
