'use client';
import {createContext,useContext,useState,type Dispatch,type SetStateAction,type ReactNode} from 'react';
import type {Customer,Contract,Event,Settings} from '../types';
import {useSettings} from '@/modules/configuracoes/hooks/useSettings';
import {useAuth} from '@/shared/supabase/AuthProvider';
import * as seed from './seed';
type State={
  customers:Customer[];setCustomers:Dispatch<SetStateAction<Customer[]>>;
  contracts:Contract[];setContracts:Dispatch<SetStateAction<Contract[]>>;
  events:Event[];setEvents:Dispatch<SetStateAction<Event[]>>;
  settings:Settings;
};
const Context=createContext<State|null>(null);
export function AppProvider({children}:{children:ReactNode}){
  const {user}=useAuth();const profile=useSettings();
  const [customers,setCustomers]=useState(seed.customers);
  const [contracts,setContracts]=useState(seed.contracts);
  const [events,setEvents]=useState(seed.events);
  const settings:Settings=profile.settings??{
    name:user?.user_metadata?.display_name||user?.email||'Minha conta',
    company:'Meu espaço de trabalho',email:user?.email||'',compact:false,
  };
  return <Context.Provider value={{customers,setCustomers,contracts,setContracts,events,setEvents,settings}}>{children}</Context.Provider>;
}
export const useApp=()=>{const value=useContext(Context);if(!value)throw new Error('AppProvider necessário');return value;};
