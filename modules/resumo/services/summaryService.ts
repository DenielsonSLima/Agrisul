import {rpcRequest} from '@/shared/supabase/rpc';
import type {ExecutiveSummaryData,SummaryData,SummarySelection} from '../types';
export const fetchSummary = (companyId: string, month: string, signal?: AbortSignal) =>
  rpcRequest<SummaryData>('summary', 'list', {companyId, month}, signal);

export async function fetchExecutiveSummary(companyId:string,from:string,to:string,signal?:AbortSignal,selection:SummarySelection={contractId:'',status:''}){
 const payload={companyId,from,to,...(selection.contractId?{contractId:selection.contractId}:{}),...(selection.status?{status:selection.status}:{})};
 const data=await rpcRequest<ExecutiveSummaryData>('summary','dashboard',payload,signal);
 // Never display an unfiltered result as if the chosen selection were applied.
 if((selection.contractId||selection.status)&&(!data.filters||data.filters.companyId!==companyId||data.filters.contractId!==selection.contractId||data.filters.status!==selection.status)){
  throw new Error('Não foi possível aplicar a seleção. Limpe os filtros e tente novamente.');
 }
 return data;
}
