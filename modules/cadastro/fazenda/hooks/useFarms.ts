import {useCadastroQuery,useCadastroMutation} from '../../hooks/useCadastroQuery';
import {fetchFarms,persistFarm} from '../services/farmApi';
import type {FarmInput} from '../types';
export function useFarms(){
  const query=useCadastroQuery('farms',{},fetchFarms);
  const mutation=useCadastroMutation('farms',({input,id}:{input:FarmInput;id?:string})=>persistFarm(input,id),['plots','contracts']);
  return {...query,farms:query.data?.farms??[],summary:query.data?.summary??null,save:(input:FarmInput,id?:string)=>mutation.mutateAsync({input,id}),saving:mutation.isPending};
}

