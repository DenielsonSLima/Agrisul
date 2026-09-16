import {useCadastroQuery,useCadastroMutation} from '../../hooks/useCadastroQuery';
import {ATR_PAGE_SIZE,fetchAtr,persistAtr} from '../services/atrApi';
import type {AtrInput} from '../types';
export function useAtr(page:number){
  const query=useCadastroQuery('atr',{page,pageSize:ATR_PAGE_SIZE},signal=>fetchAtr(page,signal));
  const mutation=useCadastroMutation('atr',({input,id}:{input:AtrInput;id?:string})=>persistAtr(input,id),[]);
  return {
    ...query,
    records:query.data?.records??[],
    pagination:query.data?.pagination??{page,pageSize:ATR_PAGE_SIZE,total:0,totalPages:1,hasPrevious:false,hasNext:false},
    save:(input:AtrInput,id?:string)=>mutation.mutateAsync({input,id}),
    saving:mutation.isPending,
  };
}
