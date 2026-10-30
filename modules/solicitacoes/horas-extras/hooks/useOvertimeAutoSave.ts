import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {OvertimeInput,OvertimeReport} from '../types';

export type OvertimeSaveStatus='saved'|'saving'|'error';
export function useOvertimeAutoSave(input:OvertimeInput,report:OvertimeReport|undefined,save:(input:OvertimeInput)=>Promise<OvertimeReport>,onStatus?:(status:OvertimeSaveStatus)=>void){
 const signature=JSON.stringify(input),saved=useRef(signature),failed=useRef(''),revision=useRef(report?.updatedAt);
 const latest=useRef({input,signature}),saveRef=useRef(save),statusRef=useRef(onStatus);
 useLayoutEffect(()=>{latest.current={input,signature};saveRef.current=save;statusRef.current=onStatus;});
 const inFlight=useRef<Promise<void>|null>(null),mounted=useRef(false),[wake,setWake]=useState(0),[status,setStatus]=useState<OvertimeSaveStatus>('saved');
 const changeStatus=(value:OvertimeSaveStatus)=>{if(mounted.current){setStatus(value);statusRef.current?.(value);}};
 const flush=async()=>{
  while(inFlight.current)await inFlight.current;
  const snapshot=latest.current;
  if(!report||snapshot.signature===saved.current||snapshot.signature===failed.current)return;
  changeStatus('saving');
  const job=(async()=>{
   try{
    const result=await saveRef.current({...snapshot.input,expectedUpdatedAt:revision.current});
    revision.current=result.updatedAt;saved.current=snapshot.signature;failed.current='';
    if(latest.current.signature===snapshot.signature)changeStatus('saved');
   }catch{failed.current=snapshot.signature;changeStatus('error');}
   finally{inFlight.current=null;if(mounted.current)setWake(value=>value+1);}
  })();
  inFlight.current=job;await job;
 };
 const flushRef=useRef(flush);useLayoutEffect(()=>{flushRef.current=flush;});
 useEffect(()=>{mounted.current=true;return()=>{void flushRef.current();mounted.current=false;};},[]);
 useEffect(()=>{
  if(signature===saved.current){setStatus('saved');statusRef.current?.('saved');return;}
  if(signature===failed.current){setStatus('error');statusRef.current?.('error');return;}
  setStatus('saving');statusRef.current?.('saving');
  const timer=setTimeout(()=>void flushRef.current(),550);return()=>clearTimeout(timer);
 },[signature,wake]);
 return {status,flush:()=>flushRef.current()};
}
