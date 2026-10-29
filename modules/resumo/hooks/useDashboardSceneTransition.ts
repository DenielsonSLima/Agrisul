'use client';
import {useEffect,useState,useSyncExternalStore} from 'react';

const motionQuery='(prefers-reduced-motion: reduce)';
const motionSnapshot=()=>window.matchMedia(motionQuery).matches;
const motionServerSnapshot=()=>true;
function subscribeMotion(changed:()=>void){
 const media=window.matchMedia(motionQuery);
 media.addEventListener('change',changed);
 return()=>media.removeEventListener('change',changed);
}

export function useDashboardSceneTransition(target:number){
 const reducedMotion=useSyncExternalStore(subscribeMotion,motionSnapshot,motionServerSnapshot);
 const [displayed,setDisplayed]=useState(target);
 useEffect(()=>{
  if(displayed===target)return;
  // Keep the current content through its fade-out. A new selection cancels
  // this swap, so fast clicks always finish on the most recently chosen tab.
  const timer=window.setTimeout(()=>setDisplayed(target),reducedMotion?0:160);
  return()=>window.clearTimeout(timer);
 },[displayed,target,reducedMotion]);
 const scene=reducedMotion?target:displayed;
 return {scene,leaving:scene!==target};
}
