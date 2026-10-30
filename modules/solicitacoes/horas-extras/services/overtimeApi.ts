import {rpcRequest} from '@/shared/supabase/rpc';
import {assertSessionActor} from '@/shared/supabase/sessionActor';
import type {OvertimeCollection,OvertimeCreateInput,OvertimeDeleteInput,OvertimeDetail,OvertimeFilters,OvertimeInput,OvertimeOptions,OvertimeReport,OvertimeTotals} from '../types';

export const fetchOvertimeOptions=(companyId:string,signal:AbortSignal)=>rpcRequest<OvertimeOptions>('overtime','options',{companyId},signal);
export const fetchOvertimeList=(filters:OvertimeFilters,signal:AbortSignal)=>rpcRequest<OvertimeCollection>('overtime','list',filters,signal);
export const fetchOvertimeTotals=(companyId:string,rows:{hours50:string;hours100:string}[],signal:AbortSignal)=>rpcRequest<OvertimeTotals>('overtime','preview',{companyId,rows},signal);
export const fetchOvertimeReport=async(companyId:string,id:string,signal:AbortSignal)=>(await rpcRequest<OvertimeDetail>('overtime','get',{companyId,id},signal)).report;
export type OvertimeExecution={actorId:string;signal:AbortSignal};
async function assertExecution(execution:OvertimeExecution){
 if(execution.signal.aborted)throw new DOMException('Operação cancelada','AbortError');
 await assertSessionActor(execution.actorId);
 if(execution.signal.aborted)throw new DOMException('Operação cancelada','AbortError');
}
export async function saveOvertime(input:OvertimeInput,execution:OvertimeExecution){
 await assertExecution(execution);
 const result=await rpcRequest<{report:OvertimeReport;created:boolean}>('overtime','save',input,execution.signal);
 await assertExecution(execution);return result;
}
export async function deleteOvertime(input:OvertimeDeleteInput,execution:OvertimeExecution){
 await assertExecution(execution);
 const result=await rpcRequest<{id:string;deleted:true}>('overtime','delete',input,execution.signal);
 await assertExecution(execution);return result;
}
export async function createOvertime(input:OvertimeCreateInput,execution:OvertimeExecution){
 await assertExecution(execution);
 const result=await rpcRequest<{report:OvertimeReport;created:true}>('overtime','create',input,execution.signal);
 await assertExecution(execution);return result;
}
export async function finishOvertime(input:OvertimeDeleteInput,execution:OvertimeExecution){
 await assertExecution(execution);
 const result=await rpcRequest<{report:OvertimeReport}>('overtime','finish',input,execution.signal);
 await assertExecution(execution);return result;
}
export async function reopenOvertime(input:OvertimeDeleteInput,execution:OvertimeExecution){
 await assertExecution(execution);
 const result=await rpcRequest<{report:OvertimeReport}>('overtime','reopen',input,execution.signal);
 await assertExecution(execution);return result;
}
