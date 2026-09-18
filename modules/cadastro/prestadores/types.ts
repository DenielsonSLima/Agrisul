import type {CompanyDetails} from '@/shared/types/companyDetails';
export type ProviderInput = Omit<CompanyDetails, 'cnpj'> & {documentType: 'CPF' | 'CNPJ'; document: string};
export type ServiceProvider = ProviderInput & {id: string; address: string; createdAt: string; updatedAt: string};
export type ProviderCollection = {providers: ServiceProvider[]; canManage: boolean};
export const emptyProvider: ProviderInput = {documentType: 'CNPJ', document: '', legalName: '', tradeName: '', street: '', number: '', complement: '', district: '', city: '', state: '', zipCode: '', phone: '', email: ''};
