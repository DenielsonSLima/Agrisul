import {getSupabaseBrowserClient} from '@/shared/supabase/client';
import {rpcRequest, RpcError} from '@/shared/supabase/rpc';
import type {Signature, SignatureFilters, SignatureInput, SignatureList, SignatureOptions, SignatureUpload} from '../types';

export const SIGNATURE_BUCKET = 'billing-signatures';
export const SIGNATURE_MAX_BYTES = 3 * 1024 * 1024;

export function fetchSignatures(filters: SignatureFilters, signal?: AbortSignal) {
  return rpcRequest<SignatureList>('signatures', 'list', filters, signal);
}

export function fetchSignatureOptions(signal?: AbortSignal) {
  return rpcRequest<SignatureOptions>('signatures', 'options', {}, signal);
}

export async function fetchSignatureImage(path: string, signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Consulta cancelada', 'AbortError');
  const {data, error} = await getSupabaseBrowserClient().storage.from(SIGNATURE_BUCKET).createSignedUrl(path, 3600);
  if (signal?.aborted) throw new DOMException('Consulta cancelada', 'AbortError');
  if (error || !data?.signedUrl) throw new Error('Não foi possível carregar a assinatura. Tente novamente.');
  return data.signedUrl;
}

export function validateSignatureFile(file: File) {
  if (file.type !== 'image/png' || !file.size || file.size > SIGNATURE_MAX_BYTES) {
    throw new Error('Selecione uma assinatura PNG de até 3 MB.');
  }
}

export async function persistSignature(input: SignatureInput) {
  const client = getSupabaseBrowserClient();
  const {data: {session}} = await client.auth.getSession();
  if (!session) throw new RpcError('Entre para cadastrar assinaturas.', 401);
  const actorId = session.user.id;
  const ensureSameSession = async () => {
    const {data: {session: current}} = await client.auth.getSession();
    if (current?.user.id !== actorId) throw new RpcError('Sua conta foi alterada. Reabra o cadastro para continuar.', 401);
  };
  const {file, removeImage, ...payload} = input;
  let fileId: string | undefined;
  if (file) {
    validateSignatureFile(file);
    const prepared = await rpcRequest<{file: SignatureUpload}>('signatures', 'prepare-upload', {
      fileName: file.name, contentType: file.type, size: file.size,
    });
    if (prepared.file.bucket !== SIGNATURE_BUCKET) throw new Error('Destino de assinatura inválido. Atualize a página e tente novamente.');
    await ensureSameSession();
    const {error} = await client.storage.from(SIGNATURE_BUCKET).upload(prepared.file.path, file, {
      contentType: file.type, upsert: false,
    });
    if (error) throw new Error('Não foi possível enviar a assinatura. Verifique sua conexão e tente novamente.');
    fileId = prepared.file.id;
  }
  // Historical requests keep their original image. Never delete a previous file
  // or undo an upload after an ambiguous response: the RPC may have committed.
  await ensureSameSession();
  return rpcRequest<{signature: Signature}>('signatures', 'save', {...payload, ...(fileId ? {fileId} : removeImage ? {fileId: null} : {})});
}

export function deactivateSignature(id: string) {
  return rpcRequest<{signature: Signature}>('signatures', 'deactivate', {id});
}
