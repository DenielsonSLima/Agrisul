import {useCadastroMutation, useCadastroQuery} from '../../hooks/useCadastroQuery';
import {fetchProviders, fetchProvider, saveProvider} from '../services/providerApi';
export function useProviders() {return useCadastroQuery('service-providers', {view: 'list'}, fetchProviders);}
export function useProvider(id: string) {return useCadastroQuery('service-providers', {view: 'detail', id}, signal => fetchProvider(id, signal), !!id);}
export function useProviderMutation() {return useCadastroMutation('service-providers', saveProvider);}
