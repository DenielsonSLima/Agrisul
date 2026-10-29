'use client';
import {useCallback,useEffect,useLayoutEffect,useRef,useSyncExternalStore} from 'react';
import {createTickerMotion,tickerLayout} from './tickerMotion.mjs';

const motionQuery='(prefers-reduced-motion: reduce)';
function subscribeReducedMotion(changed:()=>void){
  const query=window.matchMedia(motionQuery);query.addEventListener('change',changed);
  return()=>query.removeEventListener('change',changed);
}
const reducedMotionSnapshot=()=>window.matchMedia(motionQuery).matches;
export function useTickerMotion(itemCount:number,speed:number,paused:boolean){
  const viewportRef=useRef<HTMLDivElement>(null),trackRef=useRef<HTMLDivElement>(null);
  const controller=useRef<ReturnType<typeof createTickerMotion>|null>(null);
  const subscribeWidth=useCallback((changed:()=>void)=>{
    const element=viewportRef.current;if(!element)return()=>{};
    const observer=new ResizeObserver(changed);observer.observe(element);
    // Observe content too: CSS breakpoints, font loading and variable item
    // widths can change the cycle without resizing its viewport.
    const group=trackRef.current?.firstElementChild;
    if(group)observer.observe(group);
    return()=>observer.disconnect();
  },[]);
  const geometry=useSyncExternalStore(subscribeWidth,()=>{
    const viewport=viewportRef.current?.getBoundingClientRect().width??0;
    const group=trackRef.current?.firstElementChild;
    const renderedCycles=itemCount&&group?group.children.length/itemCount:0;
    const cycleWidth=group&&renderedCycles>0?group.getBoundingClientRect().width/renderedCycles:0;
    // A primitive snapshot stays stable across refetches. Measure the complete
    // catalog cycle so unequal item widths work without a JS/CSS width contract.
    return `${viewport}:${cycleWidth}`;
  },()=> '0:0');
  const [viewport,cycleWidth]=geometry.split(':').map(Number);
  const reducedMotion=useSyncExternalStore(subscribeReducedMotion,reducedMotionSnapshot,()=>true);
  const {repeats,distance}=tickerLayout(viewport,itemCount,cycleWidth);
  useLayoutEffect(()=>{
    const track=trackRef.current;if(!track)return;
    if(!controller.current)controller.current=createTickerMotion(track);
    controller.current.update(distance,speed,paused||reducedMotion);
  },[distance,speed,paused,reducedMotion]);
  useEffect(()=>()=>{controller.current?.destroy();controller.current=null;},[]);
  return {viewportRef,trackRef,repeats,reducedMotion};
}
