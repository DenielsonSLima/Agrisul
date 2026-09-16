import {useCadastroQuery,useCadastroMutation} from '../../hooks/useCadastroQuery';
import {bootstrapSugarcaneManagement,deletePractice,fetchPractices,persistPractice,type PracticeFilters} from '../services/practiceApi';
import type {PracticeInput} from '../types';
export function usePractices(filters:PracticeFilters={},enabled=true){
  const query=useCadastroQuery('cultural-practices',filters,signal=>fetchPractices(filters,signal),enabled);
  const mutation=useCadastroMutation('cultural-practices',({input,id}:{input:PracticeInput;id?:string})=>persistPractice(input,id),[]);
  const removal=useCadastroMutation('cultural-practices',deletePractice,[]);
  const bootstrap=useCadastroMutation('cultural-practices',bootstrapSugarcaneManagement,['cultures']);
  return {
   ...query,
   practices:query.data?.practices??[],
   catalog:query.data?.catalog??[],
   save:(input:PracticeInput,id?:string)=>mutation.mutateAsync({input,id}),
   saving:mutation.isPending,
   remove:removal.mutateAsync,
   removing:removal.isPending,
   bootstrapSugarcane:()=>bootstrap.mutateAsync(undefined),
   bootstrapping:bootstrap.isPending,
  };
}
