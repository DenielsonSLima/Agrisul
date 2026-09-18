import {rpcRequest} from '@/shared/supabase/rpc';
import {getSupabaseBrowserClient} from '@/shared/supabase/client';
import type {ReportCompanyBrand, ReportHeaderVariant} from '@/shared/reporting/types';

export type RequestDocumentBrand = {company: ReportCompanyBrand | null; header: ReportHeaderVariant};
export async function fetchRequestDocumentBrand(signal?: AbortSignal): Promise<RequestDocumentBrand> {
  const result = await rpcRequest<{company: (ReportCompanyBrand & {logoKey: string | null}) | null; header: ReportHeaderVariant}>('service-requests', 'document-brand', {}, signal);
  let logoUrl: string | null = null;
  if (result.company?.logoKey) {
    const {data, error} = await getSupabaseBrowserClient().storage.from('billing-company-logos').createSignedUrl(result.company.logoKey, 3600);
    if (signal?.aborted) throw new DOMException('Consulta cancelada', 'AbortError');
    if (error || !data?.signedUrl) throw new Error('Não foi possível carregar a logo do cabeçalho. Tente novamente.');
    logoUrl = data.signedUrl;
  }
  return {header: result.header, company: result.company ? {...result.company, logoUrl} : null};
}
