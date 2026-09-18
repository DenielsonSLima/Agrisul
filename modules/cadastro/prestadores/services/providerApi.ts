import {rpcRequest} from '@/shared/supabase/rpc';
import {getSupabaseBrowserClient} from '@/shared/supabase/client';
import {fetchClientCnpj} from '../../clientes/services/clientApi';
import type {ProviderInput, ProviderCollection, ServiceProvider} from '../types';

export const fetchProviders = (signal: AbortSignal) => rpcRequest<ProviderCollection>('service-providers', 'list', {}, signal);
export const fetchProvider = (id: string, signal: AbortSignal) => rpcRequest<{provider: ServiceProvider; canManage: boolean}>('service-providers', 'get', {id}, signal);
export async function saveProvider({input, id, execution}: {input: ProviderInput; id?: string; execution: {actorId: string; signal: AbortSignal}}) {
  const assertActor = async () => {
    if (execution.signal.aborted) throw new DOMException('Operação cancelada', 'AbortError');
    const {data: {session}, error} = await getSupabaseBrowserClient().auth.getSession();
    if (execution.signal.aborted || error || !execution.actorId || session?.user.id !== execution.actorId) throw new DOMException('A conta foi alterada. Abra novamente o formulário.', 'AbortError');
  };
  await assertActor();
  const result = await rpcRequest<{provider: ServiceProvider}>('service-providers', 'save', {...input, id}, execution.signal);
  await assertActor();return result.provider;
}
export async function lookupProviderCnpj(document: string, signal: AbortSignal): Promise<ProviderInput> {
  const {cnpj, ...details} = await fetchClientCnpj(document, signal);
  return {...details, documentType: 'CNPJ', document: cnpj};
}
