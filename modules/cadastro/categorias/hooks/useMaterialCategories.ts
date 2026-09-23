import {
  useCadastroMutation,
  useCadastroQuery,
} from '@/modules/cadastro/hooks/useCadastroQuery';
import {
  deleteMaterialCategory,
  fetchMaterialCategories,
  persistMaterialCategory,
} from '../services/categoryApi';
import type {MaterialCategory} from '../types';

const emptyMaterialCategories: MaterialCategory[] = [];

export function useMaterialCategories() {
  const query = useCadastroQuery(
    'material-categories',
    {view: 'list'},
    fetchMaterialCategories,
  );

  return {...query, categories: query.data?.categories ?? emptyMaterialCategories};
}

export function useMaterialCategoryMutations() {
  const saveMutation = useCadastroMutation(
    'material-categories',
    persistMaterialCategory,
  );
  const deleteMutation = useCadastroMutation(
    'material-categories',
    deleteMaterialCategory,
  );

  return {
    save: saveMutation.mutateAsync,
    remove: deleteMutation.mutateAsync,
    saving: saveMutation.isPending,
    deleting: deleteMutation.isPending,
  };
}
