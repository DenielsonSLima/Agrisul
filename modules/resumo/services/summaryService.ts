import {rpcRequest} from '@/shared/supabase/rpc';
import type {SummaryData} from '../types';
export const fetchSummary = (companyId: string, month: string, signal?: AbortSignal) =>
  rpcRequest<SummaryData>('summary', 'list', {companyId, month}, signal);
