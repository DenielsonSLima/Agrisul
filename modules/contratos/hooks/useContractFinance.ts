import {useCadastroMutation} from '@/modules/cadastro/hooks/useCadastroQuery';
import {rpcRequest} from '@/shared/supabase/rpc';
import {useWorkspaceCompany} from '@/shared/state/WorkspaceCompanyProvider';
import {useQueryClient} from '@tanstack/react-query';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {billingKeys} from '@/shared/query/keys';
import type {ContractDiscountInput,ContractPaymentInput,ContractRefundInput} from '../types';

type FinanceChange=
 |{action:'save-payment';input:ContractPaymentInput;id?:string;expectedRevision?:number}
 |{action:'save-discount';input:ContractDiscountInput;id?:string;expectedRevision?:number}
 |{action:'save-refund';input:ContractRefundInput;id?:string;expectedRevision?:number}
 |{action:'delete-payment'|'delete-discount'|'delete-refund';id:string;expectedRevision:number};

export function useContractFinance(contractId:string){
 const {activeCompanyId}=useWorkspaceCompany();
 const {user}=useAuth(),queryClient=useQueryClient();
 return useCadastroMutation('contracts',async(change:FinanceChange)=>{
  if(user)await queryClient.cancelQueries({queryKey:billingKeys.resource(user.id,'contracts')});
  const {action,...values}=change;
  const payload={companyId:activeCompanyId,contractId,
   ...('input' in values?values.input:{}),
   ...(values.id?{id:values.id,expectedRevision:values.expectedRevision}:{})};
  return rpcRequest<{id:string}>('contracts',action,payload);
 });
}
