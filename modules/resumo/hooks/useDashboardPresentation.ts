'use client';
import {useCallback,useEffect,useMemo,useState,useSyncExternalStore,type RefObject} from 'react';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {DASHBOARD_SCENES,isDashboardSceneIndex,presentationSettingsKey,readPresentationSettings,serializePresentationSettings,updateAllSceneMinutes,updateSceneMinutes,type PresentationMinutesByScene} from '../presentationSettings';
export {DASHBOARD_SCENES,DASHBOARD_SCENE_IDS,PRESENTATION_INTERVALS} from '../presentationSettings';
export type {DashboardSceneId,PresentationMinutes,PresentationMinutesByScene} from '../presentationSettings';

const settingsEvent='billing:dashboard-presentation-settings';
// Browsers that block localStorage still apply the chosen settings in this tab.
// Each fallback belongs to one account key, just like the persisted preferences.
const fallbackSettings=new Map<string,string>();
const settingsServerSnapshot=()=>'';
function readSettingsSnapshot(key:string|null){
 if(!key||typeof window==='undefined')return '';
 const fallback=fallbackSettings.get(key);if(fallback!==undefined)return fallback;
 try{return window.localStorage.getItem(key)??'';}catch{return '';}
}

export function useDashboardPresentation(rootRef:RefObject<HTMLElement|null>){
 const {registerLiveDisplay,user}=useAuth();
 const settingsKey=presentationSettingsKey(user?.id);
 const subscribeSettings=useCallback((changed:()=>void)=>{
  if(!settingsKey)return()=>{};
  const storage=(event:StorageEvent)=>{
   if(event.key!==null&&event.key!==settingsKey)return;
   fallbackSettings.delete(settingsKey);changed();
  };
  const local=(event:Event)=>{if((event as CustomEvent<{key:string}>).detail?.key===settingsKey)changed();};
  window.addEventListener('storage',storage);window.addEventListener(settingsEvent,local);
  return()=>{window.removeEventListener('storage',storage);window.removeEventListener(settingsEvent,local);};
 },[settingsKey]);
 const rawSettings=useSyncExternalStore(subscribeSettings,()=>readSettingsSnapshot(settingsKey),settingsServerSnapshot);
 const minutesByScene=useMemo(()=>readPresentationSettings(rawSettings),[rawSettings]);
 const [settingsFailure,setSettingsFailure]=useState<{key:string|null;message:string}>({key:null,message:''});
 const [fullscreen,setFullscreen]=useState(false),[presenting,setPresenting]=useState(false);
 const [paused,setPaused]=useState(false),[scene,setScene]=useState(0);
 const minutes=minutesByScene[DASHBOARD_SCENES[scene].id];
 const settingsError=settingsFailure.key===settingsKey?settingsFailure.message:'';
 const [error,setError]=useState(''),[online,setOnline]=useState(true);
 useEffect(()=>{
  if(fullscreen&&rootRef.current)return registerLiveDisplay(rootRef.current);
 },[fullscreen,registerLiveDisplay,rootRef]);
 useEffect(()=>{
  const syncFullscreen=()=>{const active=document.fullscreenElement===rootRef.current;setFullscreen(active);if(!active){setPresenting(false);setPaused(false);}};
  const syncOnline=()=>setOnline(navigator.onLine);
  syncOnline();document.addEventListener('fullscreenchange',syncFullscreen);
  window.addEventListener('online',syncOnline);window.addEventListener('offline',syncOnline);
  return()=>{document.removeEventListener('fullscreenchange',syncFullscreen);window.removeEventListener('online',syncOnline);window.removeEventListener('offline',syncOnline);};
 },[rootRef]);
 useEffect(()=>{
  if(!presenting||paused)return;
  const timer=setTimeout(()=>setScene(value=>(value+1)%DASHBOARD_SCENES.length),minutes*60000);
  return()=>clearTimeout(timer);
 },[presenting,paused,minutes,scene,settingsKey]);
 async function enterFullscreen(){
  setError('');
  if(document.fullscreenElement===rootRef.current)return true;
  try{
   if(!rootRef.current?.requestFullscreen)throw new Error('unsupported');
   await rootRef.current.requestFullscreen();return true;
  }catch{setError('Não foi possível abrir a tela cheia. Verifique se o navegador permite esse modo.');return false;}
 }
 async function toggleFullscreen(){
  if(document.fullscreenElement===rootRef.current){try{await document.exitFullscreen();}catch{setError('Use a tecla Esc para sair da tela cheia.');}}
  else await enterFullscreen();
 }
 async function startPresentation(){
  if(await enterFullscreen()){setPaused(false);setPresenting(true);}
 }
 function selectScene(index:number){
  if(isDashboardSceneIndex(index))setScene(index);
 }
 function saveSettings(next:PresentationMinutesByScene|null){
  if(!next){setSettingsFailure({key:settingsKey,message:'Escolha 1, 2, 5 ou 10 minutos para cada aba.'});return false;}
  if(!settingsKey){setSettingsFailure({key:null,message:'Entre para salvar as preferências da apresentação.'});return false;}
  const raw=serializePresentationSettings(next);let persisted=true;
  try{window.localStorage.setItem(settingsKey,raw);fallbackSettings.delete(settingsKey);setSettingsFailure({key:settingsKey,message:''});}
  catch{persisted=false;fallbackSettings.set(settingsKey,raw);setSettingsFailure({key:settingsKey,message:'O tempo foi aplicado nesta sessão, mas o navegador não permitiu salvar a preferência.'});}
  window.dispatchEvent(new CustomEvent(settingsEvent,{detail:{key:settingsKey}}));
  return persisted;
 }
 const setMinutes=(value:number)=>saveSettings(updateAllSceneMinutes(value));
 const setSceneMinutes=(index:number,value:number)=>saveSettings(updateSceneMinutes(readPresentationSettings(readSettingsSnapshot(settingsKey)),index,value));
 return {fullscreen,presenting,paused,minutes,minutesByScene,scene,error,online,settingsError,toggleFullscreen,startPresentation,selectScene,setMinutes,setSceneMinutes,
  togglePause:()=>setPaused(value=>!value),stopPresentation:()=>{setPresenting(false);setPaused(false);}};
}
