'use client';
import {useQuery} from '@tanstack/react-query';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {useWorkspaceCompany} from '@/shared/state/WorkspaceCompanyProvider';
import {billingKeys} from './keys';

export function useBillingQuery<T>(resource: string, params: Record<string, string>, fetcher: (companyId: string, signal: AbortSignal) => Promise<T>) {
  const {user, ready} = useAuth();
  const workspace = useWorkspaceCompany();
  const companyId = workspace.activeCompanyId;
  const query = useQuery({
    queryKey: [...billingKeys.resource(user?.id ?? '', resource), {...params, companyId}],
    queryFn: ({signal}) => fetcher(companyId, signal),
    enabled: ready && !!user && !!companyId,
  });
  return {...query, companyId, company: workspace.activeCompany,
    loading: !ready || workspace.loading || (!!user && !!companyId && query.isPending),
    errorMessage: workspace.error || query.error?.message || '',
    noCompany: !workspace.loading && !workspace.error && !companyId,
    reload: () => companyId ? query.refetch() : workspace.reload(),
  };
}
