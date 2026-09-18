import {useAuth} from '@/shared/supabase/AuthProvider';
import {useCadastroMutation, useCadastroQuery} from '../../hooks/useCadastroQuery';
import {fetchDocumentTemplate, fetchDocumentTemplates, persistDocumentTemplate} from '../services/documentTemplateApi';
import type {DocumentTemplateInput} from '../types';

export const useDocumentTemplates = () => useCadastroQuery('document-templates', {view: 'list'}, fetchDocumentTemplates);

export function useDocumentTemplate(key: 'service-request') {
  const {user} = useAuth();
  const query = useCadastroQuery('document-templates', {view: 'detail', key}, signal => fetchDocumentTemplate(key, signal));
  const save = useCadastroMutation('document-templates', (input: DocumentTemplateInput) => persistDocumentTemplate(input, user?.id ?? ''), ['service-requests']);
  return {...query, save: save.mutateAsync, saving: save.isPending};
}
