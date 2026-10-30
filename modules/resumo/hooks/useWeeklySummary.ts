'use client';
import {useSyncExternalStore} from 'react';
import {useBillingQuery} from '@/shared/query/useBillingQuery';
import {rpcRequest} from '@/shared/supabase/rpc';
import {normalizeSummarySelection} from '../services/summaryService';
import type {SummarySelection,WeeklySummaryData} from '../types';
import {weeklyRange} from '../weekly';

function subscribeDay(changed:()=>void){
 const timer=window.setInterval(changed,30000);
 window.addEventListener('focus',changed);document.addEventListener('visibilitychange',changed);
 return()=>{window.clearInterval(timer);window.removeEventListener('focus',changed);document.removeEventListener('visibilitychange',changed);};
}
const daySnapshot=()=>weeklyRange().to;
export function useWeeklyRange(){
 const day=useSyncExternalStore(subscribeDay,daySnapshot,daySnapshot);
 return weeklyRange(new Date(`${day}T12:00:00-03:00`));
}
export function useWeeklySummary(from:string,to:string,selection:SummarySelection,enabled:boolean){
 const contractMethod='';
 const normalized=normalizeSummarySelection(selection);
 const params={projection:'weekly-v2',from,to,contractMethod,...Object.fromEntries(Object.entries(normalized).map(([key,value])=>[key,Array.isArray(value)?JSON.stringify(value):value]))};
 return useBillingQuery('summary',params,async(companyId,signal)=>{
  const data=await rpcRequest<WeeklySummaryData>('summary','weekly',{companyId,from,to,...normalized,contractMethod},signal);
  const echo=data.filters;
  const legacyFarm=normalized.plotId?'':normalized.farmId;
  const expected={...normalized,partnerIds:[...new Set([...normalized.partnerIds,normalized.partnerId].filter(Boolean))].sort(),contractIds:[...new Set([...normalized.contractIds,normalized.contractId].filter(Boolean))].sort(),farmIds:[...new Set([...normalized.farmIds,legacyFarm].filter(Boolean))].sort(),plotIds:[...new Set([...normalized.plotIds,normalized.plotId].filter(Boolean))].sort()};
  if(data.range.from!==from||data.range.to!==to||data.days.length>7||!Array.isArray(data.contractMethods)||echo.companyId!==companyId||echo.contractMethod!==contractMethod||Object.entries(expected).some(([key,value])=>JSON.stringify(echo[key as keyof SummarySelection])!==JSON.stringify(value))){
   throw new Error('Não foi possível conferir os filtros da aba Semanal. Atualize os dados.');
  }
  return data;
 },{refetchInterval:60000,enabled});
}
