import {rpcRequest} from '@/shared/supabase/rpc';
import type {AgendaData} from '../types';
export const fetchAgenda = (companyId: string, month: string, kind: string, signal?: AbortSignal) =>
  rpcRequest<AgendaData>('agenda', 'list', {companyId, month, kind}, signal);
