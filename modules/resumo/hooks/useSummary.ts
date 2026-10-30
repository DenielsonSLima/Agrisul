import {useBillingQuery} from '@/shared/query/useBillingQuery';
import {fetchExecutiveSummary,fetchSummary,normalizeSummarySelection} from '../services/summaryService';
import type {SummarySelection} from '../types';
export function useSummary(month: string) {
  return useBillingQuery('summary', {month}, (companyId, signal) => fetchSummary(companyId, month, signal));
}

export function useExecutiveSummary(from:string,to:string,selection:SummarySelection={contractId:'',status:''},enabled=true){
 const normalized=normalizeSummarySelection(selection),{partnerIds,contractIds,farmIds,plotIds,...single}=normalized;
 // A new projection must not reuse cached snapshots without operational periods.
 const params={projection:'periods-v2',from,to,...single,partnerIds:JSON.stringify(partnerIds),contractIds:JSON.stringify(contractIds),farmIds:JSON.stringify(farmIds),plotIds:JSON.stringify(plotIds)};
 return useBillingQuery('summary',params,(companyId,signal)=>fetchExecutiveSummary(companyId,from,to,signal,normalized),{refetchInterval:60000,enabled});
}
