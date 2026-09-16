import {rpcRequest} from '@/shared/supabase/rpc';
export {RpcError as PracticeApiError} from '@/shared/supabase/rpc';
import type {PracticeInput,CulturalPractice,ManagementList,SugarcaneBootstrapResult} from '../types';

export type PracticeFilters={cultureId?:string;cultureSubtypeId?:string};
export async function fetchPractices(signal?:AbortSignal):Promise<ManagementList>;
export async function fetchPractices(filters:PracticeFilters,signal?:AbortSignal):Promise<ManagementList>;
export async function fetchPractices(filtersOrSignal:PracticeFilters|AbortSignal={},signal?:AbortSignal) {
  const filters=filtersOrSignal instanceof AbortSignal?{}:filtersOrSignal;
  const requestSignal=filtersOrSignal instanceof AbortSignal?filtersOrSignal:signal;
  return rpcRequest<ManagementList>('cultural-practices','list',filters,requestSignal);
}
export async function persistPractice(input:PracticeInput,id?:string) {
  return (await rpcRequest<{practice:CulturalPractice}>('cultural-practices','save',{...input,id})).practice;
}
export async function deletePractice(id:string){
  return rpcRequest<{id:string;deleted:true}>('cultural-practices','delete',{id});
}
export async function bootstrapSugarcaneManagement(){
  return rpcRequest<SugarcaneBootstrapResult>('cultural-practices','bootstrap-sugarcane',{});
}
