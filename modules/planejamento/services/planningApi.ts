import {rpcRequest} from '@/shared/supabase/rpc';
import type {PlanningAllocation,PlanningFieldLog,PlanningMutation,PlanningPeriod,PlanningQuery,PlanningSnapshot} from '../types';

export function fetchPlanning(query:PlanningQuery,signal?:AbortSignal){
 const {periodId,...filters}=query;
 return rpcRequest<PlanningSnapshot>('planning','list',periodId?{periodId,...filters}:filters,signal);
}

export async function persistPlanning(mutation:PlanningMutation){
 if(mutation.action==='save-period'){
  const {input,id,expectedRevision}=mutation;
  return rpcRequest<{period:PlanningPeriod}>('planning','save-period',{...input,id,expectedRevision});
 }
 if(mutation.action==='save-allocation'){
  const {input,id,periodId,plotId,expectedRevision}=mutation;
  return rpcRequest<{allocation:PlanningAllocation}>('planning','save-allocation',{...input,id,periodId,plotId,expectedRevision});
 }
 const {action,...payload}=mutation;
 if(action==='cancel-allocation')return rpcRequest<{allocation:PlanningAllocation}>('planning',action,payload);
 if(action==='remanejar')return rpcRequest<{movedAreaHa:string;source:PlanningAllocation;target:PlanningAllocation}>('planning',action,payload);
 if(action==='set-practices')return rpcRequest<{allocation:PlanningAllocation}>('planning',action,payload);
 if(action==='save-harvest-goal')return rpcRequest<{period:PlanningPeriod}>('planning',action,payload);
 if(action==='save-field-log'||action==='void-field-log')return rpcRequest<{fieldLog:PlanningFieldLog}>('planning',action,payload);
 return rpcRequest<{plot:{plotId:string;farmId:string;plantedAreaHa:string}}>('planning',action,payload);
}
