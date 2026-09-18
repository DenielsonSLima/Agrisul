import {useQuery} from '@tanstack/react-query';
import {useCadastroMutation, useCadastroQuery} from '@/modules/cadastro/hooks/useCadastroQuery';
import {billingKeys} from '@/shared/query/keys';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {complementRequest, completeRequest, createRequest, decideRequest, fetchRequest, fetchRequestOptions, fetchRequests, requestFileUrl} from '../services/requestApi';
import type {RequestComplementInput, RequestDecisionInput, RequestExecution, RequestFilters, RequestInput, ServiceRequest} from '../types';

export function useRequestOptions() {
  return useCadastroQuery('service-requests', {view: 'options'}, fetchRequestOptions);
}
export function useRequestCollection(filters: RequestFilters, enabled = true) {
  return useCadastroQuery('service-requests', {view: 'list', ...filters}, signal => fetchRequests(filters, signal), enabled);
}
export function useRequestDetail(id: string) {
  return useCadastroQuery('service-requests', {view: 'detail', id}, signal => fetchRequest(id, signal), !!id);
}
export function useRequestMutations() {
  const creation = useCadastroMutation<{input: RequestInput; execution: RequestExecution}, ServiceRequest>('service-requests', createRequest);
  const decision = useCadastroMutation<{input: RequestDecisionInput; execution: RequestExecution}, ServiceRequest>('service-requests', decideRequest);
  return {
    create: (input: RequestInput, execution: RequestExecution) => creation.mutateAsync({input, execution}),
    decide: (input: RequestDecisionInput, execution: RequestExecution) => decision.mutateAsync({input, execution}),
    creating: creation.isPending,
    deciding: decision.isPending,
  };
}
export function useRequestComplementMutation() {
  return useCadastroMutation<{input: RequestComplementInput; execution: RequestExecution}, ServiceRequest>('service-requests', complementRequest);
}
export function useRequestCompletionMutation() {
  return useCadastroMutation<{id: string; execution: RequestExecution}, ServiceRequest>('service-requests', completeRequest);
}
export function useRequestFileUrl(bucket: string, path: string | null | undefined) {
  const {user, ready} = useAuth();
  return useQuery({
    queryKey: [...billingKeys.resource(user?.id ?? '', 'service-requests'), {view: 'file', bucket, path}],
    queryFn: ({signal}) => requestFileUrl(bucket, path!, signal),
    enabled: ready && !!user && !!path,
    staleTime: 180_000,
    gcTime: 240_000,
    refetchInterval: 180_000,
  });
}
