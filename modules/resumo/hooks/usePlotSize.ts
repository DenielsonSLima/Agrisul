'use client';
import {useEffect,useState} from 'react';

/** Observe the mounted plot only, including plots appearing after an empty state. */
export function usePlotSize(){
 const [node,ref]=useState<HTMLElement|null>(null),[size,setSize]=useState({width:0,height:0});
 useEffect(()=>{
  if(!node)return;
  const observer=new ResizeObserver(entries=>{const box=entries[0]?.contentRect;if(!box)return;const width=Math.round(box.width),height=Math.round(box.height);setSize(previous=>previous.width===width&&previous.height===height?previous:{width,height});});
  observer.observe(node);return()=>observer.disconnect();
 },[node]);
 return {ref,size};
}
