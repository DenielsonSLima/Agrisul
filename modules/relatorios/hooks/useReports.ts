import {useBillingQuery} from '@/shared/query/useBillingQuery';
import {fetchReport} from '../services/reportService';
import type {ReportKind} from '../types';
export function useReports(kind: ReportKind, month: string) {
  return useBillingQuery('reports', {kind, month}, (companyId, signal) => fetchReport(companyId, kind, month, signal));
}
