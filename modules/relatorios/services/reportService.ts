import {rpcRequest} from '@/shared/supabase/rpc';
import type {ReportData, ReportKind, ReportQuery} from '../types';
export function fetchReport(companyId: string, kind: ReportKind, query: ReportQuery, signal?: AbortSignal) {
  const {search,from,to,farmId,plotId}=query.loadFilters;
  const payload=kind==='loads'?{companyId,kind,search,from,to,farmId,plotId}:{companyId,kind,month:query.month};
  return rpcRequest<ReportData>('reports', 'list', payload, signal);
}
