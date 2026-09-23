import {useCadastroMutation,useCadastroQuery} from '@/modules/cadastro/hooks/useCadastroQuery';
import {fetchPurchaseOrder,fetchPurchaseOrders,finishPurchaseOrder,persistPurchaseOrder} from '../services/purchaseOrderApi';
import type {PurchaseOrderFilters,PurchaseOrderInput} from '../types';

export function usePurchaseOrders(filters:PurchaseOrderFilters){
  const query=useCadastroQuery('purchase-orders',{view:'list',...filters},signal=>fetchPurchaseOrders(filters,signal));
  return {...query,orders:query.data?.orders??[],total:query.data?.total??0,counts:query.data?.counts??{open:0,finished:0}};
}

export function usePurchaseOrder(id:string|null){
  const query=useCadastroQuery('purchase-orders',{view:'detail',id},signal=>fetchPurchaseOrder(id!,signal),!!id);
  return {...query,order:query.data??null};
}

export function usePurchaseOrderMutations(){
  const save=useCadastroMutation('purchase-orders',persistPurchaseOrder);
  const finish=useCadastroMutation('purchase-orders',finishPurchaseOrder);
  return {save:(input:PurchaseOrderInput)=>save.mutateAsync(input),finish:(id:string)=>finish.mutateAsync(id),saving:save.isPending,finishing:finish.isPending};
}
