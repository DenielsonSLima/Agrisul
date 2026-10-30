'use client';
import {useEffect,useRef} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {authenticatedFetch,rpcRequest} from '@/shared/supabase/rpc';
import {assertSessionActor} from '@/shared/supabase/sessionActor';
import {billingKeys} from '@/shared/query/keys';
import {isWeatherFeed,type WeatherFeed} from './weatherCatalog';
import {weatherRefreshDelay} from './weatherTime.mjs';
import {fetchWeatherPreferences,type WeatherPreferences} from './weatherPreferences';

export function useDashboardWeather(){
 const {user,ready}=useAuth(),userId=user?.id??'',client=useQueryClient(),requests=useRef(new Set<AbortController>());
 const preferenceKey=billingKeys.resource(userId,'weather-preferences');
 useEffect(()=>{const active=requests.current;return()=>{for(const request of active)request.abort();active.clear();};},[userId]);
 const preferences=useQuery({queryKey:preferenceKey,enabled:ready&&!!userId,queryFn:({signal})=>fetchWeatherPreferences(userId,signal)});
 const cities=preferences.data?.cities??[],ids=cities.map(city=>city.id).join(',');
 const query=useQuery({queryKey:[...billingKeys.resource(userId,'dashboard-weather'),{ids,projection:2}],enabled:ready&&!!userId&&!!preferences.data?.configured&&cities.length>0,
  queryFn:async({signal}):Promise<WeatherFeed>=>{const response=await authenticatedFetch(`/api/dashboard-weather?ids=${encodeURIComponent(ids)}`,{signal});if(!response.ok)throw Error('Não foi possível atualizar o clima.');const feed=await response.json();if(!isWeatherFeed(feed)||feed.cities.length!==cities.length)throw Error('Previsão inválida.');return feed;},
  staleTime:1800000,gcTime:3600000,refetchInterval:query=>weatherRefreshDelay(Date.now(),query.state.data?.cities),refetchOnReconnect:'always',refetchOnWindowFocus:'always',
 });
 const mutation=useMutation({
  mutationFn:async({action,cityId}:{action:'add'|'remove'|'reset';cityId?:string})=>{
   const controller=new AbortController();requests.current.add(controller);
   try{await assertSessionActor(userId);controller.signal.throwIfAborted();return await rpcRequest<WeatherPreferences>('weather-preferences',action,cityId?{cityId}:{},controller.signal);}
   finally{requests.current.delete(controller);}
  },
  onMutate:()=>client.cancelQueries({queryKey:preferenceKey}),
  onSuccess:async()=>{await assertSessionActor(userId);await Promise.all([client.invalidateQueries({queryKey:preferenceKey}),client.invalidateQueries({queryKey:billingKeys.resource(userId,'dashboard-weather')})]);},
 });
 return {...query,cities,preferencesLoading:preferences.isPending,preferencesError:preferences.error?.message??'',reloadPreferences:preferences.refetch,
  isSaving:mutation.isPending,changeCities:(action:'add'|'remove'|'reset',cityId?:string)=>mutation.mutateAsync({action,cityId})};
}
