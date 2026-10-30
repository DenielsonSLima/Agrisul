import {authenticatedFetch,rpcRequest} from '@/shared/supabase/rpc';
import {assertSessionActor} from '@/shared/supabase/sessionActor';
import {readWeatherCities,weatherCitiesFromResponse,weatherPreferencesKey,type WeatherCity} from './weatherCatalog';
export type WeatherPreferences={configured:boolean;revision:string;cities:WeatherCity[]};
function validated(value:WeatherPreferences){
 if(!value||typeof value.configured!=='boolean'||typeof value.revision!=='string'||!/^\d+$/.test(value.revision)||!weatherCitiesFromResponse(value))throw Error('Preferências de clima inválidas.');
 return value;
}
export async function fetchWeatherPreferences(userId:string,signal:AbortSignal){
 await assertSessionActor(userId);
 const current=validated(await rpcRequest<WeatherPreferences>('weather-preferences','get',{},signal));
 if(current.configured)return current;
 let legacy:string|null=null;try{legacy=window.localStorage.getItem(weatherPreferencesKey(userId)!);}catch{}
 const cityIds=readWeatherCities(legacy).map(city=>city.id);
 signal.throwIfAborted();await assertSessionActor(userId);
 const response=await authenticatedFetch('/api/dashboard-weather',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:cityIds}),signal});
 if(!response.ok)throw Error('Não foi possível conferir suas cidades no IBGE.');
 const canonical=weatherCitiesFromResponse(await response.json());
 if(!canonical||canonical.length!==cityIds.length||canonical.some((city,index)=>city.id!==cityIds[index]))throw Error('Não foi possível importar suas cidades.');
 signal.throwIfAborted();await assertSessionActor(userId);
 const initialized=validated(await rpcRequest<WeatherPreferences>('weather-preferences','initialize',{cityIds},signal));
 try{window.localStorage.removeItem(weatherPreferencesKey(userId)!);}catch{}
 return initialized;
}
