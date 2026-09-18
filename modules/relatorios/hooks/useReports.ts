import {useBillingQuery} from '@/shared/query/useBillingQuery';
import {fetchReport} from '../services/reportService';
import type {ReportKind, ReportQuery} from '../types';
export function useReports(kind: ReportKind, query: ReportQuery) {
  const {search,from,to,farmId,plotId}=query.loadFilters;
  const params:Record<string,string>=kind==='loads'?{kind,search,from,to,farmId,plotId}:{kind,month:query.month};
  return useBillingQuery<import('../types').ReportData>('reports', params, (companyId, signal) => fetchReport(companyId, kind, query, signal));
}
