import {useCadastroQuery,useCadastroMutation} from '../../hooks/useCadastroQuery';
import {fetchClients,fetchClient,persistClient} from '../services/clientApi';
import type {ClientInput} from '../types';
export function useClients(id?:string){
  const list=useCadastroQuery('clients',{},fetchClients,!id);
  const detail=useCadastroQuery('clients',{view:'detail',id},signal=>fetchClient(id!,signal),!!id);
  const query=id?detail:list;
  return {...query,clients:list.data??[],client:detail.data??null};
}
export function useClientsMutation(){
  return useCadastroMutation('clients',({input,id}:{input:ClientInput;id?:string})=>persistClient(input,id),['contracts']);
}
