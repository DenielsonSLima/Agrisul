'use client';
import {useCallback,useEffect,useMemo,useState,useSyncExternalStore,type RefObject} from 'react';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {DASHBOARD_SCENES,isDashboardSceneIndex,presentationSettingsKey,readDashboardPreferences,serializeDashboardPreferences,validateDashboardPreferences,presentationSceneIndices,nextPresentationScene,updateAllSceneMinutes,updateSceneMinutes,type DashboardPresentationPreferences,type PresentationMinutesByScene} from '../presentationSettings';
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
const indicesFromSignature=(signature:string)=>signature?signature.split(',').map(Number):[];

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
 const preferences=useMemo(()=>readDashboardPreferences(rawSettings),[rawSettings]);
 const {minutesByScene,enabledSceneIds,tvSettings}=preferences;
 const [settingsFailure,setSettingsFailure]=useState<{key:string|null;message:string}>({key:null,message:''});
 const [fullscreen,setFullscreen]=useState(false),[presentingKey,setPresentingKey]=useState<string|null>(null);
 const [paused,setPaused]=useState(false),[selection,setSelection]=useState({key:settingsKey,index:0});
 const [settingsOpen,setSettingsOpen]=useState(false),[playback,setPlayback]=useState({key:settingsKey,active:false});
 const [sessionKey,setSessionKey]=useState(settingsKey);
 const selectedScene=selection.key===settingsKey&&enabledSceneIds.includes(DASHBOARD_SCENES[selection.index]?.id)?selection.index:DASHBOARD_SCENES.findIndex(item=>enabledSceneIds.includes(item.id));
 const rotationIndices=presentationSceneIndices(enabledSceneIds,tvSettings.mode),rotationSignature=rotationIndices.join(',');
 const rotationCount=rotationIndices.length;
 const presenting=!!settingsKey&&presentingKey===settingsKey&&rotationCount>0;
 const scene=presenting&&!rotationIndices.includes(selectedScene)?rotationIndices[0]:selectedScene;
 const playbackActive=DASHBOARD_SCENES[scene].id==='dashboard-tv'&&playback.key===settingsKey&&playback.active;
 const minutes=minutesByScene[DASHBOARD_SCENES[scene].id];
 const settingsError=settingsFailure.key===settingsKey?settingsFailure.message:'';
 const [error,setError]=useState(''),[online,setOnline]=useState(true);
 // Keep account and visibility corrections in the render that observed the change.
 // No committed frame or playback callback can keep the previous account running.
 if(sessionKey!==settingsKey){
  setSessionKey(settingsKey);setPresentingKey(null);setPaused(false);setSettingsOpen(false);setPlayback({key:settingsKey,active:false});setError('');
 }
 if(selection.key!==settingsKey||selection.index!==scene)setSelection({key:settingsKey,index:scene});
 if(presentingKey!==null&&presentingKey===settingsKey&&rotationCount===0)setPresentingKey(null);
 useEffect(()=>{
  if(fullscreen&&rootRef.current)return registerLiveDisplay(rootRef.current);
 },[fullscreen,registerLiveDisplay,rootRef]);
 useEffect(()=>{
  const syncFullscreen=()=>{const active=document.fullscreenElement===rootRef.current;setFullscreen(active);if(!active){setPresentingKey(null);setPaused(false);}};
  const syncOnline=()=>setOnline(navigator.onLine);
  syncOnline();document.addEventListener('fullscreenchange',syncFullscreen);
  window.addEventListener('online',syncOnline);window.addEventListener('offline',syncOnline);
  return()=>{document.removeEventListener('fullscreenchange',syncFullscreen);window.removeEventListener('online',syncOnline);window.removeEventListener('offline',syncOnline);};
 },[rootRef]);
 useEffect(()=>{
  if(!presenting||paused||settingsOpen||playbackActive||rotationCount<2)return;
  const timer=setTimeout(()=>setSelection({key:settingsKey,index:nextPresentationScene(scene,indicesFromSignature(rotationSignature))}),Math.round(minutes*60000));
  return()=>clearTimeout(timer);
 },[presenting,paused,settingsOpen,playbackActive,minutes,scene,settingsKey,rotationSignature,rotationCount]);
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
  if(!rotationIndices.length){setError('Ative uma aba para a apresentação ou altere a opção de pular a TV Agro.');return;}
  if(await enterFullscreen()){
   if(!rotationIndices.includes(scene))setSelection({key:settingsKey,index:rotationIndices[0]});
   setPaused(false);setPresentingKey(settingsKey);
  }
 }
 function selectScene(index:number){
  if(isDashboardSceneIndex(index)&&enabledSceneIds.includes(DASHBOARD_SCENES[index].id)){
   setPlayback({key:settingsKey,active:false});setSelection({key:settingsKey,index});
  }
 }
 function savePreferences(next:DashboardPresentationPreferences){
  const validated=validateDashboardPreferences(next);
  if(!validated){setSettingsFailure({key:settingsKey,message:'Escolha tempos válidos, mantenha pelo menos uma aba e um canal ativos.'});return false;}
  if(!settingsKey){setSettingsFailure({key:null,message:'Entre para salvar as preferências da apresentação.'});return false;}
  const raw=serializeDashboardPreferences(validated);let persisted=true;
  try{window.localStorage.setItem(settingsKey,raw);fallbackSettings.delete(settingsKey);setSettingsFailure({key:settingsKey,message:''});}
  catch{persisted=false;fallbackSettings.set(settingsKey,raw);setSettingsFailure({key:settingsKey,message:'O ajuste foi aplicado nesta sessão, mas o navegador não permitiu salvar a preferência.'});}
  window.dispatchEvent(new CustomEvent(settingsEvent,{detail:{key:settingsKey}}));
  return persisted;
 }
 function saveSettings(next:PresentationMinutesByScene|null){
  if(!next){setSettingsFailure({key:settingsKey,message:'Escolha 10, 20 ou 30 segundos, ou 1, 2, 5 ou 10 minutos para cada aba.'});return false;}
  return savePreferences({...readDashboardPreferences(readSettingsSnapshot(settingsKey)),minutesByScene:next});
 }
 const setMinutes=(value:number)=>saveSettings(updateAllSceneMinutes(value));
 const setSceneMinutes=(index:number,value:number)=>saveSettings(updateSceneMinutes(readDashboardPreferences(readSettingsSnapshot(settingsKey)).minutesByScene,index,value));
 const setPlaybackActive=useCallback((active:boolean)=>setPlayback({key:settingsKey,active}),[settingsKey]);
 const onPlaybackEnded=useCallback(()=>{
  setPlayback({key:settingsKey,active:false});
  if(presenting&&!paused&&!settingsOpen&&rotationCount>1)setSelection({key:settingsKey,index:nextPresentationScene(scene,indicesFromSignature(rotationSignature))});
 },[settingsKey,presenting,paused,settingsOpen,scene,rotationSignature,rotationCount]);
 const setTvMode=(mode:'autoplay'|'preview')=>savePreferences({...preferences,tvSettings:{...tvSettings,mode}});
 return {fullscreen,presenting,paused,minutes,minutesByScene,enabledSceneIds,tvSettings,scene,error,online,settingsError,playbackActive,toggleFullscreen,startPresentation,selectScene,setMinutes,setSceneMinutes,savePreferences,setTvMode,setSettingsOpen,setPlaybackActive,onPlaybackEnded,
  togglePause:()=>setPaused(value=>!value),stopPresentation:()=>{setPresentingKey(null);setPaused(false);}};
}
