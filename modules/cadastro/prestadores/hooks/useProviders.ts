import {useCadastroMutation, useCadastroQuery} from '../../hooks/useCadastroQuery';
import {deleteProviderContact, fetchProviders, fetchProvider, saveProvider, saveProviderContact} from '../services/providerApi';
export function useProviders() {return useCadastroQuery('service-providers', {view: 'list'}, fetchProviders);}
export function useProvider(id: string) {return useCadastroQuery('service-providers', {view: 'detail', id}, signal => fetchProvider(id, signal), !!id);}
export function useProviderMutation() {return useCadastroMutation('service-providers', saveProvider);}
export function useProviderContactMutations() {
  const save = useCadastroMutation('service-providers', saveProviderContact, ['purchase-orders']);
  const remove = useCadastroMutation('service-providers', deleteProviderContact, ['purchase-orders']);
  return {save: save.mutateAsync, remove: remove.mutateAsync, saving: save.isPending, deleting: remove.isPending};
}
