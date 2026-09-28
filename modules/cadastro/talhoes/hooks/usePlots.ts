import {useCadastroQuery,useCadastroMutation} from '../../hooks/useCadastroQuery';
import {fetchPlots,persistPlot} from '../services/plotApi';
import type {PlotInput} from '../types';

export function usePlotsMutation(){
  const mutation=useCadastroMutation('plots',({farmId,input,id}:{farmId:string;input:PlotInput;id?:string})=>persistPlot(farmId,input,id),['farms','contracts']);
  return {save:(farmId:string,input:PlotInput,id?:string)=>mutation.mutateAsync({farmId,input,id}),saving:mutation.isPending};
}

export function usePlots(farmId:string){
  const query=useCadastroQuery('plots',{farmId},signal=>fetchPlots(farmId,signal),!!farmId);
  const mutation=usePlotsMutation();
  return {...query,data:query.data??null,save:(input:PlotInput,id?:string)=>mutation.save(farmId,input,id),saving:mutation.saving};
}

