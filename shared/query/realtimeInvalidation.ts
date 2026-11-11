import type {QueryClient} from '@tanstack/react-query';
import {billingKeys} from './keys';

/** Reuse running reads: a stream of row events must not restart them forever. */
export function invalidateRealtimeResources(client:QueryClient,userId:string,resources?:readonly string[]){
 const keys=resources?[...new Set(resources)].map(resource=>billingKeys.resource(userId,resource)):[billingKeys.all(userId)];
 return Promise.all(keys.map(queryKey=>client.invalidateQueries({queryKey},{cancelRefetch:false})));
}

/** Drain row bursts in batches, then read again for events received mid-read. */
export function createRealtimeInvalidator(client:QueryClient,userId:string,delayMs=80){
 const pending=new Set<string>();let all=false,active=true,flushing=false;
 let timer:ReturnType<typeof setTimeout>|undefined;
 const schedule=()=>{
  if(!active||flushing||timer)return;
  timer=setTimeout(()=>{timer=undefined;void flush();},delayMs);
 };
 const flush=async()=>{
  if(!active)return;
  const resources=all?undefined:[...pending];pending.clear();all=false;flushing=true;
  try{await invalidateRealtimeResources(client,userId,resources);}
  finally{flushing=false;if(active&&(all||pending.size))schedule();}
 };
 return {
  enqueue(resources:readonly string[]){if(!active)return;resources.forEach(resource=>pending.add(resource));schedule();},
  refreshAll(){if(!active)return;all=true;schedule();},
  dispose(){active=false;pending.clear();if(timer)clearTimeout(timer);},
 };
}
