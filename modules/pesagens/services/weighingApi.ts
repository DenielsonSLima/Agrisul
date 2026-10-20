import {rpcRequest} from '@/shared/supabase/rpc';
import type {WeighingControl, WeighingControlInput, WeighingDetail, WeighingEntry, WeighingEntryInput, WeighingList, WeighingFilters} from '../types';

export const weighingResource = 'cane-weighings';
export const fetchWeighings = (companyId: string, signal: AbortSignal, filters: WeighingFilters = {}) =>
  rpcRequest<WeighingList>(weighingResource, 'list', {...filters, companyId}, signal);
export const fetchWeighing = (companyId: string, id: string, signal: AbortSignal, filters: WeighingFilters = {}) =>
  rpcRequest<WeighingDetail>(weighingResource, 'get', {...filters, companyId, id}, signal);
export const saveWeighing = async (companyId: string, input: WeighingControlInput, id?: string) =>
  (await rpcRequest<{control: WeighingControl}>(weighingResource, 'save', {...input, companyId, ...(id ? {id} : {})})).control;
export const deleteWeighing = (companyId: string, id: string) =>
  rpcRequest<{deleted: boolean}>(weighingResource, 'delete', {companyId, id});
export const saveWeighingEntry = async (companyId: string, controlId: string, input: WeighingEntryInput, id?: string) =>
  (await rpcRequest<{entry: WeighingEntry}>(weighingResource, 'save-entry', {...input, companyId, controlId, ...(id ? {id} : {})})).entry;
export const deleteWeighingEntry = (companyId: string, controlId: string, id: string) =>
  rpcRequest<{deleted: boolean}>(weighingResource, 'delete-entry', {companyId, controlId, id});
