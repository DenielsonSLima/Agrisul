import {getSupabaseBrowserClient} from '@/shared/supabase/client';
import {rpcRequest} from '@/shared/supabase/rpc';
import type {RequestCollection, RequestComplementInput, RequestDecisionInput, RequestExecution, RequestFile, RequestFilters, RequestInput, RequestOptions, ServiceRequest} from '../types';

export const requestSignatureBucket = 'billing-signatures';
export const fetchRequestOptions = (signal: AbortSignal) => rpcRequest<RequestOptions>('service-requests', 'options', {}, signal);
export const fetchRequests = (filters: RequestFilters, signal: AbortSignal) => rpcRequest<RequestCollection>('service-requests', 'list', {...filters}, signal);
export const fetchRequest = async (id: string, signal: AbortSignal) => (await rpcRequest<{request: ServiceRequest}>('service-requests', 'get', {id}, signal)).request;
export function assertRequestActive(execution: RequestExecution) {
  if (execution.signal.aborted) throw new DOMException('Operação cancelada', 'AbortError');
}
export async function assertRequestActor(execution: RequestExecution) {
  assertRequestActive(execution);
  const {data: {session}, error} = await getSupabaseBrowserClient().auth.getSession();
  assertRequestActive(execution);
  if (error || session?.user.id !== execution.actorId) throw new DOMException('A conta foi alterada. Abra novamente o formulário.', 'AbortError');
}
export const createRequest = async ({input, execution}: {input: RequestInput; execution: RequestExecution}) => {
  await assertRequestActor(execution);
  const {request} = await rpcRequest<{request: ServiceRequest}>('service-requests', 'create', {...input}, execution.signal);
  assertRequestActive(execution);
  return request;
};
export const decideRequest = async ({input, execution}: {input: RequestDecisionInput; execution: RequestExecution}) => {
  await assertRequestActor(execution);
  const {request} = await rpcRequest<{request: ServiceRequest}>('service-requests', 'decide', {...input}, execution.signal);
  assertRequestActive(execution);
  return request;
};
export const complementRequest = async ({input, execution}: {input: RequestComplementInput; execution: RequestExecution}) => {
  await assertRequestActor(execution);
  const {request} = await rpcRequest<{request: ServiceRequest}>('service-requests', 'complement', {...input}, execution.signal);
  await assertRequestActor(execution);
  return request;
};
export const completeRequest = async ({id, execution}: {id: string; execution: RequestExecution}) => {
  await assertRequestActor(execution);
  const {request} = await rpcRequest<{request: ServiceRequest}>('service-requests', 'complete', {id}, execution.signal);
  await assertRequestActor(execution);
  return request;
};

export async function uploadRequestAttachment(requestId: string, file: File, execution: RequestExecution): Promise<RequestFile> {
  await assertRequestActor(execution);
  const {file: prepared} = await rpcRequest<{file: RequestFile}>('service-requests', 'prepare-upload', {requestId, fileName: file.name, contentType: file.type, size: file.size}, execution.signal);
  await assertRequestActor(execution);
  const {error} = await getSupabaseBrowserClient().storage.from(prepared.bucket).upload(prepared.path, file, {contentType: file.type, upsert: false});
  await assertRequestActor(execution);
  if (error) throw new Error(`Não foi possível enviar ${file.name}. Tente novamente.`);
  return prepared;
}

export async function requestFileUrl(bucket: string, path: string, signal?: AbortSignal): Promise<string> {
  const {data, error} = await getSupabaseBrowserClient().storage.from(bucket).createSignedUrl(path, 300);
  if (signal?.aborted) throw new DOMException('Consulta cancelada', 'AbortError');
  if (error || !data?.signedUrl) throw new Error('Não foi possível abrir o arquivo. Tente novamente.');
  return data.signedUrl;
}
