import {useCadastroMutation, useCadastroQuery} from '@/modules/cadastro/hooks/useCadastroQuery';
import {fetchDocument, fetchDocumentContext, fetchDocumentOptions, fetchDocuments, fetchDocumentSources, reviewDocument, saveDocument, saveExpectation} from '../services/documentationApi';
import type {DocumentFilters, SourceReference} from '../types';

export const useDocuments = (filters: DocumentFilters) => useCadastroQuery('documentation', {view: 'list', ...filters}, signal => fetchDocuments(filters, signal));
export const useDocument = (id: string) => useCadastroQuery('documentation', {view: 'detail', id}, signal => fetchDocument(id, signal), !!id);
export const useDocumentOptions = () => useCadastroQuery('documentation', {view: 'options'}, fetchDocumentOptions);
export const useDocumentSources = (search: string, type: string) => useCadastroQuery('documentation', {view: 'sources', search, type}, signal => fetchDocumentSources(search, type, signal));
export const useDocumentContext = (source: SourceReference) => useCadastroQuery('documentation', {view: 'context', ...source}, signal => fetchDocumentContext(source, signal));
export function useDocumentMutations() {
  const save = useCadastroMutation('documentation', saveDocument);
  const review = useCadastroMutation('documentation', reviewDocument);
  const expectation = useCadastroMutation('documentation', saveExpectation);
  return {save, review, expectation};
}
