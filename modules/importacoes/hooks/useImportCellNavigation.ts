import {useEffect,useState,type RefObject} from 'react';
import {importCellNavigation,type ImportCellMove,type ImportCellNavigationEntry} from '../utils/cellNavigation';

type Target={entryId:string;fieldKey:string};
/** Keep keyboard intent until mutation/refetch renders the next editable cell. */
export function useImportCellNavigation({gridRef,entries,fields,blocked,updating}:{
 gridRef:RefObject<HTMLDivElement|null>;entries:readonly ImportCellNavigationEntry[];fields:readonly {key:string}[];blocked:boolean;updating:boolean;
}){
 const [pending,setPending]=useState<Target[]|null>(null);
 useEffect(()=>{
  if(!pending)return;
  const cancel=()=>setPending(null);
  window.addEventListener('pointerdown',cancel);
  return()=>window.removeEventListener('pointerdown',cancel);
 },[pending]);
 useEffect(()=>{
  if(!pending||blocked||updating)return;
  let frame:number;
  const focus=()=>{
   const nodes=Array.from(gridRef.current?.querySelectorAll<HTMLInputElement|HTMLButtonElement>('[data-import-cell]')??[]);
   for(const target of pending){
    const node=nodes.find(item=>item.dataset.entryId===target.entryId&&item.dataset.fieldKey===target.fieldKey);
    if(node&&!node.disabled&&!(node instanceof HTMLInputElement&&node.readOnly)){
     node.scrollIntoView({block:'nearest',inline:'nearest'});node.focus();if(node instanceof HTMLButtonElement)node.click();
     setPending(null);return;
    }
   }
   // Local cell state may settle after the parent mutation. Never expire an
   // intended move merely because its target is still saving for a few frames.
   if(pending.some(target=>nodes.some(node=>node.dataset.entryId===target.entryId&&node.dataset.fieldKey===target.fieldKey)))frame=requestAnimationFrame(focus);
   else setPending(null); // The filter removed every target.
  };
  frame=requestAnimationFrame(focus);return()=>cancelAnimationFrame(frame);
 },[pending,blocked,updating,gridRef]);
 return (entryId:string,fieldKey:string,move:ImportCellMove)=>{
  const targets=importCellNavigation(entries,fields,entryId,fieldKey,move);
  setPending(targets.length?targets:[{entryId,fieldKey}]);
 };
}
