import {getSupabaseBrowserClient} from '@/shared/supabase/client';
import {rpcRequest, RpcError} from '@/shared/supabase/rpc';
import type {DocumentTemplate, DocumentTemplateInput, DocumentTemplateList, DocumentTemplateResult} from '../types';

export const fetchDocumentTemplates = (signal?: AbortSignal) => rpcRequest<DocumentTemplateList>('document-templates', 'list', {}, signal);
export const fetchDocumentTemplate = (key: 'service-request', signal?: AbortSignal) => rpcRequest<DocumentTemplateResult>('document-templates', 'get', {key}, signal);

export async function persistDocumentTemplate(input: DocumentTemplateInput, actorId: string) {
  const {data: {session}} = await getSupabaseBrowserClient().auth.getSession();
  if (!session || session.user.id !== actorId) throw new RpcError('Sua conta foi alterada. Reabra o modelo para continuar.', 401);
  return (await rpcRequest<{template: DocumentTemplate}>('document-templates', 'save', {...input})).template;
}
