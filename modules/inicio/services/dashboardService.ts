import {rpcRequest} from '@/shared/supabase/rpc';
import type {HomeData} from '../types';

export const fetchDashboard = (companyId: string, month: string, signal?: AbortSignal) =>
  rpcRequest<HomeData>('home', 'get', {companyId, month}, signal);
