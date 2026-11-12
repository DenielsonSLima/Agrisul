import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {OvertimeInput,OvertimeReport} from '../types';
import {reportDraft} from '../utils/draftRecovery';

export type OvertimeSaveStatus='saved'|'saving'|'error';
export function useOvertimeAutoSave(input:OvertimeInput,report:OvertimeReport|undefined,save:(input:OvertimeInput)=>Promise<OvertimeReport>,onStatus?:(status:OvertimeSaveStatus)=>void){
 const signature=JSON.stringify(input),saved=useRef(signature),baseline=useRef(report),paused=useRef(false);
 const submitted=useRef<OvertimeInput|undefined>(undefined);
 const canSave=!!report;
 const latest=useRef({input,signature}),saveRef=useRef(save),statusRef=useRef(onStatus),enabled=useRef(!!report);
 useLayoutEffect(()=>{latest.current={input,signature};saveRef.current=save;statusRef.current=onStatus;enabled.current=!!report;});
 const inFlight=useRef<Promise<void>|null>(null),mounted=useRef(false),[wake,setWake]=useState(0),[status,setStatus]=useState<OvertimeSaveStatus>('saved');
 const changeStatus=useCallback((value:OvertimeSaveStatus)=>{if(mounted.current){setStatus(value);statusRef.current?.(value);}},[]);
 const flush=async()=>{
  while(inFlight.current)await inFlight.current;
  const snapshot=latest.current;
  if(!enabled.current||!baseline.current||paused.current||snapshot.signature===saved.current)return;
  changeStatus('saving');
  const job=(async()=>{
   try{
    submitted.current=snapshot.input;
    const result=await saveRef.current({...snapshot.input,expectedUpdatedAt:baseline.current?.updatedAt});
    baseline.current=result;saved.current=snapshot.signature;submitted.current=undefined;
    if(latest.current.signature===snapshot.signature)changeStatus('saved');
   }catch{paused.current=true;changeStatus('error');}
   finally{inFlight.current=null;if(mounted.current)setWake(value=>value+1);}
  })();
  inFlight.current=job;await job;
 };
 const flushRef=useRef(flush);useLayoutEffect(()=>{flushRef.current=flush;});
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{
  let active=true;
  // Publish draft status after this render; never enqueue a second write after failure.
  queueMicrotask(()=>{if(active)changeStatus(paused.current?'error':signature===saved.current||!canSave?'saved':'saving');});
  const timer=canSave&&!paused.current&&signature!==saved.current?setTimeout(()=>void flushRef.current(),550):undefined;
  return()=>{active=false;clearTimeout(timer);};
 },[signature,wake,canSave,changeStatus]);
 return {status,flush:async()=>{await flushRef.current();return !paused.current&&latest.current.signature===saved.current;},
  snapshot:async()=>{while(inFlight.current)await inFlight.current;return {baseline:baseline.current,input:latest.current.input,submitted:submitted.current};},
  acceptSnapshot:(value:OvertimeInput,current:OvertimeReport)=>{baseline.current=current;saved.current=JSON.stringify(value);paused.current=false;submitted.current=undefined;latest.current={input:value,signature:JSON.stringify(value)};changeStatus('saved');},
  resume:async(value:OvertimeInput,current:OvertimeReport)=>{
   baseline.current=current;saved.current=JSON.stringify(reportDraft(current));paused.current=false;latest.current={input:value,signature:JSON.stringify(value)};
   if(latest.current.signature===saved.current)changeStatus('saved');else await flushRef.current();
   return !paused.current&&latest.current.signature===saved.current;
  }};
}
