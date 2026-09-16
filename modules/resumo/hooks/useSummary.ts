import {useBillingQuery} from '@/shared/query/useBillingQuery';
import {fetchSummary} from '../services/summaryService';
export function useSummary(month: string) {
  return useBillingQuery('summary', {month}, (companyId, signal) => fetchSummary(companyId, month, signal));
}
