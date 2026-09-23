import {rpcRequest} from '@/shared/supabase/rpc';
import type {PaymentMethod,PaymentMethodCollection,PaymentMethodInput} from '../types';

export const fetchPaymentMethods=(signal:AbortSignal)=>
  rpcRequest<PaymentMethodCollection>('payment-methods','list',{},signal);

export const persistPaymentMethod=async(input:PaymentMethodInput)=>
  (await rpcRequest<{paymentMethod:PaymentMethod}>('payment-methods','save',input)).paymentMethod;

export const deletePaymentMethod=(id:string)=>
  rpcRequest<{id:string;deleted:true}>('payment-methods','delete',{id});
