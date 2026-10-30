import {rpcRequest} from '@/shared/supabase/rpc';
import {assertSessionActor} from '@/shared/supabase/sessionActor';
import type {Employee,EmployeeCollection,EmployeeInput} from '../types';

export const fetchEmployees=(signal:AbortSignal)=>
  rpcRequest<EmployeeCollection>('employees','list',{},signal);

type Execution={actorId:string;signal:AbortSignal};
async function assertExecution(execution:Execution){
  if(execution.signal.aborted)throw new DOMException('Operação cancelada','AbortError');
  await assertSessionActor(execution.actorId);
  if(execution.signal.aborted)throw new DOMException('Operação cancelada','AbortError');
}

export async function persistEmployee(input:EmployeeInput,execution:Execution){
  await assertExecution(execution);
  const result=await rpcRequest<{employee:Employee}>('employees','save',input,execution.signal);
  await assertExecution(execution);
  return result.employee;
}

export async function deleteEmployee(id:string,execution:Execution){
  await assertExecution(execution);
  const result=await rpcRequest<{id:string;deleted:true}>('employees','delete',{id},execution.signal);
  await assertExecution(execution);
  return result;
}
