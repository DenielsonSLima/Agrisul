import {getSupabaseBrowserClient} from '@/shared/supabase/client';
import {rpcRequest} from '@/shared/supabase/rpc';
import type {DocumentCollection, DocumentContext, DocumentDetail, DocumentExecution, DocumentFile, DocumentFilters, DocumentInput, DocumentOptions, DocumentReview, DocumentSource, ExpectationInput, SourceReference} from '../types';

export const fetchDocuments = (filters: DocumentFilters, signal: AbortSignal) => rpcRequest<DocumentCollection>('documentation', 'list', {...filters}, signal);
export const fetchDocument = (id: string, signal: AbortSignal) => rpcRequest<DocumentDetail>('documentation', 'get', {id}, signal);
export const fetchDocumentOptions = (signal: AbortSignal) => rpcRequest<DocumentOptions>('documentation', 'options', {}, signal);
export const fetchDocumentSources = (search: string, type: string, signal: AbortSignal) => rpcRequest<{sources: DocumentSource[]}>('documentation', 'sources', {search, type}, signal);
export const fetchDocumentContext = (source: SourceReference, signal: AbortSignal) => rpcRequest<DocumentContext>('documentation', 'context', {...source}, signal);

export async function assertDocumentActor(execution: DocumentExecution) {
  if (execution.signal.aborted) throw new DOMException('Operação cancelada', 'AbortError');
  const {data: {session}, error} = await getSupabaseBrowserClient().auth.getSession();
  if (execution.signal.aborted || error || session?.user.id !== execution.actorId) throw new DOMException('A conta foi alterada. Reabra o formulário.', 'AbortError');
}
export async function mutateDocumentation<T>(action: string, input: Record<string, unknown>, execution: DocumentExecution) {
  await assertDocumentActor(execution);
  const result = await rpcRequest<T>('documentation', action, input, execution.signal);
  await assertDocumentActor(execution);
  return result;
}
export const saveDocument = ({input, execution}: {input: DocumentInput; execution: DocumentExecution}) => mutateDocumentation<{document: DocumentDetail['document']}>('save', {...input}, execution);
export const reviewDocument = ({input, execution}: {input: DocumentReview; execution: DocumentExecution}) => mutateDocumentation('review', {...input}, execution);
export const saveExpectation = ({input, execution}: {input: ExpectationInput; execution: DocumentExecution}) => mutateDocumentation('expectation', {...input}, execution);

export async function uploadDocumentFile(documentId: string, file: File, execution: DocumentExecution): Promise<DocumentFile> {
  await assertDocumentActor(execution);
  const contentType = file.type || (/\.xml$/i.test(file.name) ? 'application/xml' : '');
  const {file: prepared} = await mutateDocumentation<{file: DocumentFile}>('prepare-upload', {documentId, fileName: file.name, contentType, size: file.size}, execution);
  await assertDocumentActor(execution);
  const {error} = await getSupabaseBrowserClient().storage.from(prepared.bucket).upload(prepared.path, file, {contentType, upsert: false});
  await assertDocumentActor(execution);
  if (error) throw new Error(`Não foi possível enviar “${file.name}”. Tente novamente.`);
  return prepared;
}
export async function documentationFileUrl(file: DocumentFile, signal: AbortSignal, download = false) {
  const {data, error} = await getSupabaseBrowserClient().storage.from(file.bucket).createSignedUrl(file.path, 300, download ? {download: file.fileName} : undefined);
  if (signal.aborted) throw new DOMException('Consulta cancelada', 'AbortError');
  if (error || !data?.signedUrl) throw new Error('Não foi possível abrir o arquivo. Tente novamente.');
  return data.signedUrl;
}
