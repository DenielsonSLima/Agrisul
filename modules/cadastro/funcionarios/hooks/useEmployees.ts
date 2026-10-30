import {useEffect,useRef} from 'react';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {useCadastroMutation,useCadastroQuery} from '@/modules/cadastro/hooks/useCadastroQuery';
import {deleteEmployee,fetchEmployees,persistEmployee} from '../services/employeeApi';
import type {EmployeeInput} from '../types';

export function useEmployees(){
  const query=useCadastroQuery('employees',{view:'list'},fetchEmployees);
  return {...query,employees:query.data?.employees??[],canManage:query.data?.canManage??false};
}

export function useEmployeeMutations(){
  const {user}=useAuth();
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>{
    const current=new AbortController();controller.current=current;
    return()=>{current.abort();};
  },[user?.id]);
  const execution=()=>({actorId:user?.id??'',signal:controller.current?.signal??AbortSignal.abort()});
  const save=useCadastroMutation('employees',(input:EmployeeInput)=>persistEmployee(input,execution()));
  const remove=useCadastroMutation('employees',(id:string)=>deleteEmployee(id,execution()));
  return {save:save.mutateAsync,remove:remove.mutateAsync,saving:save.isPending,deleting:remove.isPending};
}
