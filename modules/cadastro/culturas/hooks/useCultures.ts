import {useCadastroQuery,useCadastroMutation} from '../../hooks/useCadastroQuery';
import {fetchCultures,persistCulture} from '../services/cultureApi';
export function useCultures(){
  const query=useCadastroQuery('cultures',{},fetchCultures);
  const mutation=useCadastroMutation('cultures',persistCulture,['cultural-practices','planning']);
  return {...query,cultures:query.data??[],save:mutation.mutateAsync,saving:mutation.isPending};
}
