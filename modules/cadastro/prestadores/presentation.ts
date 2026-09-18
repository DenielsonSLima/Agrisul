import {formatCnpj} from '@/shared/utils/cnpj';
import type {ProviderInput} from './types';
export const providersHref = '/cadastro?secao=prestadores';
export const providerHref = (id: string) => `${providersHref}&prestador=${encodeURIComponent(id)}`;
export const providerDocument = (provider: Pick<ProviderInput, 'documentType' | 'document'>) => provider.documentType === 'CNPJ' ? formatCnpj(provider.document) : provider.document.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
