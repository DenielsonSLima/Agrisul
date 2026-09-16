import {useCadastroQuery,useCadastroMutation} from '../../hooks/useCadastroQuery';
import {fetchTypes,fetchType,persistType} from '../services/typeApi';
import type {ContractTypeInput} from '../types';
export function useContractTypes(id?:string){
  const list=useCadastroQuery('contract-types',{},fetchTypes,!id);
  const detail=useCadastroQuery('contract-types',{view:'detail',id},signal=>fetchType(id!,signal),!!id);
  const query=id?detail:list;
  return {...query,types:list.data??[],type:detail.data??null};
}
export function useContractTypesMutation(){
  return useCadastroMutation('contract-types',({input,id}:{input:ContractTypeInput;id?:string})=>persistType(input,id));
}
