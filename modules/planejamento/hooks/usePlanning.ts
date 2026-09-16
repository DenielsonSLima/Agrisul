import {useCadastroMutation,useCadastroQuery} from '@/modules/cadastro/hooks/useCadastroQuery';
import {fetchPlanning,persistPlanning} from '../services/planningApi';
import type {PlanningMutation,PlanningQuery} from '../types';

export function usePlanning(params:PlanningQuery){
 const query=useCadastroQuery('planning',params,signal=>fetchPlanning(params,signal));
 const mutation=useCadastroMutation<PlanningMutation,Awaited<ReturnType<typeof persistPlanning>>>('planning',persistPlanning,['farms','plots']);
 return {...query,data:query.data??null,save:(input:PlanningMutation)=>mutation.mutateAsync(input),saving:mutation.isPending};
}
