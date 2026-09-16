import {rpcRequest} from '@/shared/supabase/rpc';
import type {ReportData, ReportKind} from '../types';
export function fetchReport(companyId: string, kind: ReportKind, month: string, signal?: AbortSignal) {
  return rpcRequest<ReportData>('reports', 'list', {companyId, kind, month}, signal);
}
