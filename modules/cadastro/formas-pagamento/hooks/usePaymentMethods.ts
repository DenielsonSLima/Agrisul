import {useCadastroMutation,useCadastroQuery} from '@/modules/cadastro/hooks/useCadastroQuery';
import {deletePaymentMethod,fetchPaymentMethods,persistPaymentMethod} from '../services/paymentMethodApi';

export function usePaymentMethods(){
  const query=useCadastroQuery('payment-methods',{view:'list'},fetchPaymentMethods);
  return {...query,paymentMethods:query.data?.paymentMethods??[]};
}

export function usePaymentMethodMutations(){
  const save=useCadastroMutation('payment-methods',persistPaymentMethod,['purchase-orders']);
  const remove=useCadastroMutation('payment-methods',deletePaymentMethod,['purchase-orders']);
  return {save:save.mutateAsync,remove:remove.mutateAsync,saving:save.isPending,deleting:remove.isPending};
}
