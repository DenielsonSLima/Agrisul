'use client';
import {createContext,useCallback,useContext,useMemo,useSyncExternalStore,type ReactNode} from 'react';
import {moneyLabel} from '@/shared/utils/presentation';

export const DASHBOARD_MONEY_MASK='R$ ***,**';
export const dashboardValuesKey=(userId:string|null|undefined)=>userId?`billing:dashboard-values:v1:${encodeURIComponent(userId)}`:null;
const eventName='billing:dashboard-values',fallback=new Map<string,string>();
const serverSnapshot=()=>'hidden';
function snapshot(key:string|null){
 if(!key||typeof window==='undefined')return 'hidden';
 if(fallback.has(key))return fallback.get(key)!;
 try{return window.localStorage.getItem(key)==='hidden'?'hidden':'visible';}catch{return 'hidden';}
}
const DashboardValuesContext=createContext({visible:true,toggle:()=>{},money:moneyLabel});
export const useDashboardValues=()=>useContext(DashboardValuesContext);

/** A display preference scoped to this Dashboard and the authenticated account. */
export function DashboardValuesProvider({userId,children}:{userId:string|null|undefined;children:ReactNode}){
 const key=dashboardValuesKey(userId);
 const subscribe=useCallback((changed:()=>void)=>{
  const local=(event:Event)=>{if((event as CustomEvent).detail===key)changed();};
  const storage=(event:StorageEvent)=>{if(event.key===key||event.key===null){if(key)fallback.delete(key);changed();}};
  window.addEventListener(eventName,local);window.addEventListener('storage',storage);
  return()=>{window.removeEventListener(eventName,local);window.removeEventListener('storage',storage);};
 },[key]);
 const raw=useSyncExternalStore(subscribe,()=>snapshot(key),serverSnapshot),visible=raw==='visible';
 const toggle=useCallback(()=>{
  if(!key)return;const next=snapshot(key)==='visible'?'hidden':'visible';
  try{window.localStorage.setItem(key,next);fallback.delete(key);}catch{fallback.set(key,next);}
  window.dispatchEvent(new CustomEvent(eventName,{detail:key}));
 },[key]);
 const value=useMemo(()=>({visible,toggle,money:(amount:Parameters<typeof moneyLabel>[0])=>visible?moneyLabel(amount):DASHBOARD_MONEY_MASK}),[visible,toggle]);
 return <DashboardValuesContext.Provider value={value}>{children}</DashboardValuesContext.Provider>;
}
