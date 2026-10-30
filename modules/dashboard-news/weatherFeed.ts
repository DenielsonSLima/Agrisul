import {rpcRequest} from '@/shared/supabase/rpc';
import {isWeatherCity,isWeatherFeed,type WeatherFeed} from './weatherCatalog';
import {normalizeInmetForecast} from './weatherProviders.mjs';

// Select the displayed turn from the stored official response; never fetch sources here.
export function projectWeatherFeed(value:unknown,now=Date.now()):WeatherFeed{
 const snapshot=value as {cities?:unknown;checkedAt?:unknown};
 if(!snapshot||!Array.isArray(snapshot.cities)||snapshot.cities.length>20||typeof snapshot.checkedAt!=='string')throw Error('Previsão inválida.');
 const cities=snapshot.cities.map(row=>{
  if(!row||!isWeatherCity(row.city))throw Error('Previsão inválida.');
  const at=typeof row.fetchedAt==='string'?Date.parse(row.fetchedAt):NaN;
  const current=Number.isFinite(at)&&at<=now+60000&&now-at<=86400000?normalizeInmetForecast(row.payload,row.city,now):null;
  const forecast=current??(Number.isFinite(at)&&at<=now+60000&&now-at<=86400000?normalizeInmetForecast(row.payload,row.city,at):null);
  return forecast?{...forecast,status:current&&now-at<1800000?'current':'cached',updatedAt:row.fetchedAt}:
   {city:row.city,date:null,period:null,daylight:null,sunrise:null,sunset:null,iconCode:null,condition:'Previsão indisponível',minimum:null,maximum:null,humidityMinimum:null,humidityMaximum:null,status:'unavailable',updatedAt:null};
 });
 const feed={cities,checkedAt:snapshot.checkedAt,refreshSeconds:1800,source:'INMET' as const};
 if(!isWeatherFeed(feed))throw Error('Previsão inválida.');return feed;
}

export async function fetchCachedWeather(cityIds:string[],signal:AbortSignal):Promise<WeatherFeed>{
 const controller=new AbortController(),cancel=()=>controller.abort(signal.reason);
 const timer=setTimeout(()=>controller.abort(new Error('A consulta da previsão demorou demais. Tente novamente.')),12000);
 signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
 let onAbort=()=>{};
 try{
  const aborted=new Promise<never>((_,reject)=>{onAbort=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',onAbort,{once:true});if(controller.signal.aborted)onAbort();});
  return await Promise.race([aborted,(async()=>{
   controller.signal.throwIfAborted();
   const feed=projectWeatherFeed(await rpcRequest('dashboard-weather','get',{cityIds},controller.signal));
   if(feed.cities.length!==cityIds.length||cityIds.some(id=>!feed.cities.some(row=>row.city.id===id)))throw Error('Previsão inválida.');
   return feed;
  })()]);
 }finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',onAbort);}
}
