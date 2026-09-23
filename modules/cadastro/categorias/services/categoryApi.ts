import {rpcRequest} from '@/shared/supabase/rpc';
import type {
  MaterialCategory,
  MaterialCategoryCollection,
  MaterialCategoryInput,
} from '../types';

export const fetchMaterialCategories = (signal: AbortSignal) =>
  rpcRequest<MaterialCategoryCollection>('material-categories', 'list', {}, signal);

export const persistMaterialCategory = async (input: MaterialCategoryInput) =>
  (await rpcRequest<{category: MaterialCategory}>('material-categories', 'save', input)).category;

export const deleteMaterialCategory = (id: string) =>
  rpcRequest<{id: string; deleted: true}>('material-categories', 'delete', {id});
