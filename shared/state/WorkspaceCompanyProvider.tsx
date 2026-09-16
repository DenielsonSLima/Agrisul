'use client';

import {createContext,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {useCompanies} from '@/modules/configuracoes/empresas/hooks/useCompanies';
import type {Company} from '@/modules/configuracoes/empresas/types';

type WorkspaceCompanyState={
 companies:Company[];
 activeCompany:Company|null;
 activeCompanyId:string;
 loading:boolean;
 error:string;
 selectCompany:(companyId:string)=>void;
 reload:()=>Promise<unknown>;
};

const WorkspaceCompanyContext=createContext<WorkspaceCompanyState|null>(null);
const storageKey=(userId:string)=>`billing:${userId}:active-company`;

export function WorkspaceCompanyProvider({children}:{children:ReactNode}){
 const {user}=useAuth();
 const companyQuery=useCompanies();
 const [selectedId,setSelectedId]=useState(()=>user&&typeof window!=='undefined'
  ?window.localStorage.getItem(storageKey(user.id))??''
  :'');

 const activeCompany=useMemo(()=>companyQuery.companies.find(company=>company.id===selectedId)
  ??companyQuery.companies.find(company=>company.isPrimary)
  ??companyQuery.companies[0]
  ??null,[companyQuery.companies,selectedId]);

 useEffect(()=>{
  if(user&&activeCompany)window.localStorage.setItem(storageKey(user.id),activeCompany.id);
 },[user,activeCompany]);

 const selectCompany=(companyId:string)=>{
  if(companyQuery.companies.some(company=>company.id===companyId))setSelectedId(companyId);
 };

 return <WorkspaceCompanyContext.Provider value={{
  companies:companyQuery.companies,
  activeCompany,
  activeCompanyId:activeCompany?.id??'',
  loading:companyQuery.loading,
  error:companyQuery.error,
  selectCompany,
  reload:companyQuery.reload,
 }}>{children}</WorkspaceCompanyContext.Provider>;
}

export function useWorkspaceCompany(){
 const value=useContext(WorkspaceCompanyContext);
 if(!value)throw new Error('WorkspaceCompanyProvider necessario.');
 return value;
}
