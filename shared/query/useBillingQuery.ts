'use client';
import {useQuery} from '@tanstack/react-query';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {useWorkspaceCompany} from '@/shared/state/WorkspaceCompanyProvider';
import {billingKeys} from './keys';
import {RpcError} from '@/shared/supabase/rpc';

export function useBillingQuery<T>(resource: string, params: Record<string, string>, fetcher: (companyId: string, signal: AbortSignal) => Promise<T>, options: {refetchInterval?: number;enabled?:boolean;keepPreviousData?:boolean} = {}) {
  const {user, ready} = useAuth();
  const workspace = useWorkspaceCompany();
  const companyId = workspace.activeCompanyId;
  const query = useQuery({
    queryKey: [...billingKeys.resource(user?.id ?? '', resource), {...params, companyId}],
    queryFn: ({signal}) => fetcher(companyId, signal),
    enabled: ready && !!user && !!companyId && options.enabled!==false,
    refetchInterval: options.refetchInterval,
    placeholderData:options.keepPreviousData?(previous,previousQuery)=>{
      const key=previousQuery?.queryKey,scope=key?.[3] as Record<string,unknown>|undefined,error=previousQuery?.state.error;
      if(error instanceof RpcError&&error.status<500)return undefined;
      return key?.[1]===user?.id&&key?.[2]===resource&&scope?.companyId===companyId&&scope?.projection===params.projection?previous:undefined;
    }:undefined,
  });
  return {...query, companyId, company: workspace.activeCompany,
    loading: !ready || workspace.loading || (!!user && !!companyId && query.isPending),
    errorMessage: workspace.error || query.error?.message || '',
    noCompany: !workspace.loading && !workspace.error && !companyId,
    reload: () => companyId ? query.refetch() : workspace.reload(),
  };
}
