import {useCadastroQuery,useCadastroMutation} from '../../hooks/useCadastroQuery';
import {fetchPlots,persistPlot} from '../services/plotApi';
import type {PlotInput} from '../types';
export function usePlots(farmId:string){
  const query=useCadastroQuery('plots',{farmId},signal=>fetchPlots(farmId,signal),!!farmId);
  const mutation=useCadastroMutation('plots',({input,id}:{input:PlotInput;id?:string})=>persistPlot(farmId,input,id),['farms','contracts']);
  return {...query,data:query.data??null,save:(input:PlotInput,id?:string)=>mutation.mutateAsync({input,id}),saving:mutation.isPending};
}

