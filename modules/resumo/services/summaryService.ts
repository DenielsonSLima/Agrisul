import {rpcRequest} from '@/shared/supabase/rpc';
import type {ExecutiveSummaryData,SummaryData} from '../types';
export const fetchSummary = (companyId: string, month: string, signal?: AbortSignal) =>
  rpcRequest<SummaryData>('summary', 'list', {companyId, month}, signal);

export const fetchExecutiveSummary = (companyId:string,from:string,to:string,signal?:AbortSignal) =>
 rpcRequest<ExecutiveSummaryData>('summary','dashboard',{companyId,from,to},signal);
