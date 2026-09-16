'use client';
import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {Toaster} from '@/components/ui/sonner';
import {ConfirmationDialog} from './ConfirmationDialog';
import {notifications} from './notifications';
import type {ConfirmationOptions} from './models';
import {useAuth} from '@/shared/supabase/AuthProvider';

type Confirm=(options:ConfirmationOptions)=>Promise<boolean>;
const ConfirmationContext=createContext<Confirm|null>(null);

export function FeedbackProvider({children}:{children:ReactNode}){
 const {user}=useAuth();
 const [options,setOptions]=useState<ConfirmationOptions|null>(null);
 const resolver=useRef<((confirmed:boolean)=>void)|null>(null);
 const confirm=useCallback<Confirm>(next=>new Promise(resolve=>{
  resolver.current?.(false);resolver.current=resolve;setOptions(next);
 }),[]);
 const decide=useCallback((confirmed:boolean)=>{
  const resolve=resolver.current;resolver.current=null;setOptions(null);resolve?.(confirmed);
 },[]);
 const identity=useRef<string|null>(user?.id??null);
 useEffect(()=>{const next=user?.id??null;if(identity.current!==next){identity.current=next;resolver.current?.(false);resolver.current=null;setOptions(null);notifications.dismiss();}},[user?.id]);
 useEffect(()=>()=>{resolver.current?.(false);resolver.current=null;notifications.dismiss();},[]);
 return <ConfirmationContext.Provider value={confirm}>
  {children}
  <Toaster position="top-right" richColors closeButton visibleToasts={4}/>
  {options&&<ConfirmationDialog options={options} onDecision={decide}/>} 
 </ConfirmationContext.Provider>;
}

export function useConfirmation(){
 const value=useContext(ConfirmationContext);
 if(!value)throw new Error('FeedbackProvider necessário.');
 return value;
}
