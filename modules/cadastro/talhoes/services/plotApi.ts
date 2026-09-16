import {rpcRequest} from '@/shared/supabase/rpc';
export {RpcError as PlotApiError} from '@/shared/supabase/rpc';
import type {FarmPlotsSummary as FarmPlots,PlotInput} from '../types';
export async function fetchPlots(farmId:string,signal?:AbortSignal){
  return (await rpcRequest<{data:FarmPlots}>('plots','list',{farmId},signal)).data;
}
export async function persistPlot(farmId:string,input:PlotInput,id?:string){
  return (await rpcRequest<{data:FarmPlots}>('plots','save',{...input,farmId,id})).data;
}
