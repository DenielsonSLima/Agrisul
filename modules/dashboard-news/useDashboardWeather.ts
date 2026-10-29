'use client';
import {useCallback,useMemo,useSyncExternalStore} from 'react';
import {useQuery} from '@tanstack/react-query';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {authenticatedFetch} from '@/shared/supabase/rpc';
import {billingKeys} from '@/shared/query/keys';
import {isWeatherFeed,readWeatherCities,weatherPreferencesKey,type WeatherCity,type WeatherFeed} from './weatherCatalog';

const changeEvent='billing:dashboard-weather-settings',fallback=new Map<string,string>();
const serverSnapshot=()=>'';
function rawPreferences(key:string|null){if(!key||typeof window==='undefined')return '';try{return fallback.get(key)??window.localStorage.getItem(key)??'';}catch{return fallback.get(key)??'';}}
export function useDashboardWeather(){
 const {user,ready}=useAuth(),key=weatherPreferencesKey(user?.id);
 const subscribe=useCallback((changed:()=>void)=>{
  const sync=(event:StorageEvent)=>{if(event.key===key||event.key===null){if(key)fallback.delete(key);changed();}};
  const local=(event:Event)=>{if((event as CustomEvent).detail===key)changed();};
  window.addEventListener('storage',sync);window.addEventListener(changeEvent,local);return()=>{window.removeEventListener('storage',sync);window.removeEventListener(changeEvent,local);};
 },[key]);
 const raw=useSyncExternalStore(subscribe,()=>rawPreferences(key),serverSnapshot),cities=useMemo(()=>readWeatherCities(raw),[raw]);
 const ids=cities.map(city=>city.id).join(',');
 const query=useQuery({queryKey:[...billingKeys.resource(user?.id??'','dashboard-weather'),{ids}],enabled:ready&&!!user&&cities.length>0,
  queryFn:async({signal}):Promise<WeatherFeed>=>{const response=await authenticatedFetch(`/api/dashboard-weather?ids=${encodeURIComponent(ids)}`,{signal});if(!response.ok)throw Error('Não foi possível atualizar o clima.');const feed=await response.json();if(!isWeatherFeed(feed)||feed.cities.length!==cities.length)throw Error('Previsão inválida.');return feed;},
  staleTime:1800000,gcTime:3600000,refetchInterval:1800000,refetchOnReconnect:true,refetchOnWindowFocus:true,
 });
 const saveCities=(next:WeatherCity[])=>{
  if(!key||next.length>20)return false;
  const value=JSON.stringify({version:1,cities:next});let persisted=true;
  try{window.localStorage.setItem(key,value);fallback.delete(key);}catch{fallback.set(key,value);persisted=false;}
  window.dispatchEvent(new CustomEvent(changeEvent,{detail:key}));return persisted;
 };
 return {...query,cities,saveCities};
}
