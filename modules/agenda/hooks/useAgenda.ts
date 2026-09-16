import {useBillingQuery} from '@/shared/query/useBillingQuery';
import {fetchAgenda} from '../services/eventService';
export function useAgenda(month: string, kind: string) {
  return useBillingQuery('agenda', {month, kind}, (companyId, signal) => fetchAgenda(companyId, month, kind, signal));
}
