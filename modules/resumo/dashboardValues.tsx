'use client';
import {createContext,useCallback,useContext,useMemo,useSyncExternalStore,type ReactNode} from 'react';
import {moneyLabel} from '@/shared/utils/presentation';
import {financialGroupingKey,readFinancialGrouping,type FinancialGrouping} from './financialGrouping';
import {DEFAULT_DASHBOARD_PERIOD,defaultPeriodKey,readDefaultPeriod,type DashboardDefaultPeriod} from './defaultPeriod';

export const DASHBOARD_MONEY_MASK='••••••';
export const dashboardValuesKey=(userId:string|null|undefined)=>userId?`billing:dashboard-values:v1:${encodeURIComponent(userId)}`:null;
export type DashboardNewsScope='all'|'cane';
export const dashboardNewsScopeKey=(userId:string|null|undefined)=>userId?`billing:dashboard-news-scope:v1:${encodeURIComponent(userId)}`:null;
export const readDashboardNewsScope=(value:unknown):DashboardNewsScope=>value==='cane'?'cane':'all';
const eventName='billing:dashboard-values',fallback=new Map<string,string>();
const serverSnapshot=()=>'hidden';
function snapshot(key:string|null){
 if(!key||typeof window==='undefined')return 'hidden';
 if(fallback.has(key))return fallback.get(key)!;
 try{return window.localStorage.getItem(key)==='hidden'?'hidden':'visible';}catch{return 'hidden';}
}
function groupingSnapshot(key:string|null){
 if(!key||typeof window==='undefined')return 'month';
 try{return readFinancialGrouping(fallback.get(key)??window.localStorage.getItem(key));}catch{return readFinancialGrouping(fallback.get(key));}
}
function periodSnapshot(key:string|null){
 if(!key||typeof window==='undefined')return DEFAULT_DASHBOARD_PERIOD;
 try{return readDefaultPeriod(fallback.get(key)??window.localStorage.getItem(key));}catch{return readDefaultPeriod(fallback.get(key));}
}
function newsScopeSnapshot(key:string|null){
 if(!key||typeof window==='undefined')return 'all';
 try{return readDashboardNewsScope(fallback.get(key)??window.localStorage.getItem(key));}catch{return readDashboardNewsScope(fallback.get(key));}
}
function storePreference(key:string,value:string){
 let saved=true;try{window.localStorage.setItem(key,value);fallback.delete(key);}catch{fallback.set(key,value);saved=false;}
 window.dispatchEvent(new CustomEvent(eventName,{detail:key}));return saved;
}
type DashboardDisplayValues={visible:boolean;toggle:()=>void;money:typeof moneyLabel;financialGrouping:FinancialGrouping;setFinancialGrouping:(grouping:FinancialGrouping)=>boolean;defaultPeriod:DashboardDefaultPeriod;setDefaultPeriod:(period:DashboardDefaultPeriod)=>boolean;newsScope:DashboardNewsScope;setNewsScope:(scope:DashboardNewsScope)=>boolean};
const DashboardValuesContext=createContext<DashboardDisplayValues>({visible:true,toggle:()=>{},money:moneyLabel,financialGrouping:'month',setFinancialGrouping:()=>false,defaultPeriod:DEFAULT_DASHBOARD_PERIOD,setDefaultPeriod:()=>false,newsScope:'all',setNewsScope:()=>false});
export const useDashboardValues=()=>useContext(DashboardValuesContext);

/** A display preference scoped to this Dashboard and the authenticated account. */
export function DashboardValuesProvider({userId,children}:{userId:string|null|undefined;children:ReactNode}){
 const key=dashboardValuesKey(userId),groupingKey=financialGroupingKey(userId),periodKey=defaultPeriodKey(userId),newsKey=dashboardNewsScopeKey(userId);
 const subscribe=useCallback((changed:()=>void)=>{
  const local=(event:Event)=>{const changedKey=(event as CustomEvent).detail;if(changedKey===key||changedKey===groupingKey||changedKey===periodKey||changedKey===newsKey)changed();};
  const storage=(event:StorageEvent)=>{if(event.key===key||event.key===groupingKey||event.key===periodKey||event.key===newsKey||event.key===null){if(event.key)fallback.delete(event.key);else{if(key)fallback.delete(key);if(groupingKey)fallback.delete(groupingKey);if(periodKey)fallback.delete(periodKey);if(newsKey)fallback.delete(newsKey);}changed();}};
  window.addEventListener(eventName,local);window.addEventListener('storage',storage);
  return()=>{window.removeEventListener(eventName,local);window.removeEventListener('storage',storage);};
 },[key,groupingKey,periodKey,newsKey]);
 const raw=useSyncExternalStore(subscribe,()=>snapshot(key),serverSnapshot),visible=raw==='visible';
 const toggle=useCallback(()=>{
  if(!key)return;const next=snapshot(key)==='visible'?'hidden':'visible';
  storePreference(key,next);
 },[key]);
 const financialGrouping=useSyncExternalStore(subscribe,()=>groupingSnapshot(groupingKey),()=>'month' as FinancialGrouping);
 const setFinancialGrouping=useCallback((next:FinancialGrouping)=>groupingKey?storePreference(groupingKey,readFinancialGrouping(next)):false,[groupingKey]);
 const defaultPeriod=useSyncExternalStore(subscribe,()=>periodSnapshot(periodKey),()=>DEFAULT_DASHBOARD_PERIOD);
 const setDefaultPeriod=useCallback((next:DashboardDefaultPeriod)=>periodKey?storePreference(periodKey,readDefaultPeriod(next)):false,[periodKey]);
 const newsScope=useSyncExternalStore(subscribe,()=>newsScopeSnapshot(newsKey),()=>'all' as DashboardNewsScope);
 const setNewsScope=useCallback((next:DashboardNewsScope)=>newsKey?storePreference(newsKey,readDashboardNewsScope(next)):false,[newsKey]);
 const value=useMemo(()=>({visible,toggle,money:(amount:Parameters<typeof moneyLabel>[0])=>visible?moneyLabel(amount):DASHBOARD_MONEY_MASK,financialGrouping,setFinancialGrouping,defaultPeriod,setDefaultPeriod,newsScope,setNewsScope}),[visible,toggle,financialGrouping,setFinancialGrouping,defaultPeriod,setDefaultPeriod,newsScope,setNewsScope]);
 return <DashboardValuesContext.Provider value={value}>{children}</DashboardValuesContext.Provider>;
}
