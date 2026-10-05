import {useBillingQuery} from '@/shared/query/useBillingQuery';
import {fetchExecutiveSummary,fetchSummary} from '../services/summaryService';
import type {SummarySelection} from '../types';
export function useSummary(month: string) {
  return useBillingQuery('summary', {month}, (companyId, signal) => fetchSummary(companyId, month, signal));
}

export function useExecutiveSummary(from:string,to:string,selection:SummarySelection={contractId:'',status:''}){
 return useBillingQuery('summary',{from,to,...selection},(companyId,signal)=>fetchExecutiveSummary(companyId,from,to,signal,selection));
}
