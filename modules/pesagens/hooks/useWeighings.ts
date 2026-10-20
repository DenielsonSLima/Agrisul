import {useCadastroMutation, useCadastroQuery} from '@/modules/cadastro/hooks/useCadastroQuery';
import {useWorkspaceCompany} from '@/shared/state/WorkspaceCompanyProvider';
import {deleteWeighing, deleteWeighingEntry, fetchWeighing, fetchWeighings, saveWeighing, saveWeighingEntry, weighingResource} from '../services/weighingApi';
import type {WeighingControlInput, WeighingEntryInput, WeighingFilters} from '../types';

export function useWeighings(id?: string, filters: WeighingFilters = {}) {
  const workspace = useWorkspaceCompany();
  const companyId = workspace.activeCompanyId;
  const list = useCadastroQuery(weighingResource, {companyId, view: 'list', ...filters}, signal => fetchWeighings(companyId, signal, filters), !!companyId && !id);
  const detail = useCadastroQuery(weighingResource, {companyId, view: 'detail', id, ...filters}, signal => fetchWeighing(companyId, id!, signal, filters), !!companyId && !!id);
  const selected = id ? detail : list;
  return {...selected, loading: workspace.loading || selected.loading, error: workspace.error || selected.error,
    noCompany: !workspace.loading && !workspace.error && !companyId, company: workspace.activeCompany,
    controls: list.data?.controls ?? [], detail: detail.data ?? null,
    canManage: (id ? detail.data?.canManage : list.data?.canManage) ?? false};
}

export function useWeighingMutations() {
  const {activeCompanyId} = useWorkspaceCompany();
  const save = useCadastroMutation(weighingResource, ({input, id}: {input: WeighingControlInput; id?: string}) => saveWeighing(activeCompanyId, input, id));
  const remove = useCadastroMutation(weighingResource, (id: string) => deleteWeighing(activeCompanyId, id));
  const saveEntry = useCadastroMutation(weighingResource, ({controlId, input, id}: {controlId: string; input: WeighingEntryInput; id?: string}) => saveWeighingEntry(activeCompanyId, controlId, input, id));
  const removeEntry = useCadastroMutation(weighingResource, ({controlId, id}: {controlId: string; id: string}) => deleteWeighingEntry(activeCompanyId, controlId, id));
  return {save, remove, saveEntry, removeEntry};
}
