import {useQuery} from '@tanstack/react-query';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {billingKeys} from '@/shared/query/keys';
import {useCadastroMutation, useCadastroQuery} from '../../hooks/useCadastroQuery';
import {deactivateSignature, fetchSignatureImage, fetchSignatureOptions, fetchSignatures, persistSignature} from '../services/signatureApi';
import type {SignatureFilters} from '../types';

export function useSignatures(filters: SignatureFilters) {
  const list = useCadastroQuery('signatures', {view: 'list', ...filters}, signal => fetchSignatures(filters, signal));
  const options = useCadastroQuery('signatures', {view: 'options'}, fetchSignatureOptions);
  const save = useCadastroMutation('signatures', persistSignature, ['service-requests']);
  const deactivate = useCadastroMutation('signatures', deactivateSignature, ['service-requests']);
  return {
    items: list.data?.items ?? [], total: list.data?.total ?? 0,
    page: list.data?.page ?? filters.page, pageSize: list.data?.pageSize ?? filters.pageSize,
    canManage: options.data?.canManage ?? false, users: options.data?.users ?? [],
    loading: list.loading || options.loading,
    error: list.error || options.error,
    saving: save.isPending || deactivate.isPending,
    reload: async () => {await Promise.all([list.reload(), options.reload()]);},
    save: save.mutateAsync, deactivate: deactivate.mutateAsync,
  };
}

export function useSignatureImage(path?: string | null) {
  const {user, ready} = useAuth();
  return useQuery({
    queryKey: [...billingKeys.resource(user?.id ?? '', 'signatures'), {view: 'image', path}],
    queryFn: ({signal}) => fetchSignatureImage(path!, signal),
    enabled: ready && !!user && !!path,
    staleTime: 20 * 60 * 1000,
    refetchInterval: 20 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}
