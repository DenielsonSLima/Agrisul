import {useEffect,useRef,useState} from 'react';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {useCadastroMutation,useCadastroQuery} from '@/modules/cadastro/hooks/useCadastroQuery';
import {createOvertime,deleteOvertime,fetchOvertimeList,fetchOvertimeOptions,fetchOvertimeReport,fetchOvertimeTotals,finishOvertime,reopenOvertime,saveOvertime,fetchOvertimeDaily,saveOvertimeDaily} from '../services/overtimeApi';
import type {OvertimeCreateInput,OvertimeDeleteInput,OvertimeFilters,OvertimeInput,OvertimeDailyInput} from '../types';

export const useOvertimeOptions=(companyId:string)=>useCadastroQuery('overtime',{view:'options',companyId},signal=>fetchOvertimeOptions(companyId,signal),!!companyId);
export const useOvertimeList=(filters:OvertimeFilters)=>useCadastroQuery('overtime',{view:'list',...filters},signal=>fetchOvertimeList(filters,signal),!!filters.companyId);
export const useOvertimeReport=(companyId:string,id:string)=>useCadastroQuery('overtime',{view:'detail',companyId,id},signal=>fetchOvertimeReport(companyId,id,signal),!!companyId&&!!id);
export const useOvertimeDaily=(companyId:string,id:string,employeeId:string,revision?:string)=>useCadastroQuery('overtime',{view:'daily',companyId,id,employeeId,revision},signal=>fetchOvertimeDaily(companyId,id,employeeId,signal),!!companyId&&!!id&&!!employeeId);
export function useOvertimeTotals(companyId:string,rows:{hours50:string;hours100:string}[],enabled=true){
 const serialized=JSON.stringify(rows),[settled,setSettled]=useState(serialized);
 useEffect(()=>{const timer=setTimeout(()=>setSettled(serialized),200);return()=>clearTimeout(timer);},[serialized]);
 const quantities=JSON.parse(settled) as {hours50:string;hours100:string}[];
 const query=useCadastroQuery('overtime',{view:'preview',companyId,rows:quantities},signal=>fetchOvertimeTotals(companyId,quantities,signal),!!companyId&&enabled);
 return {...query,updating:serialized!==settled||query.loading};
}
export function useOvertimeMutations(){
 const {user}=useAuth();const controller=useRef<AbortController|null>(null);
 useEffect(()=>{const current=new AbortController();controller.current=current;return()=>current.abort();},[user?.id]);
 const execution=()=>({actorId:user?.id??'',signal:controller.current?.signal??AbortSignal.abort()});
 const save=useCadastroMutation('overtime',(input:OvertimeInput)=>saveOvertime(input,execution()));
 const remove=useCadastroMutation('overtime',(input:OvertimeDeleteInput)=>deleteOvertime(input,execution()));
 const create=useCadastroMutation('overtime',(input:OvertimeCreateInput)=>createOvertime(input,execution()));
 const finish=useCadastroMutation('overtime',(input:OvertimeDeleteInput)=>finishOvertime(input,execution()));
 const reopen=useCadastroMutation('overtime',(input:OvertimeDeleteInput)=>reopenOvertime(input,execution()));
 const daily=useCadastroMutation('overtime',(input:OvertimeDailyInput)=>saveOvertimeDaily(input,execution()));
 return {save:save.mutateAsync,remove:remove.mutateAsync,create:create.mutateAsync,finish:finish.mutateAsync,reopen:reopen.mutateAsync,saveDaily:daily.mutateAsync,savingDaily:daily.isPending,saving:save.isPending,deleting:remove.isPending,creating:create.isPending,finishing:finish.isPending,reopening:reopen.isPending};
}
