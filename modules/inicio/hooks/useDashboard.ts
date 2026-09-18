'use client';
import {useQuery} from '@tanstack/react-query';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {useWorkspaceCompany} from '@/shared/state/WorkspaceCompanyProvider';
import {billingKeys} from '@/shared/query/keys';
import {fetchDashboard} from '../services/dashboardService';

export function useDashboard(month: string) {
  const {user, ready} = useAuth();
  const workspace = useWorkspaceCompany();
  const companyId = workspace.activeCompanyId;
  const query = useQuery({
    queryKey: [...billingKeys.resource(user?.id ?? '', 'home'), {companyId, month}],
    queryFn: ({signal}) => fetchDashboard(companyId, month, signal),
    enabled: ready && !!user && !workspace.loading,
    // Refresh dates and deadlines even when the page stays open overnight.
    refetchInterval: 60_000,
  });
  return {...query, company: workspace.activeCompany, companyError: workspace.error,
    loading: !ready || workspace.loading || query.isPending,
    errorMessage: query.error?.message ?? '', reload: query.refetch};
}
