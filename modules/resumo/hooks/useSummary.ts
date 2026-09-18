import {useBillingQuery} from '@/shared/query/useBillingQuery';
import {fetchExecutiveSummary,fetchSummary} from '../services/summaryService';
export function useSummary(month: string) {
  return useBillingQuery('summary', {month}, (companyId, signal) => fetchSummary(companyId, month, signal));
}

export function useExecutiveSummary(from:string,to:string){
 return useBillingQuery('summary',{from,to},(companyId,signal)=>fetchExecutiveSummary(companyId,from,to,signal));
}
