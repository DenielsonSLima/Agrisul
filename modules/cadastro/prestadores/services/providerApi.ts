import {rpcRequest} from '@/shared/supabase/rpc';
import {getSupabaseBrowserClient} from '@/shared/supabase/client';
import {fetchClientCnpj} from '../../clientes/services/clientApi';
import type {ProviderContact, ProviderContactInput, ProviderDetail, ProviderInput, ProviderCollection, ServiceProvider} from '../types';

export const fetchProviders = (signal: AbortSignal) => rpcRequest<ProviderCollection>('service-providers', 'list', {}, signal);
export const fetchProvider = (id: string, signal: AbortSignal) => rpcRequest<ProviderDetail>('service-providers', 'get', {id}, signal);
type ProviderExecution = {actorId: string; signal: AbortSignal};
const assertProviderActor = async (execution: ProviderExecution) => {
  if (execution.signal.aborted) throw new DOMException('Operação cancelada', 'AbortError');
  const {data: {session}, error} = await getSupabaseBrowserClient().auth.getSession();
  if (execution.signal.aborted || error || !execution.actorId || session?.user.id !== execution.actorId) throw new DOMException('A conta foi alterada. Abra novamente o formulário.', 'AbortError');
};
export async function saveProvider({input, id, execution}: {input: ProviderInput; id?: string; execution: {actorId: string; signal: AbortSignal}}) {
  await assertProviderActor(execution);
  const result = await rpcRequest<{provider: ServiceProvider}>('service-providers', 'save', {...input, id}, execution.signal);
  await assertProviderActor(execution);return result.provider;
}
export async function saveProviderContact({input, id, execution}: {input: ProviderContactInput; id?: string; execution: ProviderExecution}) {
  await assertProviderActor(execution);
  const result = await rpcRequest<{contact: ProviderContact}>('service-providers', 'save-contact', {...input, id}, execution.signal);
  await assertProviderActor(execution);
  return result.contact;
}
export async function deleteProviderContact({id, execution}: {id: string; execution: ProviderExecution}) {
  await assertProviderActor(execution);
  const result = await rpcRequest<{contact: ProviderContact}>('service-providers', 'delete-contact', {id}, execution.signal);
  await assertProviderActor(execution);
  return result.contact;
}
export async function lookupProviderCnpj(document: string, signal: AbortSignal): Promise<ProviderInput> {
  const {cnpj, ...details} = await fetchClientCnpj(document, signal);
  return {...details, documentType: 'CNPJ', document: cnpj};
}
